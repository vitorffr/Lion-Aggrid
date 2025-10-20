/* public/js/lion-grid-nested.js — SSRM + Master/Detail (campanhas -> adsets -> ads) */
const ENDPOINTS = { SSRM: '/api/ssrm/?clean=1' };
const DRILL_ENDPOINTS = { ADSETS: '/api/adsets/', ADS: '/api/ads/' };
const DRILL = { period: 'TODAY' };

/* ============ AG Grid boot/licença + módulos ============ */
function getAgGrid() {
	const AG = globalThis.agGrid;
	if (!AG)
		throw new Error('AG Grid UMD não carregado. Verifique a ORDEM dos scripts e o path do CDN.');
	return AG;
}
(function applyAgGridLicenseAndModules() {
	try {
		const AG = getAgGrid();

		// 🔹 Se estiver usando build modular, registra os módulos necessários
		const SSRM = AG.ServerSideRowModelModule || AG?.enterprise?.ServerSideRowModelModule;
		const MDM = AG.MasterDetailModule || AG?.enterprise?.MasterDetailModule;
		if (AG?.ModuleRegistry && SSRM && MDM) {
			try {
				AG.ModuleRegistry.registerModules([SSRM, MDM]);
			} catch (e) {
				console.warn('[AG] Registro de módulos falhou (pode já estar registrado):', e);
			}
		}

		// 🔹 Licença
		const LM = AG.LicenseManager || AG?.enterprise?.LicenseManager;
		const key = document.querySelector('meta[name="hs-ag"]')?.content || '';
		if (key && LM?.setLicenseKey) LM.setLicenseKey(key);
	} catch {}
})();

/* ============ Helpers/formatters ============ */
const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const intFmt = new Intl.NumberFormat('pt-BR');

const toNumberBR = (s) => {
	if (s == null) return null;
	if (typeof s === 'number') return s;
	const n = parseFloat(
		String(s)
			.replace(/[^\d,.-]/g, '')
			.replace(/\./g, '')
			.replace(',', '.')
	);
	return Number.isFinite(n) ? n : null;
};
const currencyFormatter = (p) => {
	const n = toNumberBR(p.value);
	return n == null ? '' : brlFmt.format(n);
};
const intFormatter = (p) => {
	const n = toNumberBR(p.value);
	return n == null ? '' : intFmt.format(Math.round(n));
};
const stripHtml = (s) =>
	typeof s === 'string'
		? s
				.replace(/<[^>]*>/g, ' ')
				.replace(/\s+/g, ' ')
				.trim()
		: s;

async function fetchJSON(url, opts) {
	const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
	const text = await res.text();
	try {
		const data = JSON.parse(text);
		if (!res.ok) throw new Error(data?.error || res.statusText);
		return data;
	} catch {
		console.error('[fetchJSON] Erro JSON', text.slice(0, 200));
		return {};
	}
}

function chipFractionBadgeRenderer(params) {
	const value = String(params?.value || '').trim();
	if (!value) return '';
	const match = value.match(/^(\d+)\s*\/\s*(\d+)$/);
	let color = '#6b7280',
		textColor = '#fff';
	if (match) {
		const current = Number(match[1]),
			total = Number(match[2]);
		if (Number.isFinite(current) && Number.isFinite(total) && total > 0) {
			const ratio = current / total;
			if (current <= 0) color = '#22c55e';
			else if (ratio > 0.5) color = '#dc2626';
			else (color = '#eab308'), (textColor = '#111');
		}
	}
	const span = document.createElement('span');
	span.textContent = value;
	Object.assign(span.style, {
		display: 'inline-block',
		padding: '2px 8px',
		borderRadius: '999px',
		fontSize: '12px',
		fontWeight: '600',
		lineHeight: '1.4',
		backgroundColor: color,
		color: textColor,
	});
	return span;
}

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
function statusPillRenderer(params) {
	const value = String(params?.value || '').trim();
	if (!value) return '';
	const span = document.createElement('span');
	span.textContent = value.toUpperCase();
	Object.assign(span.style, {
		display: 'inline-block',
		padding: '2px 8px',
		borderRadius: '999px',
		fontSize: '12px',
		fontWeight: '600',
		lineHeight: '1.4',
		color: '#fff',
	});
	const lower = value.toLowerCase();
	if (lower === 'active') span.style.backgroundColor = '#22c55e';
	else if (lower === 'paused') {
		span.style.backgroundColor = '#6b7280';
		span.style.color = '#ffffffff';
	} else if (lower === 'error' || lower === 'rejected' || lower === 'off')
		span.style.backgroundColor = '#dc2626';
	else span.style.backgroundColor = '#6b7280';
	return span;
}

