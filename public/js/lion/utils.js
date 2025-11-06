/* =========================================
 * Shared Utils (reutilizáveis entre tabelas)
 * =======================================*/

/* ========== 2.1 Tempo / Async ========== */
export async function withMinSpinner(startMs, minMs) {
	const elapsed = performance.now() - startMs;
	if (elapsed < minMs) await sleep(minMs - elapsed);
}
let LION_CURRENCY = 'BRL'; // 'BRL' | 'USD'

/* Depende de LION_CURRENCY global no seu app */
export function getAppCurrency() {
	return LION_CURRENCY;
}

/** Parser tolerante a BRL/USD (string → number) */
export function parseCurrencyFlexible(value, mode = getAppCurrency()) {
	if (value == null || value === '') return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	let s = String(value).trim();
	s = s.replace(/[^\d.,\-+]/g, '');
	if (!s) return null;
	const lastDot = s.lastIndexOf('.');
	const lastComma = s.lastIndexOf(',');
	const hasSep = lastDot !== -1 || lastComma !== -1;
	let normalized;
	if (!hasSep) {
		normalized = s.replace(/[^\d\-+]/g, '');
	} else {
		const decSep = lastDot > lastComma ? '.' : ',';
		const i = s.lastIndexOf(decSep);
		const intPart = s.slice(0, i).replace(/[^\d\-+]/g, '');
		const fracPart = s.slice(i + 1).replace(/[^\d]/g, '');
		normalized = intPart + (fracPart ? '.' + fracPart : '');
	}
	const n = parseFloat(normalized);
	return Number.isFinite(n) ? n : null;
}

export function isPinnedOrTotal(params) {
	return (
		params?.node?.rowPinned === 'bottom' ||
		params?.node?.rowPinned === 'top' ||
		params?.data?.__nodeType === 'total' ||
		params?.node?.group === true
	);
}

/* ========== 2.4 Badges (cores fallback) ========== */
export const FALLBACK_STYLE = {
	success: { bg: '#22c55e', fg: '#ffffff' },
	primary: { bg: '#3b82f6', fg: '#ffffff' },
	danger: { bg: '#dc2626', fg: '#ffffff' },
	warning: { bg: '#eab308', fg: '#111111' },
	info: { bg: '#06b6d4', fg: '#ffffff' },
	secondary: { bg: '#334155', fg: '#ffffff' },
	light: { bg: '#e5e7eb', fg: '#111111' },
	dark: { bg: '#1f2937', fg: '#ffffff' },
};

export function renderBadgeNode(label, colorKey) {
	const fb = FALLBACK_STYLE[colorKey] || FALLBACK_STYLE.secondary;
	const span = document.createElement('span');
	span.textContent = label;
	span.style.display = 'inline-block';
	span.style.padding = '2px 8px';
	span.style.borderRadius = '999px';
	span.style.fontSize = '12px';
	span.style.fontWeight = '600';
	span.style.lineHeight = '1.4';
	span.style.backgroundColor = fb.bg;
	span.style.color = fb.fg;
	return span;
}
export function renderBadge(label, colorKey) {
	return renderBadgeNode(label, colorKey).outerHTML;
}

/* Versão “rica” (mantém seu comportamento com ACTIVE/PAUSE/BAN/BLOCK) */
export function pickStatusColor(labelUp) {
	if (labelUp === 'ACTIVE') return 'success';
	if (labelUp.includes('PAUSE')) return 'warning';
	if (labelUp.includes('BAN') || labelUp.includes('BLOCK')) return 'danger';
	return 'primary';
}

/* Versão simples (também exportada caso você use em outras telas) */
export function pickStatusColorSimple(raw) {
	const s = String(raw || '')
		.trim()
		.toLowerCase();
	return s === 'active' ? 'success' : 'secondary';
}

/* ========== 2.5 Toast simplificado ========== */
export function showToast(msg, type = 'info') {
	const colors = {
		info: 'linear-gradient(90deg,#06b6d4,#3b82f6)',
		success: 'linear-gradient(90deg,#22c55e,#16a34a)',
		warning: 'linear-gradient(90deg,#f59e0b,#eab308)',
		danger: 'linear-gradient(90deg,#ef4444,#dc2626)',
	};
	if (globalThis.Toastify) {
		Toastify({
			text: msg,
			duration: 2200,
			close: true,
			gravity: 'bottom',
			position: 'right',
			stopOnFocus: true,
			backgroundColor: colors[type] || colors.info,
		}).showToast();
	} else {
		console.log(`[Toast] ${msg}`);
	}
}

/* =========================================
 * 3) UTILS DE CÉLULA (comuns em outras páginas)
 * =======================================*/
