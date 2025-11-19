/* =========================================
 * Shared Utils (reutilizáveis entre tabelas)
 * =======================================*/

/* ========== 2.1 Tempo / Async ========== */
/* ========== 2.1 Tempo / Async ========== */

let LION_CURRENCY = 'BRL'; // 'BRL' | 'USD'

// [ADICIONE ESTA FUNÇÃO EXPORTADA]
export function setAppCurrency(code) {
	if (code) LION_CURRENCY = String(code).toUpperCase();
}

export function getAppCurrency() {
	return LION_CURRENCY;
}

export async function withMinSpinner(startMs, minMs) {
	const elapsed = performance.now() - startMs;
	if (elapsed < minMs) await sleep(minMs - elapsed);
}

export function cc_evalExpression(expr, row) {
	if (typeof expr !== 'string' || !expr.trim()) return null;

	// === 1) Tokenização segura ===
	// Tokens permitidos:
	//  - números decimais: 123, 123.45, .5
	//  - identificadores: campaign_revenue, fb_revenue, _x1
	//  - operadores: + - * / ( )
	//  - espaço
	const TOK_NUMBER = /(?:\d+\.\d+|\d+|\.\d+)/y;
	const TOK_IDENT = /[A-Za-z_]\w*/y;
	const TOK_OP = /[+\-*/()]/y;
	const TOK_SPACE = /\s+/y;

	const s = expr.trim();
	const tokens = [];
	let i = 0;

	while (i < s.length) {
		TOK_SPACE.lastIndex = TOK_NUMBER.lastIndex = TOK_IDENT.lastIndex = TOK_OP.lastIndex = i;

		if (TOK_SPACE.test(s)) {
			i = TOK_SPACE.lastIndex;
			continue;
		}

		if (TOK_NUMBER.test(s)) {
			const t = s.slice(i, TOK_NUMBER.lastIndex);
			tokens.push({ type: 'num', value: t });
			i = TOK_NUMBER.lastIndex;
			continue;
		}

		if (TOK_IDENT.test(s)) {
			const t = s.slice(i, TOK_IDENT.lastIndex);
			tokens.push({ type: 'id', value: t });
			i = TOK_IDENT.lastIndex;
			continue;
		}

		if (TOK_OP.test(s)) {
			const t = s.slice(i, TOK_OP.lastIndex);
			tokens.push({ type: 'op', value: t });
			i = TOK_OP.lastIndex;
			continue;
		}

		// Qualquer outro caractere (inclui ponto fora de número, %, ^, [], {}, aspas, vírgula, etc.)
		return null;
	}

	if (!tokens.length) return null;

	// === 2) Valida identificadores e constrói lista de permitidos ===
	const allowedIdSet = new Set(['number', ...Object.keys(row || {})]);
	for (const tk of tokens) {
		if (tk.type === 'id' && !allowedIdSet.has(tk.value)) return null;
	}

	// === 3) Reconstrói expressão “sanitizada” (sem espaços extras) ===
	// Mantemos a ordem original, apenas juntando os lexemas aprovados.
	const safeExpr = tokens.map((t) => t.value).join('');

	// === 4) Executa com escopo controlado ===
	try {
		// Passa todos os campos do row como variáveis locais
		const keys = [...allowedIdSet].filter((k) => k !== 'number');
		const fn = new Function(
			'number',
			'row',
			`
        "use strict";
        const { ${keys.join(', ')} } = row;
        return (${safeExpr});
      `
		);
		const val = fn(number, row || {});
		return Number.isFinite(val) ? val : null;
	} catch {
		return null;
	}
}
export class StackBelowRenderer {
	init(p) {
		this.p = p;

		const wrap = document.createElement('span');
		wrap.style.display = 'inline-flex';
		wrap.style.flexDirection = 'column';
		wrap.style.lineHeight = '1.15';
		wrap.style.gap = '2px';

		const lvl = p?.node?.level ?? -1;
		const params = p?.colDef?.cellRendererParams || {};
		const onlyLevel0 = !!params.onlyLevel0;
		const showTop = params.showTop !== false;
		const partsLabelOnly = !!params.partsLabelOnly;
		const maxParts = Number(params.maxParts) || 0;
		// Formato global da coluna (fallback)
		const fmtKey = String(params.format || 'raw');

		const partsMaxHeight = Number(params.partsMaxHeight) > 0 ? Number(params.partsMaxHeight) : 72;

		if (isPinnedOrTotal(p)) {
			const span = document.createElement('span');
			span.textContent = stripHtml(p.value ?? '');
			wrap.appendChild(span);
			this.topEl = span;
			this.partsBox = null;
			this.eGui = wrap;
			return;
		}

		if (onlyLevel0 && lvl !== 0) {
			this.topEl = null;
			this.partsBox = null;
			this.eGui = wrap;
			return;
		}

		// Função auxiliar de formatação
		const resolveFormat = (v, fmt) => {
			if (v == null) return '';
			if (fmt === 'currency') return cc_currencyFormat(Number(v));
			if (fmt === 'int') return intFmt.format(Math.round(Number(v)));
			if (fmt === 'percent') return cc_percentFormat(Number(v)); // Usa padrão de 3 casas do utils
			return String(v);
		};

		// 1. Topo (Valor Principal)
		this.topEl = null;
		if (showTop) {
			const topEl = document.createElement('span');
			const topVal = p.valueFormatted != null ? p.valueFormatted : p.value;
			// O topo sempre usa o formato principal da coluna (fmtKey)
			const coerced = typeof topVal === 'number' ? topVal : number(topVal);
			topEl.textContent = resolveFormat(Number.isFinite(coerced) ? coerced : topVal, fmtKey);
			wrap.appendChild(topEl);
			this.topEl = topEl;
		}

		// 2. Partes (Lista Scrollável)
		const partsBox = document.createElement('span');
		partsBox.className = 'lion-stack-scroll';
		partsBox.style.display = 'inline-flex';
		partsBox.style.flexDirection = 'column';
		partsBox.style.gap = '2px';
		partsBox.style.maxHeight = partsMaxHeight + 'px';
		partsBox.style.overflowY = 'auto';
		partsBox.style.paddingRight = '2px';
		partsBox.style.contain = 'content';
		this.partsBox = partsBox;

		const partsFn = p?.colDef?.cellRendererParams?.getParts;
		let parts = [];
		try {
			parts = typeof partsFn === 'function' ? partsFn(p) : [];
		} catch {}
		if (!Array.isArray(parts)) parts = [];
		if (maxParts > 0) parts = parts.slice(0, maxParts);

		parts.forEach((row) => {
			const line = document.createElement('span');
			line.style.fontSize = '11px';
			line.style.opacity = '0.85';
			const lab = String(row?.label ?? '').trim();
			const valNum = Number.isFinite(row?.value) ? row.value : number(row?.value);

			// [CORREÇÃO] Usa formato específico da linha se existir, senão usa o global
			const rowFmt = row.format || fmtKey;

			line.textContent = partsLabelOnly
				? lab || ''
				: (lab ? `${lab}: ` : '') + resolveFormat(valNum, rowFmt);

			partsBox.appendChild(line);
		});

		if (partsBox.childNodes.length > 0) wrap.appendChild(partsBox);

		wrap.addEventListener('dblclick', () => {
			const txt = this.getCopyText();
			if (txt) {
				navigator.clipboard?.writeText(txt).catch(() => {});
				try {
					showToast('Copied!', 'success');
				} catch {}
			}
		});

		this.eGui = wrap;
	}
	getGui() {
		return this.eGui;
	}