/* ======= Colunas ======= */
const rootCols = [
	{
		field: 'campaign_name',
		headerName: 'Campanha',
		minWidth: 400,
		cellRenderer: 'agGroupCellRenderer',
	},
	{
		field: 'campaign_status',
		headerName: 'Status Campanha',
		minWidth: 110,
		cellRenderer: statusPillRenderer,
	},
	{ field: 'profile_name', headerName: 'Profile', minWidth: 190 },
	{ field: 'bc_name', headerName: 'BC', minWidth: 200 },
	{ field: 'account_name', headerName: 'Conta', minWidth: 220 },
	{
		headerName: 'Status Conta',
		field: 'account_status',
		minWidth: 160,
		cellRenderer: statusPillRenderer,
	},
	{
		field: 'bid',
		headerName: 'Bid',
		valueFormatter: currencyFormatter,
		minWidth: 90,
		type: 'rightAligned',
	},
	{
		field: 'budget',
		headerName: 'Budget',
		valueFormatter: currencyFormatter,
		minWidth: 110,
		type: 'rightAligned',
	},
	{
		field: '_ads',
		headerName: 'Ads',
		minWidth: 100,
		cellRenderer: chipFractionBadgeRenderer,
	},
	{
		field: '_adsets',
		headerName: 'Adsets',
		minWidth: 110,
		cellRenderer: chipFractionBadgeRenderer,
	},
	{
		field: 'impressions',
		headerName: 'Imp.',
		valueFormatter: intFormatter,
		minWidth: 100,
		type: 'rightAligned',
	},
	{
		field: 'clicks',
		headerName: 'Cliques',
		valueFormatter: intFormatter,
		minWidth: 90,
		type: 'rightAligned',
	},
	{
		field: 'visitors',
		headerName: 'Visitantes',
		valueFormatter: intFormatter,
		minWidth: 110,
		type: 'rightAligned',
	},
	{
		field: 'cpc',
		headerName: 'CPC',
		valueFormatter: currencyFormatter,
		minWidth: 90,
		type: 'rightAligned',
	},
	{
		field: 'conversions',
		headerName: 'Conv.',
		valueFormatter: intFormatter,
		minWidth: 90,
		type: 'rightAligned',
	},
	{
		field: 'cpa_fb',
		headerName: 'CPA FB',
		valueFormatter: currencyFormatter,
		minWidth: 100,
		type: 'rightAligned',
	},
	{
		field: 'real_conversions',
		headerName: 'Conv. Real',
		valueFormatter: intFormatter,
		minWidth: 110,
		type: 'rightAligned',
	},
	{
		field: 'real_cpa',
		headerName: 'CPA Real',
		valueFormatter: currencyFormatter,
		minWidth: 100,
		type: 'rightAligned',
	},
	{
		field: 'spent',
		headerName: 'Gasto',
		valueFormatter: currencyFormatter,
		minWidth: 120,
		type: 'rightAligned',
	},
	{
		field: 'fb_revenue',
		headerName: 'FB Rev',
		valueFormatter: currencyFormatter,
		minWidth: 110,
		type: 'rightAligned',
	},
	{
		field: 'push_revenue',
		headerName: 'Push Rev',
		valueFormatter: currencyFormatter,
		minWidth: 120,
		type: 'rightAligned',
	},
	{ field: 'revenue', headerName: 'Revenue', minWidth: 250 },
	{ field: 'mx', headerName: 'MX', minWidth: 120 },
	{
		field: 'profit',
		headerName: 'Lucro',
		valueFormatter: currencyFormatter,
		minWidth: 110,
		type: 'rightAligned',
	},
];

