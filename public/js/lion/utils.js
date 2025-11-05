// public/js/lion/utils.js
// Utilitários extraídos do infinitetable.js — SEM alterar funcionalidades.
// Este arquivo define as mesmas funções/constantes no escopo global para compatibilidade
// e também exporta via ES Modules para uso com import.

// ====== BLOCO COPIADO DO ARQUIVO ORIGINAL ======
/* =========================================
 * 2) Estado Global
 * =======================================*/
// Moeda global da aplicação
let LION_CURRENCY = 'BRL'; // 'BRL' | 'USD'

// 🔍 QUICK FILTER global (vai em filterModel._global.filter)

/**
 * Altera a moeda da aplicação em runtime.
 * @param {'USD'|'BRL'} mode
 */
function setLionCurrency(mode) {
	const m = String(mode || '').toUpperCase();
	if (m === 'USD' || m === 'BRL') LION_CURRENCY = m;
	else console.warn('[Currency] modo inválido:', mode);
}
function getAppCurrency() {
	return LION_CURRENCY;
}

/* =========================================
 * 3) Utilidades (tempo/edição/parsing)
 * =======================================*/
/**
 * Sleep async
 * @param {number} ms
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Garante spinner mínimo num fluxo async.
 * @param {number} startMs performance.now() no início
 * @param {number} minMs   ms mínimo de spinner
 */
async function withMinSpinner(startMs, minMs) {
	const elapsed = performance.now() - startMs;
	if (elapsed < minMs) await sleep(minMs - elapsed);
}

/**
 * Parser tolerante a BRL/USD (string → number)
 * @param {string|number|null} value
 * @param {'USD'|'BRL'} [mode]
 * @returns {number|null}
 */
function parseCurrencyFlexible(value, mode = getAppCurrency()) {
	if (value == null || value === '') return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	let s = String(value).trim();
	s = s.replace(/[^\d.,\-+]/g, '');
	if (!s) return null;
	const lastDot = s.lastIndexOf('.');
	const lastComma = s.lastIndexOf(',');
	const hasDot = lastDot !== -1;
	const hasComma = lastComma !== -1;

	// heurística: separador decimal é o ÚLTIMO símbolo entre . e ,
	let decimal = null;
	if (hasDot && hasComma) decimal = lastDot > lastComma ? '.' : ',';
	else if (hasDot) decimal = mode === 'USD' ? '.' : '.';
	else if (hasComma) decimal = mode === 'BRL' ? ',' : ',';

	// remove milhares e normaliza decimal para '.'
	if (decimal === ',') {
		s = s.replace(/\./g, '');
		s = s.replace(',', '.');
	} else if (decimal === '.') {
		s = s.replace(/,/g, '');
	}
	const n = parseFloat(s);
	return Number.isFinite(n) ? n : null;
}

/**
 * Evita loops ao editar célula via setDataValue.
 * Marca a célula com uma flag temporária e o valueSetter/renderer pode checar.
 */
function shouldSuppressCellChange(p, colId) {
	return !!p?.data?.[`__suppress_${colId}`];
}
function setCellSilently(p, colId, value) {
	const key = `__suppress_${colId}`;
	if (p?.data) p.data[key] = true;
	p.node.setDataValue(colId, value);
}

/* =========================================
 * 4) Toast (fallback console)
 * =======================================*/
function showToast(msg, type = 'info') {
	const colors = {
		info: 'linear-gradient(90deg,#06b6d4,#3b82f6)',
		success: 'linear-gradient(90deg,#22c55e,#16a34a)',
		warning: 'linear-gradient(90deg,#f59e0b,#eab308)',
		danger: 'linear-gradient(90deg,#ef4444,#dc2626)',
	};
	if (globalThis.Toastify) {
		globalThis
			.Toastify({
				text: msg,
				duration: 2600,
				close: true,
				gravity: 'bottom',
				position: 'right',
				stopOnFocus: true,
				backgroundColor: colors[type] || colors.info,
			})
			.showToast();
	} else {
		console.log(`[Toast] ${msg}`);
	}
}

/* =========================================
 * 6) AG Grid: acesso + licença
 * =======================================*/