	refresh(p) {
		this.init(p);
		return true;
	}

	// <- NOVO: retorna o texto exatamente como aparece (topo + linhas)
	getCopyText() {
		const lines = [];
		const t = (el) => (el ? String(el.textContent || '').trim() : '');
		const push = (s) => {
			if (s && s !== '—') lines.push(s);
		};
		push(t(this.topEl));
		if (this.partsBox) {
			for (const child of this.partsBox.childNodes) push(t(child));
		}
		return lines.join('\n');
	}
}
export function parseCurrencyFlexible(value, currency = 'BRL') {
	if (value == null || value === '') return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;

	let s = String(value).trim();
	// Lógica de detecção baseada na moeda passada (BRL vs USD)
	// Se BRL, assume milhar=ponto, decimal=virgula. Se USD, oposto.
	const isBRL = currency === 'BRL';

	if (isBRL) {
		// Remove tudo que não for dígito, vírgula ou menos
		s = s.replace(/[^\d,-]/g, '').replace(',', '.');
	} else {
		// USD: Remove tudo que não for dígito, ponto ou menos
		s = s.replace(/[^\d.-]/g, '');
	}

	const n = parseFloat(s);
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
export function numBR(x, currency = 'BRL') {
	// Tenta nativo
	if (typeof x === 'number') return Number.isFinite(x) ? x : 0;
	// Tenta parse string
	const n = parseCurrencyFlexible(x, currency);
	return Number.isFinite(n) ? n : 0;
}

export function cc_currencyFormat(n, currency = 'BRL', locale = 'pt-BR') {
	if (!Number.isFinite(n)) return '';
	return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
}

export function cc_percentFormat(n, digits = 3) {
	// Validação de segurança
	if (!Number.isFinite(n)) return '';

	return (
		n.toLocaleString('pt-BR', {
			minimumFractionDigits: digits,
			maximumFractionDigits: digits,
		}) + '%'
	);
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
		showToast('Copied!', 'success');
	} catch {
		const ta = document.createElement('textarea');
		ta.value = String(text ?? '');
		ta.style.position = 'fixed';
		ta.style.left = '-9999px';
		document.body.appendChild(ta);
		ta.select();
		try {
			document.execCommand('copy');
			showToast('Copied!', 'success');
		} catch {
			showToast('Failed to copy', 'danger');
		} finally {
			ta.remove();
		}
	}
}