const adsetCols = [
	{ field: 'name', headerName: 'Adset', minWidth: 360, cellRenderer: 'agGroupCellRenderer' },
	{ field: 'campaign_status', headerName: 'Status', minWidth: 110, cellRenderer: statusPillRenderer },
	{
		field: 'bid',
		headerName: 'Bid',
		valueFormatter: currencyFormatter,
		minWidth: 90,
		type: 'rightAligned',
	},
	{
		field: 'budget',
		headerName: 'Budget',
		valueFormatter: currencyFormatter,
		minWidth: 100,
		type: 'rightAligned',
	},
	{
		field: 'cpc',
		headerName: 'CPC',
		valueFormatter: currencyFormatter,
		minWidth: 80,
		type: 'rightAligned',
	},
	{
		field: 'cpa_fb',
		headerName: 'CPA FB',
		valueFormatter: currencyFormatter,
		minWidth: 90,
		type: 'rightAligned',
	},
	{
		field: 'real_cpa',
		headerName: 'CPA Real',
		valueFormatter: currencyFormatter,
		minWidth: 90,
		type: 'rightAligned',
	},
	{
		field: 'clicks',
		headerName: 'Cliques',
		valueFormatter: intFormatter,
		minWidth: 90,
		type: 'rightAligned',
	},
	{
		field: 'conversions',
		headerName: 'Conv.',
		valueFormatter: intFormatter,
		minWidth: 90,
		type: 'rightAligned',
	},
	{
		field: 'real_conversions',
		headerName: 'Conv. Real',
		valueFormatter: intFormatter,
		minWidth: 110,
		type: 'rightAligned',
	},
	{ field: 'ctr', headerName: 'CTR', minWidth: 80, type: 'rightAligned' },
	{
		field: 'spent',
		headerName: 'Gasto',
		valueFormatter: currencyFormatter,
		minWidth: 100,
		type: 'rightAligned',
	},
	{
		field: 'fb_revenue',
		headerName: 'FB Rev',
		valueFormatter: currencyFormatter,
		minWidth: 110,
		type: 'rightAligned',
	},
	{
		field: 'push_revenue',
		headerName: 'Push Rev',
		valueFormatter: currencyFormatter,
		minWidth: 110,
		type: 'rightAligned',
	},
	{
		field: 'revenue',
		headerName: 'Revenue',
		valueFormatter: currencyFormatter,
		minWidth: 110,
		type: 'rightAligned',
	},
	{ field: 'mx', headerName: 'MX', minWidth: 80 },
	{
		field: 'profit',
		headerName: 'Lucro',
		valueFormatter: currencyFormatter,
		minWidth: 100,
		type: 'rightAligned',
	},
];

const adCols = [
	{ field: 'name', headerName: 'Anúncio', minWidth: 380, cellRenderer: 'agGroupCellRenderer' },
	{ field: 'campaign_status', headerName: 'Status', minWidth: 110, cellRenderer: statusPillRenderer },
	{ field: 'preview_url', headerName: 'Preview', minWidth: 300 },
	{ field: 'story_id', headerName: 'Story ID', minWidth: 240 },
	{
		field: 'cpc',
		headerName: 'CPC',
		valueFormatter: currencyFormatter,
		minWidth: 80,
		type: 'rightAligned',
	},
	{
		field: 'cpa_fb',
		headerName: 'CPA FB',
		valueFormatter: currencyFormatter,
		minWidth: 90,
		type: 'rightAligned',
	},
	{
		field: 'real_cpa',
		headerName: 'CPA Real',
		valueFormatter: currencyFormatter,
		minWidth: 90,
		type: 'rightAligned',
	},
	{
		field: 'clicks',
		headerName: 'Cliques',
		valueFormatter: intFormatter,
		minWidth: 90,
		type: 'rightAligned',
	},
	{
		field: 'conversions',
		headerName: 'Conv.',
		valueFormatter: intFormatter,
		minWidth: 90,
		type: 'rightAligned',
	},
	{
		field: 'real_conversions',
		headerName: 'Conv. Real',
		valueFormatter: intFormatter,
		minWidth: 110,
		type: 'rightAligned',
	},
	{ field: 'ctr', headerName: 'CTR', minWidth: 80, type: 'rightAligned' },
	{
		field: 'spent',
		headerName: 'Gasto',
		valueFormatter: currencyFormatter,
		minWidth: 100,
		type: 'rightAligned',
	},
	{
		field: 'fb_revenue',
		headerName: 'FB Rev',
		valueFormatter: currencyFormatter,
		minWidth: 110,
		type: 'rightAligned',
	},
	{
		field: 'push_revenue',
		headerName: 'Push Rev',
		valueFormatter: currencyFormatter,
		minWidth: 110,
		type: 'rightAligned',
	},
	{
		field: 'revenue',
		headerName: 'Revenue',
		valueFormatter: currencyFormatter,
		minWidth: 110,
		type: 'rightAligned',
	},
	{ field: 'mx', headerName: 'MX', minWidth: 80 },
	{
		field: 'profit',
		headerName: 'Lucro',
		valueFormatter: currencyFormatter,
		minWidth: 100,
		type: 'rightAligned',
	},
];

