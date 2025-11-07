import {
	withMinSpinner,
	getAppCurrency,
	isPinnedOrTotal,
	showToast,
	sleep,
	stripHtml,
	strongText,
	intFmt,
	toNumberBR,
	frontToNumberBR,
	frontToNumberFirst,
	number,
	sumNum,
	safeDiv,
	numBR,
	cc_currencyFormat,
	cc_percentFormat,
	currencyFormatter,
	copyToClipboard,
} from './utils.js';

/* =========================================
 * 0) Endpoints & Drilldown knobs
 * =======================================*/
const ENDPOINTS = { SSRM: '/api/ssrm/?clean=1&mode=full' };
const DRILL_ENDPOINTS = { ADSETS: '/api/adsets/', ADS: '/api/ads/' };
const DRILL = { period: 'TODAY' };

// === Fake network & min spinner (drilldown) ===
const DRILL_MIN_SPINNER_MS = 900; // mínimo que o spinner fica visível ao abrir filhos
const DRILL_FAKE_NETWORK_MS = 0; // latência fake extra (ex.: 800 ou 1200)

/* =========================================
 * 1) Estado Global
 * =======================================*/
let ROOT_CACHE = null; // Cache local do nível 0 (campanhas)
let LION_CURRENCY = 'BRL'; // 'BRL' | 'USD'

export let GLOBAL_QUICK_FILTER = ''; // 🔍 QUICK FILTER global (vai em filterModel._global.filter)

/* =========================================
 * 3) CSS de Loading (injeção automática)
 * =======================================*/
(function ensureLoadingStyles() {
	if (document.getElementById('lion-loading-styles')) return;
	const css = `
.ag-cell.ag-cell-loading * { visibility: hidden !important; }
.ag-cell.ag-cell-loading::after {
  content:""; position:absolute; left:50%; top:50%; width:14px; height:14px;
  margin-left:-7px; margin-top:-7px; border-radius:50%; border:2px solid #9ca3af;
  border-top-color:transparent; animation: lion-spin .8s linear infinite; z-index:2; pointer-events:none;
}
.lion-status-menu { position:absolute; min-width:160px; padding:6px 0; background:#111; color:#eee; border:1px solid rgba(255,255,255,.08); border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,.35); z-index:99999; }
.lion-status-menu__item { padding:8px 12px; font-size:12px; cursor:pointer; display:flex; align-items:center; gap:8px; }
.lion-status-menu__item:hover { background: rgba(255,255,255,.06); }
.lion-status-menu__item.is-active::before { content:"●"; font-size:10px; line-height:1; }
@keyframes lion-spin { to { transform: rotate(360deg); } }
.lion-editable-pen{ display:inline-flex; align-items:center; margin-left:6px; opacity:.45; pointer-events:none; font-size:12px; line-height:1; }
.ag-cell:hover .lion-editable-pen{ opacity:.85 }
.lion-editable-ok{ display:inline-flex; align-items:center; margin-left:6px; opacity:.9; pointer-events:none; font-size:12px; line-height:1; }
.ag-cell:hover .lion-editable-ok{ opacity:1 }
.lion-editable-err{ display:inline-flex; align-items:center; margin-left:6px; opacity:.95; pointer-events:none; font-size:12px; line-height:1; color:#ef4444; }
.ag-cell:hover .lion-editable-err{ opacity:1 }
.ag-cell.lion-cell-error{ background: rgba(239, 68, 68, 0.12); box-shadow: inset 0 0 0 1px rgba(239,68,68,.35); transition: background .2s ease, box-shadow .2s ease; }
.ag-cell.lion-cell-error .lion-editable-val{ color: #ef4444; font-weight: 600; }
.ag-cell.lion-cell-error.ag-cell-focus, .ag-cell.lion-cell-error:hover{ background: rgba(239, 68, 68, 0.18); box-shadow: inset 0 0 0 1px rgba(239,68,68,.5); }

/* ===== Centralização real para células que podem quebrar linha ===== */
/* 1) Remove o viés de -1px do tema nas colunas marcadas como 'lion-center-cell' */
.ag-theme-quartz :where(.ag-ltr) .ag-center-cols-container
  .ag-cell.lion-center-cell:not(.ag-cell-inline-editing):not([col-id="ag-Grid-AutoColumn"]):not([col-id="campaign"]) {
  padding-left: var(--ag-cell-horizontal-padding) !important;
  padding-right: var(--ag-cell-horizontal-padding) !important;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;      /* texto multi-linha centraliza */
}

/* 2) Faz os wrappers ocuparem a largura toda */
.ag-theme-quartz .ag-center-cols-container
  .ag-cell.lion-center-cell:not(.ag-cell-inline-editing) .ag-cell-wrapper {
  width: 100%;
}

/* 3) Garante que o conteúdo (quebrando linha) centralize */
.ag-theme-quartz .ag-center-cols-container
  .ag-cell.lion-center-cell:not(.ag-cell-inline-editing) .ag-cell-value {
  display: block;          /* evita inline-size encolhendo */
  width: 100%;             /* ocupa a célula toda */
  text-align: center;      /* linhas quebradas centralizadas */
  white-space: normal;     /* habilita wrap */
  word-break: break-word;
  overflow-wrap: anywhere;
}
`;
	const el = document.createElement('style');
	el.id = 'lion-loading-styles';
	el.textContent = css;
	document.head.appendChild(el);
})();

/* =========================================
 * 4) AG Grid: acesso + licença
 * =======================================*/
