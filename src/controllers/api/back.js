// routes/lionRows.js
// Handler SSRM que lê um JSON local, aplica limpeza/filtro/sort/paginação por bloco
// e responde no formato que o AG Grid Server-Side espera.

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
	if (typeof s === 'number') return s;
	const raw = String(s)
		.replace(/[^\d,.-]/g, '')
		.replace(/\./g, '')
		.replace(',', '.');
	const n = parseFloat(raw);
	return Number.isFinite(n) ? n : null;
};

function cleanRow(r) {
	return {
		...r,
		profile_name: stripHtml(r.profile_name),
		bc_name: stripHtml(r.bc_name),
		account_name: stripHtml(r.account_name),
		account_status: strongText(r.account_status), // só o conteúdo do <strong>
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

async function ssrm(req, env) {
	const url = new URL(req.url);
	const clean = url.searchParams.get('clean') === '1';

	const body = await req.json().catch(() => ({}));
	const { startRow = 0, endRow = 200, sortModel = [], filterModel = {} } = body;

	// Carrega arquivo JSON “fonte de verdade”
	// Se você estiver em Cloudflare Pages, isso funciona:
	const res = await fetch(new URL('/public/js/dump-convertido.json', req.url));
	const full = await res.json(); // array de linhas

	let rows = clean ? full.map(cleanRow) : full;
	rows = applyFilters(rows, filterModel);
	rows = applySort(rows, sortModel);

	const slice = rows.slice(startRow, Math.min(endRow, rows.length));
	const lastRow = rows.length;

	return new Response(JSON.stringify({ rows: slice, lastRow }), {
		headers: { 'Content-Type': 'application/json' },
	});
}

export default { ssrm };
