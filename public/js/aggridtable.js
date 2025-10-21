/* public/js/lion-grid.js */
const ENDPOINTS = { SSRM: '/api/ssrm/?clean=1' };
const DRILL_ENDPOINTS = { ADSETS: '/api/adsets/', ADS: '/api/ads/' };
const DRILL = { period: 'TODAY' };

/* ============ AG Grid boot/licença ============ */
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

/* ============ Helpers/formatters ============ */
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

const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const intFmt = new Intl.NumberFormat('pt-BR');

const currencyFormatter = (p) => {
	const n = toNumberBR(p.value);
	return n == null ? p.value ?? '' : brlFmt.format(n);
};

const intFormatter = (p) => {
	const n = toNumberBR(p.value);
	return n == null ? p.value ?? '' : intFmt.format(Math.round(n));
};

// fallback (hex) – independente de Tailwind
const FALLBACK_STYLE = {
	success: { bg: '#22c55e', fg: '#ffffff' }, // green-500
	primary: { bg: '#3b82f6', fg: '#ffffff' }, // blue-500
	danger: { bg: '#dc2626', fg: '#ffffff' }, // red-600
	warning: { bg: '#eab308', fg: '#111111' }, // yellow-500
	info: { bg: '#06b6d4', fg: '#ffffff' }, // cyan-500
	secondary: { bg: '#6b7280', fg: '#ffffff' }, // gray-500
	light: { bg: '#e5e7eb', fg: '#111111' }, // gray-200
	dark: { bg: '#1f2937', fg: '#ffffff' }, // gray-800
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

function statusPillRenderer(p) {
	const raw = p.value ?? '';
	if (isPinnedOrTotal(p) || !raw) {
		const span = document.createElement('span');
		span.textContent = stripHtml(raw) || '';
		return span;
	}
	const label = (strongText(raw) || stripHtml(raw) || '').toUpperCase();
	const color = pickStatusColor(label);
	const host = document.createElement('span');
	host.innerHTML = renderBadge(label, color);
	return host.firstElementChild;
}

function pickChipColorFromFraction(value) {
	const txt = stripHtml(value ?? '').trim();
	const m = txt.match(/^(\d+)\s*\/\s*(\d+)$/);
	if (!m) return { label: txt || '—', color: 'secondary' };
	const current = Number(m[1]);
	const total = Number(m[2]);
	if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
		return { label: `${current}/${total}`, color: 'secondary' };
	}
	if (current <= 1) return { label: `${current}/${total}`, color: 'success' }; // 0%
	const ratio = current / total;
	if (ratio > 0.5) return { label: `${current}/${total}`, color: 'danger' }; // >50%
	return { label: `${current}/${total}`, color: 'warning' }; // (0,50%]
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

/* ============ Modal simples (KTUI-like) ============ */
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

/* ============ Tema opcional ============ */
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

/* ============ Colunas ============ */
const defaultColDef = {
	sortable: true,
	filter: true,
	resizable: true,
	wrapHeaderText: true,
	autoHeaderHeight: false,
	enableRowGroup: true,
	enablePivot: true,
	enableValue: true,
};
function parseCurrencyInput(params) {
	return toNumberBR(params.newValue);
}
function isPinnedOrGroup(params) {
	return params?.node?.rowPinned || params?.node?.group;
}
function normalizeStatus(s) {
	const v = String(s || '').toUpperCase();
	if (v === 'ACTIVE') return 'ACTIVE';
	if (v === 'PAUSED') return 'PAUSED';
	if (v === 'DISABLED') return 'DISABLED';
	if (v === 'CLOSED') return 'CLOSED';
	return 'PAUSED';
}
async function toggleCampaignStatus(params) {
	if (isPinnedOrGroup(params)) return;
	if (params?.node?.level !== 0) return;
	if (params?.colDef?.field !== 'campaign_status') return;
	const row = params.data || {};
	const id = row.id;
	if (!id) return;
	const current = normalizeStatus(row.campaign_status);
	const next = current === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
	row.campaign_status = next;
	params.api.refreshCells({ rowNodes: [params.node], columns: ['campaign_status'], force: true });
}

/* Profile renderer */
function profileCellRenderer(params) {
	const raw = String(params?.value ?? '').trim();
	if (!raw) return '';
	const idx = raw.lastIndexOf(' - ');
	const name = idx > -1 ? raw.slice(0, idx).trim() : raw;
	const meta = idx > -1 ? raw.slice(idx + 3).trim() : '';
	const wrap = document.createElement('span');
	wrap.style.display = 'inline-flex';
	wrap.style.alignItems = 'baseline';
	wrap.style.gap = '8px';
	wrap.style.whiteSpace = 'nowrap';
	const nameEl = document.createElement('span');
	nameEl.textContent = name;
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

/* Revenue renderer (total + partes) */
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
	wrap.style.lineHeight = '1.1';
	wrap.style.gap = '2px';
	const totalEl = document.createElement('span');
	totalEl.textContent = total || '';
	wrap.appendChild(totalEl);
	if (parts.length === 2) {
		const metaText = document.createElement('span');
		metaText.textContent = `(${REVENUE_LABELS[0] || 'A'}: ${parts[0]} | ${
			REVENUE_LABELS[1] || 'B'
		}: ${parts[1]})`;
		metaText.style.fontSize = '11px';
		metaText.style.opacity = '0.75';
		wrap.appendChild(metaText);
	}
	return wrap;
}
// helper mínimo para GET/POST JSON
async function fetchJSON(url, opts) {
	const res = await fetch(url, {
		headers: { 'Content-Type': 'application/json' },
		credentials: 'same-origin',
		...opts,
	});
	// tenta parsear JSON mesmo em erro pra extrair msg do backend
	let data;
	try {
		data = await res.json();
	} catch {
		data = {};
	}
	if (!res.ok) throw new Error(data?.error || res.statusText || 'Request failed');
	return data;
}

function StatusSliderRenderer() {}

StatusSliderRenderer.prototype.init = function (p) {
	this.p = p;

	// params configuráveis na coluna
	const cfg = p.colDef?.cellRendererParams || {};
	const interactiveLevels = Array.isArray(cfg.interactiveLevels) ? cfg.interactiveLevels : [0];
	const smallKnob = !!cfg.smallKnob;

	const level = p?.node?.level ?? 0;
	const isInteractive = interactiveLevels.includes(level);

	// helper p/ pegar valor normalizado
	const getOn = () => {
		const raw = p.data?.campaign_status ?? p.data?.status ?? p.value;
		return String(raw || '').toUpperCase() === 'ACTIVE';
	};

	// só label quando não interativo/pinned
	if (isPinnedOrTotal(p) || !isInteractive) {
		this.eGui = document.createElement('span');
		this.eGui.textContent = strongText(String(p.value ?? ''));
		return;
	}

	const isOn = getOn();

	// estrutura
	const root = document.createElement('div');
	root.className = 'ag-status-pill';
	root.setAttribute('role', 'switch');
	root.setAttribute('tabindex', '0');
	root.setAttribute('aria-checked', String(isOn));

	const fill = document.createElement('div');
	fill.className = 'ag-status-fill';

	const knob = document.createElement('div');
	knob.className = 'ag-status-knob';
	if (smallKnob) knob.classList.add('ag-status-knob--sm');

	const label = document.createElement('div');
	label.className = 'ag-status-label';
	label.textContent = isOn ? 'ACTIVE' : 'PAUSED';

	root.append(fill, label, knob);
	this.eGui = root;

	// helpers visuais
	const maxX = () => root.clientWidth - root.clientHeight; // faixa útil
	const setProgress = (pgr) => {
		const pct = Math.max(0, Math.min(1, pgr));
		fill.style.width = pct * 100 + '%';
		knob.style.transform = `translateX(${pct * Math.max(0, maxX())}px)`;
		const on = pct >= 0.5;
		label.textContent = on ? 'ACTIVE' : 'PAUSED';
		root.setAttribute('aria-checked', String(on));
	};

	// garante posição correta depois do layout
	requestAnimationFrame(() => setProgress(isOn ? 1 : 0));

	// commit: atualiza ambos os campos, se existirem
	const commit = (on) => {
		const next = on ? 'ACTIVE' : 'PAUSED';
		if (p.data) {
			if ('campaign_status' in p.data) p.data.campaign_status = next;
			if ('status' in p.data) p.data.status = next;
		}
		setProgress(on ? 1 : 0);
		p.api.refreshCells({ rowNodes: [p.node], columns: [p.column.getId()], force: true });

		// toast apenas se foi interação do usuário (arraste válido)
		if (this._userInteracted && globalThis.Toastify) {
			Toastify({
				text: on ? 'Campanha ativada' : 'Campanha pausada',
				duration: 2200,
				close: true,
				gravity: 'bottom',
				position: 'right',
				style: {
					background: on
						? 'linear-gradient(90deg,#22c55e,#16a34a)'
						: 'linear-gradient(90deg,#06b6d4,#3b82f6)',
				},
				stopOnFocus: true,
			}).showToast();
		}
	};

	// ===== DRAG-ONLY (sem clique) =====
	const MOVE_THRESHOLD = 6; // px para considerar arraste
	let down = false,
		startX = 0,
		startOn = isOn,
		dragged = false;

	const onDown = (x, ev) => {
		down = true;
		dragged = false;
		this._userInteracted = false; // só vira true se passar do threshold
		startX = x;
		startOn = root.getAttribute('aria-checked') === 'true';
		if (ev) {
			ev.preventDefault();
			ev.stopPropagation();
		}
	};
	const onMove = (x) => {
		if (!down) return;
		const dx = x - startX;
		if (Math.abs(dx) > MOVE_THRESHOLD) {
			dragged = true;
			this._userInteracted = true;
			const p0 = startOn ? 1 : 0;
			const pgr = p0 + dx / Math.max(1, maxX());
			setProgress(pgr);
		}
	};
	const onUp = (x, ev) => {
		if (!down) return;
		down = false;

		if (!dragged) {
			// clique simples -> não faz nada
			setProgress(startOn ? 1 : 0);
			if (ev) {
				ev.preventDefault();
				ev.stopPropagation();
			}
			return;
		}

		const pct = parseFloat(fill.style.width) / 100;
		const finalOn = pct >= 0.5;

		if (finalOn !== startOn) commit(finalOn);
		else setProgress(startOn ? 1 : 0);

		setTimeout(() => (this._dragging = false), 0);
		if (ev) {
			ev.preventDefault();
			ev.stopPropagation();
		}
	};

	// listeners (bloqueando click simples)
	root.addEventListener('mousedown', (e) => onDown(e.clientX, e));
	window.addEventListener('mousemove', (e) => onMove(e.clientX));
	window.addEventListener('mouseup', (e) => onUp(e.clientX, e));

	root.addEventListener('touchstart', (e) => onDown(e.touches[0].clientX, e), { passive: false });
	window.addEventListener('touchmove', (e) => onMove(e.touches[0].clientX), { passive: true });
	window.addEventListener('touchend', (e) => onUp(e.changedTouches[0].clientX, e));

	root.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
	});
	root.addEventListener('keydown', (e) => {
		// opcional: bloqueia toggle por teclado (Space/Enter)
		if (e.code === 'Space' || e.code === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
		}
	});
};

