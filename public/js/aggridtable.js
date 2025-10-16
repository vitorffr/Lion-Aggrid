/* public/js/lion-grid.js */
const ENDPOINTS = {
	SSRM: '/api/ssrm/?clean=1',
};

function getAgGrid() {
	const AG = globalThis.agGrid;
	if (!AG)
		throw new Error('AG Grid UMD não carregado. Verifique a ORDEM dos scripts e o path do CDN.');
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

/* ==================== Helpers ==================== */
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

/* ==================== Grid ==================== */
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

	// ===== Columns =====
	const columnDefs = [
		{ headerName: 'ID', field: 'id', minWidth: 160, pinned: 'left', flex: 0.9 },
		{
			headerName: 'Perfil',
			field: 'profile_name',
			valueGetter: (p) => stripHtml(p.data?.profile_name),
			minWidth: 180,
			flex: 1.2,
			tooltipValueGetter: (p) => p.value || '',
		},
		{
			headerName: 'BM',
			field: 'bc_name',
			valueGetter: (p) => stripHtml(p.data?.bc_name),
			minWidth: 160,
			flex: 1.0,
			tooltipValueGetter: (p) => p.value || '',
		},
		{
			headerName: 'Conta',
			field: 'account_name',
			valueGetter: (p) => stripHtml(p.data?.account_name),
			minWidth: 200,
			flex: 1.3,
			tooltipValueGetter: (p) => p.value || '',
		},

		{
			headerName: 'Status (Conta)',
			field: 'account_status',
			cellRenderer: statusRenderer,
			minWidth: 140,
			flex: 0.7,
		},

		{
			headerName: 'Limite Diário',
			field: 'account_limit',
			type: 'rightAligned',
			valueGetter: (p) => toNumberBR(p.data?.account_limit),
			valueFormatter: currencyFormatter,
			minWidth: 120,
			flex: 0.8,
		},

		{
			headerName: 'Campanha',
			field: 'campaign_name',
			valueGetter: (p) => stripHtml(p.data?.campaign_name),
			minWidth: 260,
			flex: 1.6,
			tooltipValueGetter: (p) => p.value || '',
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
			valueGetter: (p) => toNumberBR(p.data?.bid),
			valueFormatter: currencyFormatter,
			minWidth: 110,
			flex: 0.6,
		},
		{
			headerName: 'Status (Campanha)',
			field: 'campaign_status',
			cellRenderer: statusRenderer,
			minWidth: 160,
			flex: 0.8,
		},
		{
			headerName: 'Orçamento',
			field: 'budget',
			type: 'rightAligned',
			valueGetter: (p) => toNumberBR(p.data?.budget),
			valueFormatter: currencyFormatter,
			minWidth: 120,
			flex: 0.7,
		},

		{
			headerName: 'Imp',
			field: 'impressions',
			type: 'rightAligned',
			valueFormatter: intFormatter,
			minWidth: 110,
			flex: 0.7,
		},
		{
			headerName: 'Cliques',
			field: 'clicks',
			type: 'rightAligned',
			valueFormatter: intFormatter,
			minWidth: 100,
			flex: 0.6,
		},
		{
			headerName: 'Visitas',
			field: 'visitors',
			type: 'rightAligned',
			valueFormatter: intFormatter,
			minWidth: 100,
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
			headerName: 'Conv.',
			field: 'conversions',
			type: 'rightAligned',
			valueFormatter: intFormatter,
			minWidth: 100,
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
			headerName: 'Conv. Real',
			field: 'real_conversions',
			type: 'rightAligned',
			valueGetter: (p) => Number(stripHtml(p.data?.real_conversions) || NaN),
			valueFormatter: intFormatter,
			minWidth: 120,
			flex: 0.7,
		},
		{
			headerName: 'CPA Real',
			field: 'real_cpa',
			type: 'rightAligned',
			valueGetter: (p) => toNumberBR(p.data?.real_cpa),
			valueFormatter: currencyFormatter,
			minWidth: 110,
			flex: 0.6,
		},

		{
			headerName: 'Gasto',
			field: 'spent',
			type: 'rightAligned',
			valueGetter: (p) => toNumberBR(p.data?.spent),
			valueFormatter: currencyFormatter,
			minWidth: 120,
			flex: 0.8,
		},
		{
			headerName: 'FB Rev',
			field: 'fb_revenue',
			type: 'rightAligned',
			valueGetter: (p) => toNumberBR(p.data?.fb_revenue),
			valueFormatter: currencyFormatter,
			minWidth: 120,
			flex: 0.8,
		},
		{
			headerName: 'Push Rev',
			field: 'push_revenue',
			type: 'rightAligned',
			valueGetter: (p) => toNumberBR(p.data?.push_revenue),
			valueFormatter: currencyFormatter,
			minWidth: 120,
			flex: 0.8,
		},

		{
			headerName: 'Feito',
			field: 'revenue',
			valueGetter: (p) => stripHtml(p.data?.revenue),
			minWidth: 220,
			flex: 1.2,
			tooltipValueGetter: (p) => p.value || '',
		},
		{
			headerName: 'MX',
			field: 'mx',
			minWidth: 120,
			valueGetter: (p) => stripHtml(p.data?.mx),
			flex: 0.7,
		},

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

		// ===== SSRM =====
		rowModelType: 'serverSide',
		serverSideStoreType: 'partial',
		cacheBlockSize: 200,
		maxBlocksInCache: 4,

		animateRows: true,
		sideBar: { toolPanels: ['columns', 'filters'], defaultToolPanel: null, position: 'right' },
		theme: createAgTheme(),

		onGridReady(params) {
			// Datasource compat (v29–v31+)
			const dataSource = {
				getRows: async (dsParams) => {
					try {
						const payload = dsParams.request; // { startRow, endRow, sortModel, filterModel }
						// Tenta POST primeiro (padrão SSRM moderno)
						let res = await fetch(ENDPOINTS.SSRM, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify(payload),
						});

						// Se o back NÃO aceitar POST, tenta GET como fallback (útil em mock simples)
						if (!res.ok) {
							const qs = new URLSearchParams({
								startRow: String(payload.startRow ?? 0),
								endRow: String(payload.endRow ?? 200),
								sortModel: JSON.stringify(payload.sortModel || []),
								filterModel: JSON.stringify(payload.filterModel || {}),
							});
							res = await fetch(`${ENDPOINTS.SSRM}&${qs.toString()}`, { method: 'GET' });
						}

						const data = await res.json().catch(() => ({}));
						if (!res.ok) throw new Error(data?.error || res.statusText);

						const rows = Array.isArray(data?.rows) ? data.rows : [];
						const lastRow = Number.isInteger(data?.lastRow)
							? data.lastRow
							: rows.length < payload.endRow - payload.startRow
							? payload.startRow + rows.length
							: -1;

						dsParams.success({ rowData: rows, rowCount: lastRow });
					} catch (e) {
						console.error('[SSRM] getRows failed:', e);
						try {
							dsParams.fail();
						} catch {}
					}
				},
			};

			// v31 tem setServerSideDatasource; em algumas builds, setGridOption também funciona
			if (typeof params.api.setServerSideDatasource === 'function') {
				params.api.setServerSideDatasource(dataSource);
			} else {
				// fallback raro
				params.api.setGridOption?.('serverSideDatasource', dataSource);
			}

			setTimeout(() => {
				try {
					params.api.sizeColumnsToFit();
				} catch {}
			}, 0);
		},
	};

	// Compat criar grid (v31: createGrid retorna API; v29/30: new Grid e API via gridOptions.api)
	let apiOrInstance;
	if (typeof AG.createGrid === 'function') {
		apiOrInstance = AG.createGrid(gridDiv, gridOptions);
	} else {
		apiOrInstance = new AG.Grid(gridDiv, gridOptions);
	}
	return { api: gridOptions.api || apiOrInstance, gridDiv };
}

/* ==================== Page Module ==================== */
const LionPage = (() => {
	let gridRef = null;

	function mount() {
		gridRef = makeGrid();
	}

	if (document.readyState !== 'loading') mount();
	else document.addEventListener('DOMContentLoaded', mount);

	return { mount };
})();

// Expondo API global vazia (só pra manter padrão com outros projetos)
globalThis.LionGrid = globalThis.LionGrid || {};