function getAgGrid() {
	const AG = globalThis.agGrid;
	if (!AG)
		throw new Error('AG Grid UMD não carregado. Verifique a ORDEM dos scripts e o path do CDN.');
	return AG;
}
(function applyAgGridLicense() {
	try {
		const AG = getAgGrid();
		const LM = AG.LicenseManager || AG?.enterprise?.LicenseManager;
		const key = document.querySelector('meta[name="hs-ag"]')?.content || '';
		if (key && LM?.setLicenseKey) LM.setLicenseKey(key);
	} catch {}
})();

function createAgTheme() {
	const AG = getAgGrid();
	if (!AG?.themeQuartz || !AG?.iconSetMaterial) return null;
	const { themeQuartz, iconSetMaterial } = AG;
	return themeQuartz.withPart(iconSetMaterial).withParams({
		accentColor: '#15BDE8',
		backgroundColor: '#0C0C0D',
		borderColor: '#FFFFFF0A',
		borderRadius: 14,
		browserColorScheme: 'dark',
		columnBorder: false,
		fontFamily: { googleFont: 'IBM Plex Sans' },
		fontSize: 14,
		foregroundColor: '#BBBEC9',
		headerBackgroundColor: '#141414',
		headerFontSize: 14,
		headerFontWeight: 600,
		headerRowBorder: true,
		headerTextColor: '#FFFFFF',
		iconSize: 18,
		rowBorder: true,
		rowHoverColor: '#13232A',
		selectedRowBackgroundColor: '#0F2A33',
		rowVerticalPaddingScale: 1.0,
		spacing: 6,
		wrapperBorder: false,
		wrapperBorderRadius: 0,
	});
}

/* =========================================
 * 7) Helpers/Formatters (HTML/numérico/moedas, badges)
 * =======================================*/
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

