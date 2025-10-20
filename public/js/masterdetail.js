/* public/js/lion-grid-nested.js — versão limpa e fiel ao JSON */
const ENDPOINTS = { SSRM: '/api/ssrm/?clean=1' };
const DRILL_ENDPOINTS = {
	ADSETS: '/api/adsets/',
	ADS: '/api/ads/',
};
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

/* ======= Colunas ======= */

// 🏁 ROOT — campanhas
const rootCols = [
	{
		field: 'campaign_name',
		headerName: 'Campanha',
		minWidth: 400,
		cellRenderer: 'agGroupCellRenderer',
	},
	{ field: 'campaign_status', headerName: 'Status', minWidth: 110 },
	{ field: 'profile_name', headerName: 'Profile', minWidth: 190 },
	{ field: 'bc_name', headerName: 'BC', minWidth: 200 },
	{ field: 'account_name', headerName: 'Conta', minWidth: 220 },
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
	{ field: 'xabu_ads', headerName: 'Xabu Ads', minWidth: 100 },
	{ field: 'xabu_adsets', headerName: 'Xabu Adsets', minWidth: 110 },
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

// 📊 ADSETS
const adsetCols = [
	{ field: 'name', headerName: 'Adset', minWidth: 360, cellRenderer: 'agGroupCellRenderer' },
	{ field: 'campaign_status', headerName: 'Status', minWidth: 110 },
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

// 📢 ADS
const adCols = [
	{ field: 'name', headerName: 'Anúncio', minWidth: 380, cellRenderer: 'agGroupCellRenderer' },
	{ field: 'campaign_status', headerName: 'Status', minWidth: 110 },
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
	gridDiv.classList.add('ag-theme-quartz');

	const gridOptions = {
		masterDetail: true,
		detailRowHeight: 400,
		domLayout: 'normal',
		theme: createAgTheme(),

		suppressColumnVirtualisation: false,
		alwaysShowHorizontalScroll: true,
		columnDefs: rootCols,
		defaultColDef: { resizable: true, sortable: true, filter: true },
		animateRows: true,

		// 🔹 Adsets
		detailCellRendererParams: {
			detailGridOptions: {
				masterDetail: true,
				detailRowAutoHeight: true,
				columnDefs: adsetCols,
				defaultColDef: { resizable: true, sortable: true, filter: true },

				// 🔹 Ads
				detailCellRendererParams: {
					detailGridOptions: {
						columnDefs: adCols,
						detailRowAutoHeight: true,
						defaultColDef: { resizable: true, sortable: true, filter: true },
					},
					getDetailRowData: async (params) => {
						const id = params.data?.id;
						const qs = new URLSearchParams({
							adset_id: id,
							period: DRILL.period,
							startRow: 0,
							endRow: 200,
						});
						const url = `${DRILL_ENDPOINTS.ADS}?${qs}`;
						console.log('[ADS]', url);
						const data = await fetchJSON(url);
						params.successCallback(data.rows || data.data || []);
					},
				},

				getDetailRowData: async (params) => {
					const id = params.data?.id;
					const qs = new URLSearchParams({
						campaign_id: id,
						period: DRILL.period,
						startRow: 0,
						endRow: 200,
					});
					const url = `${DRILL_ENDPOINTS.ADSETS}?${qs}`;
					console.log('[ADSETS]', url);
					const data = await fetchJSON(url);
					params.successCallback(data.rows || data.data || []);
				},
			},

			getDetailRowData: async (params) => {
				const id = params.data?.id;
				const qs = new URLSearchParams({
					campaign_id: id,
					period: DRILL.period,
					startRow: 0,
					endRow: 200,
				});
				const url = `${DRILL_ENDPOINTS.ADSETS}?${qs}`;
				console.log('[ROOT->ADSETS]', url);
				const data = await fetchJSON(url);
				params.successCallback(data.rows || data.data || []);
			},
		},

		onGridReady: async (params) => {
			console.log('[ROOT] Fetching campanhas...');
			let res = await fetch(ENDPOINTS.SSRM, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ startRow: 0, endRow: 500 }),
			});
			if (!res.ok) res = await fetch(`${ENDPOINTS.SSRM}&limit=500`);
			const data = await res.json().catch(() => ({}));
			const rows = data.rows || data.data || [];
			console.log(`[ROOT] Recebidas ${rows.length} campanhas`);
			params.api.setGridOption('rowData', rows);
		},
	};

	agGrid.createGrid(gridDiv, gridOptions);
}

document.addEventListener('DOMContentLoaded', makeGrid);