export function shouldSuppressCellChange(p, colId) {
	const key = `__suppress_${colId}`;
	if (p?.data?.[key]) {
		p.data[key] = false;
		return true;
	}
	return false;
}
export function setCellSilently(p, colId, value) {
	const key = `__suppress_${colId}`;
	if (p?.data) p.data[key] = true;
	p.node.setDataValue(colId, value);
}
export function setCellValueNoEvent(p, colId, value) {
	if (!p?.node?.data) return;
	const key = `__suppress_${colId}`;
	p.node.data[key] = true;
	p.node.data[colId] = value;
	p.api.refreshCells({ rowNodes: [p.node], columns: [colId], force: true, suppressFlash: true });
}
export function isCellJustSaved(p, colId) {
	return !!p?.data?.__justSaved?.[colId];
}
export function isCellLoading(p, colId) {
	return !!p?.data?.__loading?.[colId];
}
export function isCellError(p, colId) {
	return !!p?.data?.__err?.[colId];
}
export function setCellLoading(node, colId, on) {
	if (!node?.data) return;
	node.data.__loading = node.data.__loading || {};
	node.data.__loading[colId] = !!on;
}
export function clearCellError(node, colId) {
	if (!node?.data?.__err) return;
	delete node.data.__err[colId];
	const api = globalThis.LionGrid?.api;
	api?.refreshCells?.({
		rowNodes: [node],
		columns: [colId],
		force: true,
		suppressFlash: true,
	});
}
export function markCellError(node, colId, ms = 60000) {
	if (!node?.data) return;
	node.data.__err = node.data.__err || {};
	node.data.__err[colId] = true;
	const api = globalThis.LionGrid?.api;
	api?.refreshCells?.({
		rowNodes: [node],
		columns: [colId],
		force: true,
		suppressFlash: true,
	});
	setTimeout(() => clearCellError(node, colId), ms);
}
export function markCellJustSaved(node, colId, ms = 60000) {
	if (!node?.data) return;
	node.data.__justSaved = node.data.__justSaved || {};
	node.data.__justSaved[colId] = true;
	const api = globalThis.LionGrid?.api;
	api?.refreshCells?.({ rowNodes: [node], columns: [colId] });
	setTimeout(() => {
		try {
			if (!node?.data?.__justSaved) return;
			delete node.data.__justSaved[colId];
			api?.refreshCells?.({ rowNodes: [node], columns: [colId] });
		} catch {}
	}, ms);
}

/* =========================================
 * 2) UTILS (comuns entre tabelas)
 * =======================================*/

/** Sleep async */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Strip básico de HTML (export mantido) */
export const stripHtml = (s) =>
	typeof s === 'string'
		? s
				.replace(/<[^>]*>/g, ' ')
				.replace(/\s+/g, ' ')
				.trim()
		: s;

/** Extrai <strong>...</strong> se houver, senão retorna texto limpo */
export const strongText = (s) => {
	if (typeof s !== 'string') return s;
	const m = s.match(/<strong[^>]*>(.*?)<\/strong>/i);
	return stripHtml(m ? m[1] : s);
};

/** NumberFormat comum */
export const intFmt = new Intl.NumberFormat('pt-BR');

/** Parser BR padrão (string → number) */
export const toNumberBR = (s) => {
	if (s == null) return null;
	if (typeof s === 'number') return s;
	const raw = String(s)
		.replace(/[^\d,.-]/g, '')
		.replace(/\.\s*/g, '')
		.replace(',', '.');
	const n = parseFloat(raw);
	return Number.isFinite(n) ? n : null;
};

/** Conversores auxiliares para sort/filter no front */
export function frontToNumberBR(v) {
	if (v == null) return null;
	if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	const s = String(v).trim();
	if (!s) return null;
	const sign = s.includes('-') ? -1 : 1;
	const only = s
		.replace(/[^\d,.-]/g, '')
		.replace(/\./g, '')
		.replace(',', '.');
	const n = Number(only);
	return Number.isFinite(n) ? sign * n : null;
}
export function frontToNumberFirst(s) {
	if (s == null) return null;
	const str = String(s);
	const m = str.match(/-?\d{1,3}(?:\.\d{3})*,\d{2}/) || str.match(/-?\d+(?:\.\d+)?/);
	if (!m) return null;
	const clean = m[0].replace(/\./g, '').replace(',', '.');
	const n = parseFloat(clean);
	return Number.isFinite(n) ? n : null;
}

/** Coerção numérica com fallback de moeda atual */
export function number(x) {
	const n1 = toNumberBR(x);
	if (Number.isFinite(n1)) return n1;
	const n2 = parseCurrencyFlexible(x, getAppCurrency());
	return Number.isFinite(n2) ? n2 : 0;
}

/** Somas auxiliares / divisões seguras / normalizador BR */
export function sumNum(arr, pick) {
	let acc = 0;
	for (let i = 0; i < arr.length; i++) {
		const v = pick(arr[i]);
		if (Number.isFinite(v)) acc += v;
	}
	return acc;
}
export function safeDiv(num, den) {
	return den > 0 ? num / den : 0;
}
export function numBR(x) {
	const n1 = toNumberBR(x);
	if (n1 != null) return n1;
	const n2 = parseCurrencyFlexible(x, getAppCurrency());
	return Number.isFinite(n2) ? n2 : null;
}

/** Formatadores rápidos */
export function cc_currencyFormat(n) {
	if (!Number.isFinite(n)) return '';
	const cur = getAppCurrency();
	const locale = cur === 'USD' ? 'en-US' : 'pt-BR';
	return new Intl.NumberFormat(locale, { style: 'currency', currency: cur }).format(n);
}
export function cc_percentFormat(n, digits = 1) {
	if (!Number.isFinite(n)) return '';
	return (n * 100).toFixed(digits) + '%';
}
export function currencyFormatter(p) {
	const currency = getAppCurrency();
	const locale = currency === 'USD' ? 'en-US' : 'pt-BR';
	let n = typeof p.value === 'number' ? p.value : parseCurrencyFlexible(p.value, currency);
	if (!Number.isFinite(n)) return p.value ?? '';
	return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
}

/** Clipboard helper com fallback */
export async function copyToClipboard(text) {
	try {
		await navigator.clipboard.writeText(String(text ?? ''));
		showToast('Copiado!', 'success');
	} catch {
		const ta = document.createElement('textarea');
		ta.value = String(text ?? '');
		ta.style.position = 'fixed';
		ta.style.left = '-9999px';
		document.body.appendChild(ta);
		ta.select();
		try {
			document.execCommand('copy');
			showToast('Copiado!', 'success');
		} catch {
			showToast('Falha ao copiar', 'danger');
		} finally {
			ta.remove();
		}
	}
}
