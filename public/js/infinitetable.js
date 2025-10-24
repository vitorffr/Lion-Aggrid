/* public/js/lion-grid.js
 *
 * Lion Grid — AG Grid (TreeData + SSRM)
 * -------------------------------------
 * - NÃO remove nada: apenas reordenação e documentação.
 * - Mesma API pública (globalThis.LionGrid), mesmos endpoints e renderers.
 * - Comentários JSDoc adicionados para funções-chave.
 *
 * Estrutura:
 *  1) Constantes & Config
 *  2) Estado Global (moeda / quick filter)
 *  3) Utilidades (sleep/spinner, parsing, edição silenciosa)
 *  4) Toast
 *  5) CSS de Loading (IIFE)
 *  6) AG Grid: acesso + licença (IIFE)
 *  7) Helpers/Formatters (HTML/numérico/moedas, badges)
 *  8) Utils de status/loading por célula
 *  9) Renderers (status pill, chips, profile, revenue)
 * 10) Backend API (update*, fetchJSON, toggleFeature)
 * 11) Modal simples (KTUI-like)
 * 12) Tema (createAgTheme)
 * 13) Colunas (defaultColDef, defs)
 * 14) SSRM refresh compat
 * 15) Global Quick Filter (IIFE)
 * 16) State (load/apply saved)
 * 17) Toggle de colunas pinadas (getSelectionColId/togglePinnedColsFromCheckbox)
 * 18) Toolbar (presets, tamanho colunas, binds) (IIFE)
 * 19) Normalizadores (tree)
 * 20) Clipboard
 * 21) Grid (makeGrid)
 * 22) Page module (mount)
 */

/* =========================================
 * 1) Constantes & Config
 * =======================================*/
const ENDPOINTS = { SSRM: '/api/ssrm/?clean=1&mode=full' };
const DRILL_ENDPOINTS = { ADSETS: '/api/adsets/', ADS: '/api/ads/' };
const DRILL = { period: 'TODAY' };

/* ========= Grid State (sessionStorage) ========= */
const GRID_STATE_KEY = 'lion.aggrid.state.v1';
const GRID_STATE_IGNORE_ON_RESTORE = ['pagination', 'scroll', 'rowSelection', 'focusedCell'];

// === Fake network & min spinner ===
const DEV_FAKE_NETWORK_LATENCY_MS = 0;
const MIN_SPINNER_MS = 500;

// === Cache local do nível 0 (campanhas) - carrega tudo de uma vez ===
let ROOT_CACHE = null; // { rowsRaw: [], rowsNorm: [] }

/* =========================================
 * 2) Estado Global
 * =======================================*/
// Moeda global da aplicação
let LION_CURRENCY = 'BRL'; // 'BRL' | 'USD'

// 🔍 QUICK FILTER global (vai em filterModel._global.filter)
let GLOBAL_QUICK_FILTER = ''; // alimentado pelo #quickFilter

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

/**
 * Marca que o próximo setDataValue para a célula NÃO deve disparar onCellValueChanged.
 * @param {*} p params do AG Grid
 * @param {string} colId
 */
function shouldSuppressCellChange(p, colId) {
	const key = `__suppress_${colId}`;
	if (p?.data?.[key]) {
		p.data[key] = false;
		return true;
	}
	return false;
}

