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
			if (colId === 'account_status' || colId === 'campaign_status' || colId === 'status') {
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

	const globalFilter = String(filterModel._global?.filter || '')
		.trim()
		.toLowerCase();

	const checks = Object.entries(filterModel)
		.filter(([field]) => field !== '_global')
		.map(([field, f]) => {
			const ft = f.filterType || f.type || 'text';

			// === includes / excludes (lista de valores)
			if (ft === 'includes' && Array.isArray(f.values)) {
				const set = new Set(f.values.map((v) => String(v).toLowerCase()));
				return (r) => set.has(String(r[field] ?? '').toLowerCase());
			}
			if (ft === 'excludes' && Array.isArray(f.values)) {
				const set = new Set(f.values.map((v) => String(v).toLowerCase()));
				return (r) => !set.has(String(r[field] ?? '').toLowerCase());
			}

			// === texto padrão com todos os tipos (contains, notContains, startsWith, endsWith, equals, notEqual)
			if (ft === 'text') {
				const comp = String(f.type || 'contains');
				const needle = String(f.filter ?? '').toLowerCase();
				if (!needle) return () => true;
				return (r) => {
					const val = String(r[field] ?? '').toLowerCase();
					switch (comp) {
						case 'equals':
							return val === needle;
						case 'notEqual':
							return val !== needle;
						case 'startsWith':
							return val.startsWith(needle);
						case 'endsWith':
							return val.endsWith(needle);
						case 'notContains':
							return !val.includes(needle);
						case 'contains':
						default:
							return val.includes(needle);
					}
				};
			}

			// === número padrão (adiciona contains/notContains também)
			if (ft === 'number') {
				const comp = String(f.type || 'equals');
				const val = Number(f.filter);
				return (r) => {
					const n = toNumberBR(r[field]);
					if (n == null) return false;
					switch (comp) {
						case 'equals':
							return n === val;
						case 'notEqual':
							return n !== val;
						case 'greaterThan':
							return n > val;
						case 'lessThan':
							return n < val;
						case 'greaterThanOrEqual':
							return n >= val;
						case 'lessThanOrEqual':
							return n <= val;
						case 'contains':
							return String(n).includes(String(val));
						case 'notContains':
							return !String(n).includes(String(val));
						default:
							return true;
					}
				};
			}

			return () => true;
		});

	return rows.filter((r) => {
		const globalMatch =
			!globalFilter ||
			Object.values(r).some((v) =>
				String(v ?? '')
					.toLowerCase()
					.includes(globalFilter)
			);
		return globalMatch && checks.every((fn) => fn(r));
	});
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
	const maybeSum = (key, outKey = `${key}_sum`) => {
		if (hasSomeField(rows, key)) totals[outKey] = sumField(rows, key);
	};
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
	if (totals.revenue_sum == null) {
		const fb = totals.fb_revenue_sum ?? 0;
		const pr = totals.push_revenue_sum ?? 0;
		totals.revenue_sum = fb + pr;
	}
	const clicks = totals.clicks_sum ?? 0;
	const impressions = totals.impressions_sum ?? 0;
	const conversions = totals.conversions_sum ?? 0;
	const realConvs = totals.real_conversions_sum ?? 0;
	const spent = totals.spent_sum ?? 0;
	const revenue = totals.revenue_sum ?? 0;

	totals.cpc_total = safeDiv(spent, clicks);
	totals.cpa_total = safeDiv(spent, conversions);
	totals.real_cpa_total = safeDiv(spent, realConvs);
	totals.ctr_total = safeDiv(clicks, impressions);
	totals.epc_total = safeDiv(revenue, clicks);
	totals.mx_total = safeDiv(revenue, spent);
	return totals;
}

/* ==================== Carregamento via ASSETS/public ==================== */
async function loadAssetJSON(request, env, assetPath) {
	globalThis.__LION_CACHE__ = globalThis.__LION_CACHE__ || new Map();
	const cache = globalThis.__LION_CACHE__;
	if (cache.has(assetPath)) return cache.get(assetPath);

	const absolute = new URL(assetPath, 'https://assets.local');

	if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
		const res = await env.ASSETS.fetch(new Request(absolute.href, request));
		if (!res || !res.ok) {
			const body = await res?.text?.().catch(() => '');
			throw new Error(
				`[ASSETS] ${res?.status || 'ERR'} ao ler ${assetPath}: ${body?.slice?.(0, 200) || ''}`
			);
		}
		const json = await res.json();
		cache.set(assetPath, json);
		return json;
	}

	if (globalThis.__DEV_ALLOW_HTTP_ASSETS__) {
		const devUrl = new URL(assetPath, request.url);
		const res2 = await fetch(devUrl.href);
		if (!res2.ok) {
			const body = await res2.text().catch(() => '');
			throw new Error(
				`[DEV-FALLBACK] ${res2.status} ao ler ${devUrl.href}: ${body.slice(0, 200)}`
			);
		}
		const json = await res2.json();
		cache.set(assetPath, json);
		return json;
	}

	throw new Error('ASSETS não configurado e DEV fallback desativado.');
}
async function loadDump(request, env) {
	return loadAssetJSON(request, env, '/constants/clean-dump.json');
}

