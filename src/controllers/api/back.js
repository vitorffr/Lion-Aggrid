// routes/lionRows.js
// Infinite Row handlers: lê JSONs estáticos, aplica limpeza/filtro/sort
// e responde SEM paginação (dataset inteiro). O front faz scroll infinito
// e calcula os totals.
//
// Endpoints:
// - POST/GET /api/ssrm/?clean=1[&totals=0]
// - POST/GET /api/adsets/?campaign_id=...&period=TODAY|YESTERDAY
// - POST/GET /api/ads/?adset_id=...&period=TODAY|YESTERDAY
//
// Em caso de erro, SEMPRE retornam JSON.

/* ============================================================
 * 1) Helpers de texto/número
 * ============================================================ */
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
		account_status: strongText(r.account_status),
		campaign_name: stripHtml(r.campaign_name),
		revenue: stripHtml(r.revenue),
		mx: stripHtml(r.mx),
	};
}

function toNumberFirst(s) {
	if (s == null) return null;
	const str = String(s);
	const match = str.match(/-?\d{1,3}(?:\.\d{3})*,\d{2}/) || str.match(/-?\d+(?:\.\d+)?/);
	if (!match) return null;
	const clean = match[0].replace(/\./g, '').replace(',', '.');
	const n = parseFloat(clean);
	return Number.isFinite(n) ? n : null;
}

/* ============================================================
 * 2) Sort & Filter
 * ============================================================ */
