/* public/js/lion-grid-nested.js */
const ENDPOINTS = {
	SSRM: '/api/ssrm/?clean=1',
};
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

/* ============ Helpers ============ */
async function fetchJSON(url, opts) {
	const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
	const text = await res.text();
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		console.warn('[fetchJSON] Resposta não era JSON válido:', text.slice(0, 200));
		data = {};
	}
	if (!res.ok) throw new Error(data?.error || res.statusText);
	return data;
}

const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const intFmt = new Intl.NumberFormat('pt-BR');
const currencyFormatter = (p) => {
	const n = Number(p.value);
	return Number.isFinite(n) ? brlFmt.format(n) : p.value ?? '';
};
const intFormatter = (p) => {
	const n = Number(p.value);
	return Number.isFinite(n) ? intFmt.format(n) : p.value ?? '';
};

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

/* ============ Build Grid ============ */
function makeGrid() {
	const AG = globalThis.agGrid;
	const gridDiv = document.getElementById('lionGrid');
	if (!gridDiv) return console.error('Div #lionGrid não encontrada');
	gridDiv.classList.add('ag-theme-quartz');

	const gridOptions = {
		masterDetail: true,
		detailRowHeight: 420,
		columnDefs: [
			{
				field: 'campaign_name',
				headerName: 'Campanha',
				cellRenderer: 'agGroupCellRenderer',
				flex: 1.4,
			},
			{ field: 'campaign_status', headerName: 'Status', flex: 0.8 },
			{
				field: 'spent',
				headerName: 'Gasto',
				type: 'rightAligned',
				valueFormatter: currencyFormatter,
			},
			{
				field: 'profit',
				headerName: 'Lucro',
				type: 'rightAligned',
				valueFormatter: currencyFormatter,
			},
		],
		defaultColDef: { flex: 1, resizable: true, sortable: true, filter: true },
		animateRows: true,
		theme: createAgTheme(),

		// ======== Nível 1 (Adsets) ========
		detailCellRendererParams: {
			detailGridOptions: {
				masterDetail: true,
				detailRowHeight: 350,
				columnDefs: [
					{
						field: 'name',
						headerName: 'Adset',
						cellRenderer: 'agGroupCellRenderer',
						flex: 1.4,
					},
					{ field: 'status', headerName: 'Status', flex: 0.8 },
					{ field: 'spent', headerName: 'Gasto', valueFormatter: currencyFormatter },
					{ field: 'clicks', headerName: 'Cliques', valueFormatter: intFormatter },
					{ field: 'conversions', headerName: 'Conv.', valueFormatter: intFormatter },
				],
				defaultColDef: { flex: 1, resizable: true, sortable: true, filter: true },

				// ======== Nível 2 (Ads) ========
				detailCellRendererParams: {
					detailGridOptions: {
						columnDefs: [
							{ field: 'name', headerName: 'Ad', flex: 1.6 },
							{ field: 'status', headerName: 'Status', flex: 0.8 },
							{ field: 'spent', headerName: 'Gasto', valueFormatter: currencyFormatter },
							{ field: 'clicks', headerName: 'Cliques', valueFormatter: intFormatter },
							{ field: 'impressions', headerName: 'Impr.', valueFormatter: intFormatter },
						],
						defaultColDef: { flex: 1, resizable: true, sortable: true, filter: true },
					},
					// 🔹 fetch ads (nível 3)
					getDetailRowData: async (params) => {
						const adsetId = params.data?.id;
						const qs = new URLSearchParams({
							adset_id: adsetId,
							period: DRILL.period,
							startRow: 0,
							endRow: 200,
						});
						const url = `${DRILL_ENDPOINTS.ADS}?${qs.toString()}`;
						console.log('[ADS] Fetching:', url);
						try {
							const data = await fetchJSON(url);
							const rows = data.rows || data.data || [];
							console.log(`[ADS] Recebidos ${rows.length} anúncios`, rows.slice(0, 2));
							params.successCallback(rows);
						} catch (e) {
							console.error('[ADS] Erro ao buscar ads:', e);
							params.successCallback([]);
						}
					},
				},

				// 🔹 fetch adsets (nível 2)
				getDetailRowData: async (params) => {
					const campaignId = params.data?.id || params.data?.utm_campaign;
					const qs = new URLSearchParams({
						campaign_id: campaignId,
						period: DRILL.period,
						startRow: 0,
						endRow: 200,
					});
					const url = `${DRILL_ENDPOINTS.ADSETS}?${qs.toString()}`;
					console.log('[ADSETS] Fetching:', url);
					try {
						const data = await fetchJSON(url);
						const rows = data.rows || data.data || [];
						console.log(`[ADSETS] Recebidos ${rows.length} adsets`, rows.slice(0, 2));
						params.successCallback(rows);
					} catch (e) {
						console.error('[ADSETS] Erro ao buscar adsets:', e);
						params.successCallback([]);
					}
				},
			},

			// 🔹 fetch adsets (nível raiz → mesmo endpoint, mas primeiro expand)
			getDetailRowData: async (params) => {
				const campaignId = params.data?.id;
				const qs = new URLSearchParams({
					campaign_id: campaignId,
					period: DRILL.period,
					startRow: 0,
					endRow: 200,
				});
				const url = `${DRILL_ENDPOINTS.ADSETS}?${qs.toString()}`;
				console.log('[ROOT->ADSETS] Fetching:', url);
				try {
					const data = await fetchJSON(url);
					const rows = data.rows || data.data || [];
					console.log(`[ROOT->ADSETS] Recebidos ${rows.length} adsets`, rows.slice(0, 2));
					params.successCallback(rows);
				} catch (e) {
					console.error('[ROOT->ADSETS] Erro ao expandir campanha:', e);
					params.successCallback([]);
				}
			},
		},

		// 🔹 fetch campaigns (nível 0)
		onGridReady: async (params) => {
			try {
				console.log('[ROOT] Fetching campanhas...');
				let res = await fetch(ENDPOINTS.SSRM, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ startRow: 0, endRow: 500 }),
				});
				if (!res.ok) {
					console.warn('[ROOT] POST falhou, tentando GET...');
					res = await fetch(`${ENDPOINTS.SSRM}&limit=500`);
				}
				const text = await res.text();
				let data;
				try {
					data = JSON.parse(text);
				} catch {
					console.warn('[ROOT] Resposta não era JSON válido:', text.slice(0, 200));
					data = {};
				}
				const rows = data.rows || data.data || [];
				console.log(`[ROOT] Recebidas ${rows.length} campanhas`, rows.slice(0, 2));
				params.api.setGridOption('rowData', rows);
			} catch (e) {
				console.error('[ROOT] Erro ao buscar campanhas:', e);
			}
		},
	};

	agGrid.createGrid(gridDiv, gridOptions);
}

document.addEventListener('DOMContentLoaded', makeGrid);
