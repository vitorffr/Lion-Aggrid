/* public/js/lion-grid.js */

function getAgGrid() {
	const AG = globalThis.agGrid;
	if (!AG) {
		throw new Error('AG Grid UMD não carregado. Verifique a ORDEM dos scripts e o path do CDN.');
	}
	return AG;
}

// Aplica licença Enterprise antes de criar a grid
(function applyAgGridLicense() {
	try {
		const AG = getAgGrid();
		const LM = AG.LicenseManager || AG?.enterprise?.LicenseManager;
		const key = document.querySelector('meta[name="hs-ag"]')?.content || '';
		if (key && LM?.setLicenseKey) LM.setLicenseKey(key);
	} catch {}
})();

// ==================== Helpers ====================
async function fetchJSON(url, options = {}) {
	const { timeout = 12000, ...rest } = options;
	const ctrl = new AbortController();
	const to = setTimeout(() => ctrl.abort(), timeout);
	try {
		const res = await fetch(url, {
			signal: ctrl.signal,
			headers: { 'Content-Type': 'application/json' },
			...rest,
		});
		const type = res.headers.get('content-type') || '';
		const isJSON = type.includes('application/json');
		const body = isJSON ? await res.json() : await res.text();
		if (!res.ok) {
			const message = isJSON
				? body?.error || body?.message || res.statusText
				: typeof body === 'string'
				? body
				: res.statusText;
			const err = new Error(message);
			err.status = res.status;
			err.payload = body;
			throw err;
		}
		return body;
	} finally {
		clearTimeout(to);
	}
}

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

// "R$ 1.618,65" -> 1618.65  | "-" -> null
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

// Renderers no front (sem HTML vindo do back)
const statusRenderer = (p) => {
	const txt = strongText(p.value || '');
	const span = document.createElement('span');
	const active = String(txt).toUpperCase() === 'ACTIVE';
	span.className = 'badge ' + (active ? 'badge--success' : 'badge--secondary');
	span.textContent = txt || '-';
	return span;
};

