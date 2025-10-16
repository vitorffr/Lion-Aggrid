// routes/lionRows.js
// SSRM handler: lê um JSON estático, limpa/ordena/filtra/pagina
// e responde no formato esperado pelo AG Grid Server-Side.

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

function applySort(rows, sortModel) {
	if (!Array.isArray(sortModel) || !sortModel.length) return rows;
	return rows.slice().sort((a, b) => {
		for (const s of sortModel) {
			const { colId, sort } = s;
			const dir = sort === 'desc' ? -1 : 1;

			const av = a[colId];
			const bv = b[colId];

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

// ---- Carregamento do dump via ASSETS ----
// No wrangler.toml, configure:
// [assets]
// binding = "ASSETS"
// directory = "./public"
//
// Se o arquivo estiver em ./public/constants/clean-dump.json,
// o path aqui é "/constants/clean-dump.json" (sem /public).
async function loadDump(request, env) {
	// cache em memória do worker
	if (globalThis.__LION_DUMP__) return globalThis.__LION_DUMP__;

	const assetPath = '/constants/clean-dump.json';

	// Tenta via binding ASSETS (Workers)
	if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
		const assetReq = new Request(new URL(assetPath, request.url), request);
		const res = await env.ASSETS.fetch(assetReq);
		if (!res || !res.ok) {
			const body = await res?.text?.().catch(() => '');
			throw new Error(
				`Falha ao carregar ${assetPath} via ASSETS (${res?.status}). ${
					body?.slice(0, 120) || ''
				}`
			);
		}
		const json = await res.json();
		globalThis.__LION_DUMP__ = json;
		return json;
	}

	// Fallback: se estiver em Pages Functions ou servindo /public manualmente
	const res = await fetch(new URL(`/public${assetPath}`, request.url));
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(
			`Falha ao carregar /public${assetPath} (${res.status}). ${body?.slice(0, 120) || ''}`
		);
	}
	const json = await res.json();
	globalThis.__LION_DUMP__ = json;
	return json;
}

function parseRequestPayload(req) {
	// Suporta POST (body JSON) e GET (querystring)
	const url = new URL(req.url);

	// Defaults
	let startRow = 0;
	let endRow = 200;
	let sortModel = [];
	let filterModel = {};

	// Body (POST)
	return req
		.json()
		.catch(() => ({}))
		.then((body) => {
			if (body && typeof body === 'object' && Object.keys(body).length) {
				startRow = Number.isFinite(body.startRow) ? body.startRow : startRow;
				endRow = Number.isFinite(body.endRow) ? body.endRow : endRow;
				sortModel = Array.isArray(body.sortModel) ? body.sortModel : sortModel;
				filterModel = typeof body.filterModel === 'object' ? body.filterModel : filterModel;
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
			return { startRow, endRow, sortModel, filterModel, url };
		});
}

async function ssrm(req, env) {
	try {
		const { url, startRow, endRow, sortModel, filterModel } = await parseRequestPayload(req);
		const clean = new URL(url).searchParams.get('clean') === '1';

		// Carrega dump
		const full = await loadDump(req, env); // array completo
		if (!Array.isArray(full)) {
			throw new Error('Dump JSON inválido (esperado array).');
		}

		// Limpeza opcional
		let rows = clean ? full.map(cleanRow) : full;

		// Filtro e ordenação
		rows = applyFilters(rows, filterModel);
		rows = applySort(rows, sortModel);

		// Paginação em bloco (SSRM)
		const safeEnd = Math.min(Math.max(endRow, 0), rows.length);
		const safeStart = Math.min(Math.max(startRow, 0), safeEnd);
		const slice = rows.slice(safeStart, safeEnd);

		// AG Grid aceita lastRow = rows.length para informar total
		const lastRow = rows.length;

		return new Response(JSON.stringify({ rows: slice, lastRow }), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		// SEMPRE JSON: evita “error code: 1042” no front
		return new Response(JSON.stringify({ error: String(err?.message || err) }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

export default { ssrm };
