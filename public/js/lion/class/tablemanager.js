/* public/js/class/TableManager.js
 * TableManager — núcleo único (tema, licença, defaults, makeGrid)
 * Requisitos: AG Grid UMD em window.agGrid + <meta name="hs-ag"> com a licença.
 */

export class TableManager {
	constructor({ container = '#lionGrid', themeParams = {}, onReady } = {}) {
		this.container = container;
		this.themeParams = themeParams;
		this.onReady = onReady;
		this.api = null;
		this.columnApi = null;
	}

	getAgGrid() {
		const AG = globalThis.agGrid;
		if (!AG) throw new Error('AG Grid UMD não carregado');
		return AG;
	}

	applyLicense() {
		try {
			const AG = this.getAgGrid();
			const LM = AG.LicenseManager || AG?.enterprise?.LicenseManager;
			const key = document.querySelector('meta[name="hs-ag"]')?.content || '';
			if (key && LM?.setLicenseKey) LM.setLicenseKey(key);
		} catch {}
	}

	createTheme(overrides = {}) {
		const AG = this.getAgGrid();
		const { themeQuartz, iconSetMaterial } = AG;
		if (!themeQuartz || !iconSetMaterial) return undefined;

		// Defaults do projeto (iguais aos que você já usa)
		const base = {
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
			...this.themeParams, // vindo do construtor (página pode ajustar)
			...overrides, // e ainda pode sobrepor ao chamar makeGrid
		};

		return themeQuartz.withPart(iconSetMaterial).withParams(base);
	}

	// Normaliza a resposta do backend para sempre virar um array de linhas
	normalizeRowsResponse(resp) {
		try {
			if (!resp) return [];
			// casos comuns: {rows:[...]}, {data:[...]}, {list:[...]}, [...]
			if (Array.isArray(resp)) return resp;
			if (Array.isArray(resp.rows)) return resp.rows;
			if (Array.isArray(resp.data)) return resp.data;
			if (Array.isArray(resp.list)) return resp.list;
			// às vezes vem como {result:{rows:[...]}}
			if (resp.result && Array.isArray(resp.result.rows)) return resp.result.rows;
			if (resp.result && Array.isArray(resp.result.data)) return resp.result.data;
			// fallback: tenta achar a primeira propriedade array
			for (const k of Object.keys(resp)) {
				if (Array.isArray(resp[k])) return resp[k];
			}
			return [];
		} catch {
			return [];
		}
	}

	/**
	 * Encaixe rápido:
	 * - Se estiver em ServerSide: registra um datasource que faz fetch e chama success.
	 * - Se estiver em ClientSide: faz fetch uma vez e seta rowData.
	 *
	 * opts = {
	 *   url: string | (params)=>string,
	 *   method?: 'GET'|'POST',
	 *   bodyFactory?: (params)=>any,   // só p/ POST
	 *   headers?: Record<string,string>,
	 *   mapRow?: (row)=>row,           // mapeia cada linha
	 *   when?: 'serverSide'|'clientSide'|'auto'
	 * }
	 */
	attachData({ url, method = 'GET', bodyFactory, headers, mapRow, when = 'auto' } = {}) {
		const isServer =
			when === 'serverSide' ||
			(when === 'auto' && this.gridOptions?.rowModelType === 'serverSide');
		const makeUrl = (p) => (typeof url === 'function' ? url(p) : url);

		if (isServer) {
			const dataSource = {
				getRows: async (params) => {
					try {
						const reqInit = { method, headers: headers || {} };
						if (method === 'POST') {
							reqInit.headers['Content-Type'] =
								reqInit.headers['Content-Type'] || 'application/json';
							reqInit.body = JSON.stringify(bodyFactory ? bodyFactory(params) : {});
						}
						const res = await fetch(makeUrl(params), reqInit);
						const json = await res.json();
						let rows = this.normalizeRowsResponse(json);
						if (typeof mapRow === 'function') rows = rows.map(mapRow);

						// AG Grid SSRM espera "success" com rowData (v30+) ou successCallback(rowData, rowCount?) (v28-)
						const hasNewApi = typeof params.success === 'function'; // v31+
						if (hasNewApi) {
							params.success({ rowData: rows });
						} else if (typeof params.successCallback === 'function') {
							params.successCallback(rows);
						} else {
							// fallback extremo
							this.api?.setGridOption?.('rowData', rows);
						}
					} catch (e) {
						console.warn('[TableManager] getRows error:', e);
						if (typeof params.fail === 'function') params.fail();
						if (typeof params.failCallback === 'function') params.failCallback();
					}
				},
			};
			this.api?.setGridOption?.('serverSideDatasource', dataSource);
			// versões antigas:
			if (typeof this.api?.setServerSideDatasource === 'function') {
				this.api.setServerSideDatasource(dataSource);
			}
			return;
		}

		// ClientSide: um fetch e pronto
		(async () => {
			try {
				const res = await fetch(makeUrl({}), { method, headers: headers || {} });
				const json = await res.json();
				let rows = this.normalizeRowsResponse(json);
				if (typeof mapRow === 'function') rows = rows.map(mapRow);
				// setar rowData funciona em todas as versões
				this.api?.setGridOption?.('rowData', rows);
				if (typeof this.api?.setRowData === 'function') this.api.setRowData(rows);
			} catch (e) {
				console.warn('[TableManager] clientSide data error:', e);
			}
		})();
	}
}
