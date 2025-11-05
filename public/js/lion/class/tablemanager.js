/* public/js/class/TableManager.js
 * -----------------------------------------------------------------------------
 * TableManager — Instanciação + Essenciais + Toolbar Global
 * -----------------------------------------------------------------------------
 * Responsabilidades (somente):
 *  - Instanciar a AG Grid (tema, licença, opções-base) e guardar api/columnApi.
 *  - Essenciais do dia-a-dia: currency/global quick filter, refresh SSRM, state.
 *  - Toolbar global: reset layout, export (CSV/TSV), presets (salvar/aplicar),
 *    pin/size mode, e binds de inputs (quick filter).
 *
 * O “miolo pesado” (helpers de SSRM, renderers/editores, Composite/Calc Columns,
 * etc.) NÃO está aqui. Vamos aplicá-lo no arquivo “core” depois, chamando-o via
 * gridOptions/columnDefs e/ou módulos externos.
 *
 * Observações
 *  - Mantém window.__lastTableManagerInstance para integração com toolbar externa.
 *  - Integra com LionCalcColumns se existir (para exportar/importar no preset).
 *  - Usa <meta name="hs-ag"> para licença Enterprise (quando disponível).
 */

(function initUMD(global) {
	const root =
		typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global;

	class TableManager {
		// ============================
		// 1) CONSTRUÇÃO & DEFAULTS
		// ============================
		constructor(opts = {}) {
			const {
				container, // '#id' | Element
				endpoints = {
					SSRM: '/api/ssrm/?clean=1&mode=full',
					toggleFeature: '/api/dev/test-toggle/',
				},
				storageKeys = {
					gridState: 'lion.aggrid.state.v1',
					presets: 'lion.aggrid.presets.v1',
					activePreset: 'lion.aggrid.activePreset.v1',
					sizeMode: 'lion.aggrid.sizeMode', // 'auto' | 'fit'
				},
				dev = {
					minSpinnerMs: 500,
				},
				currency = 'BRL', // 'BRL' | 'USD'
			} = opts;

			this.opts = { endpoints, storageKeys, dev };
			this.containerRef = container || '#lionGrid';

			// Estado leve
			this._currency = String(currency || 'BRL').toUpperCase() === 'USD' ? 'USD' : 'BRL';
			this._globalQuickFilter = '';

			// AG Grid refs
			this.api = null;
			this.columnApi = null;

			// licença
			this._applyLicense();

			// expõe última instância (toolbar global)
			try {
				root.__lastTableManagerInstance = this;
			} catch {}
		}

		// ============================
		// 2) AG GRID: ACESSO & LICENÇA & TEMA
		// ============================
		_getAG() {
			const AG = root.agGrid;
			if (!AG) throw new Error('AG Grid UMD não carregado. Cheque a ordem dos scripts.');
			return AG;
		}

		_applyLicense() {
			try {
				const AG = this._getAG();
				const LM = AG.LicenseManager || AG?.enterprise?.LicenseManager;
				const key = document.querySelector('meta[name="hs-ag"]')?.content || '';
				if (key && LM?.setLicenseKey) LM.setLicenseKey(key);
			} catch {}
		}

		createTheme() {
			const AG = this._getAG();
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

		// ============================
		// 3) UTILS (toast, sleep)
		// ============================
		sleep(ms) {
			return new Promise((r) => setTimeout(r, ms));
		}
		async withMinSpinner(t0, minMs) {
			const elapsed = performance.now() - t0;
			if (elapsed < minMs) await this.sleep(minMs - elapsed);
		}
		showToast(msg, type = 'info') {
			const colors = {
				info: 'linear-gradient(90deg,#06b6d4,#3b82f6)',
				success: 'linear-gradient(90deg,#22c55e,#16a34a)',
				warning: 'linear-gradient(90deg,#f59e0b,#eab308)',
				danger: 'linear-gradient(90deg,#ef4444,#dc2626)',
			};
			if (root.Toastify) {
				root.Toastify({
					text: msg,
					duration: 2200,
					close: true,
					gravity: 'bottom',
					position: 'right',
					stopOnFocus: true,
					backgroundColor: colors[type] || colors.info,
				}).showToast();
			} else {
				console.log(`[Toast:${type}] ${msg}`);
			}
		}

		// ============================
		// 4) CURRENCY & QUICK FILTER
		// ============================
		setCurrency(mode) {
			const m = String(mode || '').toUpperCase();
			if (m === 'USD' || m === 'BRL') this._currency = m;
		}
		getCurrency() {
			return this._currency;
		}

		setGlobalQuickFilter(value) {
			this._globalQuickFilter = String(value || '');
			// Repassa via filterModel._global; quem busca dados deve ler isso
			this.refreshSSRM();
		}
		getGlobalQuickFilter() {
			return this._globalQuickFilter;
		}
		_buildFilterModelWithGlobal(base) {
			const fm = { ...(base || {}) };
			const gf = (this._globalQuickFilter || '').trim();
			fm._global = Object.assign({}, fm._global, { filter: gf });
			return fm;
		}

		// ============================
		// 5) STATE & PRESETS (persistência leve)
		// ============================
		_SS_KEY() {
			return this.opts.storageKeys.gridState;
		}
		_LS_PRESETS() {
			return this.opts.storageKeys.presets;
		}
		_LS_ACTIVE() {
			return this.opts.storageKeys.activePreset;
		}
		_LS_SIZE() {
			return this.opts.storageKeys.sizeMode;
		}

		getState() {
			try {
				return this.api?.getState?.() || null;
			} catch {
				return null;
			}
		}
		setState(state, ignore = []) {
			try {
				this.api?.setState?.(state || {}, ignore || []);
			} catch {}
		}
		resetLayout() {
			try {
				sessionStorage.removeItem(this._SS_KEY());
				localStorage.removeItem(this._LS_ACTIVE());
				this.api?.setState?.({}, []);
				this.api?.resetColumnState?.();
				this.api?.setFilterModel?.(null);
				this.api?.setSortModel?.([]);
				this._applySizeMode(this.getSizeMode());
				this.showToast('Layout resetado', 'info');
			} catch (e) {
				console.warn('resetLayout fail', e);
			}
		}

		_readPresets() {
			try {
				return JSON.parse(localStorage.getItem(this._LS_PRESETS()) || '{}');
			} catch {
				return {};
			}
		}
		_writePresets(obj) {
			localStorage.setItem(this._LS_PRESETS(), JSON.stringify(obj || {}));
		}

		saveAsPreset(name) {
			if (!name) return;
			let state = null;
			try {
				state = this.api?.getState?.();
			} catch {}
			if (!state) {
				this.showToast('Não foi possível capturar o estado da grid', 'danger');
				return;
			}
			// Se existir LionCalcColumns, inclui no preset
			const calcColumns =
				(root.LionCalcColumns?.exportForPreset && root.LionCalcColumns.exportForPreset()) || [];

			const bag = this._readPresets();
			bag[name] = { v: 1, name, createdAt: Date.now(), grid: state, calcColumns };
			this._writePresets(bag);
			localStorage.setItem(this._LS_ACTIVE(), name);
			this.showToast(`Preset "${name}" salvo`, 'success');
		}

		applyPreset(name) {
			if (!name) return;
			const bag = this._readPresets();
			const p = bag[name];
			if (!p?.grid) {
				this.showToast('Preset não encontrado', 'warning');
				return;
			}

			// Limpa/ativa CalcColumns somente se o módulo existir
			if (root.LionCalcColumns?.clear) {
				try {
					root.LionCalcColumns.clear();
				} catch {}
			}
			if (
				Array.isArray(p.calcColumns) &&
				p.calcColumns.length > 0 &&
				root.LionCalcColumns?.importFromPreset
			) {
				try {
					root.LionCalcColumns.importFromPreset(p.calcColumns);
				} catch {}
			}

			this.setState(p.grid, ['pagination', 'scroll', 'rowSelection', 'focusedCell']);
			localStorage.setItem(this._LS_ACTIVE(), name);
			this.showToast(`Preset "${name}" aplicado`, 'success');
		}

		listPresets() {
			return Object.values(this._readPresets() || {}).sort(
				(a, b) => (a.createdAt || 0) - (b.createdAt || 0)
			);
		}

		// ============================
		// 6) SSRM REFRESH (compat)
		// ============================
		refreshSSRM() {
			const api = this.api;
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

		// ============================
		// 7) EXPORT (CSV/TSV) & SIZE/PIN
		// ============================
		exportData({ type = 'csv', fileName = 'lion-grid', columnKeys, onlySelected = false } = {}) {
			if (!this.api) return;
			const opts = {
				fileName: `${fileName}.${type === 'tsv' ? 'tsv' : 'csv'}`,
				columnSeparator: type === 'tsv' ? '\t' : ',',
				columnKeys: Array.isArray(columnKeys) ? columnKeys : undefined,
				onlySelected: !!onlySelected,
			};
			this.api.exportDataAsCsv(opts);
			this.showToast('Export iniciado', 'success');
		}

		getSizeMode() {
			const v = localStorage.getItem(this._LS_SIZE());
			return v === 'auto' ? 'auto' : 'fit';
		}
		setSizeMode(mode) {
			localStorage.setItem(this._LS_SIZE(), mode === 'auto' ? 'auto' : 'fit');
			this._applySizeMode(this.getSizeMode());
		}
		_applySizeMode(mode) {
			const api = this.api;
			if (!api) return;
			try {
				if (mode === 'auto') {
					const all = api.getColumns()?.map((c) => c.getColId()) || [];
					api.autoSizeColumns(all, false);
				} else {
					api.sizeColumnsToFit();
				}
			} catch {}
		}

		pinDefaultColumns(checked) {
			const api = this.api;
			if (!api) return;
			const leftPins = [
				{ colId: 'ag-Grid-SelectionColumn', pinned: checked ? 'left' : null },
				{ colId: 'ag-Grid-AutoColumn', pinned: checked ? 'left' : null },
				{ colId: 'profile_name', pinned: checked ? 'left' : null },
			];
			const rightPins = [
				{ colId: 'spent', pinned: checked ? 'right' : null },
				{ colId: 'revenue', pinned: checked ? 'right' : null },
				{ colId: 'mx', pinned: checked ? 'right' : null },
				{ colId: 'profit', pinned: checked ? 'right' : null },
			];
			api.applyColumnState({ state: [...leftPins, ...rightPins], defaultState: { pinned: null } });
			this.showToast(checked ? 'Pins aplicados' : 'Pins removidos', checked ? 'success' : 'info');
		}

		// ============================
		// 8) TOOLBAR GLOBAL (binds)
		// ============================
		/**
		 * Conecta botões/inputs da sua barra de ferramentas global.
		 * Exemplo:
		 *  tm.attachToolbar({
		 *    quickFilterInput: '#quickFilter',
		 *    resetBtn: '#tb-reset',
		 *    exportCsvBtn: '#tb-export',
		 *    exportTsvBtn: '#tb-export-tsv',
		 *    savePresetBtn: '#tb-save-preset',
		 *    activePresetSelect: '#tb-preset-select',
		 *    sizeToggleBtn: '#tb-size-toggle',
		 *    pinToggleCheckbox: '#tb-pin-toggle'
		 *  });
		 */
		attachToolbar(sel = {}) {
			const q = (s) => (typeof s === 'string' ? document.querySelector(s) : s) || null;

			// quick filter global
			const $qf = q(sel.quickFilterInput);
			if ($qf) {
				$qf.addEventListener('input', () => this.setGlobalQuickFilter($qf.value || ''), {
					passive: true,
				});
			}

			// reset layout
			const $reset = q(sel.resetBtn);
			if ($reset) $reset.addEventListener('click', () => this.resetLayout());

			// export
			const $csv = q(sel.exportCsvBtn);
			if ($csv) $csv.addEventListener('click', () => this.exportData({ type: 'csv' }));
			const $tsv = q(sel.exportTsvBtn);
			if ($tsv) $tsv.addEventListener('click', () => this.exportData({ type: 'tsv' }));

			// preset: salvar
			const $savePreset = q(sel.savePresetBtn);
			if ($savePreset) {
				$savePreset.addEventListener('click', () => {
					const name = prompt('Nome do preset:');
					if (name) this.saveAsPreset(String(name).trim());
				});
			}

			// preset: aplicar (select)
			const $presetSelect = q(sel.activePresetSelect);
			if ($presetSelect) {
				// popular opções
				const fill = () => {
					const list = this.listPresets();
					while ($presetSelect.options.length) $presetSelect.remove(0);
					const opt0 = new Option('— Presets —', '');
					opt0.disabled = true;
					opt0.selected = true;
					$presetSelect.add(opt0);
					for (const p of list) {
						$presetSelect.add(new Option(p.name, p.name));
					}
				};
				fill();
				$presetSelect.addEventListener('change', () => {
					const v = $presetSelect.value || '';
					if (v) this.applyPreset(v);
				});
			}

			// size toggle (auto/fit)
			const $size = q(sel.sizeToggleBtn);
			if ($size) {
				$size.addEventListener('click', () => {
					const next = this.getSizeMode() === 'auto' ? 'fit' : 'auto';
					this.setSizeMode(next);
					this.showToast(`Size mode: ${next}`, 'info');
				});
			}

			// pin default
			const $pin = q(sel.pinToggleCheckbox);
			if ($pin) {
				$pin.addEventListener('change', () => this.pinDefaultColumns(!!$pin.checked));
			}

			this.showToast('Toolbar conectada', 'success');
		}

		// ============================
		// 9) MAKE GRID (ponto de entrada)
		// ============================
		makeGrid({ columnDefs = [], gridOptions = {}, autoGroupColumnDef } = {}) {
			const AG = this._getAG();

			const container =
				typeof this.containerRef === 'string'
					? document.querySelector(this.containerRef)
					: this.containerRef;

			if (!container) {
				console.error('[TableManager] container não encontrado');
				return null;
			}
			container.classList.add('ag-theme-quartz');

			const defaultColDef = Object.assign(
				{
					sortable: true,
					filter: 'agTextColumnFilter',
					floatingFilter: true,
					resizable: true,
					wrapHeaderText: true,
					autoHeaderHeight: true,
					enableRowGroup: true,
					enablePivot: true,
					enableValue: true,
					suppressHeaderFilterButton: true,
				},
				gridOptions.defaultColDef || {}
			);

			const merged = Object.assign(
				{
					theme: this.createTheme(),
					columnDefs: [].concat(columnDefs),
					defaultColDef,
					autoGroupColumnDef: autoGroupColumnDef || gridOptions.autoGroupColumnDef,
					rowModelType: gridOptions.rowModelType || 'serverSide',
					cacheBlockSize: gridOptions.cacheBlockSize || 200,
					treeData: gridOptions.treeData ?? true,
					sideBar: gridOptions.sideBar ?? {
						toolPanels: ['columns', 'filters'],
						defaultToolPanel: null,
						position: 'right',
					},
					context: Object.assign({}, gridOptions.context || {}, {
						showToast: (msg, type) => this.showToast(msg, type),
						getCurrency: () => this.getCurrency(),
						getGlobalQuickFilter: () => this.getGlobalQuickFilter(),
					}),
					onGridReady: (params) => {
						this.api = params.api;
						this.columnApi = params.columnApi;

						// aplica preset ativo se houver
						const activePreset = localStorage.getItem(this._LS_ACTIVE());
						if (activePreset) {
							const bag = this._readPresets();
							const p = bag[activePreset];
							if (p?.grid) {
								this.setState(p.grid, [
									'pagination',
									'scroll',
									'rowSelection',
									'focusedCell',
								]);
								// reativa calc columns se existir módulo
								if (root.LionCalcColumns?.activateAll) {
									try {
										root.LionCalcColumns.activateAll();
									} catch {}
								}
							}
						}

						// aplica size mode
						this._applySizeMode(this.getSizeMode());

						// permite que o bootstrap injete datasource próprio; se não, deixa como está
						if (!gridOptions.serverSideDatasource && !gridOptions.getChildRows) {
							// datasource “placeholder” (o core/bootstraps devem setar algo real)
							const ds = {
								getRows: (rq) => {
									// Sem fonte padrão aqui. O “core” proverá o SSRM real.
									rq.success({ rowData: [], rowCount: 0 });
								},
							};
							params.api.setGridOption('serverSideDatasource', ds);
						}
					},
				},
				gridOptions
			);

			new AG.Grid(container, merged);
			try {
				root.__lastTableManagerInstance = this;
			} catch {}
			return this;
		}
	}

	// export ES module + global
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = { TableManager };
	}
	root.TableManager = TableManager;
})(this);