StatusSliderRenderer.prototype.getGui = function () {
	return this.eGui;
};

StatusSliderRenderer.prototype.refresh = function (p) {
	const cfg = p.colDef?.cellRendererParams || {};
	const interactiveLevels = Array.isArray(cfg.interactiveLevels) ? cfg.interactiveLevels : [0];
	const level = p?.node?.level ?? 0;
	if (!this.eGui || isPinnedOrTotal(p) || !interactiveLevels.includes(level)) return false;

	const raw = p.data?.campaign_status ?? p.data?.status ?? p.value;
	const isOn = String(raw || '').toUpperCase() === 'ACTIVE';

	const fill = this.eGui.querySelector('.ag-status-fill');
	const knob = this.eGui.querySelector('.ag-status-knob');
	const label = this.eGui.querySelector('.ag-status-label');
	const maxX = () => this.eGui.clientWidth - this.eGui.clientHeight;

	// garante posição correta após refresh/layout
	requestAnimationFrame(() => {
		fill.style.width = (isOn ? 100 : 0) + '%';
		knob.style.transform = `translateX(${(isOn ? 1 : 0) * Math.max(0, maxX())}px)`;
		label.textContent = isOn ? 'ACTIVE' : 'PAUSED';
		this.eGui.setAttribute('aria-checked', String(isOn));
	});

	return true;
};