function applySort(rows, sortModel) {
	if (!Array.isArray(sortModel) || !sortModel.length) return rows;

	return rows.slice().sort((a, b) => {
		for (const s of sortModel) {
			const { colId, sort } = s;
			const dir = sort === 'desc' ? -1 : 1;

			let av = a[colId];
			let bv = b[colId];

			// 1) status custom
			if (colId === 'account_status' || colId === 'campaign_status' || colId === 'status') {
				const order = ['ACTIVE', 'PAUSED', 'DISABLED', 'CLOSED'];
				const ai = order.indexOf(String(av ?? '').toUpperCase());
				const bi = order.indexOf(String(bv ?? '').toUpperCase());
				const aIdx = ai === -1 ? Number.POSITIVE_INFINITY : ai;
				const bIdx = bi === -1 ? Number.POSITIVE_INFINITY : bi;
				const cmp = (aIdx - bIdx) * dir;
				if (cmp !== 0) return cmp;
				continue;
			}

			// 2) revenue: extrai o primeiro número
			if (colId === 'revenue') {
				const an = toNumberFirst(av);
				const bn = toNumberFirst(bv);
				if (an == null && bn == null) continue;
				if (an == null) return -1 * dir;
				if (bn == null) return 1 * dir;
				if (an !== bn) return (an < bn ? -1 : 1) * dir;
				continue;
			}

			// 3) padrão
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

			// includes / excludes
			if (ft === 'includes' && Array.isArray(f.values)) {
				const set = new Set(f.values.map((v) => String(v).toLowerCase()));
				return (r) => set.has(String(r[field] ?? '').toLowerCase());
			}
			if (ft === 'excludes' && Array.isArray(f.values)) {
				const set = new Set(f.values.map((v) => String(v).toLowerCase()));
				return (r) => !set.has(String(r[field] ?? '').toLowerCase());
			}

			// texto
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

			// número (+ contains/notContains)
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

/* ============================================================
 * 3) Agregadores
 * ============================================================ */
const sum = (a, b) => (Number.isFinite(a) ? a : 0) + (Number.isFinite(b) ? b : 0);
const safeDiv = (num, den) => (den > 0 ? num / den : 0);
function sumField(rows, field) {
	return rows.reduce((acc, r) => sum(acc, toNumberBR(r[field])), 0);
}
function hasSomeField(rows, field) {
	return rows.some((r) => toNumberBR(r[field]) != null);
}

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

/* ============================================================
 * 4) Carregamento via ASSETS/public (GET forçado + cache)
 * ============================================================ */

// cache simples por isolate
globalThis.__LION_CACHE__ = globalThis.__LION_CACHE__ || new Map();
globalThis.__LION_PROMISE__ = globalThis.__LION_PROMISE__ || new Map();

// SEMPRE GET no binding de assets
async function fetchAsset(env, assetPath) {
	const url = new URL(assetPath, 'https://assets.local');
	return env.ASSETS.fetch(
		new Request(url, { method: 'GET', headers: { accept: 'application/json' } })
	);
}

// JSON único por assets (GET). Mantém fallback dev opcional.
async function loadAssetJSON(request, env, assetPath) {
	const cache = globalThis.__LION_CACHE__;
	if (cache.has(assetPath)) return cache.get(assetPath);

	if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
		const res = await fetchAsset(env, assetPath);
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
		const res2 = await fetch(devUrl.href, {
			method: 'GET',
			headers: { accept: 'application/json' },
		});
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

// Manifest → partes (decodifica por streaming para reduzir cópias)
async function loadJoinedAssetJSON(request, env, manifestPath) {
	const manRes = await fetchAsset(env, manifestPath);
	if (!manRes.ok) throw new Error(`[ASSETS] ${manRes.status} ao ler manifest ${manifestPath}`);
	const manifest = await manRes.json(); // { parts: [{file, size, sha256?}], ... }
	if (!manifest || !Array.isArray(manifest.parts) || !manifest.parts.length) {
		throw new Error(`Manifest inválido em ${manifestPath}`);
	}

	const baseDir = manifestPath.slice(0, manifestPath.lastIndexOf('/')) || '';
	const decoder = new TextDecoder('utf-8');
	const pieces = [];

	for (const p of manifest.parts) {
		const filePath = `${baseDir}/${p.file}`; // ex: /constants/teste.part00.json
		const res = await fetchAsset(env, filePath);
		if (!res.ok || !res.body) throw new Error(`Falha ao ler parte: ${p.file}`);

		const reader = res.body.getReader();
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			pieces.push(decoder.decode(value, { stream: true })); // decodifica aos poucos
		}
	}
	pieces.push(decoder.decode()); // flush
	const text = pieces.join('');
	return JSON.parse(text);
}

// tenta manifest primeiro; se não houver, cai no JSON único
async function loadDump(request, env) {
	const cache = globalThis.__LION_CACHE__;
	const inflight = globalThis.__LION_PROMISE__;
	const cacheKey = '__JOINED__/constants/teste';

	if (cache.has(cacheKey)) return cache.get(cacheKey);
	if (inflight.has(cacheKey)) return inflight.get(cacheKey);

	const p = (async () => {
		try {
			const joined = await loadJoinedAssetJSON(request, env, '/constants/teste.manifest.json');
			cache.set(cacheKey, joined);
			return joined;
		} catch {
			const single = await loadAssetJSON(request, env, '/constants/teste.json');
			cache.set(cacheKey, single);
			return single;
		} finally {
			inflight.delete(cacheKey);
		}
	})();

	inflight.set(cacheKey, p);
	return p;
}

/* ============================================================
 * 5) Parser do request (body OU query)
 * ============================================================ */
function parseRequestPayload(req) {
	const url = new URL(req.url);

	let startRow = 0;
	let endRow = 200;
	let sortModel = [];
	let filterModel = {};
	let mode = 'slice'; // 'slice' (default SSRM) | 'full'

	const coerceFull = (v) => {
		if (v == null) return null;
		const s = String(v).toLowerCase();
		return s === '1' || s === 'true' || s === 'yes';
	};

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

				// 👇 modo
				if (typeof body.mode === 'string')
					mode = body.mode.toLowerCase() === 'full' ? 'full' : 'slice';
				const fullFromBody = coerceFull(body.full);
				if (fullFromBody === true) mode = 'full';
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

				// 👇 modo via query
				const qMode = (url.searchParams.get('mode') || '').toLowerCase();
				if (qMode === 'full') mode = 'full';
				const fullQS = coerceFull(url.searchParams.get('full'));
				if (fullQS === true) mode = 'full';
			}

			return { startRow, endRow, sortModel, filterModel, mode, url: url.toString() };
		});
}

/* ============================================================
 * 6) Filtro por parent + period
 * ============================================================ */
function filterByParentAndPeriod(rows, { idKey, idValue, period }) {
	const wantPeriod = String(period || 'TODAY').toUpperCase();
	return rows.filter((r) => {
		const idOk = !idValue || String(r[idKey]) === String(idValue);
		const periodOk = String(r.period || 'TODAY').toUpperCase() === wantPeriod;
		return idOk && periodOk;
	});
}

/* ============================================================
 * 7) Overlay em memória (volátil por isolate)
 * ============================================================ */
function getMutStore() {
	globalThis.__LION_MUT__ = globalThis.__LION_MUT__ || {
		campaigns: new Map(),
		adsets: new Map(),
		ads: new Map(),
	};
	return globalThis.__LION_MUT__;
}

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

function overlayAdset(row) {
	const store = getMutStore();
	const id = String(row.id ?? '');
	const base = { ...row };
	if (id) Object.assign(base, store.adsets.get(id) || {});
	const statusVal = String(base.campaign_status ?? base.status ?? '').toUpperCase();
	return statusVal ? { ...base, campaign_status: statusVal } : base;
}
function overlayAdsetArray(rows) {
	return rows.map(overlayAdset);
}

function overlayAd(row) {
	const store = getMutStore();
	const id = String(row.id ?? '');
	const base = { ...row };
	if (id) Object.assign(base, store.ads.get(id) || {});
	const statusVal = String(base.campaign_status ?? base.status ?? '').toUpperCase();
	return statusVal ? { ...base, campaign_status: statusVal } : base;
}
function overlayAdArray(rows) {
	return rows.map(overlayAd);
}

/* ============================================================
 * 8) Handlers: /api/adsets & /api/ads (FULL DATASET)
 * ============================================================ */
async function adsets(req, env) {
	try {
		const reqForBody = req.clone();
		const reqForAssets = req.clone();

		let { startRow, endRow, sortModel, filterModel, mode, url } = await parseRequestPayload(
			reqForBody
		);
		filterModel = normalizeFilterKeys(filterModel);
		const u = new URL(url);
		const campaignId = u.searchParams.get('campaign_id') || (filterModel?.campaign_id?.filter ?? '');
		const period = (
			u.searchParams.get('period') ||
			filterModel?.period?.filter ||
			'TODAY'
		).toUpperCase();

		const full = await loadAssetJSON(reqForAssets, env, '/constants/adsets.json');
		if (!Array.isArray(full)) throw new Error('adsets.json inválido (esperado array).');

		let rows = filterByParentAndPeriod(full, { idKey: 'idroot', idValue: campaignId, period });
		rows = overlayAdsetArray(rows);
		rows = rows.map((r) => ({ ...r, campaign: stripHtml(r.name || '') }));
		rows = applyFilters(rows, filterModel);
		rows = applySort(rows, sortModel);

		const totals = computeTotalsGeneric(rows);
		const { outRows, lastRow } = sliceForMode(rows, startRow, endRow, mode);

		return new Response(JSON.stringify({ mode, rows: outRows, lastRow, totals }), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		return new Response(JSON.stringify({ error: String(err?.message || err) }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

function sliceForMode(rows, startRow, endRow, mode) {
	if (mode === 'full') {
		return { outRows: rows, lastRow: rows.length };
	}
	const safeEnd = Math.min(Math.max(endRow, 0), rows.length);
	const safeStart = Math.min(Math.max(startRow, 0), safeEnd);
	return { outRows: rows.slice(safeStart, safeEnd), lastRow: rows.length };
}

async function ads(req, env) {
	try {
		const reqForBody = req.clone();
		const reqForAssets = req.clone();

		let { startRow, endRow, sortModel, filterModel, mode, url } = await parseRequestPayload(
			reqForBody
		);
		filterModel = normalizeFilterKeys(filterModel);
		const u = new URL(url);
		const adsetId = u.searchParams.get('adset_id') || (filterModel?.adset_id?.filter ?? '');
		const period = (
			u.searchParams.get('period') ||
			filterModel?.period?.filter ||
			'TODAY'
		).toUpperCase();

		const full = await loadAssetJSON(reqForAssets, env, '/constants/ads.json');
		if (!Array.isArray(full)) throw new Error('ads.json inválido (esperado array).');

		let rows = filterByParentAndPeriod(full, { idKey: 'idchild', idValue: adsetId, period });
		rows = overlayAdArray(rows);
		rows = rows.map((r) => ({ ...r, campaign: stripHtml(r.name || '') }));
		rows = applyFilters(rows, filterModel);
		rows = applySort(rows, sortModel);

		const totals = computeTotalsGeneric(rows);
		const { outRows, lastRow } = sliceForMode(rows, startRow, endRow, mode);

		return new Response(JSON.stringify({ mode, rows: outRows, lastRow, totals }), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		return new Response(JSON.stringify({ error: String(err?.message || err) }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/* ============================================================
 * 9) Mutations: Status (Campaigns + Adsets + Ads)
 * ============================================================ */
async function updateCampaignStatus(req, env) {
	try {
		const url = new URL(req.url);
		const parts = url.pathname.split('/').filter(Boolean);
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

async function updateAdsetStatus(req, env) {
	try {
		const url = new URL(req.url);
		const parts = url.pathname.split('/').filter(Boolean);
		const id = parts[2];
		if (!id) throw new Error('Missing adset id');

		const body = await req.json().catch(() => ({}));
		const status = String(body.status || '').toUpperCase();
		const allow = new Set(['ACTIVE', 'PAUSED', 'DISABLED', 'CLOSED']);
		if (!allow.has(status)) throw new Error('Invalid status');

		const store = getMutStore();
		const prev = store.adsets.get(id) || {};
		store.adsets.set(id, { ...prev, status, campaign_status: status });

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

async function updateAdStatus(req, env) {
	try {
		const url = new URL(req.url);
		const parts = url.pathname.split('/').filter(Boolean);
		const id = parts[2];
		if (!id) throw new Error('Missing ad id');

		const body = await req.json().catch(() => ({}));
		const status = String(body.status || '').toUpperCase();
		const allow = new Set(['ACTIVE', 'PAUSED', 'DISABLED', 'CLOSED']);
		if (!allow.has(status)) throw new Error('Invalid status');

		const store = getMutStore();
		const prev = store.ads.get(id) || {};
		store.ads.set(id, { ...prev, status, campaign_status: status });

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

/* ============================================================
 * 10) Mutations: Bid/Budget (campanha)
 * ============================================================ */
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

/* ============================================================
 * 11) /api/ssrm/ (root) — FULL DATASET
 * ============================================================ */

// heurística simples pra fast-path
function hasFilters(fm) {
	if (!fm || typeof fm !== 'object') return false;
	const hasGlobal = !!String(fm._global?.filter || '').trim();
	const keys = Object.keys(fm).filter((k) => k !== '_global');
	return hasGlobal || keys.length > 0;
}

async function ssrm(req, env) {
	try {
		const reqForBody = req.clone();
		const reqForAssets = req.clone();

		let { url, startRow, endRow, sortModel, filterModel, mode } = await parseRequestPayload(
			reqForBody
		);
		filterModel = normalizeFilterKeys(filterModel);
		const u = new URL(url);
		const clean = u.searchParams.get('clean') === '1';
		const skipTotals = (u.searchParams.get('totals') ?? '').toString() === '0';

		const full = await loadDump(reqForAssets, env);
		if (!Array.isArray(full)) throw new Error('Dump JSON inválido (esperado array).');

		// FAST-PATH: sem sort e sem filtros e não-full → fatia antes de mapear tudo
		const wantFast = mode !== 'full' && !sortModel?.length && !hasFilters(filterModel);
		if (wantFast) {
			const totalLen = full.length;
			const safeEnd = Math.min(Math.max(endRow, 0), totalLen);
			const safeStart = Math.min(Math.max(startRow, 0), safeEnd);
			const outRows = full.slice(safeStart, safeEnd).map((r) => {
				const rr = clean ? cleanRow(r) : r;
				const over = overlayCampaign(rr);
				return {
					...over,
					campaign: `${stripHtml(over.campaign_name || '')} ${String(
						over.utm_campaign || ''
					)}`.trim(),
				};
			});
			return new Response(
				JSON.stringify({ mode, rows: outRows, lastRow: totalLen, totals: null }),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// caminho completo
		let rows = clean ? full.map(cleanRow) : full;
		rows = overlayCampaignArray(rows);
		rows = rows.map((r) => ({
			...r,
			campaign: `${stripHtml(r.campaign_name || '')} ${String(r.utm_campaign || '')}`.trim(),
		}));

		rows = applyFilters(rows, filterModel);
		rows = applySort(rows, sortModel);

		const totals = skipTotals ? null : computeTotalsRoot(rows);
		const { outRows, lastRow } = sliceForMode(rows, startRow, endRow, mode);

		return new Response(JSON.stringify({ mode, rows: outRows, lastRow, totals }), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		return new Response(JSON.stringify({ error: String(err?.message || err) }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/* ============================================================
 * 12) Normalização de filterModel (auto-group -> campaign)
 * ============================================================ */
function normalizeFilterKeys(filterModel) {
	if (!filterModel || typeof filterModel !== 'object') return filterModel || {};
	const fm = { ...filterModel };
	if (fm['ag-Grid-AutoColumn'] && !fm['campaign']) {
		fm['campaign'] = fm['ag-Grid-AutoColumn'];
		delete fm['ag-Grid-AutoColumn'];
	}
	return fm;
}

/* ============================================================
 * 13) /api/dev/test-toggle (mock)
 * ============================================================ */
async function testToggle(req, env) {
	try {
		const body = await req.json().catch(() => ({}));
		const feature = String(body?.feature || '').trim();
		const value = body?.value;

		if (!feature || value === undefined) {
			return new Response(JSON.stringify({ ok: false, error: 'Missing feature/value' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		await new Promise((r) => setTimeout(r, 300 + Math.random() * 600));

		const success = Math.random() < 0.75;
		if (!success) {
			return new Response(
				JSON.stringify({ ok: false, error: `Mock: falha ao aplicar "${feature}"` }),
				{
					headers: { 'Content-Type': 'application/json' },
				}
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

/* ============================================================
 * 14) Export
 * ============================================================ */
export default {
	ssrm,
	adsets,
	ads,
	updateCampaignStatus,
	updateAdsetStatus,
	updateAdStatus,
	updateCampaignBid,
	updateCampaignBudget,
	testToggle,
};
