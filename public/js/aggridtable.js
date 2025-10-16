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

const selectCellRenderer = (p) => {
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

	wrap.appendChild(input);
	return wrap;
};

/* ==================== KTUI Modal helpers ==================== */
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
	const titleEl = modal.querySelector('.kt-modal-title');
	const bodyEl = modal.querySelector('.kt-modal-body > pre, .kt-modal-body');
	if (titleEl) titleEl.textContent = title;
	if (bodyEl) bodyEl.textContent = content;
	openKTModal('#lionKtModal');
}

/* ==================== Tema (opcional) ==================== */
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

/* ==================== Grid ==================== */
function makeGrid() {
	const AG = getAgGrid();
	const gridDiv = document.getElementById('lionGrid');
	if (!gridDiv) {
		console.error('[LionGrid] #lionGrid não encontrado');
		return null;
	}
	gridDiv.classList.add('ag-theme-quartz');

	// colunas que DEVEM abrir modal ao clicar
	const MODAL_FIELDS = new Set([
		'profile_name',
		'bc_name',
		'account_name',
		'account_status',
		'account_limit',
		'campaign_name',
		'utm_campaign',
		'bid',
		'campaign_status',
		'budget',
		'xabu_ads',
		'xabu_adsets',
		'cpc',
		'cpa_fb',
		'real_conversions',
		'real_cpa',
		'spent',
		'fb_revenue',
		'push_revenue',
		'revenue',
		'mx',
		'profit',
	]);

	// ===== Columns =====
	const columnDefs = [
		{
			headerName: '',
			field: 'select',
			pinned: 'left',
			width: 50,
			minWidth: 50,
			maxWidth: 50,
			resizable: false,
			suppressSizeToFit: true,
			suppressAutoSize: true,
			cellRenderer: selectCellRenderer,
		},

		// Textos / identificação
		{
			headerName: 'Profile',
			field: 'profile_name',
			valueGetter: (p) => stripHtml(p.data?.profile_name),
			minWidth: 180,
			flex: 1.2,
			tooltipValueGetter: (p) => p.value || '',
		},
		{
			headerName: 'BC',
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

		// Status (badges/strings)
		{
			headerName: 'Status Conta',
			field: 'account_status',
			minWidth: 140,
			flex: 0.7,
		},
		{
			headerName: 'Limite',
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

		// Valores (moeda)
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
			headerName: 'Status Campanha',
			field: 'campaign_status',
			minWidth: 160,
			flex: 0.8,
		},
		{
			headerName: 'Budget',
			field: 'budget',
			type: 'rightAligned',
			valueGetter: (p) => toNumberBR(p.data?.budget),
			valueFormatter: currencyFormatter,
			minWidth: 120,
			flex: 0.7,
		},

		// Chips 0/3 e 0/1
		{
			headerName: 'Ads',
			field: 'xabu_ads',
			minWidth: 100,
			maxWidth: 120,
			tooltipValueGetter: (p) => stripHtml(p.data?.xabu_ads),
		},
		{
			headerName: 'Adsets',
			field: 'xabu_adsets',
			minWidth: 110,
			maxWidth: 130,
			tooltipValueGetter: (p) => stripHtml(p.data?.xabu_adsets),
		},

		// Métricas inteiras
		{
			headerName: 'Impr.',
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
			headerName: 'Visit.',
			field: 'visitors',
			type: 'rightAligned',
			valueFormatter: intFormatter,
			minWidth: 100,
			flex: 0.6,
		},

		// Custo/conversão
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

		// Dinheiro
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

		// Compostos
		{
			headerName: 'Revenue',
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
			headerName: 'Profit',
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

	// helper para exibir no modal exatamente o que o user vê
	function resolveDisplayFromParams(params) {
		// se o grid já formatou (ex.: valueFormatter), vem aqui
		if (params.valueFormatted != null && params.valueFormatted !== '') {
			return String(params.valueFormatted);
		}
		// fallback: limpa HTML e tenta números
		const field = params.colDef?.field;
		const val = params.value;
		if (typeof val === 'string') return stripHtml(val);
		if (val == null) return '';
		if (
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
			return n == null ? '' : brlFmt.format(n);
		}
		if (['impressions', 'clicks', 'visitors', 'conversions', 'real_conversions'].includes(field)) {
			const n = Number(val);
			return Number.isFinite(n) ? intFmt.format(n) : String(val);
		}
		if (field === 'account_status' || field === 'campaign_status') {
			return strongText(String(val || ''));
		}
		return String(val);
	}

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

		// abre modal sem mexer no renderer/visual
		onCellClicked(params) {
			const field = params.colDef?.field;
			if (!field || !MODAL_FIELDS.has(field)) return;

			// pega o texto exibido (ou próximo disso) e mostra no modal
			const display = resolveDisplayFromParams(params);
			const title = params.colDef?.headerName || 'Detalhes';
			showKTModal({ title, content: display || '(vazio)' });
		},

		onGridReady(params) {
			const ds = {
				getRows: async (dsParams) => {
					const callSuccess = (payload) => {
						if (typeof dsParams.success === 'function') dsParams.success(payload);
						else if (typeof dsParams.successCallback === 'function')
							dsParams.successCallback(payload.rowData, payload.rowCount);
					};
					const callFail = () => {
						if (typeof dsParams.fail === 'function') dsParams.fail();
						else if (typeof dsParams.failCallback === 'function') dsParams.failCallback();
					};

					try {
						const rq = dsParams.request; // { startRow, endRow, sortModel, filterModel }
						// tenta POST (padrão)
						let res = await fetch(ENDPOINTS.SSRM, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify(rq),
						});

						// fallback GET (mock simples)
						if (!res.ok) {
							const qs = new URLSearchParams({
								startRow: String(rq.startRow ?? 0),
								endRow: String(rq.endRow ?? 200),
								sortModel: JSON.stringify(rq.sortModel || []),
								filterModel: JSON.stringify(rq.filterModel || {}),
							});
							res = await fetch(`${ENDPOINTS.SSRM}&${qs.toString()}`, { method: 'GET' });
						}

						const data = await res.json().catch(() => ({}));
						if (!res.ok) throw new Error(data?.error || res.statusText);

						const rows = Array.isArray(data?.rows) ? data.rows : [];
						const lastRow = Number.isInteger(data?.lastRow)
							? data.lastRow
							: rows.length < rq.endRow - rq.startRow
							? rq.startRow + rows.length
							: -1;

						callSuccess({ rowData: rows, rowCount: lastRow });
					} catch (e) {
						console.error('[SSRM] getRows failed:', e);
						callFail();
					}
				},
			};

			if (typeof params.api.setServerSideDatasource === 'function') {
				params.api.setServerSideDatasource(ds);
			} else {
				params.api.setGridOption?.('serverSideDatasource', ds);
			}

			setTimeout(() => {
				try {
					params.api.sizeColumnsToFit();
				} catch {}
			}, 0);
		},
	};

	// createGrid (v31+) / fallback (v29/30)
	let apiOrInstance;
	const AGg = getAgGrid();
	if (typeof AGg.createGrid === 'function') {
		apiOrInstance = AGg.createGrid(gridDiv, gridOptions);
	} else {
		apiOrInstance = new AGg.Grid(gridDiv, gridOptions);
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

// Expondo API global vazia (padrão)
globalThis.LionGrid = globalThis.LionGrid || {};