const columnDefs = [
	// Identificação
	{
		headerName: 'Profile',
		field: 'profile_name',
		valueGetter: (p) => stripHtml(p.data?.profile_name),
		minWidth: 180,
		flex: 1.2,
		cellRenderer: profileCellRenderer,
		pinned: 'left', // <- padrão ligado
		tooltipValueGetter: (p) => p.value || '',
	},
	{
		headerName: 'Business Center',
		field: 'bc_name',
		valueGetter: (p) => stripHtml(p.data?.bc_name),
		minWidth: 160,
		flex: 1.0,
		tooltipValueGetter: (p) => p.value || '',
	},
	{
		headerName: 'Account',
		field: 'account_name',
		valueGetter: (p) => stripHtml(p.data?.account_name),
		minWidth: 200,
		flex: 1.3,
		tooltipValueGetter: (p) => p.value || '',
	},
	{
		headerName: 'Account Status',
		field: 'account_status',
		minWidth: 160,
		flex: 0.7,
		cellRenderer: statusPillRenderer,
	},
	{
		headerName: 'Daily Limit',
		field: 'account_limit',
		type: 'rightAligned',
		valueGetter: (p) => toNumberBR(p.data?.account_limit),
		valueFormatter: currencyFormatter,
		minWidth: 120,
		flex: 0.8,
	},

	{
		headerName: 'UTM',
		field: 'utm_campaign',
		minWidth: 160,
		flex: 0.9,
		tooltipValueGetter: (p) => p.value || '',
	},

	{
		headerName: 'Bid',
		field: 'bid',
		type: 'rightAligned',
		editable: (p) => p.node?.level === 0,
		cellEditor: 'agNumberCellEditor',
		valueParser: parseCurrencyInput,
		valueFormatter: currencyFormatter,
		minWidth: 110,
		flex: 0.6,
	},
	{
		headerName: 'Campaign Status',
		field: 'campaign_status',
		minWidth: 160,
		flex: 0.8,
		cellRenderer: StatusSliderRenderer,
		cellRendererParams: {
			interactiveLevels: [0, 1, 2], // raiz + adsets + ads
			smallKnob: true, // bolinha menor
		},
		suppressKeyboardEvent: () => true, // (opcional) desliga navegação por teclado nessa célula
	},

	{
		headerName: 'Budget',
		field: 'budget',
		type: 'rightAligned',
		editable: (p) => p.node?.level === 0,
		cellEditor: 'agNumberCellEditor',
		valueParser: parseCurrencyInput,
		valueFormatter: currencyFormatter,
		minWidth: 110,
		flex: 0.6,
	},

	{
		headerName: 'Ads',
		field: '_ads',
		minWidth: 100,
		maxWidth: 120,
		tooltipValueGetter: (p) => stripHtml(p.data?.xabu_ads),
		cellRenderer: chipFractionBadgeRenderer,
	},
	{
		headerName: 'Adsets',
		field: '_adsets',
		minWidth: 110,
		maxWidth: 130,
		tooltipValueGetter: (p) => stripHtml(p.data?.xabu_adsets),
		cellRenderer: chipFractionBadgeRenderer,
	},

	{
		headerName: 'Impressions',
		field: 'impressions',
		type: 'rightAligned',
		valueFormatter: intFormatter,
		minWidth: 150,
		flex: 0.7,
	},
	{
		headerName: 'Clicks',
		field: 'clicks',
		type: 'rightAligned',
		valueFormatter: intFormatter,
		minWidth: 150,
		flex: 0.6,
	},
	{
		headerName: 'Visitors',
		field: 'visitors',
		type: 'rightAligned',
		valueFormatter: intFormatter,
		minWidth: 150,
		flex: 0.6,
	},
	{
		headerName: 'CPC',
		field: 'cpc',
		type: 'rightAligned',
		valueGetter: (p) => toNumberBR(p.data?.cpc),
		valueFormatter: currencyFormatter,
		minWidth: 100,
		flex: 0.6,
	},
	{
		headerName: 'Conversions',
		field: 'conversions',
		type: 'rightAligned',
		valueFormatter: intFormatter,
		minWidth: 150,
		flex: 0.6,
	},
	{
		headerName: 'CPA FB',
		field: 'cpa_fb',
		type: 'rightAligned',
		valueGetter: (p) => toNumberBR(p.data?.cpa_fb),
		valueFormatter: currencyFormatter,
		minWidth: 110,
		flex: 0.6,
	},
	{
		headerName: 'Real Conversions',
		field: 'real_conversions',
		type: 'rightAligned',
		valueGetter: (p) => toNumberBR(p.data?.real_conversions),
		valueFormatter: intFormatter,
		minWidth: 150,
		flex: 0.7,
	},
	{
		headerName: 'Real CPA',
		field: 'real_cpa',
		type: 'rightAligned',
		valueGetter: (p) => toNumberBR(p.data?.real_cpa),
		valueFormatter: currencyFormatter,
		minWidth: 110,
		flex: 0.6,
	},

	{
		headerName: 'Spend',
		field: 'spent',
		type: 'rightAligned',
		valueGetter: (p) => toNumberBR(p.data?.spent),
		valueFormatter: currencyFormatter,
		minWidth: 120,
		flex: 0.8,
	},
	{
		headerName: 'Facebook Revenue',
		field: 'fb_revenue',
		type: 'rightAligned',
		valueGetter: (p) => toNumberBR(p.data?.fb_revenue),
		valueFormatter: currencyFormatter,
		minWidth: 180,
		flex: 0.8,
	},
	{
		headerName: 'Push Revenue',
		field: 'push_revenue',
		type: 'rightAligned',
		valueGetter: (p) => toNumberBR(p.data?.push_revenue),
		valueFormatter: currencyFormatter,
		minWidth: 120,
		flex: 0.8,
	},

	{
		headerName: 'Revenue',
		field: 'revenue',
		valueGetter: (p) => stripHtml(p.data?.revenue),
		minWidth: 200,
		flex: 1.0,
		wrapText: true,
		autoHeight: false,
		cellRenderer: revenueCellRenderer,
		tooltipValueGetter: (p) => p.data?.revenue || '',
	},

	{
		headerName: 'MX',
		field: 'mx',
		minWidth: 120,
		valueGetter: (p) => stripHtml(p.data?.mx),
		flex: 0.7,
	},
	{
		headerName: 'Profit',
		field: 'profit',
		type: 'rightAligned',
		valueGetter: (p) => toNumberBR(p.data?.profit),
		valueFormatter: currencyFormatter,
		minWidth: 120,
		flex: 0.8,
	},
];