function getAgGrid() {
	const AG = globalThis.agGrid;
	if (!AG) throw new Error('AG Grid UMD not loaded. Check the script ORDER and the CDN path.');
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

/* =========================================
 * 5) Helpers de sort/filter no FRONT (reutilizáveis)
 * =======================================*/
function frontApplySort(rows, sortModel) {
	if (!Array.isArray(sortModel) || !sortModel.length) return rows;
	const orderStatus = ['ACTIVE', 'PAUSED', 'DISABLED', 'CLOSED'];
	return rows.slice().sort((a, b) => {
		for (const s of sortModel) {
			const { colId, sort } = s;
			const dir = sort === 'desc' ? -1 : 1;
			let av = a[colId],
				bv = b[colId];

			// status custom
			if (colId === 'account_status' || colId === 'campaign_status' || colId === 'status') {
				const ai = orderStatus.indexOf(String(av ?? '').toUpperCase());
				const bi = orderStatus.indexOf(String(bv ?? '').toUpperCase());
				const aIdx = ai === -1 ? Number.POSITIVE_INFINITY : ai;
				const bIdx = bi === -1 ? Number.POSITIVE_INFINITY : bi;
				const cmp = (aIdx - bIdx) * dir;
				if (cmp !== 0) return cmp;
				continue;
			}

			// revenue: pega primeiro número da string
			if (colId === 'revenue') {
				const an = frontToNumberFirst(av);
				const bn = frontToNumberFirst(bv);
				if (an == null && bn == null) continue;
				if (an == null) return -1 * dir;
				if (bn == null) return 1 * dir;
				if (an !== bn) return (an < bn ? -1 : 1) * dir;
				continue;
			}

			// padrão: numérico se possível, senão texto
			const an = frontToNumberBR(av);
			const bn = frontToNumberBR(bv);
			const bothNum = an != null && bn != null;
			let cmp;
			if (bothNum) cmp = an === bn ? 0 : an < bn ? -1 : 1;
			else {
				const as = String(av ?? '').toLowerCase();
				const bs = String(bv ?? '').toLowerCase();
				cmp = as.localeCompare(bs, 'pt-BR');
			}
			if (cmp !== 0) return cmp * dir;
		}
		return 0;
	});
}
function frontApplyFilters(rows, filterModel) {
	if (!filterModel || typeof filterModel !== 'object') return rows;
	const globalFilter = String(filterModel._global?.filter || '')
		.trim()
		.toLowerCase();

	const checks = Object.entries(filterModel)
		.filter(([field]) => field !== '_global')
		.map(([field, f]) => {
			const ft = f.filterType || f.type || 'text';
			const isCampaignCol =
				field === 'campaign' ||
				field === 'ag-Grid-AutoColumn' ||
				field.startsWith('ag-Grid-AutoColumn');

			// CAMPANHA (nome + UTM)
			if (isCampaignCol) {
				const comp = String(f.type || 'contains');
				const needle = String(f.filter ?? '').toLowerCase();
				if (!needle) return () => true;
				return (r) => {
					const name = String(r.__label || r.campaign_name || '').toLowerCase();
					const utm = String(r.utm_campaign || '').toLowerCase();
					const combined = (name + ' ' + utm).trim();
					switch (comp) {
						case 'equals':
							return combined === needle;
						case 'notEqual':
							return combined !== needle;
						case 'startsWith':
							return combined.startsWith(needle);
						case 'endsWith':
							return combined.endsWith(needle);
						case 'notContains':
							return !combined.includes(needle);
						case 'contains':
						default:
							return combined.includes(needle);
					}
				};
			}

			// includes / excludes (lista)
			if (ft === 'includes' && Array.isArray(f.values)) {
				const set = new Set(f.values.map((v) => String(v).toLowerCase()));
				return (r) => set.has(String(r[field] ?? '').toLowerCase());
			}
			if (ft === 'excludes' && Array.isArray(f.values)) {
				const set = new Set(f.values.map((v) => String(v).toLowerCase()));
				return (r) => !set.has(String(r[field] ?? '').toLowerCase());
			}

			// texto (genérico)
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

			// number
			if (ft === 'number') {
				const comp = String(f.type || 'equals');
				const val = Number(f.filter);
				return (r) => {
					const n = frontToNumberBR(r[field]);
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

/* =========================================
 * 6) Totais no CLIENTE (nível 0)
 * =======================================*/
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
 * 7) Calculated Columns Helpers (safe eval)
 * =======================================*/
/**
 * Avaliador SEGURO de expressões aritméticas sobre o row.
 * Suporta: + - * / () espaços e identificadores [A-Za-z_]\w* e helper number.
 */
/**
 * Avaliador SEGURO de expressões aritméticas sobre o row.
 * Suporta: + - * / () espaços, identificadores [A-Za-z_]\w*, helper number,
 * e **números decimais** (ex.: 0.5, 1.25, .75).
 * Não permite: %, ^, [], {}, strings, vírgulas, acessos com ponto (a.b).
 */
function cc_evalExpression(expr, row) {
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

/* =========================================
 * 8) Utils de status/loading por célula (placeholder da seção)
 * =======================================*/
// (mantido como no original — drop-in para substituir redrawRows quando usado)

/* =========================================
 * 9) Renderers
 * =======================================*/

const REVENUE_LABELS = ['A', 'B'];

/** Renderer: valor principal + linhas auxiliares abaixo (com scroll nas partes) */
/** Renderer: valor principal + linhas auxiliares abaixo (com scroll nas partes) */
function StackBelowRenderer() {}
StackBelowRenderer.prototype.init = function (p) {
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
	const fmtKey = String(params.format || 'raw');

	const partsMaxHeight = Number(params.partsMaxHeight) > 0 ? Number(params.partsMaxHeight) : 72;

	// 👉 Se for pinned/total, deixa como estava (mostra texto simples)
	if (isPinnedOrTotal(p)) {
		const span = document.createElement('span');
		span.textContent = stripHtml(p.value ?? '');
		wrap.appendChild(span);
		this.topEl = span;
		this.partsBox = null;
		this.eGui = wrap;
		return;
	}

	// 👉 Se onlyLevel0 e NÃO é raiz, **não mostra nada**
	if (onlyLevel0 && lvl !== 0) {
		// deixa o wrapper vazio para manter altura/linha consistente
		this.topEl = null;
		this.partsBox = null;
		this.eGui = wrap;
		return;
	}
	// ... (restante do init continua igual a partir daqui — começando em formatVal)

	const formatVal = (v) => {
		if (v == null) return '';
		if (fmtKey === 'currency') return cc_currencyFormat(Number(v));
		if (fmtKey === 'int') return intFmt.format(Math.round(Number(v)));
		if (fmtKey === 'percent') return cc_percentFormat(Number(v));
		return String(v);
	};

	// Linha do topo (valor principal)
	this.topEl = null;
	if (showTop) {
		const topEl = document.createElement('span');
		const topVal = p.valueFormatted != null ? p.valueFormatted : p.value;
		const coerced = typeof topVal === 'number' ? topVal : number(topVal);
		topEl.textContent = formatVal(Number.isFinite(coerced) ? coerced : topVal);
		wrap.appendChild(topEl);
		this.topEl = topEl;
	}

	// Container SCROLLÁVEL das partes
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
		line.textContent = partsLabelOnly ? lab || '' : (lab ? `${lab}: ` : '') + formatVal(valNum);
		partsBox.appendChild(line);
	});

	if (partsBox.childNodes.length > 0) wrap.appendChild(partsBox);

	// atalho: duplo-clique copia exatamente o que está renderizado
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
};
StackBelowRenderer.prototype.getGui = function () {
	return this.eGui;
};
StackBelowRenderer.prototype.refresh = function (p) {
	this.init(p);
	return true;
};

// <- NOVO: retorna o texto exatamente como aparece (topo + cada linha das partes)
StackBelowRenderer.prototype.getCopyText = function () {
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
};

/* =========================================
 * 10) Fetch JSON helper
 * =======================================*/
async function fetchJSON(url, opts) {
	const res = await fetch(url, {
		headers: { 'Content-Type': 'application/json' },
		credentials: 'same-origin',
		...opts,
	});
	let data;
	try {
		data = await res.json();
	} catch {
		data = {};
	}
	if (!res.ok) throw new Error(data?.error || res.statusText || 'Request failed');
	return data;
}

/* =========================================
 * 11) Modal simples (KTUI-like)
 * =======================================*/
function ensureKtModalDom() {
	if (document.getElementById('lionKtModal')) return;
	const tpl = document.createElement('div');
	tpl.innerHTML = `
<div class="kt-modal hidden" data-kt-modal="true" id="lionKtModal" aria-hidden="true">
  <div class="kt-modal-content max-w-[420px] top-[10%]">
    <div class="kt-modal-header">
      <h3 class="kt-modal-title">Details</h3>
      <button type="button" class="kt-modal-close" aria-label="Close" data-kt-modal-dismiss="#lionKtModal">✕</button>
    </div>
    <div class="kt-modal-body">
      <pre class="whitespace-pre-wrap text-sm"></pre>
    </div>
  </div>
</div>`;
	document.body.appendChild(tpl.firstElementChild);
	document
		.querySelector('[data-kt-modal-dismiss="#lionKtModal"]')
		?.addEventListener('click', () => closeKTModal('#lionKtModal'));
	document.getElementById('lionKtModal')?.addEventListener('click', (e) => {
		if (e.target.id === 'lionKtModal') closeKTModal('#lionKtModal');
	});
}
function openKTModal(selector = '#lionKtModal') {
	const el = document.querySelector(selector);
	if (!el) return;
	el.style.display = 'block';
	el.classList.add('kt-modal--open');
	el.classList.remove('hidden');
	el.removeAttribute('aria-hidden');
}
function closeKTModal(selector = '#lionKtModal') {
	const modal = document.querySelector(selector);
	if (!modal) return;

	// inverte visibilidade
	modal.setAttribute('aria-hidden', 'true');
	modal.style.display = 'none';
	modal.classList.remove('kt-modal--open');
	modal.classList.add('hidden');
}
function showKTModal({ title = 'Details', content = '' } = {}) {
	ensureKtModalDom();
	const modal = document.querySelector('#lionKtModal');
	if (!modal) return;

	// atualizar conteúdo
	modal.querySelector('.kt-modal-title').textContent = title;
	modal.querySelector('.kt-modal-body > pre').textContent = content;

	// Primeiro seta aria-hidden = 'false' para ativar visibilidade via CSS
	modal.setAttribute('aria-hidden', 'false');

	// Depois mostra via display
	modal.style.display = 'flex';
	modal.classList.add('kt-modal--open');
	modal.classList.remove('hidden');
}

/* ========= Calculated Columns: populate selects (Col 1 / Col 2) ========= */
(function CalcColsPopulate() {
	const $col1 = document.getElementById('cc-col1');
	const $col2 = document.getElementById('cc-col2');
	const $reload = document.getElementById('cc-reload');
	let lastSelection = { col1: null, col2: null };

	function resolveGridApis() {
		if (globalThis.gridOptions?.api) return { api: globalThis.gridOptions.api };
		if (globalThis.LionGrid?.api) return { api: globalThis.LionGrid.api };
		if (typeof globalThis.getAgGridApis === 'function') {
			const apis = globalThis.getAgGridApis();
			if (apis?.api) return { api: apis.api };
		}
		return { api: null };
	}
	function _isCalculableByDef(def) {
		if (!def) return false;
		if (def.calcEligible === true) return true;
		if (def.calcType === 'numeric') return true;
		if (def.valueType === 'number') return true;
		if (def.cellDataType === 'number') return true;
		if (def.type === 'numericColumn') return true;
		if (def.filter === 'agNumberColumnFilter') return true;
		if (typeof def.valueParser === 'function') return true;
		return false;
	}
	function getSelectableColumns(api) {
		if (!api) return [];
		let defs = [];
		try {
			const displayed = api.getAllDisplayedColumns?.() || [];
			if (displayed.length)
				defs = displayed.map((gc) => gc.getColDef?.() || gc.colDef || null).filter(Boolean);
		} catch (_) {}
		if (!defs.length) {
			const columnState = api.getColumnState?.() || [];
			const viaState = columnState
				.map((s) => api.getColumn?.(s.colId)?.getColDef?.())
				.filter(Boolean);
			if (viaState.length) defs = viaState;
			else defs = (api.getColumnDefs?.() || []).flatMap(flattenColDefs);
		}
		const deny = new Set(['ag-Grid-AutoColumn', 'ag-Grid-RowGroup', '__autoGroup']);
		defs = defs.filter((def) => {
			if (!def) return false;
			const field = def.field || def.colId;
			const header = def.headerName || field;
			if (!field || !header) return false;
			if (deny.has(field)) return false;
			if (String(field).startsWith('__')) return false;
			if (def.checkboxSelection) return false;
			if (def.rowGroup || def.pivot) return false;
			const h = String(header).toLowerCase();
			if (h.includes('select') || h.includes('ação') || h.includes('action')) return false;
			return true;
		});
		defs = defs.filter(_isCalculableByDef);
		const mapped = defs.map((def) => ({
			field: String(def.field || def.colId),
			headerName: String(def.headerName || def.field || def.colId),
		}));
		const seen = new Set();
		const unique = [];
		for (const it of mapped) {
			if (seen.has(it.field)) continue;
			seen.add(it.field);
			unique.push(it);
		}
		return unique;
	}
	function flattenColDefs(defOrArray) {
		const out = [];
		const walk = (arr) => {
			(arr || []).forEach((def) => {
				if (def?.children?.length) walk(def.children);
				else out.push(def);
			});
		};
		if (Array.isArray(defOrArray)) walk(defOrArray);
		else if (defOrArray) walk([defOrArray]);
		return out;
	}
	function fillSelect(selectEl, items, keepValue) {
		if (!selectEl) return;
		const current = selectEl.value || null;
		const desired = keepValue ?? current ?? '';
		while (selectEl.options.length) selectEl.remove(0);
		const placeholderText =
			selectEl.getAttribute('data-kt-select-placeholder') ||
			selectEl.getAttribute('title') ||
			'Select';
		const hasDesired = desired && items.some((it) => it.field === desired);
		const ph = new Option(placeholderText, '');
		if (!hasDesired) {
			ph.disabled = true;
			ph.selected = true;
		}
		selectEl.add(ph);
		for (const it of items) {
			const label = `${String(it.headerName)} (${String(it.field)})`;
			const opt = new Option(label, String(it.field));
			selectEl.add(opt);
		}
		if (hasDesired) selectEl.value = desired;
		try {
			selectEl.dispatchEvent(new CustomEvent('kt:select:refresh', { bubbles: true }));
			if (window.KT?.select?.refresh) window.KT.select.refresh(selectEl);
			if (window.KT?.reinitSelect) window.KT.reinitSelect(selectEl);
			selectEl.dispatchEvent(new Event('change', { bubbles: true }));
		} catch (_) {}
	}
	function populateColSelects() {
		const { api } = resolveGridApis();
		if (!$col1 || !$col2) return;
		if (!api) return;
		const items = getSelectableColumns(api);
		if (!$col1.value) lastSelection.col1 = lastSelection.col1 || null;
		else lastSelection.col1 = $col1.value;
		if (!$col2.value) lastSelection.col2 = lastSelection.col2 || null;
		else lastSelection.col2 = $col2.value;
		fillSelect($col1, items, lastSelection.col1);
		fillSelect($col2, items, lastSelection.col2);
	}
	function escapeHtml(s) {
		return String(s)
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#39;');
	}
	function bindEventsOnce() {
		if ($reload) {
			$reload.addEventListener(
				'click',
				() => {
					populateColSelects();
				},
				{ passive: true }
			);
			document.getElementById('cc-save')?.setAttribute('data-kt-modal-dismiss', '#calcColsModal');
		}
		const modal = document.getElementById('calcColsModal');
		if (modal) {
			modal.addEventListener('kt:modal:shown', populateColSelects, { passive: true });
			modal.addEventListener('shown.bs.modal', populateColSelects, { passive: true });
			const obs = new MutationObserver((muts) => {
				for (const m of muts) {
					if (m.type === 'attributes' && m.attributeName === 'aria-hidden') {
						if (modal.getAttribute('aria-hidden') === 'false') populateColSelects();
					}
				}
			});
			obs.observe(modal, { attributes: true });
		}
	}
	globalThis.CalcColsUI = { populateSelects: populateColSelects };
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', () => {
			bindEventsOnce();
			populateColSelects();
		});
	} else {
		bindEventsOnce();
		populateColSelects();
	}
})();

/* =========================================
 * 12) Tema (AG Grid Quartz)
 * =======================================*/
function createAgTheme() {
	const AG = getAgGrid();
	const { themeQuartz, iconSetMaterial } = AG;
	if (!themeQuartz || !iconSetMaterial) return undefined;
	return themeQuartz.withPart(iconSetMaterial).withParams({
		browserColorScheme: 'dark',
		backgroundColor: '#0C0C0D',
		foregroundColor: '#f7f9ffff',
		headerBackgroundColor: '#141414',
		headerTextColor: '#FFFFFF',
		accentColor: '#15BDE8',
		borderColor: '#FFFFFF0A',
		rowBorder: true,
		headerRowBorder: true,
		fontFamily: { googleFont: 'IBM Plex Sans' },
		fontSize: 14,
		spacing: 6,
	});
}

/* =========================================
 * 12.1) Composite Columns registry
 * =======================================*/
/* =========================================
 * 12.1) Composite Columns registry (corrigido)
 * =======================================*/
const LionCompositeColumns = (() => {
	const registry = new Map();

	function register(id, builder) {
		registry.set(String(id), builder);
	}

	function _ensureApi() {
		const api = globalThis.LionGrid?.api;
		if (!api) throw new Error('[CompositeColumns] Grid API indisponível');
		return api;
	}

	function _getColumnDefs(api) {
		if (typeof api.getColumnDefs === 'function') return api.getColumnDefs() || [];
		const cols = api.getColumns?.() || [];
		return cols.map((c) => c.getColDef?.()).filter(Boolean);
	}

	function _setColumnDefs(api, defs) {
		if (typeof api.setGridOption === 'function') api.setGridOption('columnDefs', defs);
		else if (typeof api.setColumnDefs === 'function') api.setColumnDefs(defs);
		else {
			const colApi = api.getColumnApi?.();
			if (colApi?.setColumnDefs) colApi.setColumnDefs(defs);
			else throw new Error('api.setColumnDefs is not available');
		}
	}

	function _findGroup(defs, groupId) {
		for (const d of defs) if (d?.groupId === groupId) return d;
		return null;
	}

	// --- helpers globais internos ---
	function _normKey(s) {
		return String(s || '')
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-z0-9]/g, '');
	}

	function _walkDefs(defs, visit, parentCtx = null) {
		(defs || []).forEach((d, idx) => {
			const ctx = { parent: parentCtx?.node || null, arr: defs, idx, node: d };
			if (d && Array.isArray(d.children) && d.children.length) {
				_walkDefs(d.children, visit, ctx);
			} else {
				visit(d, ctx);
			}
		});
	}

	function _buildColIndex(allDefs) {
		const map = new Map();
		_walkDefs(allDefs, (leaf, ctx) => {
			const keys = [
				_normKey(leaf?.colId),
				_normKey(leaf?.field),
				_normKey(leaf?.headerName),
			].filter(Boolean);
			keys.forEach((k) => {
				if (!map.has(k)) map.set(k, { arr: ctx.arr, idx: ctx.idx, leaf });
			});
		});
		return map;
	}
	// Mapeia sinônimos comuns -> chaves canônicas
	function _aliasList(raw) {
		const s = String(raw || '')
			.trim()
			.toLowerCase();
		const base = [raw]; // mantém o original
		const map = {
			revenue: ['revenue', 'receita', 'receitas', 'rev', 'fat', 'faturamento'],
			spent: [
				'spent',
				'gasto',
				'gastos',
				'spend',
				'despesa',
				'despesas',
				'cost',
				'custo',
				'custos',
			],
			profit: ['profit', 'lucro', 'resultado', 'ganho', 'ganhos'],
			mx: ['mx', 'roi', 'roas', 'retorno'],
			ctr: ['ctr', 'taxadeclique', 'taxa de clique'],
			clicks: ['clicks', 'cliques', 'clique'],
		};
		for (const [k, arr] of Object.entries(map)) {
			if (arr.includes(s)) return [k, ...arr];
		}
		return base;
	}

	// Escolhe o “hit” no índice aceitando: (1) match exato normalizado, (2) substring
	function _pickHitByTargets(allDefs, idxMap, afterTargets) {
		const norm = (x) =>
			(x == null ? '' : String(x))
				.toLowerCase()
				.normalize('NFD')
				.replace(/[\u0300-\u036f]/g, '')
				.replace(/[^a-z0-9]/g, '');

		// 1) tenta exact match por qualquer alvo (inclui aliases)
		for (const raw of afterTargets.flatMap(_aliasList)) {
			const key = norm(raw);
			if (key && idxMap.has(key)) return idxMap.get(key);
		}

		// 2) tenta substring match em headerName/field/colId
		const leaves = [];
		_walkDefs(allDefs, (leaf, ctx) => leaves.push({ leaf, ctx }));
		for (const raw of afterTargets.flatMap(_aliasList)) {
			const needle = norm(raw);
			if (!needle) continue;
			for (const { leaf, ctx } of leaves) {
				const bag = [leaf?.headerName, leaf?.field, leaf?.colId].map(norm).filter(Boolean);
				if (bag.some((s) => s.includes(needle))) return { arr: ctx.arr, idx: ctx.idx, leaf };
			}
		}

		return null; // nada encontrado
	}

	// afterKey pode ser string ou array de strings
	function _insertAfter(allDefs, newDef, afterKey, fallbackGroupNode /* opcional */) {
		const targets = (Array.isArray(afterKey) ? afterKey : [afterKey]).filter(
			(k) => k != null && String(k).trim() !== ''
		);

		const idxMap = _buildColIndex(allDefs);
		const hit = _pickHitByTargets(allDefs, idxMap, targets);

		if (hit) {
			const { arr, idx } = hit;
			arr.splice(idx + 1, 0, newDef); // insere ao lado do alvo, no mesmo pai
			return;
		}

		if (fallbackGroupNode && Array.isArray(fallbackGroupNode.children)) {
			fallbackGroupNode.children.push(newDef);
			return;
		}
		allDefs.push(newDef); // fallback final
	}

	function _removeCols(allDefs, idsSet) {
		// remove folhas com colId/field em qualquer nível
		function filterArray(arr) {
			for (let i = arr.length - 1; i >= 0; i--) {
				const d = arr[i];
				if (d?.children?.length) {
					filterArray(d.children);
					// se um grupo ficar vazio, mantemos o grupo (AG Grid lida com grupo vazio)
				} else {
					const key = String(d?.colId || d?.field || '');
					if (key && idsSet.has(key)) arr.splice(i, 1);
				}
			}
		}
		filterArray(allDefs);
	}
	function activate(ids = []) {
		const api = _ensureApi();
		const defsRef = _getColumnDefs(api);
		const newDefs = Array.isArray(defsRef) ? defsRef.slice() : [];
		const fallbackGroupNode = _findGroup(newDefs, 'grp-metrics-rev');

		// só constrói o índice uma vez; atualizamos quando inserir
		let idxMap = _buildColIndex(newDefs);

		for (const id of ids) {
			const builder = registry.get(String(id));
			if (!builder) continue;

			const colDef = builder();
			if (!colDef || typeof colDef !== 'object') continue;

			const colKey = _normKey(String(colDef.colId || colDef.field || ''));
			if (!colKey) continue;

			// evita duplicar
			if (idxMap.has(colKey)) continue;

			// alvo pode vir como __afterId (field/colId) OU __after (label/array)
			let afterRaw = colDef.__afterId || colDef.__after || 'Revenue';
			const afterTargets = Array.isArray(afterRaw) ? afterRaw : [afterRaw];

			_insertAfter(newDefs, colDef, afterTargets, fallbackGroupNode);

			// reindexa após inserir
			idxMap = _buildColIndex(newDefs);
		}

		_setColumnDefs(api, newDefs);
		try {
			api.sizeColumnsToFit?.();
		} catch {}
		return true;
	}

	function deactivate(ids = []) {
		const api = _ensureApi();
		const defsRef = _getColumnDefs(api);
		const newDefs = Array.isArray(defsRef) ? defsRef.slice() : [];
		const idsSet = new Set(ids.map(String));

		_removeCols(newDefs, idsSet);

		_setColumnDefs(api, newDefs);
		try {
			api.sizeColumnsToFit?.();
		} catch {}
		return true;
	}

	return { register, activate, deactivate };
})();