// ==================== Tema (opcional) ====================
function createAgTheme() {
	const AG = getAgGrid();
	const { themeQuartz, iconSetMaterial } = AG;
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

// ==================== Grid ====================
function makeGrid() {
	const AG = getAgGrid();
	const gridDiv = document.getElementById('lionGrid');
	if (!gridDiv) {
		console.error('[LionGrid] #lionGrid não encontrado');
		return null;
	}
	gridDiv.classList.add('ag-theme-quartz');

	// estilos mínimos para badge
	const style = document.createElement('style');
	style.textContent = `
    .badge{display:inline-block;padding:2px 6px;border-radius:6px;font-size:11px;font-weight:600}
    .badge--success{background:#e8f7ef;color:#0f8a4b}
    .badge--secondary{background:#eee;color:#333}
  `;
	document.head.appendChild(style);
	// ===== Helpers p/ parsing/format =====
	const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
	const INT = new Intl.NumberFormat('pt-BR');

	function stripHtml(s) {
		return String(s ?? '')
			.replace(/<[^>]*>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	}

	// "R$ 1.618,65"  | " -R$ 1,00 " | "2.360,73" -> number
	function toNumberBR(s) {
		if (s == null) return null;
		const raw = String(s).trim();
		if (!raw) return null;
		const sign = raw.includes('-') ? -1 : 1;
		const only = raw
			.replace(/[^\d,.-]/g, '')
			.replace(/\./g, '')
			.replace(',', '.');
		const n = Number(only);
		return Number.isFinite(n) ? sign * n : null;
	}

	function currencyFormatter(p) {
		const v = p.value;
		if (v == null || Number.isNaN(v)) return '';
		return BRL.format(v);
	}

	function intFormatter(p) {
		const v = Number(p.value);
		if (!Number.isFinite(v)) return '';
		return INT.format(v);
	}

	// extrai o texto (e uma "classe de cor") a partir do HTML dos status
	function parseBadgeHtml(html) {
		const txt = stripHtml(html).toUpperCase(); // ACTIVE / INACTIVE …
		const lower = txt.toLowerCase();
		let color = 'secondary';
		if (/(success|active|ok|ativo)/i.test(html) || /(success|active|ok|ativo)/i.test(lower))
			color = 'success';
		else if (
			/(danger|error|inactive|inativo|blocked|ban)/i.test(html) ||
			/(danger|error|inactive|inativo|blocked|ban)/i.test(lower)
		)
			color = 'danger';
		else if (/(warning|pending|aguard|hold)/i.test(html) || /(warning|pending)/i.test(lower))
			color = 'warning';
		else if (/(info)/i.test(html)) color = 'info';
		return { label: txt || '—', color };
	}

	const COLOR_CLASS = {
		success: 'bg-green-500 text-white',
		danger: 'bg-red-600 text-white',
		warning: 'bg-yellow-500 text-black',
		info: 'bg-cyan-500 text-white',
		secondary: 'bg-gray-500 text-white',
	};

	function statusRenderer(p) {
		const { label, color } = parseBadgeHtml(p.value);
		const span = document.createElement('span');
		span.className = `px-2 py-[2px] rounded-full text-xs font-semibold ${
			COLOR_CLASS[color] || COLOR_CLASS.secondary
		}`;
		span.textContent = label;
		return span;
	}

	// "0/3" em chip
	function chipCountRenderer(p) {
		const txt = stripHtml(p.value); // deve virar "0/3"
		const span = document.createElement('span');
		span.className = `px-2 py-[2px] rounded-full text-xs font-semibold ${COLOR_CLASS.success}`;
		span.textContent = txt || '—';
		return span;
	}

	// checkbox “selecionar linha”
	function selectCellRenderer(p) {
		const id = p?.data?.id || '';
		const wrap = document.createElement('label');
		wrap.style.display = 'flex';
		wrap.style.alignItems = 'center';
		wrap.style.height = '100%';

		const input = document.createElement('input');
		input.type = 'checkbox';
		input.name = 'selected-campaigns';
		input.dataset.selectId = id;
		input.style.width = '18px';
		input.style.height = '18px';
		input.addEventListener('change', (e) => {
			// se quiser, dispare um evento global aqui
			// window.dispatchEvent(new CustomEvent('row-select', { detail: { id, checked: e.target.checked } }));
		});

		wrap.appendChild(input);
		return wrap;
	}
	// ===== Columns (na ordem do layout legado) =====
	const columnDefs = [
		{
			headerName: '',
			checkboxSelection: true,
			headerCheckboxSelection: true,
			width: 30,
			pinned: 'left',
			suppressHeaderFilterButton: true,
		},
		{
			headerName: 'Perfil',
			field: 'profile_name',
			valueGetter: (p) => stripHtml(p.data?.profile_name),
			minWidth: 180,
			flex: 1.2,
			tooltipValueGetter: (p) => p.value || '',
		},

		// 2) BM
		{
			headerName: 'BM',
			field: 'bc_name',
			valueGetter: (p) => stripHtml(p.data?.bc_name),
			minWidth: 160,
			flex: 1.0,
			tooltipValueGetter: (p) => p.value || '',
		},

		// 3) Conta
		{
			headerName: 'Conta',
			field: 'account_name',
			valueGetter: (p) => stripHtml(p.data?.account_name),
			minWidth: 200,
			flex: 1.3,
			tooltipValueGetter: (p) => p.value || '',
		},

		// 4) Status (conta)
		{
			headerName: 'Status',
			field: 'account_status',
			cellRenderer: statusRenderer,
			minWidth: 140,
			flex: 0.7,
		},

		// 5) Limite Diário
		{
			headerName: 'Limite Diário',
			field: 'account_limit',
			type: 'rightAligned',
			valueGetter: (p) => toNumberBR(p.data?.account_limit),
			valueFormatter: currencyFormatter,
			minWidth: 120,
			flex: 0.8,
		},

		// 6) Campanha
		{
			headerName: 'Campanha',
			field: 'campaign_name',
			valueGetter: (p) => stripHtml(p.data?.campaign_name),
			minWidth: 260,
			flex: 1.6,
			tooltipValueGetter: (p) => p.value || '',
		},

		// 7) utm_camp
		{
			headerName: 'utm_camp',
			field: 'utm_campaign',
			minWidth: 160,
			flex: 0.9,
			tooltipValueGetter: (p) => p.value || '',
		},

		// 9) Bid
		{
			headerName: 'Bid',
			field: 'bid',
			type: 'rightAligned',
			valueGetter: (p) => toNumberBR(p.data?.bid),
			valueFormatter: currencyFormatter,
			minWidth: 110,
			flex: 0.6,
		},

		// 10) Status Campanha
		{
			headerName: 'Status Campanha',
			field: 'campaign_status',
			cellRenderer: statusRenderer,
			minWidth: 160,
			flex: 0.8,
		},

		// 11) Orçamento
		{
			headerName: 'Orçamento',
			field: 'budget',
			type: 'rightAligned',
			valueGetter: (p) => toNumberBR(p.data?.budget),
			valueFormatter: currencyFormatter,
			minWidth: 120,
			flex: 0.7,
		},

		// 12) Xabu Ads
		{
			headerName: 'Xabu Ads',
			field: 'xabu_ads',
			minWidth: 110,
			maxWidth: 140,
			cellRenderer: chipCountRenderer,
			tooltipValueGetter: (p) => stripHtml(p.data?.xabu_ads),
		},

		// 13) Xabu Adsets
		{
			headerName: 'Xabu Adsets',
			field: 'xabu_adsets',
			minWidth: 120,
			maxWidth: 150,
			cellRenderer: chipCountRenderer,
			tooltipValueGetter: (p) => stripHtml(p.data?.xabu_adsets),
		},

		// 14) Imp
		{
			headerName: 'Imp',
			field: 'impressions',
			type: 'rightAligned',
			valueFormatter: intFormatter,
			minWidth: 110,
			flex: 0.7,
		},

		// 15) Clicks
		{
			headerName: 'Clicks',
			field: 'clicks',
			type: 'rightAligned',
			valueFormatter: intFormatter,
			minWidth: 100,
			flex: 0.6,
		},

		// 16) Visitors
		{
			headerName: 'Visitors',
			field: 'visitors',
			type: 'rightAligned',
			valueFormatter: intFormatter,
			minWidth: 100,
			flex: 0.6,
		},

		// 17) CPC
		{
			headerName: 'CPC',
			field: 'cpc',
			type: 'rightAligned',
			valueGetter: (p) => toNumberBR(p.data?.cpc),
			valueFormatter: currencyFormatter,
			minWidth: 100,
			flex: 0.6,
		},

		// 18) Convs
		{
			headerName: 'Convs',
			field: 'conversions',
			type: 'rightAligned',
			valueFormatter: intFormatter,
			minWidth: 100,
			flex: 0.6,
		},

		// 19) CPA FB
		{
			headerName: 'CPA FB',
			field: 'cpa_fb',
			type: 'rightAligned',
			valueGetter: (p) => toNumberBR(p.data?.cpa_fb),
			valueFormatter: currencyFormatter,
			minWidth: 110,
			flex: 0.6,
		},

		// 20) Real Convs
		{
			headerName: 'Real Convs',
			field: 'real_conversions',
			type: 'rightAligned',
			valueGetter: (p) => Number(stripHtml(p.data?.real_conversions) || NaN),
			valueFormatter: intFormatter,
			minWidth: 120,
			flex: 0.7,
		},

		// 21) CPA Real
		{
			headerName: 'CPA Real',
			field: 'real_cpa',
			type: 'rightAligned',
			valueGetter: (p) => toNumberBR(p.data?.real_cpa),
			valueFormatter: currencyFormatter,
			minWidth: 110,
			flex: 0.6,
		},

		// 22) Gasto
		{
			headerName: 'Gasto',
			field: 'spent',
			type: 'rightAligned',
			valueGetter: (p) => toNumberBR(p.data?.spent),
			valueFormatter: currencyFormatter,
			minWidth: 120,
			flex: 0.8,
		},

		// 23) Feito fb
		{
			headerName: 'Feito fb',
			field: 'fb_revenue',
			type: 'rightAligned',
			valueGetter: (p) => toNumberBR(p.data?.fb_revenue),
			valueFormatter: currencyFormatter,
			minWidth: 120,
			flex: 0.8,
		},

		// 24) Feito psh
		{
			headerName: 'Feito psh',
			field: 'push_revenue',
			type: 'rightAligned',
			valueGetter: (p) => toNumberBR(p.data?.push_revenue),
			valueFormatter: currencyFormatter,
			minWidth: 120,
			flex: 0.8,
		},

		// 25) Feito (completo)
		{
			headerName: 'Feito',
			field: 'revenue',
			valueGetter: (p) => stripHtml(p.data?.revenue),
			minWidth: 220,
			flex: 1.2,
			tooltipValueGetter: (p) => p.value || '',
		},

		// 26) MX
		{
			headerName: 'MX',
			field: 'mx',
			minWidth: 120,
			valueGetter: (p) => stripHtml(p.data?.mx),
			flex: 0.7,
		},

		// 27) Lucro
		{
			headerName: 'Lucro',
			field: 'profit',
			type: 'rightAligned',
			valueGetter: (p) => toNumberBR(p.data?.profit),
			valueFormatter: currencyFormatter,
			minWidth: 120,
			flex: 0.8,
		},
	];

	const defaultColDef = {
		sortable: true,
		filter: true,
		resizable: true,
		tooltipShowDelay: 200,
		tooltipHideDelay: 80,
		wrapHeaderText: true,
		autoHeaderHeight: false,
		enableRowGroup: true,
		enablePivot: true,
		enableValue: true,
	};

	const gridOptions = {
		columnDefs,
		defaultColDef,
		rowSelection: 'multiple',
		suppressRowClickSelection: true,
		rowData: [],
		pagination: true,
		paginationPageSize: 50,
		animateRows: true,
		sideBar: { toolPanels: ['columns', 'filters'], defaultToolPanel: null, position: 'right' },
		theme: createAgTheme(),
		onGridReady(params) {
			setTimeout(() => {
				try {
					params.api.sizeColumnsToFit();
				} catch {}
			}, 0);
		},
	};

	// AG Grid 31+: createGrid retorna a API
	const api = getAgGrid().createGrid(gridDiv, gridOptions);
	return { api, gridDiv };
}

// ==================== Page Module ====================
const LionPage = (() => {
	let gridRef = null;

	function setData(rows) {
		const api = gridRef?.api;
		if (!api) return;
		const data = Array.isArray(rows) ? rows : [];
		if (api.setGridOption) api.setGridOption('rowData', data);
		else if (api.setRowData) api.setRowData(data);
		try {
			api.sizeColumnsToFit?.();
		} catch {}
	}

	async function loadFromUrl(url) {
		const api = gridRef?.api;
		if (!api || !url) return;
		try {
			api.showLoadingOverlay?.();
			const json = await fetchJSON(url);
			const rows = Array.isArray(json) ? json : Array.isArray(json?.rows) ? json.rows : [];
			setData(rows);
			if (!rows.length) api.showNoRowsOverlay?.();
			else api.hideOverlay?.();
		} catch (err) {
			console.error('[LionGrid] erro ao carregar:', err);
			setData([]);
			gridRef?.api?.showNoRowsOverlay?.();
		}
	}

	// público
	function mount() {
		gridRef = makeGrid();

		// 1) se o back injetar direto
		if (Array.isArray(window.LION_DATA)) {
			setData(window.LION_DATA);
			return;
		}

		// 2) carrega de URL (query ?data=... ou <meta name="lion-data-url" .../>)
		const qsUrl = new URLSearchParams(location.search).get('data');
		const metaUrl = document.querySelector('meta[name="lion-data-url"]')?.content;
		const fallbackUrl = '/public/js/clean-dump.json'; // ajuste se necessário
		loadFromUrl(qsUrl || metaUrl || fallbackUrl);
	}

	return { mount, setData, loadFromUrl };
})();

// Boot
if (document.readyState !== 'loading') LionPage.mount();
else document.addEventListener('DOMContentLoaded', () => LionPage.mount());

// Expondo API global
globalThis.LionGrid = {
	init: (rows) => LionPage.setData(rows), // seta dados diretamente (array de objetos)
	setData: (rows) => LionPage.setData(rows),
	loadFromUrl: (url) => LionPage.loadFromUrl(url),
};