/* ==================== Parser do request (POST body ou GET query) ==================== */
function parseRequestPayload(req) {
	const url = new URL(req.url);

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

				if (body.campaign_id) url.searchParams.set('campaign_id', body.campaign_id);
				if (body.adset_id) url.searchParams.set('adset_id', body.adset_id);
				if (body.period) url.searchParams.set('period', body.period);
			} else {
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

/* ==================== Overlay em memória ==================== */
// ⚠️ VOLÁTIL: por isolate. Para durabilidade real, use KV/D1.
function getMutStore() {
	globalThis.__LION_MUT__ = globalThis.__LION_MUT__ || { campaigns: new Map(), adsets: new Map() };
	return globalThis.__LION_MUT__;
}

// Campaign overlay (root)
function overlayCampaign(row) {
	const store = getMutStore();
	const id = String(row.id ?? row.utm_campaign ?? '');
	if (!id) return row;
	const mut = store.campaigns.get(id);
	if (!mut) return row;
	return { ...row, ...mut };
}
function overlayCampaignArray(rows) {
	return rows.map(overlayCampaign);
}

// Adset overlay
function overlayAdset(row) {
	const store = getMutStore();
	const id = String(row.id ?? '');
	if (!id) return row;
	const mut = store.adsets.get(id);
	if (!mut) return row;
	return { ...row, ...mut };
}
function overlayAdsetArray(rows) {
	return rows.map(overlayAdset);
}

async function adsets(req, env) {
	try {
		const reqForBody = req.clone();
		const reqForAssets = req.clone();

		let { startRow, endRow, sortModel, filterModel, url } = await parseRequestPayload(reqForBody);
		filterModel = normalizeFilterKeys(filterModel);
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

		// overlay antes de filtrar/ordenar
		rows = overlayAdsetArray(rows);

		// campo virtual (compat com colId "campaign" da auto group column)
		rows = rows.map((r) => ({ ...r, campaign: stripHtml(r.name || '') }));

		// 2) filtros genéricos
		rows = applyFilters(rows, filterModel);

		// 3) ordena
		rows = applySort(rows, sortModel);

		// Totais
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

async function ads(req, env) {
	try {
		const reqForBody = req.clone();
		const reqForAssets = req.clone();

		let { startRow, endRow, sortModel, filterModel, url } = await parseRequestPayload(reqForBody);
		filterModel = normalizeFilterKeys(filterModel);
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

		// campo virtual (compat com colId "campaign" da auto group column)
		rows = rows.map((r) => ({ ...r, campaign: stripHtml(r.name || '') }));

		// 2) filtros genéricos
		rows = applyFilters(rows, filterModel);

		// 3) ordena
		rows = applySort(rows, sortModel);

		// Totais
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

/* ==================== Mutations (Campaigns + Adsets) ==================== */
async function updateCampaignStatus(req, env) {
	try {
		const url = new URL(req.url);
		const parts = url.pathname.split('/').filter(Boolean); // ["api","campaigns",":id","status"]
		const id = parts[2];
		if (!id) throw new Error('Missing campaign id');

		const body = await req.json().catch(() => ({}));
		const status = String(body.status || '').toUpperCase();
		const allow = new Set(['ACTIVE', 'PAUSED', 'DISABLED', 'CLOSED']);
		if (!allow.has(status)) throw new Error('Invalid status');

		const store = getMutStore();
		const prev = store.campaigns.get(id) || {};
		store.campaigns.set(id, { ...prev, campaign_status: status, status });

		return new Response(JSON.stringify({ ok: true, id, status }), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

// ⚠️ NOVA: adset status
async function updateAdsetStatus(req, env) {
	try {
		const url = new URL(req.url);
		const parts = url.pathname.split('/').filter(Boolean); // ["api","adsets",":id","status"]
		const id = parts[2];
		if (!id) throw new Error('Missing adset id');

		const body = await req.json().catch(() => ({}));
		const status = String(body.status || '').toUpperCase();
		const allow = new Set(['ACTIVE', 'PAUSED', 'DISABLED', 'CLOSED']);
		if (!allow.has(status)) throw new Error('Invalid status');

		const store = getMutStore();
		const prev = store.adsets.get(id) || {};
		// nos adsets o campo de status é "status"
		store.adsets.set(id, { ...prev, status });

		return new Response(JSON.stringify({ ok: true, id, status }), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/* ==================== Bid/Budget (campanha – já existentes) ==================== */
async function updateCampaignBid(req, env) {
	try {
		const url = new URL(req.url);
		const parts = url.pathname.split('/').filter(Boolean);
		const id = parts[2];
		if (!id) throw new Error('Missing campaign id');

		const body = await req.json().catch(() => ({}));
		const n = Number(body.bid);
		if (!Number.isFinite(n) || n < 0) throw new Error('Invalid bid');

		const store = getMutStore();
		const prev = store.campaigns.get(id) || {};
		store.campaigns.set(id, { ...prev, bid: n });

		return new Response(JSON.stringify({ ok: true, id, bid: n }), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

async function updateCampaignBudget(req, env) {
	try {
		const url = new URL(req.url);
		const parts = url.pathname.split('/').filter(Boolean);
		const id = parts[2];
		if (!id) throw new Error('Missing campaign id');

		const body = await req.json().catch(() => ({}));
		const n = Number(body.budget);
		if (!Number.isFinite(n) || n < 0) throw new Error('Invalid budget');

		const store = getMutStore();
		const prev = store.campaigns.get(id) || {};
		store.campaigns.set(id, { ...prev, budget: n });

		return new Response(JSON.stringify({ ok: true, id, budget: n }), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

async function ssrm(req, env) {
	try {
		const reqForBody = req.clone();
		const reqForAssets = req.clone();

		let { url, startRow, endRow, sortModel, filterModel } = await parseRequestPayload(reqForBody);
		filterModel = normalizeFilterKeys(filterModel);
		const clean = new URL(url).searchParams.get('clean') === '1';

		const full = await loadDump(reqForAssets, env);
		if (!Array.isArray(full)) {
			throw new Error('Dump JSON inválido (esperado array).');
		}

		// overlay de CAMPANHAS antes de filtrar/ordenar
		let rows = overlayCampaignArray(clean ? full.map(cleanRow) : full);

		// campo virtual usado pelo filtro da coluna "Campaign"
		rows = rows.map((r) => ({
			...r,
			campaign: `${stripHtml(r.campaign_name || '')} ${String(r.utm_campaign || '')}`.trim(),
		}));

		// filtros e sort
		rows = applyFilters(rows, filterModel);
		rows = applySort(rows, sortModel);

		// totais
		const totals = computeTotalsRoot(rows);

		// slice SSRM
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

function normalizeFilterKeys(filterModel) {
	if (!filterModel || typeof filterModel !== 'object') return filterModel || {};
	const fm = { ...filterModel };
	// quando a auto group column usa o id padrão do AG Grid
	if (fm['ag-Grid-AutoColumn'] && !fm['campaign']) {
		fm['campaign'] = fm['ag-Grid-AutoColumn'];
		delete fm['ag-Grid-AutoColumn'];
	}
	return fm;
}

// ==================== /api/dev/test-toggle (mock genérico de sucesso/erro) ====================
async function testToggle(req, env) {
	try {
		const body = await req.json().catch(() => ({}));
		const feature = String(body?.feature || '').trim(); // ex.: 'pin' | 'sizeMode'
		const value = body?.value; // ex.: true | 'auto' | 'fit'

		if (!feature || value === undefined) {
			return new Response(JSON.stringify({ ok: false, error: 'Missing feature/value' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// pequeno delay para simular latência
		await new Promise((r) => setTimeout(r, 300 + Math.random() * 600));

		// 50% de chance de sucesso
		const success = Math.random() < 0.75; //bypass para teste

		if (!success) {
			return new Response(
				JSON.stringify({
					ok: false,
					error: `Mock: falha ao aplicar "${feature}"`,
				}),
				{ headers: { 'Content-Type': 'application/json' } }
			);
		}

		return new Response(
			JSON.stringify({
				ok: true,
				applied: { feature, value },
				message: `Aplicado "${feature}" = ${JSON.stringify(value)}`,
			}),
			{ headers: { 'Content-Type': 'application/json' } }
		);
	} catch (err) {
		return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/* ==================== Export ==================== */
export default {
	ssrm, // /api/ssrm/
	adsets, // /api/adsets
	ads, // /api/ads
	updateCampaignStatus, // PUT /api/campaigns/:id/status
	updateAdsetStatus, // PUT /api/adsets/:id/status
	updateCampaignBid, // PUT /api/campaigns/:id/bid
	updateCampaignBudget, // PUT /api/campaigns/:id/budget
	testToggle, // 👈 nova rota mock genérica (só sorteia ok/erro)
};