/**
 * Faz update de célula sem disparar handlers de edição.
 * @param {*} p params do AG Grid
 * @param {string} colId
 * @param {*} value
 */
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
 * 5) CSS de Loading (injeção automática)
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
`;
	const el = document.createElement('style');
	el.id = 'lion-loading-styles';
	el.textContent = css;
	document.head.appendChild(el);
})();

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

const intFmt = new Intl.NumberFormat('pt-BR');

/** Formatter de moeda dinâmico (BRL/USD) para AG Grid. */
function currencyFormatter(p) {
	const currency = getAppCurrency();
	const locale = currency === 'USD' ? 'en-US' : 'pt-BR';
	let n = typeof p.value === 'number' ? p.value : parseCurrencyFlexible(p.value, currency);
	if (!Number.isFinite(n)) return p.value ?? '';
	return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
}
const intFormatter = (p) => {
	const n = toNumberBR(p.value);
	return n == null ? p.value ?? '' : intFmt.format(Math.round(n));
};

/** Cores fallback para badges (sem tailwind). */
const FALLBACK_STYLE = {
	success: { bg: '#22c55e', fg: '#ffffff' },
	primary: { bg: '#3b82f6', fg: '#ffffff' },
	danger: { bg: '#dc2626', fg: '#ffffff' },
	warning: { bg: '#eab308', fg: '#111111' },
	info: { bg: '#06b6d4', fg: '#ffffff' },
	secondary: { bg: '#334155', fg: '#ffffff' },
	light: { bg: '#e5e7eb', fg: '#111111' },
	dark: { bg: '#1f2937', fg: '#ffffff' },
};
function renderBadgeNode(label, colorKey) {
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
function renderBadge(label, colorKey) {
	return renderBadgeNode(label, colorKey).outerHTML;
}
function pickStatusColor(raw) {
	const s = String(raw || '')
		.trim()
		.toLowerCase();
	return s === 'active' ? 'success' : 'secondary';
}
function isPinnedOrTotal(params) {
	return (
		params?.node?.rowPinned === 'bottom' ||
		params?.node?.rowPinned === 'top' ||
		params?.data?.__nodeType === 'total' ||
		params?.node?.group === true
	);
}

/* ===== Totais no CLIENTE (usados no nível 0) ===== */
function numBR(x) {
	const n1 = toNumberBR(x);
	if (n1 != null) return n1;
	const n2 = parseCurrencyFlexible(x, getAppCurrency());
	return Number.isFinite(n2) ? n2 : null;
}
function sumNum(arr, pick) {
	let acc = 0;
	for (let i = 0; i < arr.length; i++) {
		const v = pick(arr[i]);
		if (Number.isFinite(v)) acc += v;
	}
	return acc;
}
function safeDiv(num, den) {
	return den > 0 ? num / den : 0;
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
function isStatusActiveVal(v) {
	return String(v ?? '').toUpperCase() === 'ACTIVE';
}
function getRowStatusValue(p) {
	return p?.data?.campaign_status ?? p?.data?.status ?? p?.value ?? '';
}
function setRowStatus(data, on) {
	const next = on ? 'ACTIVE' : 'PAUSED';
	if (data) {
		if ('campaign_status' in data) data.campaign_status = next;
		if ('status' in data) data.status = next;
	}
}
function setCellLoading(node, colId, on) {
	if (!node?.data) return;
	node.data.__loading = node.data.__loading || {};
	node.data.__loading[colId] = !!on;
}
function isCellLoading(p, colId) {
	return !!p?.data?.__loading?.[colId];
}

/* =========================================
 * 9) Renderers
 * =======================================*/
function statusPillRenderer(p) {
	const raw = p.value ?? '';
	if (isPinnedOrTotal(p) || !raw) {
		const span = document.createElement('span');
		span.textContent = stripHtml(raw) || '';
		return span;
	}
	const labelClean = (strongText(raw) || stripHtml(raw) || '').trim();
	const labelUp = labelClean.toUpperCase();
	if (/^\s*INATIVA\s+PAGAMENTO\s*$/i.test(labelClean)) {
		const el = document.createElement('span');
		el.className = 'lion-badge--inativa-pagamento';
		el.textContent = 'INATIVA\nPAGAMENTO';
		return el;
	}
	if (labelUp === 'ACTIVE') {
		const el = document.createElement('span');
		el.className = 'lion-badge--active';
		el.textContent = 'ACTIVE';
		return el;
	}
	const color = pickStatusColor(labelUp);
	return renderBadgeNode(labelUp, color);
}

function pickChipColorFromFraction(value) {
	const txt = stripHtml(value ?? '').trim();
	const m = txt.match(/^(\d+)\s*\/\s*(\d+)$/);
	if (!m) return { label: txt || '—', color: 'secondary' };
	const current = Number(m[1]);
	const total = Number(m[2]);
	if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0)
		return { label: `${current}/${total}`, color: 'secondary' };
	if (current <= 1) return { label: `${current}/${total}`, color: 'success' };
	const ratio = current / total;
	if (ratio > 0.5) return { label: `${current}/${total}`, color: 'danger' };
	return { label: `${current}/${total}`, color: 'warning' };
}
function chipFractionBadgeRenderer(p) {
	if (isPinnedOrTotal(p) || !p.value) {
		const span = document.createElement('span');
		span.textContent = stripHtml(p.value) || '';
		return span;
	}
	const { label, color } = pickChipColorFromFraction(p.value);
	const host = document.createElement('span');
	host.innerHTML = renderBadge(label, color);
	return host.firstElementChild;
}

function profileCellRenderer(params) {
	const raw = String(params?.value ?? '').trim();
	if (!raw) return '';
	const idx = raw.lastIndexOf(' - ');
	const name = idx > -1 ? raw.slice(0, idx).trim() : raw;
	const meta = idx > -1 ? raw.slice(idx + 3).trim() : '';
	const wrap = document.createElement('span');
	wrap.style.display = 'inline-flex';
	wrap.style.flexDirection = 'column';
	wrap.style.lineHeight = '1.2';
	const nameEl = document.createElement('span');
	nameEl.textContent = name;
	nameEl.style.fontWeight = '500';
	wrap.appendChild(nameEl);
	if (meta) {
		const metaEl = document.createElement('span');
		metaEl.textContent = meta;
		metaEl.style.fontSize = '10px';
		metaEl.style.opacity = '0.65';
		metaEl.style.letterSpacing = '0.2px';
		wrap.appendChild(metaEl);
	}
	return wrap;
}

const REVENUE_LABELS = ['A', 'B'];
function parseRevenue(raw) {
	const txt = stripHtml(raw ?? '').trim();
	const m = txt.match(/^(.*?)\s*\(\s*(.*?)\s*\|\s*(.*?)\s*\)\s*$/);
	if (!m) return { total: txt, parts: [] };
	return { total: m[1].trim(), parts: [m[2].trim(), m[3].trim()] };
}
function revenueCellRenderer(p) {
	const raw = p.value ?? p.data?.revenue ?? '';
	if (isPinnedOrTotal(p) || !raw) {
		const span = document.createElement('span');
		span.textContent = stripHtml(raw) || '';
		return span;
	}
	const { total, parts } = parseRevenue(raw);
	const wrap = document.createElement('span');
	wrap.style.display = 'inline-flex';
	wrap.style.flexDirection = 'column';
	wrap.style.lineHeight = '1.15';
	wrap.style.gap = '2px';
	const totalEl = document.createElement('span');
	totalEl.textContent = total || '';
	wrap.appendChild(totalEl);
	if (parts.length === 2) {
		const aEl = document.createElement('span');
		aEl.textContent = `(${REVENUE_LABELS[0] || 'A'}: ${parts[0]})`;
		aEl.style.fontSize = '11px';
		aEl.style.opacity = '0.75';
		const bEl = document.createElement('span');
		bEl.textContent = `(${REVENUE_LABELS[1] || 'B'}: ${parts[1]})`;
		bEl.style.fontSize = '11px';
		bEl.style.opacity = '0.75';
		wrap.appendChild(aEl);
		wrap.appendChild(bEl);
	}
	return wrap;
}

/* ======= Campaign Status Slider Renderer (otimizado) ======= */
function StatusSliderRenderer() {}
const LionStatusMenu = (() => {
	let el = null,
		onPick = null;
	function ensure() {
		if (el) return el;
		el = document.createElement('div');
		el.className = 'lion-status-menu';
		el.style.display = 'none';
		document.body.appendChild(el);
		return el;
	}
	function close() {
		if (!el) return;
		el.style.display = 'none';
		onPick = null;
		document.removeEventListener('mousedown', onDocClose, true);
		window.removeEventListener('blur', close, true);
	}
	function onDocClose(ev) {
		if (!el) return;
		if (ev.target === el || el.contains(ev.target)) return;
		close();
	}
	function open({ left, top, width, current, pick }) {
		const host = ensure();
		host.innerHTML = '';
		onPick = pick;
		['ACTIVE', 'PAUSED'].forEach((st) => {
			const item = document.createElement('div');
			item.className = 'lion-status-menu__item' + (current === st ? ' is-active' : '');
			item.textContent = st;
			item.addEventListener('mousedown', (e) => e.preventDefault());
			item.addEventListener('click', (e) => {
				e.preventDefault();
				if (onPick) onPick(st);
				close();
			});
			host.appendChild(item);
		});
		const menuW = 180;
		host.style.left = `${Math.max(8, left + (width - menuW) / 2)}px`;
		host.style.top = `${top + 6}px`;
		host.style.display = 'block';
		setTimeout(() => {
			document.addEventListener('mousedown', onDocClose, true);
			window.addEventListener('blur', close, true);
		}, 0);
	}
	return { open, close };
})();

StatusSliderRenderer.prototype.init = function (p) {
	this.p = p;
	const cfg = p.colDef?.cellRendererParams || {};
	const interactive = new Set(Array.isArray(cfg.interactiveLevels) ? cfg.interactiveLevels : [0]);
	const smallKnob = !!cfg.smallKnob;
	const level = p?.node?.level ?? 0;
	const colId = p.column.getColId();

	const getVal = () =>
		String(p.data?.campaign_status ?? p.data?.status ?? p.value ?? '').toUpperCase();
	const isOnVal = () => getVal() === 'ACTIVE';

	if (isPinnedOrTotal(p) || !interactive.has(level)) {
		this.eGui = document.createElement('span');
		this.eGui.textContent = strongText(String(p.value ?? ''));
		return;
	}

	const root = document.createElement('div');
	root.className = 'ag-status-pill';
	root.setAttribute('role', 'switch');
	root.setAttribute('tabindex', '0');

	const fill = document.createElement('div');
	fill.className = 'ag-status-fill';
	const knob = document.createElement('div');
	knob.className = 'ag-status-knob';
	if (smallKnob) knob.classList.add('ag-status-knob--sm');
	const label = document.createElement('div');
	label.className = 'ag-status-label';
	root.append(fill, label, knob);
	this.eGui = root;

	let trackLenPx = 0,
		rafToken = null;
	const computeTrackLen = () => {
		const pad = parseFloat(getComputedStyle(root).paddingLeft || '0');
		const knobW = knob.clientWidth || 0;
		const edgeGap = parseFloat(getComputedStyle(root).getPropertyValue('--edge-gap') || '0');
		const travel = root.clientWidth - 2 * pad - 2 * edgeGap - knobW;
		return Math.max(0, travel);
	};
	const setProgress = (pct01) => {
		const pct = Math.max(0, Math.min(1, pct01));
		fill.style.width = pct * 100 + '%';
		knob.style.transform = `translateX(${pct * trackLenPx}px)`;
		const on = pct >= 0.5;
		label.textContent = on ? 'ACTIVE' : 'PAUSED';
		root.setAttribute('aria-checked', String(on));
	};

	requestAnimationFrame(() => {
		trackLenPx = computeTrackLen();
		setProgress(isOnVal() ? 1 : 0);
	});

	const setCellBusy = (on) => {
		setCellLoading(p.node, colId, !!on);
		p.api.refreshCells({ rowNodes: [p.node], columns: [colId] });
	};

	const commit = async (nextOrString, prevOn) => {
		const nextVal =
			typeof nextOrString === 'string'
				? nextOrString.toUpperCase()
				: nextOrString
				? 'ACTIVE'
				: 'PAUSED';

		const level = p.node?.level ?? 0;
		const id =
			level === 0
				? String(p.data?.id ?? p.data?.utm_campaign ?? '')
				: String(p.data?.id ?? '') || '';

		if (!id) return;

		const scope = level === 2 ? 'ad' : level === 1 ? 'adset' : 'campaign';

		setCellBusy(true);
		try {
			const okTest = await toggleFeature('status', { scope, id, value: nextVal });
			if (!okTest) {
				const rollbackVal = prevOn ? 'ACTIVE' : 'PAUSED';
				if (p.data) {
					if ('campaign_status' in p.data) p.data.campaign_status = rollbackVal;
					if ('status' in p.data) p.data.status = rollbackVal;
				}
				setProgress(prevOn ? 1 : 0);
				p.api.refreshCells({ rowNodes: [p.node], columns: [colId] });
				return;
			}

			if (p.data) {
				if ('campaign_status' in p.data) p.data.campaign_status = nextVal;
				if ('status' in p.data) p.data.status = nextVal;
			}
			setProgress(nextVal === 'ACTIVE' ? 1 : 0);
			p.api.refreshCells({ rowNodes: [p.node], columns: [colId] });

			try {
				if (scope === 'ad') await updateAdStatusBackend(id, nextVal);
				else if (scope === 'adset') await updateAdsetStatusBackend(id, nextVal);
				else await updateCampaignStatusBackend(id, nextVal);

				if (this._userInteracted) {
					const scopeLabel = scope === 'ad' ? 'Ad' : scope === 'adset' ? 'Adset' : 'Campanha';
					const msg = nextVal === 'ACTIVE' ? `${scopeLabel} ativado` : `${scopeLabel} pausado`;
					showToast(msg, 'success');
				}
			} catch (e) {
				const rollbackVal = prevOn ? 'ACTIVE' : 'PAUSED';
				if (p.data) {
					if ('campaign_status' in p.data) p.data.campaign_status = rollbackVal;
					if ('status' in p.data) p.data.status = rollbackVal;
				}
				setProgress(prevOn ? 1 : 0);
				p.api.refreshCells({ rowNodes: [p.node], columns: [colId] });
				showToast(`Falha ao salvar status: ${e?.message || e}`, 'danger');
			}
		} finally {
			setCellBusy(false);
		}
	};

	const MOVE_THRESHOLD = 6;
	let dragging = false,
		startX = 0,
		startOn = false,
		moved = false;

	const onPointerMove = (x) => {
		if (!dragging || rafToken) return;
		rafToken = requestAnimationFrame(() => {
			rafToken = null;
			const dx = x - startX;
			if (!moved && Math.abs(dx) > MOVE_THRESHOLD) moved = true;
			if (!moved) return;
			const p0 = startOn ? 1 : 0;
			const pgr = p0 + dx / Math.max(1, trackLenPx);
			setProgress(pgr);
		});
	};
	const detachWindowListeners = () => {
		window.removeEventListener('mousemove', onMouseMove);
		window.removeEventListener('mouseup', onMouseUp);
		window.removeEventListener('touchmove', onTouchMove, { passive: true });
		window.removeEventListener('touchend', onTouchEnd);
	};
	const onMouseMove = (e) => onPointerMove(e.clientX);
	const onTouchMove = (e) => onPointerMove(e.touches[0].clientX);

	const endDrag = (x, ev) => {
		if (!dragging) return;
		dragging = false;
		detachWindowListeners();
		if (!moved) {
			ev?.preventDefault?.();
			ev?.stopPropagation?.();
			openMenu();
			return;
		}
		const pct = parseFloat(fill.style.width) / 100;
		const finalOn = pct >= 0.5;
		if (finalOn !== startOn) commit(finalOn, startOn);
		else setProgress(startOn ? 1 : 0);
		ev?.preventDefault?.();
		ev?.stopPropagation?.();
	};
	const onMouseUp = (e) => endDrag(e.clientX, e);
	const onTouchEnd = (e) => endDrag(e.changedTouches[0].clientX, e);

	const beginDrag = (x, ev) => {
		this._userInteracted = true;
		dragging = true;
		moved = false;
		startX = x;
		startOn = root.getAttribute('aria-checked') === 'true';
		trackLenPx = computeTrackLen();
		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
		window.addEventListener('touchmove', onTouchMove, { passive: true });
		window.addEventListener('touchend', onTouchEnd);
		ev?.preventDefault?.();
		ev?.stopPropagation?.();
	};
	root.addEventListener('mousedown', (e) => beginDrag(e.clientX, e));
	root.addEventListener('touchstart', (e) => beginDrag(e.touches[0].clientX, e), { passive: false });

	root.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
	});
	root.addEventListener('keydown', (e) => {
		if (e.code === 'Space' || e.code === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			openMenu();
		}
	});
	root.addEventListener('dblclick', (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (isCellLoading({ data: p.node?.data }, colId)) return;
		const cur = getVal();
		const prevOn = cur === 'ACTIVE';
		const next = prevOn ? 'PAUSED' : 'ACTIVE';
		this._userInteracted = true;
		commit(next, prevOn);
	});
	const openMenu = () => {
		if (isCellLoading({ data: p.node?.data }, colId)) return;
		const cur = getVal();
		const rect = root.getBoundingClientRect();
		LionStatusMenu.open({
			left: rect.left,
			top: rect.bottom,
			width: rect.width,
			current: cur,
			pick: async (st) => {
				if (st === cur) return;
				this._userInteracted = true;
				const prevOn = cur === 'ACTIVE';
				await commit(st, prevOn);
			},
		});
	};

	this._cleanup = () => {
		LionStatusMenu.close();
		detachWindowListeners();
		if (rafToken) cancelAnimationFrame(rafToken);
	};
};
StatusSliderRenderer.prototype.getGui = function () {
	return this.eGui;
};
StatusSliderRenderer.prototype.refresh = function (p) {
	const cfg = p.colDef?.cellRendererParams || {};
	const interactive = new Set(Array.isArray(cfg.interactiveLevels) ? cfg.interactiveLevels : [0]);
	const level = p?.node?.level ?? 0;
	if (!this.eGui || isPinnedOrTotal(p) || !interactive.has(level)) return false;

	const raw = String(p.data?.campaign_status ?? p.data?.status ?? p.value ?? '').toUpperCase();
	const isOn = raw === 'ACTIVE';
	const fill = this.eGui.querySelector('.ag-status-fill');
	const knob = this.eGui.querySelector('.ag-status-knob');
	const label = this.eGui.querySelector('.ag-status-label');
	const cs = getComputedStyle(this.eGui);
	const pad = parseFloat(cs.paddingLeft || '0');
	const edgeGap = parseFloat(cs.getPropertyValue('--edge-gap') || '0');
	const rectW = this.eGui.getBoundingClientRect().width;
	const kRectW = this.eGui.querySelector('.ag-status-knob').getBoundingClientRect().width || 0;
	const trackLenPx = Math.max(0, rectW - 2 * pad - 2 * edgeGap - kRectW);

	requestAnimationFrame(() => {
		fill.style.width = (isOn ? 100 : 0) + '%';
		const onNudge = parseFloat(cs.getPropertyValue('--knob-on-nudge') || '0') || 0;
		const offNudge = parseFloat(cs.getPropertyValue('--knob-off-nudge') || '0') || 0;
		const nudgePx = isOn ? onNudge : offNudge;
		let x = (isOn ? 1 : 0) * trackLenPx;
		knob.style.transform = `translateX(${x + nudgePx}px)`;
		label.textContent = isOn ? 'ACTIVE' : 'PAUSED';
		this.eGui.setAttribute('aria-checked', String(isOn));
	});
	LionStatusMenu.close();
	return true;
};
StatusSliderRenderer.prototype.destroy = function () {
	this._cleanup?.();
};

/* =========================================
 * 10) Backend API (update*, fetchJSON, toggleFeature)
 * =======================================*/
async function updateAdStatusBackend(id, status) {
	const t0 = performance.now();
	if (DEV_FAKE_NETWORK_LATENCY_MS > 0) await sleep(DEV_FAKE_NETWORK_LATENCY_MS);
	const res = await fetch(`/api/ads/${encodeURIComponent(id)}/status/`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'same-origin',
		body: JSON.stringify({ status }),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok || data?.ok === false) throw new Error(data?.error || 'Ad status update failed');
	await withMinSpinner(t0, MIN_SPINNER_MS);
	return data;
}
async function updateAdsetStatusBackend(id, status) {
	const t0 = performance.now();
	if (DEV_FAKE_NETWORK_LATENCY_MS > 0) await sleep(DEV_FAKE_NETWORK_LATENCY_MS);
	const res = await fetch(`/api/adsets/${encodeURIComponent(id)}/status/`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'same-origin',
		body: JSON.stringify({ status }),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok || data?.ok === false) throw new Error(data?.error || 'Adset status update failed');
	await withMinSpinner(t0, MIN_SPINNER_MS);
	return data;
}
async function updateCampaignStatusBackend(id, status) {
	const t0 = performance.now();
	if (DEV_FAKE_NETWORK_LATENCY_MS > 0) await sleep(DEV_FAKE_NETWORK_LATENCY_MS);
	const res = await fetch(`/api/campaigns/${encodeURIComponent(id)}/status/`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'same-origin',
		body: JSON.stringify({ status }),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok || data?.ok === false) throw new Error(data?.error || 'Status update failed');
	await withMinSpinner(t0, MIN_SPINNER_MS);
	return data;
}
async function updateCampaignBudgetBackend(id, budgetNumber) {
	const t0 = performance.now();
	if (DEV_FAKE_NETWORK_LATENCY_MS > 0) await sleep(DEV_FAKE_NETWORK_LATENCY_MS);
	const res = await fetch(`/api/campaigns/${encodeURIComponent(id)}/budget/`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'same-origin',
		body: JSON.stringify({ budget: budgetNumber }),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok || data?.ok === false) throw new Error(data?.error || 'Budget update failed');
	await withMinSpinner(t0, MIN_SPINNER_MS);
	return data;
}
async function updateCampaignBidBackend(id, bidNumber) {
	const t0 = performance.now();
	if (DEV_FAKE_NETWORK_LATENCY_MS > 0) await sleep(DEV_FAKE_NETWORK_LATENCY_MS);
	const res = await fetch(`/api/campaigns/${encodeURIComponent(id)}/bid/`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'same-origin',
		body: JSON.stringify({ bid: bidNumber }),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok || data?.ok === false) throw new Error(data?.error || 'Bid update failed');
	await withMinSpinner(t0, MIN_SPINNER_MS);
	return data;
}
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
async function toggleFeature(feature, value) {
	const res = await fetch('/api/dev/test-toggle/', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'same-origin',
		body: JSON.stringify({ feature, value }),
	});
	const data = await res.json();
	if (res.ok && data.ok) {
		showToast(data.message || 'Aplicado', 'success');
		return true;
	}
	const msg = data?.error || `Erro (${res.status})`;
	showToast(msg, 'danger');
	return false;
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
      <h3 class="kt-modal-title">Detalhes</h3>
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
	const el = document.querySelector(selector);
	if (!el) return;
	el.style.display = 'none';
	el.classList.remove('kt-modal--open');
	el.classList.add('hidden');
	el.setAttribute('aria-hidden', 'true');
}
function showKTModal({ title = 'Detalhes', content = '' } = {}) {
	ensureKtModalDom();
	const modal = document.querySelector('#lionKtModal');
	if (!modal) return;
	modal.querySelector('.kt-modal-title').textContent = title;
	modal.querySelector('.kt-modal-body > pre').textContent = content;
	openKTModal('#lionKtModal');
}

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
		foregroundColor: '#BBBEC9',
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
const LION_CENTER_EXCLUDES = new Set(['profile_name']);

/* =========================================
 * 13) Colunas (defaultColDef, defs)
 * =======================================*/
const defaultColDef = {
	sortable: true,
	filter: 'agTextColumnFilter',
	floatingFilter: true,
	resizable: true,
	cellClass: (p) => (LION_CENTER_EXCLUDES.has(p.column.getColId()) ? null : 'lion-center-cell'),
	wrapHeaderText: true,
	autoHeaderHeight: true,
	enableRowGroup: true,
	enablePivot: true,
	enableValue: true,
	suppressHeaderFilterButton: true,
};
function parseCurrencyInput(params) {
	return parseCurrencyFlexible(params.newValue, getAppCurrency());
}
function isPinnedOrGroup(params) {
	return params?.node?.rowPinned || params?.node?.group;
}

function CampaignStatusFloatingFilter() {}
CampaignStatusFloatingFilter.prototype.init = function (params) {
	this.params = params;
	const wrap = document.createElement('div');
	wrap.style.display = 'flex';
	wrap.style.alignItems = 'center';
	wrap.style.height = '100%';
	wrap.style.padding = '0 6px';

	const sel = document.createElement('select');
	sel.className = 'ag-input-field-input ag-text-field-input lion-ff-select--inputlike';
	sel.style.width = '100%';
	sel.style.height = '28px';
	sel.style.fontSize = '12px';
	sel.style.padding = '2px 8px';
	sel.style.boxSizing = 'border-box';

	[
		['', 'ALL'],
		['ACTIVE', 'ACTIVE'],
		['PAUSED', 'PAUSED'],
	].forEach(([v, t]) => {
		const o = document.createElement('option');
		o.value = v;
		o.textContent = t;
		sel.appendChild(o);
	});

	const applyFromModel = (model) => {
		if (!model) {
			sel.value = '';
			return;
		}
		const v = String(model.filter ?? '').toUpperCase();
		sel.value = v === 'ACTIVE' || v === 'PAUSED' ? v : '';
	};
	applyFromModel(params.parentModel);

	const applyTextEquals = (val) => {
		params.parentFilterInstance((parent) => {
			if (!val) parent.setModel(null);
			else parent.setModel({ filterType: 'text', type: 'equals', filter: val });
			if (typeof parent.onBtApply === 'function') parent.onBtApply();
			params.api.onFilterChanged();
		});
	};
	sel.addEventListener('change', () => {
		const v = sel.value ? String(sel.value).toUpperCase() : '';
		applyTextEquals(v);
	});

	wrap.appendChild(sel);
	this.eGui = wrap;
	this.sel = sel;
};
CampaignStatusFloatingFilter.prototype.getGui = function () {
	return this.eGui;
};
CampaignStatusFloatingFilter.prototype.onParentModelChanged = function (parentModel) {
	if (!this.sel) return;
	if (!parentModel) {
		this.sel.value = '';
		return;
	}
	const v = String(parentModel.filter ?? '').toUpperCase();
	this.sel.value = v === 'ACTIVE' || v === 'PAUSED' ? v : '';
};

function AccountStatusFloatingFilter() {}
AccountStatusFloatingFilter.prototype.init = function (params) {
	this.params = params;
	const wrap = document.createElement('div');
	wrap.style.display = 'flex';
	wrap.style.alignItems = 'center';
	wrap.style.height = '100%';
	wrap.style.padding = '0 6px';

	const sel = document.createElement('select');
	sel.className = 'ag-input-field-input ag-text-field-input lion-ff-select--inputlike';
	sel.style.width = '100%';
	sel.style.height = '28px';
	sel.style.fontSize = '12px';
	sel.style.padding = '2px 8px';
	sel.style.boxSizing = 'border-box';

	[
		['', 'ALL'],
		['ACTIVE', 'ACTIVE'],
		['INATIVA PAGAMENTO', 'INATIVA PAGAMENTO'],
	].forEach(([v, t]) => {
		const o = document.createElement('option');
		o.value = v;
		o.textContent = t;
		sel.appendChild(o);
	});

	const applyFromModel = (model) => {
		if (!model) {
			sel.value = '';
			return;
		}
		const v = String(model.filter ?? '').toUpperCase();
		sel.value = v === 'ACTIVE' || v === 'INATIVA PAGAMENTO' ? v : '';
	};
	applyFromModel(params.parentModel);

	const applyTextEquals = (val) => {
		params.parentFilterInstance((parent) => {
			if (!val) parent.setModel(null);
			else parent.setModel({ filterType: 'text', type: 'equals', filter: val });
			if (typeof parent.onBtApply === 'function') parent.onBtApply();
			params.api.onFilterChanged();
		});
	};
	sel.addEventListener('change', () => {
		const v = sel.value ? String(sel.value).toUpperCase() : '';
		applyTextEquals(v);
	});

	wrap.appendChild(sel);
	this.eGui = wrap;
	this.sel = sel;
};
AccountStatusFloatingFilter.prototype.getGui = function () {
	return this.eGui;
};
AccountStatusFloatingFilter.prototype.onParentModelChanged = function (parentModel) {
	if (!this.sel) return;
	if (!parentModel) {
		this.sel.value = '';
		return;
	}
	const v = String(parentModel.filter ?? '').toUpperCase();
	this.sel.value = v === 'ACTIVE' || v === 'INATIVA PAGAMENTO' ? v : '';
};

function CurrencyMaskEditor() {}
CurrencyMaskEditor.prototype.init = function (params) {
	this.params = params;
	const startNumber =
		typeof params.value === 'number'
			? params.value
			: parseCurrencyFlexible(params.value, getAppCurrency());

	this.input = document.createElement('input');
	this.input.type = 'text';
	this.input.className = 'ag-input-field-input ag-text-field-input';
	this.input.style.width = '100%';
	this.input.style.height = '100%';
	this.input.style.boxSizing = 'border-box';
	this.input.style.padding = '2px 6px';
	this.input.autocomplete = 'off';
	this.input.inputMode = 'numeric';

	const fmt = (n) =>
		n == null || !Number.isFinite(n)
			? ''
			: new Intl.NumberFormat('pt-BR', {
					minimumFractionDigits: 2,
					maximumFractionDigits: 2,
			  }).format(n);

	const asNumberFromDigits = (digits) => {
		if (!digits) return null;
		const intCents = parseInt(digits, 10);
		if (!Number.isFinite(intCents)) return null;
		return intCents / 100;
	};

	const formatFromRawInput = () => {
		const raw = (this.input.value || '').replace(/\D+/g, '');
		const n = asNumberFromDigits(raw);
		this.input.value = n == null ? '' : fmt(n);
	};

	this.input.value = fmt(startNumber);

	this.onInput = () => {
		formatFromRawInput();
		this.input.setSelectionRange(this.input.value.length, this.input.value.length);
	};
	this.input.addEventListener('input', this.onInput);

	this.onKeyDown = (e) => {
		if (e.key === 'Escape') this.input.value = fmt(startNumber);
	};
	this.input.addEventListener('keydown', this.onKeyDown);
};
CurrencyMaskEditor.prototype.getGui = function () {
	return this.input;
};
CurrencyMaskEditor.prototype.afterGuiAttached = function () {
	this.input.focus();
	this.input.select();
};
CurrencyMaskEditor.prototype.getValue = function () {
	return this.input.value;
};
CurrencyMaskEditor.prototype.destroy = function () {
	this.input?.removeEventListener?.('input', this.onInput);
	this.input?.removeEventListener?.('keydown', this.onKeyDown);
};
CurrencyMaskEditor.prototype.isPopup = function () {
	return false;
};

/* ======= ColumnDefs ======= */
const columnDefs = [
	{
		headerName: 'Profile',
		field: 'profile_name',
		valueGetter: (p) => stripHtml(p.data?.profile_name),
		minWidth: 110,
		flex: 1.2,
		cellRenderer: profileCellRenderer,
		pinned: 'left',
		tooltipValueGetter: (p) => p.value || '',
	},
	{
		headerName: 'Identification',
		groupId: 'grp-id',
		marryChildren: true,
		openByDefault: true,
		children: [
			{
				headerName: 'BM',
				field: 'bc_name',
				valueGetter: (p) => stripHtml(p.data?.bc_name),
				minWidth: 100,
				flex: 1.0,
				autoHeight: true,
				wrapText: true,
				cellStyle: (p) =>
					p?.node?.level === 0 ? { fontSize: '13px', lineHeight: '1.6' } : null,
				tooltipValueGetter: (p) => p.value || '',
			},
			{
				headerName: 'Account',
				field: 'account_name',
				valueGetter: (p) => stripHtml(p.data?.account_name),
				minWidth: 100,
				autoHeight: true,
				flex: 1.3,
				wrapText: true,
				cellStyle: (p) =>
					p?.node?.level === 0 ? { fontSize: '13px', lineHeight: '1.6' } : null,
				tooltipValueGetter: (p) => p.value || '',
			},
		],
	},
	{
		headerName: 'Operation & Setup',
		groupId: 'grp-op',
		marryChildren: true,
		openByDefault: true,
		children: [
			{
				headerName: 'Account Status',
				field: 'account_status',
				minWidth: 110,
				flex: 0.7,
				cellRenderer: statusPillRenderer,
				filter: 'agTextColumnFilter',
				floatingFilter: true,
				floatingFilterComponent: AccountStatusFloatingFilter,
				floatingFilterComponentParams: { suppressFilterButton: true },
			},
			{
				headerName: 'Daily Limit',
				field: 'account_limit',
				valueGetter: (p) => toNumberBR(p.data?.account_limit),
				valueFormatter: currencyFormatter,
				minWidth: 80,
				flex: 0.8,
			},
			{
				headerName: 'Campaign Status',
				field: 'campaign_status',
				cellClass: ['lion-center-cell'],
				minWidth: 115,
				flex: 0.8,
				cellRenderer: StatusSliderRenderer,
				cellRendererParams: { interactiveLevels: [0, 1, 2], smallKnob: true },
				suppressKeyboardEvent: () => true,
				cellClassRules: { 'ag-cell-loading': (p) => isCellLoading(p, 'campaign_status') },
				filter: 'agTextColumnFilter',
				floatingFilter: true,
				floatingFilterComponent: CampaignStatusFloatingFilter,
				floatingFilterComponentParams: { suppressFilterButton: true },
			},
			{
				headerName: 'Budget',
				field: 'budget',
				editable: (p) => p.node?.level === 0 && !isCellLoading(p, 'budget'),
				cellEditor: CurrencyMaskEditor,
				valueParser: parseCurrencyInput,
				valueFormatter: currencyFormatter,
				minWidth: 100,
				flex: 0.6,
				cellClassRules: { 'ag-cell-loading': (p) => isCellLoading(p, 'budget') },
				onCellValueChanged: async (p) => {
					try {
						if (shouldSuppressCellChange(p, 'budget')) return;
						if ((p?.node?.level ?? 0) !== 0) return;
						const row = p?.data || {};
						const id = String(row.id ?? row.utm_campaign ?? '');
						if (!id) return;
						const currency = getAppCurrency();
						const oldN = parseCurrencyFlexible(p.oldValue, currency);
						const newN = parseCurrencyFlexible(p.newValue, currency);
						if (Number.isFinite(oldN) && Number.isFinite(newN) && oldN === newN) return;
						if (!Number.isFinite(newN) || newN < 0) {
							setCellSilently(p, 'budget', p.oldValue);
							showToast('Budget inválido', 'danger');
							return;
						}
						setCellLoading(p.node, 'budget', true);
						p.api.refreshCells({ rowNodes: [p.node], columns: ['budget'] });
						const okTest = await toggleFeature('budget', { id, value: newN });
						if (!okTest) {
							setCellSilently(p, 'budget', p.oldValue);
							p.api.refreshCells({ rowNodes: [p.node], columns: ['budget'] });
							return;
						}
						await updateCampaignBudgetBackend(id, newN);
						setCellSilently(p, 'budget', newN);
						p.api.refreshCells({ rowNodes: [p.node], columns: ['budget'] });
						showToast('Budget atualizado', 'success');
					} catch (e) {
						setCellSilently(p, 'budget', p.oldValue);
						showToast(`Erro ao salvar Budget: ${e?.message || e}`, 'danger');
					} finally {
						setCellLoading(p.node, 'budget', false);
						p.api.refreshCells({ rowNodes: [p.node], columns: ['budget'] });
					}
				},
			},
			{
				headerName: 'Bid',
				field: 'bid',
				editable: (p) => p.node?.level === 0 && !isCellLoading(p, 'bid'),
				cellEditor: CurrencyMaskEditor,
				valueParser: parseCurrencyInput,
				valueFormatter: currencyFormatter,
				minWidth: 70,
				flex: 0.6,
				cellClassRules: { 'ag-cell-loading': (p) => isCellLoading(p, 'bid') },
				onCellValueChanged: async (p) => {
					try {
						if (shouldSuppressCellChange(p, 'bid')) return;
						if ((p?.node?.level ?? 0) !== 0) return;
						const row = p?.data || {};
						const id = String(row.id ?? row.utm_campaign ?? '');
						if (!id) return;
						const currency = getAppCurrency();
						const oldN = parseCurrencyFlexible(p.oldValue, currency);
						const newN = parseCurrencyFlexible(p.newValue, currency);
						if (Number.isFinite(oldN) && Number.isFinite(newN) && oldN === newN) return;
						if (!Number.isFinite(newN) || newN < 0) {
							setCellSilently(p, 'bid', p.oldValue);
							showToast('Bid inválido', 'danger');
							return;
						}
						setCellLoading(p.node, 'bid', true);
						p.api.refreshCells({ rowNodes: [p.node], columns: ['bid'] });
						const okTest = await toggleFeature('bid', { id, value: newN });
						if (!okTest) {
							setCellSilently(p, 'bid', p.oldValue);
							p.api.refreshCells({ rowNodes: [p.node], columns: ['bid'] });
							return;
						}
						await updateCampaignBidBackend(id, newN);
						setCellSilently(p, 'bid', newN);
						p.api.refreshCells({ rowNodes: [p.node], columns: ['bid'] });
						showToast('Bid atualizado', 'success');
					} catch (e) {
						setCellSilently(p, 'bid', p.oldValue);
						showToast(`Erro ao salvar Bid: ${e?.message || e}`, 'danger');
					} finally {
						setCellLoading(p.node, 'bid', false);
						p.api.refreshCells({ rowNodes: [p.node], columns: ['bid'] });
					}
				},
			},
			{
				headerName: 'Ads',
				field: '_ads',
				minWidth: 70,
				maxWidth: 120,
				tooltipValueGetter: (p) => stripHtml(p.data?.xabu_ads),
				cellRenderer: chipFractionBadgeRenderer,
			},
			{
				headerName: 'Adsets',
				field: '_adsets',
				minWidth: 84,
				maxWidth: 130,
				tooltipValueGetter: (p) => stripHtml(p.data?.xabu_adsets),
				cellRenderer: chipFractionBadgeRenderer,
			},
		],
	},
	{
		headerName: 'Metrics & Revenue',
		groupId: 'grp-metrics-rev',
		marryChildren: true,
		openByDefault: true,
		children: [
			{
				headerName: 'Imp',
				field: 'impressions',
				valueFormatter: intFormatter,
				minWidth: 70,
				flex: 0.7,
			},
			{
				headerName: 'Clicks',
				field: 'clicks',
				valueFormatter: intFormatter,
				minWidth: 80,
				flex: 0.6,
			},
			{
				headerName: 'Visitors',
				field: 'visitors',
				valueFormatter: intFormatter,
				minWidth: 88,
				flex: 0.6,
			},
			{
				headerName: 'CPC',
				field: 'cpc',
				valueGetter: (p) => toNumberBR(p.data?.cpc),
				valueFormatter: currencyFormatter,
				minWidth: 70,
				flex: 0.6,
			},
			{
				headerName: 'Convs',
				field: 'conversions',
				valueFormatter: intFormatter,
				minWidth: 80,
				flex: 0.6,
			},
			{
				headerName: 'CPA FB',
				field: 'cpa_fb',
				valueGetter: (p) => toNumberBR(p.data?.cpa_fb),
				valueFormatter: currencyFormatter,
				minWidth: 70,
				flex: 0.6,
			},
			{
				headerName: 'Real Convs',
				field: 'real_conversions',
				valueGetter: (p) => toNumberBR(p.data?.real_conversions),
				valueFormatter: intFormatter,
				minWidth: 80,
				flex: 0.7,
			},
			{
				headerName: 'Real CPA',
				field: 'real_cpa',
				valueGetter: (p) => toNumberBR(p.data?.real_cpa),
				valueFormatter: currencyFormatter,
				minWidth: 80,
				flex: 0.6,
			},
			{
				headerName: 'Spend',
				field: 'spent',
				valueGetter: (p) => toNumberBR(p.data?.spent),
				valueFormatter: currencyFormatter,
				minWidth: 90,
				pinned: 'right',
				flex: 0.8,
			},
			{
				headerName: 'Facebook Revenue',
				field: 'fb_revenue',
				valueGetter: (p) => toNumberBR(p.data?.fb_revenue),
				valueFormatter: currencyFormatter,
				minWidth: 100,
				flex: 0.8,
			},
			{
				headerName: 'Push Revenue',
				field: 'push_revenue',
				valueGetter: (p) => toNumberBR(p.data?.push_revenue),
				valueFormatter: currencyFormatter,
				minWidth: 94,
				flex: 0.8,
			},
			{
				headerName: 'Revenue',
				field: 'revenue',
				valueGetter: (p) => stripHtml(p.data?.revenue),
				minWidth: 115,
				flex: 1.0,
				pinned: 'right',
				wrapText: true,
				autoHeight: false,
				cellRenderer: revenueCellRenderer,
				tooltipValueGetter: (p) => p.data?.revenue || '',
			},
			{
				headerName: 'MX',
				field: 'mx',
				minWidth: 80,
				pinned: 'right',
				valueGetter: (p) => stripHtml(p.data?.mx),
				flex: 0.7,
			},
			{
				headerName: 'Profit',
				field: 'profit',
				pinned: 'right',
				valueGetter: (p) => toNumberBR(p.data?.profit),
				valueFormatter: currencyFormatter,
				minWidth: 95,
				flex: 0.8,
			},
		],
	},
];

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
		api.setState(saved, GRID_STATE_IGNORE_ON_RESTORE);
		return true;
	} catch (e) {
		console.warn('[GridState] restore failed:', e);
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
			console.warn('Grid API ainda não disponível');
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
		const bag = readPresets();
		bag[name] = { v: PRESET_VERSION, name, createdAt: Date.now(), grid: state };
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
				console.log(`[Preset] Auto-aplicado: "${activePreset}"`);
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

/* =========================================
 * 19) Normalizadores (TreeData)
 * =======================================*/
function normalizeCampaignRow(r) {
	return {
		__nodeType: 'campaign',
		__groupKey: String(r.utm_campaign || r.id || ''),
		__label: stripHtml(r.campaign_name || '(sem nome)'),
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

/* =========================================
 * 20) Clipboard
 * =======================================*/
async function copyToClipboard(text) {
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

/* =========================================
 * 21) Grid (Tree Data + SSRM)
 * =======================================*/
function makeGrid() {
	const AG = getAgGrid();
	const gridDiv = document.getElementById('lionGrid');
	if (!gridDiv) {
		console.error('[LionGrid] #lionGrid não encontrado');
		return null;
	}
	gridDiv.classList.add('ag-theme-quartz');

	const autoGroupColumnDef = {
		headerName: 'Campaign',
		colId: 'campaign',
		filter: 'agTextColumnFilter',
		floatingFilter: true,
		sortable: false,
		wrapText: true,
		autoHeight: false,
		minWidth: 270,
		pinned: 'left',
		cellClass: (p) => ['camp-root', 'camp-child', 'camp-grand'][Math.min(p?.node?.level ?? 0, 2)],
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
		getRowId: (p) => {
			if (p.data?.__nodeType === 'campaign') return `c:${p.data.__groupKey}`;
			if (p.data?.__nodeType === 'adset') return `s:${p.data.__groupKey}`;
			if (p.data?.__nodeType === 'ad')
				return `a:${p.data.id || p.data.story_id || p.data.__label}`;
			return Math.random().toString(36).slice(2);
		},

		columnDefs: [].concat(columnDefs),
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

		rowHeight: 60,
		animateRows: true,
		sideBar: { toolPanels: ['columns', 'filters'], defaultToolPanel: null, position: 'right' },
		theme: createAgTheme(),

		getContextMenuItems: (params) => {
			const d = params.node?.data || {};
			const isCampaign = params.node?.level === 0;
			const items = [];
			items.push('cut', 'copy', 'copyWithHeaders', 'copyWithGroupHeaders', 'export', 'separator');
			if (isCampaign) {
				const label = d.__label || d.campaign_name || '';
				const utm = d.utm_campaign || '';
				if (label)
					items.push({
						name: 'Copiar Campaign',
						action: () => copyToClipboard(label),
						icon: '<span class="ag-icon ag-icon-copy"></span>',
					});
				if (utm)
					items.push({
						name: 'Copiar UTM',
						action: () => copyToClipboard(utm),
						icon: '<span class="ag-icon ag-icon-copy"></span>',
					});
			}
			return items;
		},

		onCellClicked(params) {
			if (params?.node?.level > 0) return;
			const isAutoGroupCol =
				(typeof params.column?.isAutoRowGroupColumn === 'function' &&
					params.column.isAutoRowGroupColumn()) ||
				params.colDef?.colId === 'ag-Grid-AutoColumn' ||
				!!params.colDef?.showRowGroup ||
				params?.column?.getColId?.() === 'campaign';
			const clickedExpanderOrCheckbox = !!params.event?.target?.closest?.(
				'.ag-group-expanded, .ag-group-contracted, .ag-group-checkbox'
			);
			if (
				isAutoGroupCol &&
				!clickedExpanderOrCheckbox &&
				params?.data?.__nodeType === 'campaign'
			) {
				const label = params.data.__label || '(sem nome)';
				showKTModal({ title: 'Campaign', content: label });
				return;
			}
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
			const vfmt = params.valueFormatted;
			let display;
			if (vfmt != null && vfmt !== '') display = String(vfmt);
			else {
				const val = params.value;
				if (typeof val === 'string') display = stripHtml(val);
				else if (val == null) display = '';
				else if (
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
							: new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
				} else if (
					['impressions', 'clicks', 'visitors', 'conversions', 'real_conversions'].includes(
						field
					)
				) {
					const n = Number(val);
					display = Number.isFinite(n) ? intFmt.format(n) : String(val);
				} else if (field === 'account_status' || field === 'campaign_status') {
					display = strongText(String(val || ''));
				} else display = String(val);
			}
			const title = params.colDef?.headerName || 'Detalhes';
			showKTModal({ title, content: display || '(vazio)' });
		},

		onGridReady(params) {
			applySavedStateIfAny(params.api);

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

						// =========================================
						// Nível 0 — CAMPANHAS
						// -> Carrega TUDO uma única vez e fatia local
						// -> Totais calculados no FRONT (ROOT_CACHE.rowsRaw)
						// =========================================
						if (groupKeys.length === 0) {
							// carrega cache se necessário
							if (!ROOT_CACHE) {
								// pede tudo de uma vez (usa um endRow bem alto para compat)
								const hardEnd = 1000000;
								let res = await fetch(ENDPOINTS.SSRM, {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									credentials: 'same-origin',
									body: JSON.stringify({
										startRow: 0,
										endRow: hardEnd,
										sortModel: sortModel || [],
										filterModel: filterModelWithGlobal,
									}),
								});

								if (!res.ok) {
									const qs = new URLSearchParams({
										startRow: '0',
										endRow: String(hardEnd),
										sortModel: JSON.stringify(sortModel || []),
										filterModel: JSON.stringify(filterModelWithGlobal || {}),
									});
									res = await fetch(`${ENDPOINTS.SSRM}&${qs.toString()}`, {
										credentials: 'same-origin',
									});
								}

								const data = await res.json().catch(() => ({ rows: [], lastRow: 0 }));
								const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
								const rowsNorm = rowsRaw.map(normalizeCampaignRow);
								ROOT_CACHE = { rowsRaw, rowsNorm };
							}

							// fatia local conforme solicitado pela store
							const slice = ROOT_CACHE.rowsNorm.slice(
								startRow,
								Math.min(endRow, ROOT_CACHE.rowsNorm.length)
							);
							const totalCount = ROOT_CACHE.rowsNorm.length;

							// calcula TOTAIS no front
							const totals = computeClientTotals(ROOT_CACHE.rowsRaw);
							const currency = getAppCurrency();
							const locale = currency === 'USD' ? 'en-US' : 'pt-BR';
							const nfCur = new Intl.NumberFormat(locale, { style: 'currency', currency });

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
							])
								pinnedTotal[k] = nfCur.format(Number(pinnedTotal[k]) || 0);
							for (const k of [
								'impressions',
								'clicks',
								'visitors',
								'conversions',
								'real_conversions',
							])
								pinnedTotal[k] = intFmt.format(Number(pinnedTotal[k]) || 0);
							if (typeof pinnedTotal.ctr === 'number')
								pinnedTotal.ctr = (pinnedTotal.ctr * 100).toFixed(2) + '%';

							// label (quantidade de campanhas)
							pinnedTotal.__label = `CAMPAIGNS: ${intFmt.format(totalCount)}`;

							// aplica pinned bottom row
							try {
								const targetApi = req.api ?? params.api;
								if (targetApi?.setPinnedBottomRowData)
									targetApi.setPinnedBottomRowData([pinnedTotal]);
								else targetApi?.setGridOption?.('pinnedBottomRowData', [pinnedTotal]);
							} catch (e) {
								console.warn('Erro ao aplicar pinned bottom row:', e);
							}

							req.success({ rowData: slice, rowCount: totalCount });
							return;
						}

						// =========================================
						// Nível 1 — ADSETS (continua SSRM/DRILL)
						// =========================================
						if (groupKeys.length === 1) {
							const campaignId = groupKeys[0];
							const qs = new URLSearchParams({
								campaign_id: campaignId,
								period: DRILL.period,
								startRow: String(startRow),
								endRow: String(endRow),
								sortModel: JSON.stringify(sortModel || []),
								filterModel: JSON.stringify(filterModelWithGlobal || {}),
							});
							const data = await fetchJSON(`${DRILL_ENDPOINTS.ADSETS}?${qs.toString()}`);
							const rows = (data.rows || []).map(normalizeAdsetRow);
							req.success({ rowData: rows, rowCount: data.lastRow ?? rows.length });
							return;
						}

						// =========================================
						// Nível 2 — ADS (continua SSRM/DRILL)
						// =========================================
						if (groupKeys.length === 2) {
							const adsetId = groupKeys[1];
							const qs = new URLSearchParams({
								adset_id: adsetId,
								period: DRILL.period,
								startRow: String(startRow),
								endRow: String(endRow),
								sortModel: JSON.stringify(sortModel || []),
								filterModel: JSON.stringify(filterModelWithGlobal || {}),
							});
							const data = await fetchJSON(`${DRILL_ENDPOINTS.ADS}?${qs.toString()}`);
							const rows = (data.rows || []).map(normalizeAdRow);
							req.success({ rowData: rows, rowCount: data.lastRow ?? rows.length });
							return;
						}

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
			? AG.createGrid(gridDiv, gridOptions)
			: new AG.Grid(gridDiv, gridOptions);

	const api = gridOptions.api || apiOrInstance;

	globalThis.LionGrid = globalThis.LionGrid || {};
	globalThis.LionGrid.api = api;
	globalThis.LionGrid.resetLayout = function () {
		try {
			sessionStorage.removeItem(GRID_STATE_KEY);
			api.setState({}, []);
			showToast('Layout Reset', 'info');
		} catch {}
	};

	return { api, gridDiv };
}

/* =========================================
 * 22) Page module (mount)
 * =======================================*/
const LionPage = (() => {
	let gridRef = null;
	function mount() {
		gridRef = makeGrid();
		const el = document.getElementById('pinToggle');
		if (el && !el.hasAttribute('data-init-bound')) {
			el.checked = true;
			el.addEventListener('change', () => togglePinnedColsFromCheckbox(false));
			el.setAttribute('data-init-bound', '1');
		}
		togglePinnedColsFromCheckbox(true); // silencioso no load
	}
	if (document.readyState !== 'loading') mount();
	else document.addEventListener('DOMContentLoaded', mount);
	return { mount };
})();
globalThis.LionGrid = globalThis.LionGrid || {};