/* ============ Normalizadores tree ============ */
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

/* ============ Grid (Tree Data + SSRM) ============ */
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
		sortable: false,
		wrapText: true,
		minWidth: 350,
		pinned: 'left', // <- padrão ligado
		cellStyle: (p) => (p?.node?.level === 0 ? { fontSize: '12px', lineHeight: '1.6' } : null),
		cellRendererParams: { suppressCount: true, innerRenderer: (p) => p.data?.__label || '' },
	};

	const gridOptions = {
		context: { showToast: (msg, type) => Toastify({ text: msg }).showToast() },

		// onCellDoubleClicked: toggleCampaignStatus,
		rowModelType: 'serverSide',
		cacheBlockSize: 200,
		maxBlocksInCache: 4,
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
			checkboxes: true,
			headerCheckbox: true,
			selectionColumn: { width: 80, pinned: 'left', suppressHeaderFilterButton: true },
		},
		rowHeight: 42,
		animateRows: true,
		sideBar: { toolPanels: ['columns', 'filters'], defaultToolPanel: null, position: 'right' },
		theme: createAgTheme(),

		onCellClicked(params) {
			if (params?.node?.level > 0) return;
			const isAutoGroupCol =
				(typeof params.column?.isAutoRowGroupColumn === 'function' &&
					params.column.isAutoRowGroupColumn()) ||
				params.colDef?.colId === 'ag-Grid-AutoColumn' ||
				!!params.colDef?.showRowGroup;
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
					display = n == null ? '' : brlFmt.format(n);
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

						// Nível 0 => campanhas
						if (groupKeys.length === 0) {
							let res = await fetch(ENDPOINTS.SSRM, {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ startRow, endRow, sortModel, filterModel }),
								credentials: 'same-origin',
							});
							if (!res.ok) {
								const qs = new URLSearchParams({
									startRow: String(startRow),
									endRow: String(endRow),
									sortModel: JSON.stringify(sortModel || []),
									filterModel: JSON.stringify(filterModel || {}),
								});
								res = await fetch(`${ENDPOINTS.SSRM}&${qs.toString()}`, {
									credentials: 'same-origin',
								});
							}
							const data = await res.json().catch(() => ({ rows: [], lastRow: 0 }));
							const totals = data?.totals || {};
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
								pinnedTotal[k] = brlFmt.format(Number(pinnedTotal[k]) || 0);
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

							const rows = (data.rows || []).map(normalizeCampaignRow);
							try {
								const api = params.api;
								if (api?.setPinnedBottomRowData)
									api.setPinnedBottomRowData([pinnedTotal]);
								else params.api?.setGridOption?.('pinnedBottomRowData', [pinnedTotal]);
							} catch (e) {
								console.warn('Erro ao aplicar pinned bottom row:', e);
							}

							req.success({ rowData: rows, rowCount: data.lastRow ?? -1 });
							return;
						}

						// Nível 1 => adsets
						if (groupKeys.length === 1) {
							const campaignId = groupKeys[0];
							const qs = new URLSearchParams({
								campaign_id: campaignId,
								period: DRILL.period,
								startRow: String(startRow),
								endRow: String(endRow),
							});
							const data = await fetchJSON(`${DRILL_ENDPOINTS.ADSETS}?${qs.toString()}`);
							const rows = (data.rows || []).map(normalizeAdsetRow);
							req.success({ rowData: rows, rowCount: data.lastRow ?? rows.length });
							return;
						}

						// Nível 2 => ads
						if (groupKeys.length === 2) {
							const adsetId = groupKeys[1];
							const qs = new URLSearchParams({
								adset_id: adsetId,
								period: DRILL.period,
								startRow: String(startRow),
								endRow: String(endRow),
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
		},
	};

	const apiOrInstance =
		typeof AG.createGrid === 'function'
			? AG.createGrid(gridDiv, gridOptions)
			: new AG.Grid(gridDiv, gridOptions);

	const api = gridOptions.api || apiOrInstance;

	// expõe a API pra outras funções (toggle)
	globalThis.LionGrid = globalThis.LionGrid || {};
	globalThis.LionGrid.api = api;

	return { api, gridDiv };
}