/* ======= Grid ======= */
function makeGrid() {
	const gridDiv = document.getElementById('lionGrid');
	if (!gridDiv) return console.error('Div #lionGrid não encontrada');

	// ⚠️ Sem altura visível o SSRM não dispara
	if (!gridDiv.style.height && !gridDiv.style.minHeight) {
		gridDiv.style.minHeight = '560px';
	}
	gridDiv.classList.add('ag-theme-quartz');

	const gridOptions = {
		rowModelType: 'serverSide',
		cacheBlockSize: 200,
		maxBlocksInCache: 4,
		rowSelection: {
			mode: 'multiRow', // ou 'singleRow'
			// enableClickSelection: true, // substitui suppressRowClickSelection
			checkboxes: true, // ativa checkboxes
			headerCheckbox: true, // checkbox no header
			selectionColumn: {
				width: 80,
				pinned: 'left',
				suppressHeaderFilterButton: true,
			},
		},
		masterDetail: true,
		detailRowAutoHeight: true, // detailRowHeight: 400,
		isRowMaster: () => true,

		domLayout: 'normal',
		theme: createAgTheme(),
		suppressColumnVirtualisation: false,
		alwaysShowHorizontalScroll: true,
		columnDefs: rootCols,
		defaultColDef: { resizable: true, sortable: true, filter: true },
		animateRows: true,

		detailCellRendererParams: {
			detailGridOptions: {
				columnDefs: adsetCols,
				defaultColDef: { resizable: true, sortable: true, filter: true },

				// ✅ MASTER DETAIL aninhado (adsets -> ads)
				masterDetail: true,
				detailRowAutoHeight: true, // altura automática para o nível de ads

				theme: createAgTheme(),
				domLayout: 'autoHeight', // grid ajusta altura automaticamente

				detailCellRendererParams: {
					detailGridOptions: {
						columnDefs: adCols,
						defaultColDef: { resizable: true, sortable: true, filter: true },
						theme: createAgTheme(),
						domLayout: 'autoHeight', // ads também com altura automática
					},
					getDetailRowData: async (params) => {
						const id = params.data?.id;
						if (!id) {
							console.warn('[ADS] Sem adset id');
							params.successCallback([]);
							return;
						}

						const qs = new URLSearchParams({
							adset_id: id,
							period: DRILL.period,
							startRow: '0',
							endRow: '200',
						});
						const url = `${DRILL_ENDPOINTS.ADS}?${qs}`;
						console.log('[ADS] Fetching:', url);

						try {
							const data = await fetchJSON(url);
							const rows = data.rows || data.data || (Array.isArray(data) ? data : []);
							console.log('[ADS] Recebidos:', rows.length, 'ads');
							params.successCallback(rows);
						} catch (e) {
							console.error('[ADS] Erro:', e);
							params.successCallback([]);
						}
					},
				},
			},

			getDetailRowData: async (params) => {
				const id = params.data?.id || params.data?.utm_campaign;
				if (!id) {
					console.warn('[ADSETS] Sem campaign id');
					params.successCallback([]);
					return;
				}

				const qs = new URLSearchParams({
					campaign_id: id,
					period: DRILL.period,
					startRow: '0',
					endRow: '200',
				});
				const url = `${DRILL_ENDPOINTS.ADSETS}?${qs}`;
				console.log('[ADSETS] Fetching:', url);

				try {
					const data = await fetchJSON(url);
					const rows = data.rows || data.data || (Array.isArray(data) ? data : []);
					console.log('[ADSETS] Recebidos:', rows.length, 'adsets');
					params.successCallback(rows);
				} catch (e) {
					console.error('[ADSETS] Erro:', e);
					params.successCallback([]);
				}
			},
		},

		onGridReady: (params) => {
			const datasource = {
				getRows: async (req) => {
					try {
						const { startRow = 0, endRow = 200, sortModel, filterModel } = req.request;
						console.log('[SSRM] request', { startRow, endRow, sortModel, filterModel });

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
							const url = `${ENDPOINTS.SSRM}&${qs.toString()}`;
							console.warn('[SSRM] POST falhou, tentando GET:', url);
							res = await fetch(url, { credentials: 'same-origin' });
						}

						const data = await res.json().catch(() => ({ rows: [], lastRow: 0 }));
						const rows = data.rows || data.data || [];
						const lastRow = Number.isFinite(data.lastRow) ? data.lastRow : rows.length;

						console.log('[SSRM] rows recebidas:', rows.length, 'lastRow:', lastRow);
						req.success({ rowData: rows, rowCount: lastRow });
					} catch (e) {
						console.error('[SSRM] getRows failed:', e);
						req.fail();
					}
				},
			};

			// ✅ v34+: setar via setGridOption. Mantive fallback p/ versões antigas.
			const setDS =
				typeof params.api.setServerSideDatasource === 'function'
					? (ds) => params.api.setServerSideDatasource(ds)
					: (ds) => params.api.setGridOption('serverSideDatasource', ds);

			setDS(datasource);

			// ajuste inicial
			setTimeout(() => {
				try {
					params.api.sizeColumnsToFit();
				} catch {}
			}, 0);
		},
	};

	agGrid.createGrid(gridDiv, gridOptions);
}

document.addEventListener('DOMContentLoaded', makeGrid);
