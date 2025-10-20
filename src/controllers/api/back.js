// routes/lionRows.js
// SSRM handlers: lê JSONs estáticos, aplica limpeza/filtro/sort/paginação
// e responde no formato esperado pelo AG Grid Server-Side.
//
// Endpoints:
// - POST /api/ssrm/?clean=1
// - POST /api/adsets/?campaign_id=...&period=TODAY|YESTERDAY
// - POST /api/ads/?adset_id=...&period=TODAY|YESTERDAY
//
// Observação: todos aceitam também GET com os mesmos parâmetros na querystring.
// Em caso de erro, SEMPRE retornam JSON (evita “error code: 1042”).
// no topo do routes/lionRows.js
const BID_OVERRIDES = new Map(); // id -> number

async function patchCampaignBid(req) {
	try {
		const body = await req.json().catch(() => ({}));
		const id = String(body.id || '').trim();
		const bid = Number(body.bid);
		if (!id || !Number.isFinite(bid)) {
			return new Response(JSON.stringify({ error: 'id/bid inválidos' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		BID_OVERRIDES.set(id, bid);
		return new Response(JSON.stringify({ ok: true }), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		return new Response(JSON.stringify({ error: String(err?.message || err) }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/* ==================== Helpers de texto/número ==================== */
const stripHtml = (s) =>
	typeof s === 'string'
		? s
				.replace(/<[^>]*>/g, ' ')
				.replace(/\s+/g, ' ')
				.trim()
		: s;

const strongText = (s) => {
	if (typeof s !== 'string') return s;
	const m = s.match(/<strong[^>]*>(.*?)<\/strong>/i);
	return stripHtml(m ? m[1] : s);
};

// "R$ 1.618,65" | "-R$ 1,00" | "2.360,73" -> Number
const toNumberBR = (s) => {
	if (s == null) return null;
	if (typeof s === 'number' && Number.isFinite(s)) return s;
	const raw = String(s).trim();
	if (!raw) return null;
	const sign = raw.includes('-') ? -1 : 1;
	const only = raw
		.replace(/[^\d,.-]/g, '')
		.replace(/\./g, '')
		.replace(',', '.');
	const n = Number(only);
	return Number.isFinite(n) ? sign * n : null;
};

function cleanRow(r) {
	return {
		...r,
		profile_name: stripHtml(r.profile_name),
		bc_name: stripHtml(r.bc_name),
		account_name: stripHtml(r.account_name),
		account_status: strongText(r.account_status), // extrai texto do <strong>
		campaign_name: stripHtml(r.campaign_name),
		revenue: stripHtml(r.revenue),
		mx: stripHtml(r.mx),
	};
}

// extrai apenas o primeiro número principal (ex: "R$ 2.553,34 (R$ 341,69...)" → 2553.34)
function toNumberFirst(s) {
	if (s == null) return null;
	const str = String(s);
	const match = str.match(/-?\d{1,3}(?:\.\d{3})*,\d{2}/) || str.match(/-?\d+(?:\.\d+)?/);
	if (!match) return null;
	const clean = match[0].replace(/\./g, '').replace(',', '.');
	const n = parseFloat(clean);
	return Number.isFinite(n) ? n : null;
}

// sort universal (com suporte a revenue e status custom)
function applySort(rows, sortModel) {
	if (!Array.isArray(sortModel) || !sortModel.length) return rows;

	return rows.slice().sort((a, b) => {
		for (const s of sortModel) {
			const { colId, sort } = s;
			const dir = sort === 'desc' ? -1 : 1;

			let av = a[colId];
			let bv = b[colId];

			/* ======== 1️⃣ ordem customizada para STATUS ======== */
			if (colId === 'account_status' || colId === 'campaign_status') {
				const order = ['ACTIVE', 'PAUSED', 'DISABLED', 'CLOSED'];
				const ai = order.indexOf(String(av).toUpperCase());
				const bi = order.indexOf(String(bv).toUpperCase());
				const cmp = (ai - bi) * dir;
				if (cmp !== 0) return cmp;
				continue;
			}

			/* ======== 2️⃣ caso especial para REVENUE ======== */
			if (colId === 'revenue') {
				const an = toNumberFirst(av);
				const bn = toNumberFirst(bv);
				if (an == null && bn == null) continue;
				if (an == null) return -1 * dir;
				if (bn == null) return 1 * dir;
				if (an !== bn) return (an < bn ? -1 : 1) * dir;
				continue;
			}

			/* ======== 3️⃣ comportamento padrão ======== */
			const an = toNumberBR(av);
			const bn = toNumberBR(bv);
			const bothNumeric = an != null && bn != null;

			let cmp;
			if (bothNumeric) {
				cmp = an === bn ? 0 : an < bn ? -1 : 1;
			} else {
				const as = String(av ?? '').toLowerCase();
				const bs = String(bv ?? '').toLowerCase();
				cmp = as.localeCompare(bs, 'pt-BR');
			}

			if (cmp !== 0) return cmp * dir;
		}
		return 0;
	});
}

function applyFilters(rows, filterModel) {
	if (!filterModel || typeof filterModel !== 'object') return rows;

	const checks = Object.entries(filterModel).map(([field, f]) => {
		const ft = f.filterType || f.type || 'text';

		if (ft === 'text') {
			const needle = String(f.filter ?? '').toLowerCase();
			if (!needle) return () => true;
			return (r) =>
				String(r[field] ?? '')
					.toLowerCase()
					.includes(needle);
		}

		if (ft === 'number') {
			const comp = String(f.type || 'equals');
			const val = Number(f.filter);
			return (r) => {
				const n = toNumberBR(r[field]);
				if (n == null) return false;
				if (comp === 'equals') return n === val;
				if (comp === 'greaterThan') return n > val;
				if (comp === 'lessThan') return n < val;
				if (comp === 'greaterThanOrEqual') return n >= val;
				if (comp === 'lessThanOrEqual') return n <= val;
				if (comp === 'notEqual') return n !== val;
				return true;
			};
		}

		return () => true;
	});

	return rows.filter((r) => checks.every((fn) => fn(r)));
}

/* ==================== Agregadores de rodapé ==================== */

const sum = (a, b) => (Number.isFinite(a) ? a : 0) + (Number.isFinite(b) ? b : 0);
const safeDiv = (num, den) => (den > 0 ? num / den : 0);

function sumField(rows, field) {
	return rows.reduce((acc, r) => sum(acc, toNumberBR(r[field])), 0);
}
function hasSomeField(rows, field) {
	return rows.some((r) => toNumberBR(r[field]) != null);
}

// Totais/rodapé para a RAIZ (campanhas)
function computeTotalsRoot(rows) {
	const totals = {};

	// Somas
	totals.impressions_sum = sumField(rows, 'impressions');
	totals.clicks_sum = sumField(rows, 'clicks');
	totals.visitors_sum = sumField(rows, 'visitors');
	totals.conversions_sum = sumField(rows, 'conversions');
	totals.real_conversions_sum = sumField(rows, 'real_conversions');
	totals.spent_sum = sumField(rows, 'spent');
	totals.fb_revenue_sum = sumField(rows, 'fb_revenue');
	totals.push_revenue_sum = sumField(rows, 'push_revenue');
	totals.revenue_sum = totals.fb_revenue_sum + totals.push_revenue_sum;
	totals.profit_sum = sumField(rows, 'profit');
	totals.budget_sum = sumField(rows, 'budget');

	// Médias derivadas / ponderadas
	totals.cpc_total = safeDiv(totals.spent_sum, totals.clicks_sum);
	totals.cpa_fb_total = safeDiv(totals.spent_sum, totals.conversions_sum);
	totals.real_cpa_total = safeDiv(totals.spent_sum, totals.real_conversions_sum);
	totals.ctr_total = safeDiv(totals.clicks_sum, totals.impressions_sum);
	totals.mx_total = safeDiv(totals.revenue_sum, totals.spent_sum);

	return totals;
}

// Totais genéricos (adsets/ads). Calcula o que existir.
function computeTotalsGeneric(rows) {
	const totals = {};

	// somas "comuns"
	const maybeSum = (key, outKey = `${key}_sum`) => {
		if (hasSomeField(rows, key)) totals[outKey] = sumField(rows, key);
	};

	// campos que podem existir nos mocks
	[
		'impressions',
		'clicks',
		'visitors',
		'conversions',
		'real_conversions',
		'spent',
		'budget',
		'profit',
		'fb_revenue',
		'push_revenue',
		'revenue',
	].forEach((f) => maybeSum(f));

	// revenue_sum se não veio como field
	if (totals.revenue_sum == null) {
		const fb = totals.fb_revenue_sum ?? 0;
		const pr = totals.push_revenue_sum ?? 0;
		totals.revenue_sum = fb + pr;
	}

	// derivadas usuais
	const clicks = totals.clicks_sum ?? 0;
	const impressions = totals.impressions_sum ?? 0;
	const conversions = totals.conversions_sum ?? 0;
	const realConvs = totals.real_conversions_sum ?? 0;
	const spent = totals.spent_sum ?? 0;
	const revenue = totals.revenue_sum ?? 0;

	totals.cpc_total = safeDiv(spent, clicks);
	totals.cpa_total = safeDiv(spent, conversions); // "CPA" genérico, se existir no dataset
	totals.real_cpa_total = safeDiv(spent, realConvs);
	totals.ctr_total = safeDiv(clicks, impressions);
	totals.epc_total = safeDiv(revenue, clicks);
	totals.mx_total = safeDiv(revenue, spent);

	return totals;
}

/* ==================== Carregamento via ASSETS/public ==================== */
// No wrangler.toml, configure:
//
// [assets]
// binding = "ASSETS"
// directory = "./public"
//
// Se o arquivo estiver em ./public/constants/clean-dump.json,
// o path aqui é "/constants/clean-dump.json" (sem /public).

// troque o seu loadAssetJSON por este
async function loadAssetJSON(request, env, assetPath) {
	// cache leve por arquivo
	globalThis.__LION_CACHE__ = globalThis.__LION_CACHE__ || new Map();
	const cache = globalThis.__LION_CACHE__;
	if (cache.has(assetPath)) return cache.get(assetPath);

	const urlFrom = (path) => new URL(path, request.url);

	// 1) tenta ASSETS, mas não dá throw se falhar; loga e faz fallback
	if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
		try {
			const assetReq = new Request(urlFrom(assetPath), request);
			const res = await env.ASSETS.fetch(assetReq);
			if (res && res.ok) {
				const json = await res.json();
				cache.set(assetPath, json);
				return json;
			} else {
				console.warn('[ASSETS] non-ok', res?.status, assetPath);
			}
		} catch (e) {
			console.warn('[ASSETS] fetch failed, falling back to /public', e);
		}
	}

	// 2) fallback /public SEMPRE que ASSETS falhar
	try {
		const res2 = await fetch(urlFrom(`/public${assetPath}`));
		if (!res2.ok) {
			const body = await res2.text().catch(() => '');
			console.error('[PUBLIC] non-ok', res2.status, assetPath, body.slice(0, 200));
			// último recurso: evita 500 duro; devolve array vazio (ou lance erro se preferir)
			return [];
		}
		const json = await res2.json();
		cache.set(assetPath, json);
		return json;
	} catch (e) {
		console.error('[PUBLIC] fetch failed', e);
		// último recurso: evita 500 duro
		return [];
	}
}

// Loader “especial” do dump raiz (mantido por compatibilidade)
async function loadDump(request, env) {
	return loadAssetJSON(request, env, '/constants/clean-dump.json');
}

/* ==================== Parser do request (POST body ou GET query) ==================== */
function parseRequestPayload(req) {
	// Suporta POST (body JSON) e GET (querystring)
	const url = new URL(req.url);

	// Defaults
	let startRow = 0;
	let endRow = 200;
	let sortModel = [];
	let filterModel = {};

	return req
		.json()
		.catch(() => ({}))
		.then((body) => {
			if (body && typeof body === 'object' && Object.keys(body).length) {
				startRow = Number.isFinite(body.startRow) ? body.startRow : startRow;
				endRow = Number.isFinite(body.endRow) ? body.endRow : endRow;
				sortModel = Array.isArray(body.sortModel) ? body.sortModel : sortModel;
				filterModel = typeof body.filterModel === 'object' ? body.filterModel : filterModel;

				// permite também passar campaign_id/adset_id/period no body
				if (body.campaign_id) url.searchParams.set('campaign_id', body.campaign_id);
				if (body.adset_id) url.searchParams.set('adset_id', body.adset_id);
				if (body.period) url.searchParams.set('period', body.period);
			} else {
				// Query (GET) fallback
				const sr = Number(url.searchParams.get('startRow'));
				const er = Number(url.searchParams.get('endRow'));
				if (Number.isFinite(sr)) startRow = sr;
				if (Number.isFinite(er)) endRow = er;
				try {
					const sm = JSON.parse(url.searchParams.get('sortModel') || '[]');
					if (Array.isArray(sm)) sortModel = sm;
				} catch {}
				try {
					const fm = JSON.parse(url.searchParams.get('filterModel') || '{}');
					if (fm && typeof fm === 'object') filterModel = fm;
				} catch {}
			}
			return { startRow, endRow, sortModel, filterModel, url: url.toString() };
		});
}

/* ==================== Filtro por parent + period ==================== */
function filterByParentAndPeriod(rows, { idKey, idValue, period }) {
	const wantPeriod = String(period || 'TODAY').toUpperCase();
	return rows.filter((r) => {
		const idOk = !idValue || String(r[idKey]) === String(idValue);
		const periodOk = String(r.period || 'TODAY').toUpperCase() === wantPeriod;
		return idOk && periodOk;
	});
}

/* ==================== /api/ssrm/ (raiz) ==================== */
async function ssrm(req, env) {
	try {
		// cada uso do Request recebe seu próprio clone
		const reqForBody = req.clone(); // para ler o body/json
		const reqForAssets = req.clone(); // para carregar assets/dump

		// lê payload (POST/GET) a partir do clone do body
		const { url, startRow, endRow, sortModel, filterModel } = await parseRequestPayload(reqForBody);
		const clean = new URL(url).searchParams.get('clean') === '1';

		// carrega dump raiz a partir do clone para assets
		const full = await loadDump(reqForAssets, env); // array completo
		if (!Array.isArray(full)) {
			throw new Error('Dump JSON inválido (esperado array).');
		}

		// limpeza opcional
		let rows = clean ? full.map(cleanRow) : full;

		// filtro e ordenação
		rows = applyFilters(rows, filterModel);
		rows = applySort(rows, sortModel);
		rows = rows.map((r) => {
			const ov = BID_OVERRIDES.get(String(r.id));
			return ov != null ? { ...r, bid: ov } : r;
		});

		// >>> Totais sobre o CONJUNTO FILTRADO (antes da paginação)
		const totals = computeTotalsRoot(rows);

		// paginação em bloco (SSRM)
		const safeEnd = Math.min(Math.max(endRow, 0), rows.length);
		const safeStart = Math.min(Math.max(startRow, 0), safeEnd);
		const slice = rows.slice(safeStart, safeEnd);

		// resposta sempre em JSON
		return new Response(JSON.stringify({ rows: slice, lastRow: rows.length, totals }), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		return new Response(JSON.stringify({ error: String(err?.message || err) }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/* ==================== /api/adsets (filtra por campaign_id + period) ==================== */
async function adsets(req, env) {
	try {
		const reqForBody = req.clone();
		const reqForAssets = req.clone();

		const { startRow, endRow, sortModel, filterModel, url } = await parseRequestPayload(reqForBody);
		const u = new URL(url);
		const campaignId = u.searchParams.get('campaign_id') || (filterModel?.campaign_id?.filter ?? '');
		const period = (
			u.searchParams.get('period') ||
			filterModel?.period?.filter ||
			'TODAY'
		).toUpperCase();

		// Carrega flat adsets (./public/constants/adsets.json)
		// Esperado: [{ id, idroot: <campaign_id>, period, name, status, ... }, ...]
		const full = await loadAssetJSON(reqForAssets, env, '/constants/adsets.json');
		if (!Array.isArray(full)) throw new Error('adsets.json inválido (esperado array).');

		// 1) parent + period
		let rows = filterByParentAndPeriod(full, { idKey: 'idroot', idValue: campaignId, period });

		// 2) filtros genéricos
		rows = applyFilters(rows, filterModel);

		// 3) ordena
		rows = applySort(rows, sortModel);

		// >>> Totais sobre o conjunto filtrado
		const totals = computeTotalsGeneric(rows);

		// 4) SSRM slice
		const safeEnd = Math.min(Math.max(endRow, 0), rows.length);
		const safeStart = Math.min(Math.max(startRow, 0), safeEnd);
		const slice = rows.slice(safeStart, safeEnd);

		return new Response(JSON.stringify({ rows: slice, lastRow: rows.length, totals }), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		return new Response(JSON.stringify({ error: String(err?.message || err) }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/* ==================== /api/ads (filtra por adset_id + period) ==================== */
async function ads(req, env) {
	try {
		const reqForBody = req.clone();
		const reqForAssets = req.clone();

		const { startRow, endRow, sortModel, filterModel, url } = await parseRequestPayload(reqForBody);
		const u = new URL(url);
		const adsetId = u.searchParams.get('adset_id') || (filterModel?.adset_id?.filter ?? '');
		const period = (
			u.searchParams.get('period') ||
			filterModel?.period?.filter ||
			'TODAY'
		).toUpperCase();

		// Carrega flat ads (./public/constants/ads.json)
		// Esperado: [{ id, idchild: <adset_id>, period, name, status, preview_url, ... }, ...]
		const full = await loadAssetJSON(reqForAssets, env, '/constants/ads.json');
		if (!Array.isArray(full)) throw new Error('ads.json inválido (esperado array).');

		// 1) parent + period
		let rows = filterByParentAndPeriod(full, { idKey: 'idchild', idValue: adsetId, period });

		// 2) filtros genéricos
		rows = applyFilters(rows, filterModel);

		// 3) ordena
		rows = applySort(rows, sortModel);

		// >>> Totais sobre o conjunto filtrado
		const totals = computeTotalsGeneric(rows);

		// 4) SSRM slice
		const safeEnd = Math.min(Math.max(endRow, 0), rows.length);
		const safeStart = Math.min(Math.max(startRow, 0), safeEnd);
		const slice = rows.slice(safeStart, safeEnd);

		return new Response(JSON.stringify({ rows: slice, lastRow: rows.length, totals }), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		return new Response(JSON.stringify({ error: String(err?.message || err) }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/* ==================== Export ==================== */
export default {
	ssrm,
	adsets,
	ads,
	bid: patchCampaignBid, // opcional se você roteia por nome
};