/* ============ Toast simples (Toastify) ============ */
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

/* ============ Toggle de colunas pinadas ============ */
// tenta descobrir o ID da coluna de seleção
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

function togglePinnedColsFromCheckbox() {
	const api = globalThis.LionGrid?.api;
	if (!api) return;

	const el = document.getElementById('pinToggle');
	if (!el) return;
	const checked = !!el.checked;

	const selectionColId = getSelectionColId(api);

	const base = [
		{ colId: 'ag-Grid-AutoColumn', pinned: checked ? 'left' : null },
		{ colId: 'profile_name', pinned: checked ? 'left' : null },
	];
	if (selectionColId) base.push({ colId: selectionColId, pinned: checked ? 'left' : null });

	api.applyColumnState({ state: base, defaultState: { pinned: null } });
	showToast(
		checked ? 'Colunas fixadas à esquerda' : 'Colunas desfixadas',
		checked ? 'success' : 'info'
	);
}

/* ============ Page module ============ */
const LionPage = (() => {
	let gridRef = null;
	function mount() {
		gridRef = makeGrid();

		// liga o checkbox
		const el = document.getElementById('pinToggle');
		if (el) {
			// estado inicial (se colunas começam pinadas, deixe marcado)
			if (!el.hasAttribute('data-init-bound')) {
				el.checked = true; // seu default é pinado
				el.addEventListener('change', togglePinnedColsFromCheckbox);
				el.setAttribute('data-init-bound', '1');
			}
		}

		// aplica o estado atual do checkbox imediatamente
		togglePinnedColsFromCheckbox();
	}

	if (document.readyState !== 'loading') mount();
	else document.addEventListener('DOMContentLoaded', mount);

	return { mount };
})();
globalThis.LionGrid = globalThis.LionGrid || {};