function renderBadgeNode(text, color) {
	const el = document.createElement('span');
	el.className = 'lion-badge';
	el.textContent = text ?? '';
	if (color) el.style.setProperty('--lion-badge-color', color);
	return el;
}
function renderBadge(text, color) {
	const el = renderBadgeNode(text, color);
	return el.outerHTML;
}
function pickStatusColor(labelUp) {
	if (!labelUp) return '#6b7280';
	if (labelUp.includes('ACTIVE')) return '#16a34a';
	if (labelUp.includes('PAUSED')) return '#f59e0b';
	if (labelUp.includes('DISAPPROVED') || labelUp.includes('REJECT')) return '#ef4444';
	return '#0ea5e9';
}
function clampTextLength(s, max = 64) {
	const str = String(s ?? '');
	return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

/** Parser de data flexível */
function parseDateFlexible(s) {
	if (!s) return null;
	const d = new Date(s);
	return Number.isNaN(d.getTime()) ? null : d;
}

/** Inteiros locais (BR) */
const intFmt = new Intl.NumberFormat('pt-BR');

/** Formatter de moeda dinâmico (BRL/USD) para AG Grid. */
function currencyFormatter(p) {
	const currency = getAppCurrency();
	const locale = currency === 'USD' ? 'en-US' : 'pt-BR';
	let n = typeof p.value === 'number' ? p.value : parseCurrencyFlexible(p.value, currency);
	if (!Number.isFinite(n)) return '';
	return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
}

/** Converte string de front BR para número. */
function frontToNumberBR(s) {
	if (typeof s === 'number') return s;
	const raw = String(s)
		.replace(/[^\d,.-]/g, '')
		.replace(/\./g, '')
		.replace(',', '.');
	const n = parseFloat(raw);
	return Number.isFinite(n) ? n : null;
}
/** Tenta converter, preferindo o primeiro formato que bater. */
function frontToNumberFirst(s) {
	const a = frontToNumberBR(s);
	if (a != null) return a;
	const b = parseFloat(String(s).replace(/[^\d.-]/g, ''));
	return Number.isFinite(b) ? b : null;
}

/** Aplica sort no front (array de objetos) — util pra drilldown local etc. */
function frontApplySort(rows, sortModel) {
	if (!Array.isArray(rows) || !Array.isArray(sortModel) || !sortModel.length) return rows;
	const all = [...rows];
	all.sort((ra, rb) => {
		for (const s of sortModel) {
			const { colId, sort } = s || {};
			if (!colId || !sort) continue;
			const va = ra[colId];
			const vb = rb[colId];
			if (va == null && vb == null) continue;
			if (va == null) return sort === 'asc' ? -1 : 1;
			if (vb == null) return sort === 'asc' ? 1 : -1;
			if (va < vb) return sort === 'asc' ? -1 : 1;
			if (va > vb) return sort === 'asc' ? 1 : -1;
		}
		return 0;
	});
	return all;
}

/** Aplica filters no front (array de objetos) — util pra drilldown local etc. */
function frontApplyFilters(rows, filterModel) {
	if (!Array.isArray(rows) || !filterModel || !Object.keys(filterModel).length) return rows;
	const pass = (row, colId, f) => {
		if (!f) return true;
		// global quick filter
		if (colId === '_global' && f.filter) {
			const needle = String(f.filter).toLowerCase();
			return Object.values(row).some((v) =>
				String(v ?? '')
					.toLowerCase()
					.includes(needle)
			);
		}
		// texto contém
		if (f.filterType === 'text' && f.type === 'contains') {
			const needle = String(f.filter ?? '').toLowerCase();
			return String(row[colId] ?? '')
				.toLowerCase()
				.includes(needle);
		}
		// número maior/menor/igual
		if (f.filterType === 'number') {
			const n = Number(f.filter);
			const v = Number(row[colId]);
			if (!Number.isFinite(n) || !Number.isFinite(v)) return true;
			if (f.type === 'greaterThan') return v > n;
			if (f.type === 'lessThan') return v < n;
			if (f.type === 'equals') return v === n;
		}
		return true;
	};
	return rows.filter((r) => {
		return Object.entries(filterModel).every(([colId, f]) => pass(r, colId, f));
	});
}
function computeClientTotals(rows) {
	const spent_sum = sumNum(rows, (r) => numBR(r.spent));
	const fb_revenue_sum = sumNum(rows, (r) => numBR(r.fb_revenue));
	const push_revenue_sum = sumNum(rows, (r) => numBR(r.push_revenue));
	const revenue_sum =
		(Number.isFinite(fb_revenue_sum) ? fb_revenue_sum : 0) +
			(Number.isFinite(push_revenue_sum) ? push_revenue_sum : 0) ||
		sumNum(rows, (r) => numBR(r.revenue));
	const impressions_sum = sumNum(rows, (r) => numBR(r.impressions));
	const clicks_sum = sumNum(rows, (r) => numBR(r.clicks));
	const visitors_sum = sumNum(rows, (r) => numBR(r.visitors));
	const conversions_sum = sumNum(rows, (r) => numBR(r.conversions));
	const real_conversions_sum = sumNum(rows, (r) => numBR(r.real_conversions));
	const profit_sum = sumNum(rows, (r) => numBR(r.profit));
	const budget_sum = sumNum(rows, (r) => numBR(r.budget));
	const cpc_total = safeDiv(spent_sum, clicks_sum);
	const cpa_fb_total = safeDiv(spent_sum, conversions_sum);
	const real_cpa_total = safeDiv(spent_sum, real_conversions_sum);
	const ctr_total = safeDiv(clicks_sum, impressions_sum);
	const epc_total = safeDiv(revenue_sum, clicks_sum);
	const mx_total = safeDiv(revenue_sum, spent_sum);
	return {
		impressions_sum,
		clicks_sum,
		visitors_sum,
		conversions_sum,
		real_conversions_sum,
		spent_sum,
		fb_revenue_sum,
		push_revenue_sum,
		revenue_sum,
		profit_sum,
		budget_sum,
		cpc_total,
		cpa_fb_total,
		real_cpa_total,
		ctr_total,
		epc_total,
		mx_total,
	};
}
/* =========================================
 * 8) Utils de status/loading por célula
 * =======================================*/
// 👇 drop-in p/ usar no lugar onde você chamava redrawRows
function blurLikeClickElsewhere(p) {
	const api = p.api;
	const rowIdx = p.node.rowIndex;
	const colId = p.column.getColId();

	// 1) “Clique fora”: encerra edição (commit) — igual blur
	api.stopEditing(false);

	// 2) Faz AG Grid "esquecer" a célula focada
	api.clearFocusedCell?.();

	// 3) Reposiciona foco na mesma célula (ou onde preferir)
	requestAnimationFrame(() => {
		api.setFocusedCell?.(rowIdx, colId);
	});
}

// Marcação visual simples de "loading" na célula
function startCellLoading(p) {
	const e = p?.eGridCell || p?.event?.target;
	if (!e) return;
	e.classList?.add('is-loading');
}
function endCellLoading(p) {
	const e = p?.eGridCell || p?.event?.target;
	if (!e) return;
	e.classList?.remove('is-loading');
}

// Erro visual por célula
function markCellError(p) {
	const e = p?.eGridCell || p?.event?.target;
	if (!e) return;
	e.classList?.add('has-error');
	setTimeout(() => e.classList?.remove('has-error'), 2000);
}
function isCellError(p) {
	const e = p?.eGridCell || p?.event?.target;
	return !!e?.classList?.contains?.('has-error');
}
function sumNum(arr, pick) {
	let acc = 0;
	for (let i = 0; i < arr.length; i++) {
		const v = pick(arr[i]);
		if (Number.isFinite(v)) acc += v;
	}
	return acc;
}
function numBR(x) {
	const n1 = toNumberBR(x);
	if (n1 != null) return n1;
	const n2 = parseCurrencyFlexible(x, getAppCurrency());
	return Number.isFinite(n2) ? n2 : null;
}
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

function safeDiv(num, den) {
	return den > 0 ? num / den : 0;
}
function isPinnedOrTotal(params) {
	return (
		params?.node?.rowPinned === 'bottom' ||
		params?.node?.rowPinned === 'top' ||
		params?.data?.__nodeType === 'total' ||
		params?.node?.group === true
	);
}
function isCellLoading(p, colId) {
	return !!p?.data?.__loading?.[colId];
}
function isCellJustSaved(p, colId) {
	return !!p?.data?.__justSaved?.[colId];
}
function setCellLoading(node, colId, on) {
	if (!node?.data) return;
	node.data.__loading = node.data.__loading || {};
	node.data.__loading[colId] = !!on;
}
// ====== EXPORTS ======
export {
	setCellLoading,
	isCellJustSaved,
	isCellLoading,
	isPinnedOrTotal,
	safeDiv,
	toNumberBR,
	numBR,
	sumNum,
	computeClientTotals,
	// estado global
	setLionCurrency,
	getAppCurrency,
	// utilidades gerais
	sleep,
	withMinSpinner,
	parseCurrencyFlexible,
	// toast
	showToast,
	// ag-grid helpers
	getAgGrid /* applyAgGridLicense IIFE roda automaticamente */,
	createAgTheme,
	// helpers/formatters
	stripHtml,
	strongText,
	renderBadgeNode,
	renderBadge,
	pickStatusColor,
	clampTextLength,
	parseDateFlexible,
	intFmt,
	currencyFormatter,
	frontToNumberBR,
	frontToNumberFirst,
	frontApplySort,
	frontApplyFilters,
	// célula status/loading utils
	blurLikeClickElsewhere,
	startCellLoading,
	endCellLoading,
	markCellError,
	isCellError,
};

// ====== EXPÕE NO GLOBAL PARA COMPATIBILIDADE ======
Object.assign(globalThis, {
	setCellLoading,
	isCellJustSaved,
	isCellLoading,
	isPinnedOrTotal,
	safeDiv,
	toNumberBR,
	numBR,
	sumNum,
	computeClientTotals,
	setLionCurrency,
	getAppCurrency,
	sleep,
	withMinSpinner,
	parseCurrencyFlexible,
	showToast,
	getAgGrid,
	createAgTheme,
	stripHtml,
	strongText,
	renderBadgeNode,
	renderBadge,
	pickStatusColor,
	clampTextLength,
	parseDateFlexible,
	intFmt,
	currencyFormatter,
	frontToNumberBR,
	frontToNumberFirst,
	frontApplySort,
	frontApplyFilters,
	blurLikeClickElsewhere,
	startCellLoading,
	endCellLoading,
	markCellError,
	isCellError,
});