/* =========================================
 * 12.5) Calculated Columns (user-defined)
 * =======================================*/
const LionCalcColumns = (() => {
	const LS_KEY = 'lion.aggrid.calcCols.v1';
	function _read() {
		try {
			return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
		} catch {
			return [];
		}
	}
	function _write(arr) {
		localStorage.setItem(LS_KEY, JSON.stringify(Array.isArray(arr) ? arr : []));
	}
	function _autoWrapFields(expr) {
		if (!expr) return expr;
		if (/\bnumber\s*\(/.test(expr)) return expr;
		return expr.replace(/\b([a-zA-Z_]\w*)(?!\s*\()/g, 'number($1)');
	}
	function _compileExpr(expr) {
		const src = String(expr || '').trim();
		if (!src) return null;
		const wrapped = _autoWrapFields(src);
		return (row) => cc_evalExpression(wrapped, row);
	}
	function _norm(cfg) {
		const id = String(cfg.id || '').trim();
		const headerName = String(cfg.headerName || id || 'Calc').trim();
		const expression = String(cfg.expression || '').trim();
		const format = (cfg.format || 'currency').toLowerCase();
		const partsFormat = (
			cfg.partsFormat || (format === 'percent' ? 'currency' : format)
		).toLowerCase();
		const onlyLevel0 = cfg.onlyLevel0 ?? cfg.onlyRoot ?? true;
		const after = cfg.after || 'Revenue';
		const totalLabel = String(cfg.totalLabel ?? 'Total').trim();
		const mini = !!cfg.mini;
		const hideTop = mini;
		const includeTotalAsPart = mini;
		const partsLabelOnly = false;
		const maxParts = 0;
		const parts = Array.isArray(cfg.parts)
			? cfg.parts.map((p) => ({
					label: String(p.label || '').trim(),
					expr: String(p.expr || '').trim(),
			  }))
			: [];
		return {
			id,
			headerName,
			expression,
			format,
			partsFormat,
			parts,
			onlyLevel0,
			after,
			totalLabel,
			mini,
			hideTop,
			includeTotalAsPart,
			partsLabelOnly,
			maxParts,
		};
	}
	function _fmtBy(fmt, n) {
		if (!Number.isFinite(n)) return '—';
		if (fmt === 'int') return intFmt.format(Math.round(n));
		if (fmt === 'raw') return String(n);
		if (fmt === 'percent') return cc_percentFormat(n);
		return cc_currencyFormat(n);
	}
	function _buildColDef(cfg) {
		const {
			id,
			headerName,
			expression,
			format,
			partsFormat,
			parts,
			onlyLevel0,
			after,
			totalLabel,
			mini,
			hideTop,
			includeTotalAsPart,
			partsLabelOnly,
			maxParts,
		} = _norm(cfg);
		const totalFn = _compileExpr(expression);
		const partFns = parts.map((p) => ({ label: p.label, fn: _compileExpr(p.expr) }));
		const valueFormatter = (p) => {
			const v0 = typeof p.value === 'number' ? p.value : number(p.value);
			const v = Number.isFinite(v0) ? v0 : null;
			if (v == null) return p.value ?? '';
			if (format === 'int') return intFmt.format(Math.round(v));
			if (format === 'raw') return String(v);
			if (format === 'percent') return cc_percentFormat(v);
			return currencyFormatter({ value: v });
		};
		const tooltipValueGetter = (p) => {
			const row = p?.data || {};
			const tot = totalFn ? totalFn(row) : null;
			const lines = [`${totalLabel}: ${_fmtBy(format, tot)}`];
			for (const { label, fn } of partFns)
				lines.push(`${label || ''}: ${_fmtBy(partsFormat, fn ? fn(row) : null)}`);
			return lines.join('\n');
		};
		return {
			headerName,
			colId: id,
			minWidth: 150,
			flex: 1,
			pinned: null,
			valueGetter: (p) => {
				const row = p?.data || {};
				const val = totalFn ? totalFn(row) : null;
				return Number.isFinite(val) ? val : null;
			},
			valueFormatter,
			clipboardValueGetter: (p) => {
				// 1) tenta extrair do renderer (DOM -> top + partes)
				try {
					const inst = p.api.getCellRendererInstances({
						rowNodes: [p.node],
						columns: [p.column],
					})?.[0];
					if (inst && typeof inst.getCopyText === 'function') {
						const txt = inst.getCopyText();
						if (txt && txt.trim()) return txt;
					}
				} catch {}

				// 2) fallback (sem renderer): monta com total + partes
				try {
					const row = p?.data || {};
					const tot = typeof totalFn === 'function' ? totalFn(row) : null;
					const partsNow = p?.colDef?.cellRendererParams?.getParts
						? p.colDef.cellRendererParams.getParts({ data: row })
						: [];
					const lines = [];
					lines.push(`${totalLabel}: ${_fmtBy(format, tot)}`);
					for (const it of partsNow) {
						const v = Number.isFinite(it?.value) ? it.value : null;
						const fmt = it?.isTotal ? format : partsFormat;
						const label = String(it?.label || it?.name || '').trim();
						const line = label ? `${label}: ${_fmtBy(fmt, v)}` : _fmtBy(fmt, v);
						if (line && line !== '—') lines.push(line);
					}
					return lines.join('\n');
				} catch {
					// 3) último recurso: valor bruto
					const v = p.valueFormatted ?? p.value ?? '';
					return String(v);
				}
			},

			cellRenderer: StackBelowRenderer,
			cellRendererParams: {
				partsMaxHeight: 40, // em px (ex.: 96, 120, 160)

				onlyLevel0: !!onlyLevel0,
				format:
					partsFormat === 'int'
						? 'int'
						: partsFormat === 'raw'
						? 'raw'
						: partsFormat === 'percent'
						? 'percent'
						: 'currency',
				showTop: !hideTop,
				partsLabelOnly: !!partsLabelOnly,
				showLabels: mini,
				forceShowLabels: mini,
				maxParts: Number(maxParts) || 0,
				getParts: (p) => {
					const row = p?.data || {};
					const list = [];
					const pushPart = (label, value, isTotal, fmt) => {
						const formatted = Number.isFinite(value) ? _fmtBy(fmt, value) : '—';
						list.push({
							label,
							name: label,
							value,
							text: `${label}: ${formatted}`,
							labelWithValue: `${label}: ${formatted}`,
							isTotal: !!isTotal,
						});
					};
					if (includeTotalAsPart) {
						const tot = totalFn ? totalFn(row) : null;
						pushPart(totalLabel, tot, true, format);
					}
					for (const { label, fn } of partFns) {
						const v = fn ? fn(row) : null;
						pushPart(label, v, false, partsFormat);
					}
					return list;
				},
			},
			__after: after,
		};
	}
	function _registerAndActivate(cfg) {
		const colDef = _buildColDef(cfg);
		if (!colDef) return false;
		LionCompositeColumns.register(colDef.colId, () => colDef);
		console.log(`[CalcCols] Registering "${colDef.colId}":`, {
			showTop: colDef.cellRendererParams?.showTop,
			showLabels: colDef.cellRendererParams?.showLabels,
			forceShowLabels: colDef.cellRendererParams?.forceShowLabels,
			onlyLevel0: colDef.cellRendererParams?.onlyLevel0,
		});
		try {
			return LionCompositeColumns.activate([colDef.colId]) || true;
		} catch (e) {
			console.warn('[CalcCols] activate failed', e);
			return false;
		}
	}
	function _migrateLegacyColumn(cfg) {
		if (cfg.parts && cfg.parts.length > 0) return cfg;
		const fieldMatches = (cfg.expression || '').match(/\b([a-zA-Z_]\w*)(?!\s*\()/g);
		if (fieldMatches && fieldMatches.length > 0) {
			const known = ['number', 'cc_evalExpression', 'Math'];
			const unique = [...new Set(fieldMatches)].filter((f) => !known.includes(f));
			cfg.parts = unique.slice(0, 5).map((field) => ({
				label: field
					.replace(/_/g, ' ')
					.replace(/\b\w/g, (l) => l.toUpperCase())
					.trim(),
				expr: field,
			}));
			console.log(`[CalcCols] Migrated "${cfg.id}" with auto-parts:`, cfg.parts);
		}
		return cfg;
	}
	function add(config) {
		let cfg = _norm(config);
		cfg = _migrateLegacyColumn(cfg);
		if (!cfg.id || !cfg.expression) {
			showToast('Invalid config (id/expression required)', 'danger');
			return false;
		}
		if (!_compileExpr(cfg.expression)) {
			showToast('Invalid expression', 'danger');
			return false;
		}
		for (const p of cfg.parts) {
			if (p.expr && !_compileExpr(p.expr)) {
				showToast(`Invalid part: ${p.label || '(no label)'}`, 'danger');
				return false;
			}
		}
		const bag = _read();
		const idx = bag.findIndex((c) => String(c.id) === cfg.id);
		if (idx >= 0) bag[idx] = cfg;
		else bag.push(cfg);
		_write(bag);
		const ok = _registerAndActivate(cfg);
		if (ok) showToast(`Column "${cfg.headerName}" ready`, 'success');
		return !!ok;
	}
	function remove(id) {
		const key = String(id || '').trim();
		if (!key) return;
		try {
			LionCompositeColumns.deactivate([key]);
		} catch {}
		const bag = _read().filter((c) => String(c.id) !== key);
		_write(bag);
		showToast(`Column removed: ${key}`, 'info');
	}
	function list() {
		return _read();
	}
	function activateAll() {
		const bag = _read();
		const migrated = [];
		let cnt = 0;
		for (const cfg of bag) {
			const m = _migrateLegacyColumn(cfg);
			if (m.parts && m.parts.length > 0 && (!cfg.parts || cfg.parts.length === 0)) cnt++;
			migrated.push(m);
			_registerAndActivate(m);
		}
		if (cnt > 0) {
			_write(migrated);
			console.log(`[CalcCols] Migrated ${cnt} column(s)`);
		}
	}
	function getAvailableFields() {
		return [
			'revenue',
			'fb_revenue',
			'push_revenue',
			'spent',
			'profit',
			'clicks',
			'impressions',
			'visitors',
			'conversions',
			'real_conversions',
			'cpc',
			'cpa_fb',
			'real_cpa',
			'budget',
			'bid',
			'mx',
			'ctr',
		];
	}
	function exportForPreset() {
		return _read().map((cfg) => _migrateLegacyColumn(cfg));
	}
	function importFromPreset(columns) {
		if (!Array.isArray(columns)) return;
		_write(columns);
		activateAll();
	}
	function clear() {
		const bag = _read();
		for (const cfg of bag) {
			try {
				LionCompositeColumns.deactivate([cfg.id]);
			} catch {}
		}
		_write([]);
	}
	return {
		add,
		remove,
		list,
		activateAll,
		getAvailableFields,
		exportForPreset,
		importFromPreset,
		clear,
	};
})();
globalThis.LionCalcColumns = LionCalcColumns;

/* =========================================
 * 13) Colunas (defaultColDef, defs)
 * =======================================*/
const defaultColDef = {
	sortable: true,
	filter: 'agTextColumnFilter',
	floatingFilter: true,
	resizable: true,
	cellClass: (p) => 'lion-center-cell',
	wrapHeaderText: true,
	autoHeaderHeight: true,
	enableRowGroup: true,
	enablePivot: true,
	enableValue: true,
	suppressHeaderFilterButton: true,
};

function isPinnedOrGroup(params) {
	return params?.node?.rowPinned || params?.node?.group;
}
const columnDefs = []; // (placeholder conforme original)

/* =========================================
 * 14) SSRM refresh compat
 * =======================================*/
function refreshSSRM(api) {
	if (!api) return;
	if (typeof api.refreshServerSideStore === 'function') {
		api.refreshServerSideStore({ purge: true });
	} else if (typeof api.purgeServerSideCache === 'function') {
		api.purgeServerSideCache();
	} else if (typeof api.refreshServerSide === 'function') {
		api.refreshServerSide({ purge: true });
	} else if (typeof api.onFilterChanged === 'function') {
		api.onFilterChanged();
	}
}
function setParentRowLoading(api, parentId, on) {
	if (!api || !parentId) return;
	const node = api.getRowNode(parentId);
	if (!node || !node.data) return;
	node.data.__rowLoading = !!on;
}

/* =========================================
 * 15) Global Quick Filter (IIFE)
 * =======================================*/
(function setupGlobalQuickFilter() {
	function focusQuickFilter() {
		const input = document.getElementById('quickFilter');
		if (!input) return;
		input.focus();
		input.select?.();
	}
	function applyGlobalFilter(val) {
		GLOBAL_QUICK_FILTER = String(val || '');
		const api = globalThis.LionGrid?.api;
		if (!api) return;
		refreshSSRM(api);
	}
	function init() {
		const input = document.getElementById('quickFilter');
		if (!input) return;
		try {
			input.setAttribute('accesskey', 'k');
		} catch {}
		let t = null;
		input.addEventListener('input', () => {
			clearTimeout(t);
			t = setTimeout(() => applyGlobalFilter(input.value.trim()), 250);
		});
		if (input.value) applyGlobalFilter(input.value.trim());
	}
	window.addEventListener(
		'keydown',
		(e) => {
			const tag = e.target?.tagName?.toLowerCase?.() || '';
			const editable = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
			if (editable) return;
			const key = String(e.key || '').toLowerCase();
			if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === 'k') {
				e.preventDefault();
				focusQuickFilter();
			}
		},
		{ capture: true }
	);
	globalThis.addEventListener('lionGridReady', init);
})();

/* =========================================
 * 16) State (load/apply)
 * =======================================*/
const GRID_STATE_KEY = 'lion.aggrid.state.v1';
const GRID_STATE_IGNORE_ON_RESTORE = ['pagination', 'scroll', 'rowSelection', 'focusedCell'];

function buildFilterModelWithGlobal(baseFilterModel) {
	const fm = { ...(baseFilterModel || {}) };
	const gf = (GLOBAL_QUICK_FILTER || '').trim();
	fm._global = Object.assign({}, fm._global, { filter: gf });
	return fm;
}
function loadSavedState() {
	try {
		const raw = sessionStorage.getItem(GRID_STATE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		return parsed?.state || null;
	} catch {
		return null;
	}
}
function applySavedStateIfAny(api) {
	const saved = loadSavedState();
	if (!saved) return false;
	try {
		sessionStorage.removeItem(GRID_STATE_KEY);
		api.setState(saved, GRID_STATE_IGNORE_ON_RESTORE);
		return true;
	} catch (e) {
		console.warn('[GridState] restore failed, clearing saved state:', e);
		sessionStorage.removeItem(GRID_STATE_KEY);
		return false;
	}
}

/* =========================================
 * 17) Toggle de colunas pinadas
 * =======================================*/
function getSelectionColId(api) {
	try {
		const cols = api.getColumns() || [];
		const ids = cols.map((c) => c.getColId());
		if (ids.includes('ag-Grid-Selection')) return 'ag-Grid-Selection';
		const found = cols.find(
			(c) => c.getColDef()?.headerCheckboxSelection || c.getColDef()?.checkboxSelection
		);
		return found?.getColId() || null;
	} catch {
		return null;
	}
}
function togglePinnedColsFromCheckbox(silent = false) {
	const api = globalThis.LionGrid?.api;
	if (!api) return;
	const el = document.getElementById('pinToggle');
	if (!el) return;
	const checked = !!el.checked;
	const selectionColId = getSelectionColId(api);
	const leftPins = [
		{ colId: 'ag-Grid-SelectionColumn', pinned: checked ? 'left' : null },
		{ colId: 'ag-Grid-AutoColumn', pinned: checked ? 'left' : null },
		{ colId: 'profile_name', pinned: checked ? 'left' : null },
	];
	if (selectionColId) leftPins.push({ colId: selectionColId, pinned: checked ? 'left' : null });
	const rightPins = [
		{ colId: 'spent', pinned: checked ? 'right' : null },
		{ colId: 'revenue', pinned: checked ? 'right' : null },
		{ colId: 'mx', pinned: checked ? 'right' : null },
		{ colId: 'profit', pinned: checked ? 'right' : null },
	];
	api.applyColumnState({ state: [...leftPins, ...rightPins], defaultState: { pinned: null } });
	if (!silent)
		showToast(checked ? 'Columns Pinned' : 'Columns Unpinned', checked ? 'success' : 'info');
}

/* =========================================
 * 18) Toolbar (state/layout + presets + tamanho colunas)
 * =======================================*/
(function setupToolbar() {
	const byId = (id) => document.getElementById(id);
	function ensureApi() {
		const api = globalThis.LionGrid?.api;
		if (!api) {
			console.warn('Grid API not available yet');
			return null;
		}
		return api;
	}
	const SS_KEY_STATE = GRID_STATE_KEY || 'lion.aggrid.state.v1';
	const LS_KEY_PRESETS = 'lion.aggrid.presets.v1';
	const LS_KEY_ACTIVE_PRESET = 'lion.aggrid.activePreset.v1';
	const PRESET_VERSION = 1;

	function getState() {
		const api = ensureApi();
		if (!api) return null;
		try {
			return api.getState();
		} catch {
			return null;
		}
	}
	function setState(state, ignore = []) {
		const api = ensureApi();
		if (!api) return;
		try {
			api.setState(state, ignore || []);
		} catch (e) {
			console.warn('setState fail', e);
		}
	}

	function resetLayout() {
		const api = ensureApi();
		if (!api) return;
		try {
			sessionStorage.removeItem(SS_KEY_STATE);
			localStorage.removeItem(LS_KEY_ACTIVE_PRESET);
			api.setState({}, []);
			api.resetColumnState?.();
			api.setFilterModel?.(null);
			api.setSortModel?.([]);
			refreshPresetUserSelect();
			togglePinnedColsFromCheckbox(true);
			showToast('Layout Reset', 'info');
		} catch (e) {
			console.warn('resetLayout fail', e);
		}
	}

	function readPresets() {
		try {
			return JSON.parse(localStorage.getItem(LS_KEY_PRESETS) || '{}');
		} catch {
			return {};
		}
	}
	function writePresets(obj) {
		localStorage.setItem(LS_KEY_PRESETS, JSON.stringify(obj));
	}
	function listPresetNames() {
		return Object.keys(readPresets()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
	}

	function refreshPresetUserSelect() {
		const sel = byId('presetUserSelect');
		if (!sel) return;
		const activePreset = localStorage.getItem(LS_KEY_ACTIVE_PRESET) || '';
		while (sel.firstChild) sel.removeChild(sel.firstChild);
		const placeholderText = 'Default';
		sel.appendChild(new Option(placeholderText, ''));
		listPresetNames().forEach((name) => sel.appendChild(new Option(name, name)));
		if (activePreset && [...sel.options].some((o) => o.value === activePreset))
			sel.value = activePreset;
		else sel.value = '';
	}

	// ===== Calculated Columns Modal (KTUI) =====
	(function setupCalcColsModal() {
		const $ = (sel) => document.querySelector(sel);
		const DEFAULT_OPERATORS = [
			{ value: 'custom', label: '✎ Custom Expression', template: '' },
			{
				value: 'divide',
				label: '÷ Division (A / B)',
				template: 'number({col1}) / number({col2})',
			},
			{
				value: 'multiply',
				label: '× Multiplication (A × B)',
				template: 'number({col1}) * number({col2})',
			},
			{ value: 'add', label: '+ Addition (A + B)', template: 'number({col1}) + number({col2})' },
			{
				value: 'subtract',
				label: '− Subtraction (A − B)',
				template: 'number({col1}) - number({col2})',
			},
			{
				value: 'percent',
				label: '% Percentage (A / B × 100)',
				template: '(number({col1}) / number({col2})) * 100',
			},
			{
				value: 'percent_change',
				label: 'Δ% Change ((B-A)/A × 100)',
				template: '((number({col2}) - number({col1})) / number({col1})) * 100',
			},
			{
				value: 'average',
				label: '⌀ Average ((A+B)/2)',
				template: '(number({col1}) + number({col2})) / 2',
			},
		];

		function populateExpressionSelect() {
			const sel = $('#cc-format');
			if (!sel) return;
			sel.innerHTML = '';
			DEFAULT_OPERATORS.forEach((op) => {
				const option = document.createElement('option');
				option.value = op.value;
				option.textContent = op.label;
				option.dataset.template = op.template;
				sel.appendChild(option);
			});
			if (globalThis.KT && KT.Select && KT.Select.getOrCreateInstance) {
				try {
					const instance = KT.Select.getOrCreateInstance(sel);
					if (instance) {
						instance.destroy();
						KT.Select.getInstance(sel)?.init();
					}
				} catch (e) {
					console.warn('Failed to reinitialize cc-format select:', e);
				}
			}
		}

		function populateColumnSelects() {
			const api = ensureApi();
			if (!api) return;

			// ===== helpers para repetir a mesma lógica do CalcColsPopulate =====
			function _isCalculableByDef(def) {
				if (!def) return false;
				if (def.calcEligible === true) return true;
				if (def.calcType === 'numeric') return true;
				if (def.valueType === 'number') return true;
				if (def.cellDataType === 'number') return true;
				if (def.type === 'numericColumn') return true;
				if (def.filter === 'agNumberColumnFilter') return true;
				if (typeof def.valueParser === 'function') return true;
				return false;
			}
			function _flattenColDefs(defOrArray) {
				const out = [];
				const walk = (arr) => {
					(arr || []).forEach((def) => {
						if (def?.children?.length) walk(def.children);
						else out.push(def);
					});
				};
				if (Array.isArray(defOrArray)) walk(defOrArray);
				else if (defOrArray) walk([defOrArray]);
				return out;
			}
			function _getSelectableColumns() {
				let defs = [];
				try {
					const displayed = api.getAllDisplayedColumns?.() || [];
					if (displayed.length) {
						defs = displayed
							.map((gc) => gc.getColDef?.() || gc.colDef || null)
							.filter(Boolean);
					}
				} catch {}
				if (!defs.length) {
					const columnState = api.getColumnState?.() || [];
					const viaState = columnState
						.map((s) => api.getColumn?.(s.colId)?.getColDef?.())
						.filter(Boolean);
					if (viaState.length) defs = viaState;
					else defs = (api.getColumnDefs?.() || []).flatMap(_flattenColDefs);
				}

				const deny = new Set(['ag-Grid-AutoColumn', 'ag-Grid-RowGroup', '__autoGroup']);
				defs = defs.filter((def) => {
					if (!def) return false;
					const field = def.field || def.colId;
					const header = def.headerName || field;
					if (!field || !header) return false;
					if (deny.has(field)) return false;
					if (String(field).startsWith('__')) return false;
					if (def.checkboxSelection) return false;
					if (def.rowGroup || def.pivot) return false;
					const h = String(header).toLowerCase();
					if (h.includes('select') || h.includes('ação') || h.includes('action')) return false;
					return true;
				});

				// mantém apenas as numéricas/calculáveis
				defs = defs.filter(_isCalculableByDef);

				// map + dedup por field
				const mapped = defs.map((def) => ({
					field: String(def.field || def.colId),
					label: String(def.headerName || def.field || def.colId),
				}));
				const seen = new Set();
				const unique = [];
				for (const it of mapped) {
					if (seen.has(it.field)) continue;
					seen.add(it.field);
					unique.push(it);
				}
				// ordena por label visível
				unique.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
				return unique;
			}

			// ===== aplica no <select> do modal =====
			const col1Sel = document.querySelector('#cc-col1');
			const col2Sel = document.querySelector('#cc-col2');
			if (!col1Sel || !col2Sel) return;

			const options = _getSelectableColumns();
			[col1Sel, col2Sel].forEach((sel) => {
				sel.innerHTML = '';
				for (const col of options) {
					const opt = document.createElement('option');
					opt.value = col.field;
					opt.textContent = `${col.label} (${col.field})`;
					sel.appendChild(opt);
				}
				// reinit KT select se existir
				if (globalThis.KT && KT.Select && KT.Select.getOrCreateInstance) {
					try {
						const instance = KT.Select.getOrCreateInstance(sel);
						if (instance) {
							instance.destroy();
							KT.Select.getInstance(sel)?.init();
						}
					} catch (e) {
						console.warn('Failed to reinitialize column select:', e);
					}
				}
			});
		}

		function updateExpressionFromSelects() {
			const formatSel = $('#cc-format');
			const col1Sel = $('#cc-col1');
			const col2Sel = $('#cc-col2');
			const exprInput = $('#cc-expression');
			const partsInput = $('#cc-parts');
			if (!formatSel || !col1Sel || !col2Sel || !exprInput) return;
			const selectedOp = formatSel.options[formatSel.selectedIndex];
			const template = selectedOp?.dataset?.template;
			if (!template || formatSel.value === 'custom') return;
			const col1 = col1Sel.value;
			const col2 = col2Sel.value;
			if (col1 && col2) {
				const expression = template.replace(/{col1}/g, col1).replace(/{col2}/g, col2);
				exprInput.value = expression;
				if (partsInput) {
					const col1Label = col1Sel.options[col1Sel.selectedIndex]?.textContent || col1;
					const col2Label = col2Sel.options[col2Sel.selectedIndex]?.textContent || col2;
					const parts = [
						{ label: col1Label.replace(/number/gi, '').trim(), expr: col1 },
						{ label: col2Label.replace(/number/gi, '').trim(), expr: col2 },
					];
					partsInput.value = JSON.stringify(parts, null, 2);
				}
			}
		}

		function modalShow(selector) {
			const el = document.querySelector(selector);
			if (!el) return;
			if (globalThis.KT && KT.Modal && KT.Modal.getOrCreateInstance)
				KT.Modal.getOrCreateInstance(el).show();
			else {
				el.classList.remove('hidden');
				el.style.display = 'block';
				el.setAttribute('aria-hidden', 'false');
				el.classList.add('kt-modal--open');
			}
		}
		function modalHide(selector) {
			const el = document.querySelector(selector);
			if (!el) return;
			if (globalThis.KT && KT.Modal && KT.Modal.getOrCreateInstance)
				KT.Modal.getOrCreateInstance(el).hide();
			else {
				el.style.display = 'none';
				el.classList.add('hidden');
				el.classList.remove('kt-modal--open');
				el.setAttribute('aria-hidden', 'true');
			}
		}

		const btn = document.getElementById('btnCalcCols');
		if (btn) {
			btn.addEventListener('click', (e) => {
				const sel = btn.getAttribute('data-kt-modal-toggle') || '#calcColsModal';
				setTimeout(() => {
					modalShow(sel);
					clearForm();
					populateExpressionSelect();
					populateColumnSelects();
					renderList();
				}, 0);
			});
		}

		const formatSel = $('#cc-format');
		const col1Sel = $('#cc-col1');
		const col2Sel = $('#cc-col2');
		if (formatSel) formatSel.addEventListener('change', updateExpressionFromSelects);
		if (col1Sel) col1Sel.addEventListener('change', updateExpressionFromSelects);
		if (col2Sel) col2Sel.addEventListener('change', updateExpressionFromSelects);

		const modalEl = document.getElementById('calcColsModal');
		if (modalEl)
			modalEl.addEventListener('show.kt.modal', () => {
				clearForm();
				populateExpressionSelect();
				populateColumnSelects();
				renderList();
			});

		const list = $('#cc-list');
		const empty = $('#cc-empty');
		const saveBtn = $('#cc-save');
		const reloadBtn = $('#cc-reload');
		const resetBtn = $('#cc-reset-form');
		const activateAllBtn = $('#cc-activate-all');

		if (typeof document !== 'undefined') {
			if (document.readyState === 'loading') {
				document.addEventListener('DOMContentLoaded', () => {
					setTimeout(() => {
						populateExpressionSelect();
						populateColumnSelects();
					}, 100);
				});
			} else {
				setTimeout(() => {
					populateExpressionSelect();
					populateColumnSelects();
				}, 100);
			}
		}

		function readForm() {
			const headerName = ($('#cc-header')?.value || '').trim();
			let id = ($('#cc-id')?.value || '').trim();
			const format = ($('#cc-type')?.value || 'currency').trim().toLowerCase();
			const expression = ($('#cc-expression')?.value || '').trim();
			const onlyLevel0 = !!$('#cc-only-level0')?.checked;
			const after = ($('#cc-after')?.value || 'Revenue').trim() || 'Revenue';
			const mini = !!$('#cc-mini')?.checked;

			if (!id && headerName)
				id = headerName.toLowerCase().replace(/\s+/g, '_').replace(/[^\w]/g, '');

			let parts = [];
			const raw = ($('#cc-parts')?.value || '').trim();
			if (raw) {
				try {
					parts = JSON.parse(raw);
				} catch {
					showToast('Invalid Parts JSON', 'danger');
					parts = null;
				}
			}
			return { id, headerName, format, expression, parts, onlyLevel0, after, mini };
		}
		function clearForm() {
			$('#cc-header').value = '';
			$('#cc-id').value = '';
			const formatSel = $('#cc-format');
			if (formatSel && formatSel.options.length > 0) formatSel.selectedIndex = 0;
			const col1Sel = $('#cc-col1');
			const col2Sel = $('#cc-col2');
			if (col1Sel && col1Sel.options.length > 0) col1Sel.selectedIndex = 0;
			if (col2Sel && col2Sel.options.length > 0) col2Sel.selectedIndex = 0;
			$('#cc-expression').value = '';
			$('#cc-parts').value = '[]';
			$('#cc-only-level0').checked = true;
			$('#cc-after').value = 'Revenue';
			$('#cc-type').value = 'currency';
			const miniEl = $('#cc-mini');
			if (miniEl) miniEl.checked = false;
			updateExpressionFromSelects();
		}
		function renderList() {
			if (!list) return;
			const items = globalThis.LionCalcColumns?.list?.() || [];
			list.innerHTML = '';
			if (!items.length) {
				empty?.classList.remove('hidden');
				return;
			}
			empty?.classList.add('hidden');
			for (const c of items) {
				const li = document.createElement('li');
				li.className = 'flex items-center justify-between p-3';
				const left = document.createElement('div');
				left.className = 'min-w-0';
				left.innerHTML = `
        <div class="font-medium">${c.headerName || c.id}</div>
        <div class="text-xs opacity-70 break-words">id: <code>${c.id}</code></div>
        <div class="text-xs opacity-70 break-words">expr: <code>${c.expression}</code></div>
      `;
				const right = document.createElement('div');
				right.className = 'flex items-center gap-2';
				const btnApply = document.createElement('button');
				btnApply.className = 'kt-btn kt-btn-xs';
				btnApply.textContent = 'Activate';
				btnApply.addEventListener('click', () => {
					try {
						globalThis.LionCalcColumns?.add?.(c);
					} catch (e) {
						console.warn(e);
					}
				});
				const btnEdit = document.createElement('button');
				btnEdit.className = 'kt-btn kt-btn-light kt-btn-xs';
				btnEdit.textContent = 'Edit';
				btnEdit.addEventListener('click', () => {
					$('#cc-header').value = c.headerName || '';
					$('#cc-id').value = c.id || '';
					$('#cc-type').value = c.format || 'currency';
					$('#cc-expression').value = c.expression || '';
					$('#cc-parts').value = (c.parts && JSON.stringify(c.parts)) || '';
					$('#cc-only-level0').checked = !!c.onlyLevel0;
					$('#cc-after').value = c.after || 'Revenue';
					const miniEl = $('#cc-mini');
					if (miniEl) miniEl.checked = !!c.mini;
				});
				const btnRemove = document.createElement('button');
				btnRemove.className = 'kt-btn kt-btn-danger kt-btn-xs';
				btnRemove.textContent = 'Remove';
				btnRemove.addEventListener('click', () => {
					if (!confirm(`Remove column "${c.id}"?`)) return;
					try {
						globalThis.LionCalcColumns?.remove?.(c.id);
						renderList();
					} catch (e) {
						console.warn(e);
					}
				});
				right.append(btnApply, btnEdit, btnRemove);
				li.append(left, right);
				list.appendChild(li);
			}
		}

		saveBtn?.addEventListener('click', (e) => {
			e.preventDefault();

			const cfg = readForm();
			if (!cfg) return;
			if (!cfg.id || !cfg.expression) {
				showToast('ID and Expression are required', 'danger');
				return;
			}

			try {
				const ok = globalThis.LionCalcColumns?.add?.(cfg);
				if (!ok) return;

				// 1) fecha modal
				try {
					modalHide('#calcColsModal');
				} catch {}

				// 2) garante visibilidade da nova coluna
				const api = globalThis.LionGrid?.api || null;
				if (api) {
					try {
						api.ensureColumnVisible(cfg.id, 'auto');
					} catch {}
					try {
						api.refreshHeader?.();
					} catch {}
					try {
						api.redrawRows?.();
					} catch {}

					// 3) “reload” leve do SSRM p/ reprocessar filtros/sort e recalcular pin totals
					try {
						refreshSSRM(api);
					} catch {}

					// 4) ajuste fino de layout após aplicar colDefs
					setTimeout(() => {
						try {
							api.sizeColumnsToFit?.();
						} catch {}
						try {
							api.resetRowHeights?.();
						} catch {}
					}, 50);
				}

				// 5) atualiza a lista do modal (na próxima abertura)
				renderList();

				showToast('Calculated column saved and applied!', 'success');
			} catch (err) {
				showToast('Failed to save column ', 'danger');
				console.warn(err);
			}
		});

		resetBtn?.addEventListener('click', (e) => {
			e.preventDefault();
			clearForm();
		});
		reloadBtn?.addEventListener('click', (e) => {
			e.preventDefault();
			populateColumnSelects();
			renderList();
		});
		activateAllBtn?.addEventListener('click', (e) => {
			e.preventDefault();
			try {
				globalThis.LionCalcColumns?.activateAll?.();
				showToast('All calculated columns activated', 'success');
			} catch (err) {
				showToast('Failed to activate all', 'danger');
			}
		});
		document.addEventListener('click', (ev) => {
			const t = ev.target;
			if (!(t instanceof Element)) return;
			const toggle = t.closest('[data-kt-modal-toggle="#calcColsModal"]');
			if (toggle) {
				setTimeout(() => {
					clearForm();
					populateExpressionSelect();
					populateColumnSelects();
					renderList();
				}, 50);
			}
		});
	})();

	function saveAsPreset() {
		const api = ensureApi();
		if (!api) return;
		const name = prompt('Preset name:');
		if (!name) return;
		let state;
		try {
			state = api.getState();
		} catch {}
		if (!state) return showToast("Couldn't capture grid state", 'danger');
		const calcColumns = globalThis.LionCalcColumns?.exportForPreset?.() || [];
		const bag = readPresets();
		bag[name] = { v: PRESET_VERSION, name, createdAt: Date.now(), grid: state, calcColumns };
		writePresets(bag);
		refreshPresetUserSelect();
		const sel = byId('presetUserSelect');
		if (sel) sel.value = name;
		showToast(`Preset "${name}" saved`, 'success');
	}
	function applyPresetUser(name) {
		if (!name) return;
		const bag = readPresets();
		const p = bag[name];
		if (!p?.grid) return showToast('Preset not found', 'warning');
		globalThis.LionCalcColumns?.clear?.();
		if (Array.isArray(p.calcColumns) && p.calcColumns.length > 0) {
			globalThis.LionCalcColumns?.importFromPreset?.(p.calcColumns);
		}
		setState(p.grid, ['pagination', 'scroll', 'rowSelection', 'focusedCell']);
		localStorage.setItem(LS_KEY_ACTIVE_PRESET, name);
		refreshPresetUserSelect();
		showToast(`Preset "${name}" applied`, 'success');
	}
	function deletePreset() {
		const sel = byId('presetUserSelect');
		const name = sel?.value || '';
		if (!name) return showToast('Pick a preset first', 'warning');
		if (!confirm(`Delete preset "${name}"?`)) return;
		const bag = readPresets();
		delete bag[name];
		writePresets(bag);
		const activePreset = localStorage.getItem(LS_KEY_ACTIVE_PRESET);
		if (activePreset === name) localStorage.removeItem(LS_KEY_ACTIVE_PRESET);
		refreshPresetUserSelect();
		showToast(`Preset "${name}" removed`, 'info');
	}
	function downloadPreset() {
		const sel = byId('presetUserSelect');
		const name = sel?.value || '';
		if (!name) return showToast('Pick a preset first', 'warning');
		const bag = readPresets();
		const p = bag[name];
		if (!p) return showToast('Preset not found', 'warning');
		const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `lion-preset-${name}.json`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
		showToast(`Preset "${name}" downloaded`, 'success');
	}
	function uploadPreset() {
		const input = byId('presetFileInput');
		if (!input) return;
		input.value = '';
		input.click();
	}
	byId('presetFileInput')?.addEventListener('change', (e) => {
		const file = e.target.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			try {
				const parsed = JSON.parse(String(reader.result || '{}'));
				if (!parsed?.grid) return showToast('Invalid preset file', 'danger');
				const name = prompt(
					'Name to save this preset as:',
					parsed.name || file.name.replace(/\.json$/i, '')
				);
				if (!name) return;
				const bag = readPresets();
				bag[name] = { ...parsed, name, importedAt: Date.now() };
				writePresets(bag);
				refreshPresetUserSelect();
				const sel = byId('presetUserSelect');
				if (sel) sel.value = name;
				applyPresetUser(name);
			} catch {
				showToast('Failed to read JSON', 'danger');
			}
		};
		reader.readAsText(file, 'utf-8');
	});

	const LS_KEY_SIZE_MODE = 'lion.aggrid.sizeMode'; // 'auto' | 'fit'
	function applySizeMode(mode) {
		const api = (globalThis.LionGrid || {}).api;
		if (!api) return;
		try {
			if (mode === 'auto') {
				const all = api.getColumns()?.map((c) => c.getColId()) || [];
				api.autoSizeColumns(all, false);
			} else api.sizeColumnsToFit();
		} catch {}
	}
	function getSizeMode() {
		const v = localStorage.getItem(LS_KEY_SIZE_MODE);
		return v === 'auto' ? 'auto' : 'fit';
	}
	function setSizeMode(mode) {
		localStorage.setItem(LS_KEY_SIZE_MODE, mode);
	}

	(function initSizeModeToggle() {
		const el = byId('colSizeModeToggle');
		if (!el) return;
		const mode = getSizeMode();
		el.checked = mode === 'auto';
		applySizeMode(mode);
		el.addEventListener('change', () => {
			const next = el.checked ? 'auto' : 'fit';
			setSizeMode(next);
			applySizeMode(next);
			showToast(next === 'auto' ? 'Mode: Auto Size' : 'Mode: Size To Fit', 'info');
		});
		window.addEventListener('resize', () => applySizeMode(getSizeMode()));
	})();

	byId('btnResetLayout')?.addEventListener('click', resetLayout);
	byId('presetUserSelect')?.addEventListener('change', (e) => {
		const v = e.target.value;
		if (!v) {
			resetLayout();
			localStorage.removeItem(LS_KEY_ACTIVE_PRESET);
			refreshPresetUserSelect();
			return;
		}
		applyPresetUser(v);
	});
	byId('btnAddCalcCol')?.addEventListener('click', () => {
		try {
			LionCalcColumns.openQuickBuilder();
		} catch (e) {
			console.warn(e);
		}
	});
	byId('btnManageCalcCols')?.addEventListener('click', () => {
		try {
			LionCalcColumns.manage();
		} catch (e) {
			console.warn(e);
		}
	});

	byId('btnSaveAsPreset')?.addEventListener('click', saveAsPreset);
	byId('btnDeletePreset')?.addEventListener('click', deletePreset);
	byId('btnDownloadPreset')?.addEventListener('click', downloadPreset);
	byId('btnUploadPreset')?.addEventListener('click', uploadPreset);

	refreshPresetUserSelect();

	globalThis.addEventListener('lionGridReady', () => {
		const activePreset = localStorage.getItem(LS_KEY_ACTIVE_PRESET);
		if (activePreset) {
			const bag = readPresets();
			const p = bag[activePreset];
			if (p?.grid) {
				setState(p.grid, ['pagination', 'scroll', 'rowSelection', 'focusedCell']);
				console.log(`[Preset] Auto-applied: "${activePreset}"`);
			}
		} else {
			const api = globalThis.LionGrid?.api;
			if (api) {
				try {
					api.setState({}, []);
					api.resetColumnState?.();
					api.setFilterModel?.(null);
					api.setSortModel?.([]);
					setTimeout(() => {
						togglePinnedColsFromCheckbox(true);
					}, 50);
					console.log('[Preset] Complete initialization applied - no active preset');
				} catch (e) {
					console.warn('[Preset] Failed to apply complete initialization:', e);
				}
			}
		}
	});

	globalThis.LionGrid = Object.assign(globalThis.LionGrid || {}, {
		getState,
		setState,
		resetLayout,
		saveAsPreset,
		applyPresetUser,
	});
})();
document.getElementById('calcColsModal')?.addEventListener(
	'click',
	(e) => {
		if (e.target.id !== 'calcColsModal') return;
		const el = e.currentTarget;
		try {
			if (window.KT?.Modal?.getOrCreateInstance) {
				window.KT.Modal.getOrCreateInstance(el).hide();
				return;
			}
		} catch {}
		el.style.display = 'none';
		el.classList.add('hidden');
		el.classList.remove('kt-modal--open');
		el.setAttribute('aria-hidden', 'true');
	},
	{ passive: true }
);
// Make the "Close" button and the top-right "X" close the modal (calcColsModal)
(function bindCalcColsModalClose() {
	const modal = document.getElementById('calcColsModal');
	if (!modal) return;

	function hideModal() {
		// Prefer KT if present
		try {
			if (window.KT?.Modal?.getOrCreateInstance) {
				window.KT.Modal.getOrCreateInstance(modal).hide();
				return;
			}
		} catch {}
		// Fallback manual
		modal.style.display = 'none';
		modal.classList.add('hidden');
		modal.classList.remove('kt-modal--open');
		modal.setAttribute('aria-hidden', 'true');
	}

	// Wire both the "Close" button and the X icon
	const closeBtns = modal.querySelectorAll(
		'[data-kt-modal-dismiss="#calcColsModal"], .kt-modal-close'
	);
	closeBtns.forEach((btn) => {
		btn.addEventListener(
			'click',
			(e) => {
				e.preventDefault();
				hideModal();
			},
			{ passive: true }
		);
	});
})();

// (opcional) ESC fecha também
document.addEventListener(
	'keydown',
	(e) => {
		if (e.key !== 'Escape') return;
		const el = document.getElementById('calcColsModal');
		if (!el || el.getAttribute('aria-hidden') !== 'false') return;

		try {
			if (window.KT?.Modal?.getOrCreateInstance) {
				window.KT.Modal.getOrCreateInstance(el).hide();
				return;
			}
		} catch {}
		el.style.display = 'none';
		el.classList.add('hidden');
		el.classList.remove('kt-modal--open');
		el.setAttribute('aria-hidden', 'true');
	},
	{ passive: true }
);

/* =========================================
 * 19) Normalizadores (TreeData)
 * =======================================*/
function normalizeCampaignRow(r) {
	const label = stripHtml(r.campaign_name || '(no name)');
	const utm = String(r.utm_campaign || r.id || '');
	return {
		__nodeType: 'campaign',
		__groupKey: utm,
		__label: label,
		campaign: (label + ' ' + utm).trim(),
		...r,
	};
}
function normalizeAdsetRow(r) {
	return {
		__nodeType: 'adset',
		__groupKey: String(r.id || ''),
		__label: stripHtml(r.name || '(adset)'),
		...r,
	};
}
function normalizeAdRow(r) {
	return { __nodeType: 'ad', __label: stripHtml(r.name || '(ad)'), ...r };
}
const WRAP_FIELDS = ['campaign', 'bc_name', 'account_name'];

export class Table {
	constructor(columnDefs = [], opts = {}) {
		this.container = opts.container || '#lionGrid';
		this.columnDefs = Array.isArray(columnDefs) ? columnDefs : [];
		this.gridDiv = null;
		this.api = null;

		// Endpoints configuráveis
		this.endpoints = Object.assign(
			{
				SSRM: '/api/ssrm/?clean=1&mode=full',
				ADSETS: '/api/adsets/',
				ADS: '/api/ads/',
			},
			opts.endpoints || {}
		);

		// Knobs de drill configuráveis
		this.drill = Object.assign(
			{
				period: 'TODAY',
				minSpinnerMs: 900, // mínimo do spinner ao abrir filhos
				fakeNetworkMs: 0, // latência fake extra
			},
			opts.drill || {}
		);

		// Seletor do checkbox de pinar colunas (caso queira customizar)
		this.pinToggleSelector = opts.pinToggleSelector || '#pinToggle';
	}

	init() {
		return this.makeGrid();
	}

	makeGrid() {
		const AG = getAgGrid();
		this.gridDiv = document.querySelector(this.container);
		if (!this.gridDiv) {
			console.error('[LionGrid] #lionGrid not found');
			return null;
		}
		this.gridDiv.classList.add('ag-theme-quartz');

		const autoGroupColumnDef = {
			headerName: 'Campaign',
			colId: 'campaign',
			filter: 'agTextColumnFilter',
			floatingFilter: true,
			sortable: false,
			wrapText: true,
			minWidth: 280,
			pinned: 'left',
			cellClass: (p) =>
				['camp-root', 'camp-child', 'camp-grand'][Math.min(p?.node?.level ?? 0, 2)],
			cellClassRules: {
				'ag-cell-loading': (p) => !!p?.data?.__rowLoading,
			},
			tooltipValueGetter: (p) => {
				const d = p.data || {};
				if (p?.node?.level === 0) {
					const name = d.__label || '';
					const utm = d.utm_campaign || '';
					return utm ? `${name} — ${utm}` : name;
				}
				return d.__label || '';
			},
			cellRendererParams: {
				suppressCount: true,
				innerRenderer: (p) => {
					const d = p.data || {};
					const label = d.__label || '';
					const utm = d.utm_campaign || '';
					if (p?.node?.level === 0 && (label || utm)) {
						const wrap = document.createElement('span');
						wrap.style.display = 'inline-flex';
						wrap.style.flexDirection = 'column';
						wrap.style.lineHeight = '1.25';
						const l1 = document.createElement('span');
						l1.textContent = label;
						l1.style.fontWeight = '600';
						wrap.appendChild(l1);
						if (utm) {
							const l2 = document.createElement('span');
							l2.textContent = utm;
							l2.style.fontSize = '9px';
							l2.style.opacity = '0.75';
							l2.style.letterSpacing = '0.2px';
							wrap.appendChild(l2);
						}
						return wrap;
					}
					return label;
				},
			},
			valueGetter: (p) => {
				const d = p.data || {};
				const name = d.__label || '';
				const utm = d.utm_campaign || '';
				return (name + ' ' + utm).trim();
			},
		};

		// ===== [1] Medidor offscreen (singleton) =====
		const _rowHeightMeasure = (() => {
			let box = null;
			return {
				ensure() {
					if (box) return box;
					box = document.createElement('div');
					box.id = 'lion-rowheight-measurer';
					Object.assign(box.style, {
						position: 'absolute',
						left: '-99999px',
						top: '-99999px',
						visibility: 'hidden',
						whiteSpace: 'normal',
						wordBreak: 'break-word',
						overflowWrap: 'anywhere',
						lineHeight: '1.25',
						fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
						fontSize: '14px',
						padding: '0',
						margin: '0',
						border: '0',
					});
					document.body.appendChild(box);
					return box;
				},
				measure(text, widthPx) {
					const el = this.ensure();
					el.style.width = Math.max(0, widthPx) + 'px';
					el.textContent = text || '';
					return el.scrollHeight || 0;
				},
			};
		})();

		// ===== [2] Largura útil da coluna autoGroup =====
		function getAutoGroupContentWidth(api) {
			try {
				const col =
					api.getColumn('campaign') ||
					api.getDisplayedCenterColumns().find((c) => c.getColId?.() === 'campaign');
				if (!col) return 300;
				api.getDisplayedColAfter?.(col); // força layout
				const colW = col.getActualWidth();
				const padding = 16;
				const iconArea = 28;
				return Math.max(40, colW - padding - iconArea);
			} catch {
				return 300;
			}
		}

		// ===== [2.1] Largura útil de QUALQUER coluna folha =====
		function getFieldContentWidth(api, field) {
			try {
				const col = api.getColumn(field);
				if (!col) return null;
				const w = col.getActualWidth?.();
				if (!w || !Number.isFinite(w)) return null;
				const horizontalPadding = 12; // margem visual interna da célula
				return Math.max(0, w - horizontalPadding);
			} catch {
				return null;
			}
		}

		// ===== [3] Texto que realmente aparece na célula por campo =====
		function getCellTextForField(p, field) {
			const d = p?.data || {};
			if (field === 'campaign') {
				if ((p?.node?.level ?? 0) !== 0) return String(d.__label || '');
				const label = String(d.__label || '');
				const utm = String(d.utm_campaign || '');
				return utm ? `${label}\n${utm}` : label;
			}
			if (field === 'bc_name') {
				return String(d.bc_name || '');
			}
			// fallback
			return String(d[field] ?? '');
		}

		// ===== [4] Cache simples por rowId + largura =====
		const _rowHCache = new Map();
		function _cacheKey(p, width) {
			const id =
				p?.node?.id ||
				(p?.node?.data?.__nodeType === 'campaign'
					? `c:${p?.node?.data?.__groupKey}`
					: p?.node?.data?.__nodeType === 'adset'
					? `s:${p?.node?.data?.__groupKey}`
					: p?.node?.data?.id || Math.random());
			return id + '|' + Math.round(width);
		}

		// ===== [5] getRowHeight dinâmico por nº de linhas =====
		const BASE_ROW_MIN = 50;
		const VERT_PAD = 12;

		const gridOptions = {
			floatingFiltersHeight: 35,
			groupHeaderHeight: 35,
			headerHeight: 62,
			context: { showToast: (msg, type) => Toastify({ text: msg }).showToast() },
			rowModelType: 'serverSide',
			cacheBlockSize: 200,
			treeData: true,

			isServerSideGroup: (data) => data?.__nodeType === 'campaign' || data?.__nodeType === 'adset',
			getServerSideGroupKey: (data) => data?.__groupKey ?? '',
			getRowId: function (params) {
				// Garante IDs únicos para cada nó
				if (params.data && params.data.__nodeType === 'campaign') {
					return `c:${params.data.__groupKey}`;
				}
				if (params.data && params.data.__nodeType === 'adset') {
					return `s:${params.data.__groupKey}`;
				}
				if (params.data && params.data.__nodeType === 'ad') {
					return `a:${params.data.id || params.data.story_id || params.data.__label}`;
				}
				// fallback
				return params.data && params.data.id != null
					? String(params.data.id)
					: `${Math.random()}`;
			},

			// IMPORTANTE: usa APENAS as colunas passadas para a classe
			columnDefs: [].concat(this.columnDefs),
			autoGroupColumnDef,
			defaultColDef,

			rowSelection: {
				mode: 'multiRow',
				checkboxes: { enabled: true, header: true },
				selectionColumn: {
					id: 'ag-Grid-SelectionColumn',
					width: 36,
					pinned: 'left',
					suppressHeaderMenuButton: true,
					suppressHeaderFilterButton: true,
				},
			},

			// Quais colunas podem quebrar em múltiplas linhas?

			rowHeight: BASE_ROW_MIN,
			getRowHeight: (p) => {
				// coleta larguras atuais por campo relevante
				const widthBag = {};
				widthBag.campaign = getAutoGroupContentWidth(p.api);
				const bmW = getFieldContentWidth(p.api, 'bc_name');
				if (bmW != null) widthBag.bc_name = bmW;

				const wKey = Object.entries(widthBag)
					.map(([k, v]) => `${k}:${Math.round(v || 0)}`)
					.join('|');

				const key =
					(p?.node?.id ||
						(p?.node?.data?.__nodeType === 'campaign'
							? `c:${p?.node?.data?.__groupKey}`
							: p?.node?.data?.__nodeType === 'adset'
							? `s:${p?.node?.data?.__groupKey}`
							: p?.node?.data?.id || Math.random())) +
					'|' +
					wKey;

				if (_rowHCache.has(key)) return _rowHCache.get(key);

				// mede cada candidato usando sua largura efetiva
				let maxTextH = 0;
				for (const field of WRAP_FIELDS) {
					const w = widthBag[field];
					if (!w) continue; // coluna não exibida
					const text = getCellTextForField(p, field);
					const textH = _rowHeightMeasure.measure(text, w);
					if (textH > maxTextH) maxTextH = textH;
				}

				// fallback se nada foi medido
				if (maxTextH <= 0) {
					_rowHCache.set(key, BASE_ROW_MIN);
					return BASE_ROW_MIN;
				}

				const h = Math.max(BASE_ROW_MIN, maxTextH + VERT_PAD);
				_rowHCache.set(key, h);
				return h;
			},

			onGridSizeChanged: () => {
				_rowHCache.clear();
				gridOptions.api?.resetRowHeights();
			},
			onColumnResized: () => {
				_rowHCache.clear();
				gridOptions.api?.resetRowHeights();
			},
			onFirstDataRendered: () => {
				_rowHCache.clear();
				gridOptions.api?.resetRowHeights();
			},
			onRowGroupOpened: () => {
				_rowHCache.clear();
				gridOptions.api?.resetRowHeights();
			},

			animateRows: true,
			sideBar: {
				toolPanels: ['columns', 'filters'],
				defaultToolPanel: null,
				position: 'right',
			},
			theme: createAgTheme(),

			getContextMenuItems: (params) => {
				const d = params.node?.data || {};
				const colId = params.column?.getColDef?.().colId ?? params.column?.colId;
				const isCampaignColumn = colId === 'ag-Grid-AutoColumn'; // ajustar se seu colId for diferente

				function buildCopyWithPartsText(p) {
					try {
						const inst = p.api.getCellRendererInstances({
							rowNodes: [p.node],
							columns: [p.column],
						})?.[0];
						if (inst && typeof inst.getCopyText === 'function') {
							const txt = String(inst.getCopyText() || '').trim();
							if (txt) return txt;
						}
					} catch {}

					try {
						const colDef = p.column?.getColDef?.() || p.colDef || {};
						const getParts = colDef?.cellRendererParams?.getParts;
						const row = p.node?.data || {};
						const top = p.valueFormatted ?? p.value ?? '';
						const lines = [];
						const push = (s) => {
							const v = s == null ? '' : String(s).trim();
							if (v && v !== '—') lines.push(v);
						};
						push(top);

						if (typeof getParts === 'function') {
							const parts =
								getParts({
									data: row,
									colDef,
									node: p.node,
									api: p.api,
									column: p.column,
									value: p.value,
									valueFormatted: p.valueFormatted,
								}) || [];

							for (const it of parts) {
								const txt =
									it?.text ||
									it?.labelWithValue ||
									(String(it?.label || it?.name || '').trim()
										? `${String(it?.label || it?.name || '').trim()}: ${
												Number.isFinite(it?.value)
													? cc_currencyFormat(Number(it.value))
													: String(it?.value ?? '—')
										  }`
										: `${
												Number.isFinite(it?.value)
													? cc_currencyFormat(Number(it.value))
													: String(it?.value ?? '—')
										  }`);
								push(txt);
							}
						}
						return lines.join('\n') || String(top || '');
					} catch {
						return String(p.valueFormatted ?? p.value ?? '');
					}
				}

				const items = [
					'cut',
					'copy',
					'copyWithHeaders',
					'copyWithGroupHeaders',
					'export',
					'separator',
				];

				// Somente na coluna campaign
				if (isCampaignColumn) {
					const label = d.__label || d.campaign_name || '';
					const utm = d.utm_campaign || '';
					if (label) {
						items.push({
							name: 'Copy Campaign',
							action: () => copyToClipboard(label),
							icon: '<span class="ag-icon ag-icon-copy"></span>',
						});
					}
					if (utm) {
						items.push({
							name: 'Copy UTM',
							action: () => copyToClipboard(utm),
							icon: '<span class="ag-icon ag-icon-copy"></span>',
						});
					}
				}

				// “Copy with parts” como antes
				(function maybeAddCopyWithParts() {
					const colDef = params.column?.getColDef?.() || params.colDef || {};
					const hasRenderer =
						colDef?.cellRenderer === StackBelowRenderer ||
						typeof colDef?.cellRendererParams?.getParts === 'function';

					if (!hasRenderer) return;

					items.push('separator');
					items.push({
						name: 'Copy with parts',
						action: () => {
							const txt = buildCopyWithPartsText(params);
							copyToClipboard(txt);
							try {
								showToast('Copied (with parts)', 'success');
							} catch {}
						},
						icon: '<span class="ag-icon ag-icon-copy"></span>',
					});
				})();

				return items;
			},

			onCellClicked: (params) => {
				const node = params.node;
				const eventTarget = params.event?.target;

				// Se nó estiver carregando, ignora qualquer clique
				if (node?.data?.__rowLoading) {
					return;
				}

				// Apenas roots de campanha/adset devem expandir/colapsar
				if (node.group) {
					// Se clicou fora do ícone de expandir/contrair
					const clickedExpanderOrCheckbox = !!eventTarget?.closest?.(
						'.ag-group-expanded, .ag-group-contracted, .ag-group-checkbox'
					);
					if (!clickedExpanderOrCheckbox) {
						// Inverte estado expandido
						node.setExpanded(!node.expanded);
						return;
					}
				}

				// Após lidar com expand/collapse, se nível > 0, ignora para modal
				if (node.level > 0) return;

				const isAutoGroupCol =
					(typeof params.column?.isAutoRowGroupColumn === 'function' &&
						params.column.isAutoRowGroupColumn()) ||
					params.colDef?.colId === 'ag-Grid-AutoColumn' ||
					!!params.colDef?.showRowGroup ||
					params?.column?.getColId?.() === 'campaign';
				const clickedExpander = clickedExpanderOrCheckbox;
				// Reusar a variável

				if (isAutoGroupCol && !clickedExpander && params?.data?.__nodeType === 'campaign') {
					const label = params.data.__label || '(no name)';
					showKTModal({ title: 'Campaign', content: label });
					return;
				}

				// Modal para campos específicos
				const MODAL_FIELDS = new Set([
					'profile_name',
					'bc_name',
					'account_name',
					'account_status',
					'account_limit',
					'campaign_name',
					'utm_campaign',
					'xabu_ads',
					'xabu_adsets',
				]);
				const field = params.colDef?.field;
				if (!field || !MODAL_FIELDS.has(field)) return;

				let display;
				const vfmt = params.valueFormatted;
				if (vfmt != null && vfmt !== '') {
					display = String(vfmt);
				} else {
					const val = params.value;
					if (typeof val === 'string') {
						display = stripHtml(val);
					} else if (val == null) {
						display = '';
					} else if (
						[
							'account_limit',
							'bid',
							'budget',
							'cpc',
							'cpa_fb',
							'real_cpa',
							'spent',
							'fb_revenue',
							'push_revenue',
							'profit',
						].includes(field)
					) {
						const n = toNumberBR(val);
						const currency = getAppCurrency();
						const locale = currency === 'USD' ? 'en-US' : 'pt-BR';
						display =
							n == null
								? ''
								: new Intl.NumberFormat(locale, {
										style: 'currency',
										currency,
								  }).format(n);
					} else if (
						[
							'impressions',
							'clicks',
							'visitors',
							'conversions',
							'real_conversions',
						].includes(field)
					) {
						const n = Number(val);
						display = Number.isFinite(n) ? intFmt.format(n) : String(val);
					} else if (field === 'account_status' || field === 'campaign_status') {
						display = strongText(String(val || ''));
					} else {
						display = String(val);
					}
				}

				const title = params.colDef?.headerName || 'Details';
				showKTModal({ title: 'Details', content: display || '(empty)' });
			},

			onGridReady: (params) => {
				console.log('[GridReady] Grid initialized successfully');

				const dataSource = {
					getRows: async (req) => {
						try {
							const {
								startRow = 0,
								endRow = 200,
								groupKeys = [],
								sortModel,
								filterModel,
							} = req.request;
							const filterModelWithGlobal = buildFilterModelWithGlobal(filterModel);

							// Nível 0 — CAMPANHAS
							if (groupKeys.length === 0) {
								if (!globalThis.ROOT_CACHE) {
									let res = await fetch(this.endpoints.SSRM, {
										method: 'POST',
										headers: { 'Content-Type': 'application/json' },
										credentials: 'same-origin',
										body: JSON.stringify({ mode: 'full' }),
									});
									if (!res.ok) {
										res = await fetch(this.endpoints.SSRM, {
											credentials: 'same-origin',
										});
									}
									const data = await res.json().catch(() => ({ rows: [] }));
									const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
									globalThis.ROOT_CACHE = { rowsRaw };
								}

								const all = globalThis.ROOT_CACHE.rowsRaw;
								const filtered = frontApplyFilters(all, filterModelWithGlobal);
								const ordered = frontApplySort(filtered, sortModel || []);
								const rowsNorm = ordered.map(normalizeCampaignRow);

								const totalCount = rowsNorm.length;
								const slice = rowsNorm.slice(startRow, Math.min(endRow, totalCount));

								const totals = computeClientTotals(ordered);
								const currency = getAppCurrency();
								const locale = currency === 'USD' ? 'en-US' : 'pt-BR';
								const nfCur = new Intl.NumberFormat(locale, {
									style: 'currency',
									currency,
								});

								const pinnedTotal = {
									id: '__pinned_total__',
									bc_name: 'TOTAL',
									impressions: totals.impressions_sum ?? 0,
									clicks: totals.clicks_sum ?? 0,
									visitors: totals.visitors_sum ?? 0,
									conversions: totals.conversions_sum ?? 0,
									real_conversions: totals.real_conversions_sum ?? 0,
									spent: totals.spent_sum ?? 0,
									fb_revenue: totals.fb_revenue_sum ?? 0,
									push_revenue: totals.push_revenue_sum ?? 0,
									revenue: totals.revenue_sum ?? 0,
									profit: totals.profit_sum ?? 0,
									budget: totals.budget_sum ?? 0,
									cpc: totals.cpc_total ?? 0,
									cpa_fb: totals.cpa_fb_total ?? 0,
									real_cpa: totals.real_cpa_total ?? 0,
									mx: totals.mx_total ?? 0,
									ctr: totals.ctr_total ?? 0,
									__label: `CAMPAIGNS: ${intFmt.format(totalCount)}`,
								};

								for (const k of [
									'spent',
									'fb_revenue',
									'push_revenue',
									'revenue',
									'profit',
									'budget',
									'cpc',
									'cpa_fb',
									'real_cpa',
									'mx',
								]) {
									pinnedTotal[k] = nfCur.format(Number(pinnedTotal[k]) || 0);
								}
								for (const k of [
									'impressions',
									'clicks',
									'visitors',
									'conversions',
									'real_conversions',
								]) {
									pinnedTotal[k] = intFmt.format(Number(pinnedTotal[k]) || 0);
								}
								if (typeof pinnedTotal.ctr === 'number') {
									pinnedTotal.ctr = (pinnedTotal.ctr * 100).toFixed(2) + '%';
								}

								const targetApi = req.api ?? params.api;
								try {
									targetApi.setPinnedBottomRowData?.([pinnedTotal]) ||
										targetApi.setGridOption?.('pinnedBottomRowData', [pinnedTotal]);
								} catch (e) {
									console.warn('Error applying pinned bottom row:', e);
								}

								req.success({ rowData: slice, rowCount: totalCount });
								return;
							}

							// Nível 1 — ADSETS
							if (groupKeys.length === 1) {
								const campaignId = groupKeys[0];
								const parentId = `c:${campaignId}`;
								const apiTarget = req.api ?? params.api;
								const parentNode = apiTarget.getRowNode(parentId);

								// Bloqueio durante carregamento caso:
								if (parentNode?.data?.__rowLoading) {
									// Permite se estiver fechado
									if (parentNode.expanded) {
										req.success({ rowData: [], rowCount: 0 });
										return;
									}
								}

								setParentRowLoading(apiTarget, parentId, true);

								const qs = new URLSearchParams({
									campaign_id: campaignId,
									period: this.drill.period,
									startRow: String(startRow),
									endRow: String(endRow),
									sortModel: JSON.stringify(sortModel || []),
									filterModel: JSON.stringify(filterModelWithGlobal || {}),
								});

								if (this.drill.fakeNetworkMs > 0) await sleep(this.drill.fakeNetworkMs);

								const data = await fetchJSON(
									`${this.endpoints.ADSETS}?${qs.toString()}`
								);
								const rows = (data.rows || []).map(normalizeAdsetRow);

								await withMinSpinner(req.request, this.drill.minSpinnerMs);

								if (parentNode && typeof parentNode.setExpanded === 'function') {
									parentNode.setExpanded(true, true);
								}

								req.success({ rowData: rows, rowCount: data.lastRow ?? rows.length });

								setParentRowLoading(apiTarget, parentId, false);
								return;
							}

							// Nível 2 — ADS
							if (groupKeys.length === 2) {
								const adsetId = groupKeys[1];
								const parentId = `s:${adsetId}`;
								const apiTarget = req.api ?? params.api;
								const parentNode = apiTarget.getRowNode(parentId);

								if (parentNode?.data?.__rowLoading) {
									if (parentNode.expanded) {
										req.success({ rowData: [], rowCount: 0 });
										return;
									}
								}

								setParentRowLoading(apiTarget, parentId, true);

								const qs = new URLSearchParams({
									adset_id: adsetId,
									period: this.drill.period,
									startRow: String(startRow),
									endRow: String(endRow),
									sortModel: JSON.stringify(sortModel || []),
									filterModel: JSON.stringify(filterModelWithGlobal || {}),
								});

								if (this.drill.fakeNetworkMs > 0) await sleep(this.drill.fakeNetworkMs);

								const data = await fetchJSON(`${this.endpoints.ADS}?${qs.toString()}`);
								const rows = (data.rows || []).map(normalizeAdRow);

								await withMinSpinner(req.request, this.drill.minSpinnerMs);

								if (parentNode && typeof parentNode.setExpanded === 'function') {
									parentNode.setExpanded(true, true);
								}

								req.success({ rowData: rows, rowCount: data.lastRow ?? rows.length });

								setParentRowLoading(apiTarget, parentId, false);
								return;
							}

							// Fallback vazio
							req.success({ rowData: [], rowCount: 0 });
						} catch (e) {
							console.error('[TREE SSRM] getRows failed:', e);
							req.fail();
						}
					},
				};

				if (typeof params.api.setServerSideDatasource === 'function') {
					params.api.setServerSideDatasource(dataSource);
				} else {
					params.api.setGridOption?.('serverSideDatasource', dataSource);
				}

				setTimeout(() => {
					try {
						params.api.sizeColumnsToFit();
					} catch {}
				}, 0);
				setTimeout(() => {
					globalThis.dispatchEvent(new CustomEvent('lionGridReady'));
				}, 100);
			},
		};

		const apiOrInstance =
			typeof AG.createGrid === 'function'
				? AG.createGrid(this.gridDiv, gridOptions)
				: new AG.Grid(this.gridDiv, gridOptions);

		const api = gridOptions.api || apiOrInstance;

		// expõe no global e captura na instância
		globalThis.LionGrid = globalThis.LionGrid || {};
		globalThis.LionGrid.api = api;
		globalThis.LionGrid.resetLayout = function () {
			try {
				sessionStorage.removeItem(GRID_STATE_KEY);
				api.setState({}, []);
				setTimeout(() => {
					api.sizeColumnsToFit();
					api.resetRowHeights();
				}, 50);
				showToast('Layout Reset', 'info');
			} catch {}
		};

		try {
			LionCompositeColumns.activate();
		} catch (e) {
			console.warn(e);
		}

		try {
			const _api = typeof api !== 'undefined' && api ? api : gridOptions?.api || null;
			if (_api) this.api = _api;
		} catch {}

		// ===== Bind opcional do toggle de pinos (usa a função global já existente) =====
		this._bindPinnedToggle();

		return { api: this.api, gridDiv: this.gridDiv };
	}

	_bindPinnedToggle() {
		const el = document.querySelector(this.pinToggleSelector);
		if (!el) return;
		if (!el.hasAttribute('data-init-bound')) {
			el.checked = true;
			el.addEventListener('change', () => togglePinnedColsFromCheckbox(false));
			el.setAttribute('data-init-bound', '1');
		}
		// aplica silencioso no load
		try {
			togglePinnedColsFromCheckbox(true);
		} catch {}
	}
}
