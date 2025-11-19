import {
	withMinSpinner,
	showToast,
	sleep,
	stripHtml,
	intFmt,
	frontToNumberBR,
	frontToNumberFirst,
	sumNum,
	safeDiv,
	numBR,
	cc_currencyFormat,
	cc_percentFormat,
	copyToClipboard,
	StackBelowRenderer,
	cc_evalExpression,
	setAppCurrency,
} from './utils.js';

export let GLOBAL_QUICK_FILTER = '';

function getAgGrid() {
	const AG = globalThis.agGrid;
	if (!AG) throw new Error('AG Grid UMD not loaded. Check the script ORDER and the CDN path.');
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

function buildFilterModelWithGlobal(baseFilterModel) {
	const fm = { ...(baseFilterModel || {}) };
	const gf = (GLOBAL_QUICK_FILTER || '').trim();
	fm._global = Object.assign({}, fm._global, { filter: gf });
	return fm;
}

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

export class Table {
	constructor(columnDefs = [], opts = {}) {
		// =================================================================
		// 1. CONFIGURAÇÃO CENTRALIZADA (Padrão "Ou um Ou Outro" ||)
		// =================================================================
		this.config = {
			// Seletores DOM
			selectors: {
				container: opts.container || opts.selectors?.container || '#lionGrid',
				quickFilter: opts.selectors?.quickFilter || '#quickFilter',
				pinToggle: opts.selectors?.pinToggle || '#pinToggle',
				sizeModeToggle: opts.selectors?.sizeModeToggle || '#colSizeModeToggle',
				presetSelect: opts.selectors?.presetSelect || '#presetUserSelect',
				presetFileInput: opts.selectors?.presetFileInput || '#presetFileInput',
				btnResetLayout: opts.selectors?.btnResetLayout || '#btnResetLayout',
				btnSavePreset: opts.selectors?.btnSavePreset || '#btnSaveAsPreset',
				btnDeletePreset: opts.selectors?.btnDeletePreset || '#btnDeletePreset',
				btnDownloadPreset: opts.selectors?.btnDownloadPreset || '#btnDownloadPreset',
				btnUploadPreset: opts.selectors?.btnUploadPreset || '#btnUploadPreset',

				// Modal Calc Cols
				modalCalcCols: opts.selectors?.modalCalcCols || '#calcColsModal',
				btnAddCalcCol: opts.selectors?.btnAddCalcCol || '#btnCalcCols',
				btnManageCalcCols: opts.selectors?.btnManageCalcCols || '#btnManageCalcCols',
				ccCol1: opts.selectors?.ccCol1 || '#cc-col1',
				ccCol2: opts.selectors?.ccCol2 || '#cc-col2',
				ccFormat: opts.selectors?.ccFormat || '#cc-format',
				ccExpression: opts.selectors?.ccExpression || '#cc-expression',
				ccParts: opts.selectors?.ccParts || '#cc-parts',
				ccList: opts.selectors?.ccList || '#cc-list',
				ccEmpty: opts.selectors?.ccEmpty || '#cc-empty',
				ccSave: opts.selectors?.ccSave || '#cc-save',
				ccReload: opts.selectors?.ccReload || '#cc-reload',
				ccReset: opts.selectors?.ccReset || '#cc-reset-form',
				ccActivateAll: opts.selectors?.ccActivateAll || '#cc-activate-all',
				ccHeader: opts.selectors?.ccHeader || '#cc-header',
				ccId: opts.selectors?.ccId || '#cc-id',
				ccType: opts.selectors?.ccType || '#cc-type',
				ccOnlyLevel0: opts.selectors?.ccOnlyLevel0 || '#cc-only-level0',
				ccAfter: opts.selectors?.ccAfter || '#cc-after',
				ccMini: opts.selectors?.ccMini || '#cc-mini',

				// Modal de Drilldown/Detalhes
				modalDrilldown: opts.selectors?.modalDrilldown || '#lionKtModal',
				modalDrilldownTitle: opts.selectors?.modalDrilldownTitle || '.kt-modal-title',
				modalDrilldownBody: opts.selectors?.modalDrilldownBody || '.kt-modal-body > pre',
				modalDrilldownClose: opts.selectors?.modalDrilldownClose || '.kt-modal-close',
			},

			// Endpoints de API (Movido para config)
			endpoints: opts.endpoints || {
				SSRM: '/api/ssrm/?clean=1&mode=full',
				ADSETS: '/api/adsets/',
				ADS: '/api/ads/',
			},

			// Aliases de Colunas (Movido para config - antigo this.map)
			aliases: opts.aliases ||
				opts.map || {
					revenue: ['revenue', 'receita', 'receitas', 'rev', 'fat', 'faturamento'],
					spent: ['spent', 'gasto', 'gastos', 'spend', 'despesa', 'custo'],
					profit: ['profit', 'lucro', 'resultado', 'ganho'],
					mx: ['mx', 'roi', 'roas', 'retorno'],
					ctr: ['ctr', 'taxadeclique'],
					clicks: ['clicks', 'cliques'],
				},

			// Configurações de Drill/Rede (Movido para config - antigo this.drill)
			drill: opts.drill || {
				period: 'TODAY',
				minSpinnerMs: 900,
				fakeNetworkMs: 0,
			},

			// Configurações Visuais e Estilos Injetados (NOVO - Remove hardcoded CSS)
			styles: opts.styles || {
				loadingColor: '#9ca3af',
				errorColor: '#ef4444',
				errorBg: 'rgba(239, 68, 68, 0.12)',
				backdrop: {
					background: '#000 !important',
					opacity: '0.5 !important',
					zIndex: '1050',
				},
				modalZIndex: '1055',
			},

			// Configurações do Setup do Grid AG (NOVO - Remove hardcoded properties do makeGrid)
			gridSetup: opts.gridSetup || {
				themeClass: 'ag-theme-quartz',
				selectionColWidth: 36,
				sideBar: {
					toolPanels: ['columns', 'filters'],
					defaultToolPanel: null,
					position: 'right',
				},
				animateRows: true,
			},

			// Templates HTML
			templates: {
				modalDrilldown:
					opts.templates?.modalDrilldown ||
					`
					<div class="kt-modal hidden" id="{id}" aria-hidden="true" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;align-items:center;justify-content:center;">
						<div class="kt-modal-content" style="background:#09090B;color:#fff;padding:20px;border-radius:8px;max-width:500px;width:90%;max-height:80vh;overflow:auto;position:relative;">
							<div class="kt-modal-header" style="display:flex;justify-content:space-between;margin-bottom:15px;">
								<h3 class="kt-modal-title" style="font-weight:bold;font-size:1.1rem;">Details</h3>
								<button type="button" class="kt-modal-close" style="background:none;border:none;color:#fff;font-size:1.2rem;cursor:pointer;">✕</button>
							</div>
							<div class="kt-modal-body"><pre class="whitespace-pre-wrap text-sm" style="white-space:pre-wrap;word-break:break-word;"></pre></div>
						</div>
					</div>`,
			},

			// Chaves de Storage
			storageKeys: {
				gridState: opts.storageKeys?.gridState || opts.GRID_STATE_KEY || 'lion.aggrid.state.v1',
				presets: opts.storageKeys?.presets || 'lion.aggrid.presets.v1',
				activePreset: opts.storageKeys?.activePreset || 'lion.aggrid.activePreset.v1',
				pinnedState: opts.storageKeys?.pinnedState || 'lion.aggrid.pinnedState',
				sizeMode: opts.storageKeys?.sizeMode || 'lion.aggrid.sizeMode',
				calcCols: opts.storageKeys?.calcCols || 'lion.aggrid.calcCols.v1',
			},

			// Callbacks
			callbacks: {
				computeTotals: opts.callbacks?.computeTotals || null,
				customSort: opts.callbacks?.customSort || null,
				getCalculableColumns: opts.callbacks?.getCalculableColumns || null,
				getCellText: opts.callbacks?.getCellText || null,
				normalizeRow: opts.callbacks?.normalizeRow || null,
			},

			// Mapeamento de Chaves de Dados
			dataKeys: opts.dataKeys || {
				id: 'id',
				campaign_name: 'campaign_name',
				utm_campaign: 'utm_campaign',
				adset_name: 'name',
				ad_name: 'name',
				revenue: 'revenue',
				spent: 'spent',
				profit: 'profit',
				mx: 'mx',
				fb_revenue: 'fb_revenue',
				push_revenue: 'push_revenue',
				budget: 'budget',
				impressions: 'impressions',
				clicks: 'clicks',
				visitors: 'visitors',
				conversions: 'conversions',
				real_conversions: 'real_conversions',
				cpc_total: 'cpc_total',
				cpa_fb_total: 'cpa_fb_total',
				real_cpa_total: 'real_cpa_total',
				ctr_total: 'ctr_total',
				epc_total: 'epc_total',
				mx_total: 'mx_total',
			},

			// Comportamento e Dados
			behavior: {
				currency: opts.currency || opts.LION_CURRENCY || 'BRL',
				locale: opts.locale || 'pt-BR',
				wrapFields: opts.wrapFields ||
					opts.WRAP_FIELDS || ['campaign', 'bc_name', 'account_name'],
				selectionColumnId:
					opts.selectionColumnId || opts.selectionColumn || 'ag-Grid-SelectionColumn',
				autoGroupColumnId: opts.autoGroupColumnId || 'campaign',
				autoGroupHeader: opts.autoGroupHeader || 'Campaign',

				defaultInsertAfter: opts.behavior?.defaultInsertAfter || 'Revenue',
				pinnedRight: opts.pinnedRight || ['spent', 'revenue', 'mx', 'profit'],
				pinnedLeft: opts.pinnedLeft || ['profile_name'],
				statusOrder: opts.statusOrder || ['ACTIVE', 'PAUSED', 'DISABLED', 'CLOSED'],
				statusColIds: opts.statusColIds || ['account_status', 'campaign_status', 'status'],
				totalLabelPrefix: opts.totalLabelPrefix || 'CAMPAIGNS: ',
				calcDenyList: opts.calcDenyList || [
					'ag-Grid-AutoColumn',
					'ag-Grid-RowGroup',
					'__autoGroup',
				],
				modalOpenFields: opts.modalOpenFields || [
					'profile_name',
					'bc_name',
					'account_name',
					'account_status',
					'account_limit',
					'campaign_name',
					'utm_campaign',
				],
				legacyAutoGroupIds: ['ag-Grid-AutoColumn'],
				ignoreOnRestore: opts.ignoreOnRestore || [
					'pagination',
					'scroll',
					'rowSelection',
					'focusedCell',
				],
			},

			// Layout (Tamanhos e Ajustes)
			layout: opts.layout || {
				headerHeight: 62,
				groupHeaderHeight: 35,
				floatingFiltersHeight: 35,
				rowHeightMin: 50,
				rowVertPad: 12, // Padding vertical para rows com wrap
				autoGroupMinWidth: 280,
				calcColMinWidth: 150, // [NOVO] Largura min colunas calculadas
				cacheBlockSize: 200,
				// [NOVO] Magic numbers usados para medir texto
				measurePadding: 12, // Usado em getFieldContentWidth
				autoGroupOffset: 44, // Usado em getAutoGroupContentWidth
			},

			// Textos UI
			text: opts.text || {
				copyCampaign: 'Copy Campaign',
				copyUTM: 'Copy UTM',
				copyWithParts: 'Copy with parts',
				modalDetailsTitle: 'Details',
				modalCampaignTitle: 'Campaign',
				emptyValue: '—',
				noName: '(no name)',
				adsetDefault: '(adset)',
				adDefault: '(ad)',
				toastLayoutReset: 'Layout Reset',
				toastPresetSaved: 'Preset "{name}" saved',
				toastPresetApplied: 'Preset "{name}" applied',
				toastPresetRemoved: 'Preset "{name}" removed',
				toastPresetDownloaded: 'Preset "{name}" downloaded',
				toastColumnSaved: 'Column Saved',
				toastActivated: 'Activated',
				toastCopied: 'Copied',
				toastCopiedParts: 'Copied (with parts)',
			},

			// Modal de Colunas Calculadas
			calcConfig: opts.calcConfig || {
				ignoredHeaderPatterns: ['select', 'ação', 'action'],
				operators: [
					{ value: 'custom', label: '✎ Custom Expression', template: '' },
					{
						value: 'divide',
						label: '÷ Division (A / B)',
						template: 'number({col1}) / number({col2})',
					},
					{
						value: 'multiply',
						label: '× Multiplication (A × B)',
						template: 'number({col1}) * number({col2})',
					},
					{
						value: 'add',
						label: '+ Addition (A + B)',
						template: 'number({col1}) + number({col2})',
					},
					{
						value: 'subtract',
						label: '− Subtraction (A − B)',
						template: 'number({col1}) - number({col2})',
					},
					{
						value: 'percent',
						label: '% Percentage (A / B × 100)',
						template: '(number({col1}) / number({col2})) * 100',
					},
					{
						value: 'percent_change',
						label: 'Δ% Change ((B-A)/A × 100)',
						template: '((number({col2}) - number({col1})) / number({col1})) * 100',
					},
					{
						value: 'average',
						label: '⌀ Average ((A+B)/2)',
						template: '(number({col1}) + number({col2})) / 2',
					},
				],
			},

			theme: opts.theme || {},
		};

		setAppCurrency(this.config.behavior.currency);
		this.columnDefs = Array.isArray(columnDefs) ? columnDefs : [];
		this.defaultColDef = opts.defaultColDef;
		this.gridDiv = null;
		this.gridApi = null;
		this.gridColumnApi = null;
		this.api = null;

		const parentTable = this;

		// --- Classes Internas ---

		class LionCompositeColumns {
			constructor(map) {
				this.registry = new Map();
				this.api = null;
				this.map = map;
			}

			initGridApi(api, columnApi) {
				this.api = api;
			}

			register(id, builder) {
				this.registry.set(String(id), builder);
			}

			_ensureApi() {
				if (!this.api) throw new Error('[CompositeColumns] Grid API indisponível');
				return this.api;
			}

			_getColumnDefs(api) {
				if (typeof api.getColumnDefs === 'function') return api.getColumnDefs() || [];
				const cols = api.getColumns?.() || [];
				return cols.map((c) => c.getColDef?.()).filter(Boolean);
			}

			_setColumnDefs(api, defs) {
				if (typeof api.setGridOption === 'function') api.setGridOption('columnDefs', defs);
				else if (typeof api.setColumnDefs === 'function') api.setColumnDefs(defs);
				else api.getColumnApi?.()?.setColumnDefs(defs);
			}

			_findGroup(defs, groupId) {
				for (const d of defs) if (d?.groupId === groupId) return d;
				return null;
			}

			_normKey(s) {
				return String(s || '')
					.toLowerCase()
					.normalize('NFD')
					.replace(/[\u0300-\u036f]/g, '')
					.replace(/[^a-z0-9]/g, '');
			}

			_buildColIndex(allDefs) {
				const map = new Map();
				const walk = (defsList, visit) => {
					(defsList || []).forEach((d, idx) => {
						if (d?.children?.length) walk(d.children, visit);
						else visit(d, defsList, idx);
					});
				};
				walk(allDefs, (leaf, arr, idx) => {
					const keys = [
						this._normKey(leaf?.colId),
						this._normKey(leaf?.field),
						this._normKey(leaf?.headerName),
					].filter(Boolean);
					keys.forEach((k) => {
						if (!map.has(k)) map.set(k, { arr, idx, leaf });
					});
				});
				return map;
			}

			_aliasList(raw) {
				const s = String(raw || '')
					.trim()
					.toLowerCase();

				for (const [k, arr] of Object.entries(this.map)) {
					if (arr.includes(s)) return [k, ...arr];
				}
				return [raw];
			}

			_pickHitByTargets(allDefs, idxMap, afterTargets) {
				for (const raw of afterTargets.flatMap((t) => this._aliasList(t))) {
					const key = this._normKey(raw);
					if (key && idxMap.has(key)) return idxMap.get(key);
				}
				return null;
			}

			_insertAfter(allDefs, newDef, afterKey, fallbackGroupNode) {
				const targets = (Array.isArray(afterKey) ? afterKey : [afterKey]).filter((k) => k);
				const idxMap = this._buildColIndex(allDefs);
				const hit = this._pickHitByTargets(allDefs, idxMap, targets);

				if (hit) {
					hit.arr.splice(hit.idx + 1, 0, newDef);
					return;
				}
				if (fallbackGroupNode && Array.isArray(fallbackGroupNode.children)) {
					fallbackGroupNode.children.push(newDef);
				} else {
					allDefs.push(newDef);
				}
			}

			_removeCols(allDefs, idsSet) {
				const filterArray = (arr) => {
					for (let i = arr.length - 1; i >= 0; i--) {
						const d = arr[i];
						if (d?.children?.length) filterArray(d.children);
						else {
							const key = String(d?.colId || d?.field || '');
							if (key && idsSet.has(key)) arr.splice(i, 1);
						}
					}
				};
				filterArray(allDefs);
			}

			activate(ids = []) {
				const api = this._ensureApi();
				const defsRef = this._getColumnDefs(api);
				const newDefs = Array.isArray(defsRef) ? defsRef.slice() : [];
				const fallbackGroupNode = this._findGroup(newDefs, 'grp-metrics-rev');
				let idxMap = this._buildColIndex(newDefs);
				let hasChanges = false;
				const idsList = Array.isArray(ids) ? ids : [ids];

				for (const id of idsList) {
					const builder = this.registry.get(String(id));
					if (!builder) continue;
					const colDef = builder();
					if (!colDef) continue;

					const colKey = this._normKey(String(colDef.colId || colDef.field || ''));
					if (!colKey || idxMap.has(colKey)) continue;

					let afterRaw =
						colDef.__afterId ||
						colDef.__after ||
						parentTable.config.behavior.defaultInsertAfter;
					this._insertAfter(newDefs, colDef, afterRaw, fallbackGroupNode);
					idxMap = this._buildColIndex(newDefs);
					hasChanges = true;
				}

				if (hasChanges) this._setColumnDefs(api, newDefs);
				return true;
			}

			deactivate(ids = []) {
				const api = this._ensureApi();
				const defsRef = this._getColumnDefs(api);
				const newDefs = Array.isArray(defsRef) ? defsRef.slice() : [];
				const idsSet = new Set(ids.map(String));
				this._removeCols(newDefs, idsSet);
				this._setColumnDefs(api, newDefs);
				return true;
			}
		}

		class LionCalcColumns {
			constructor(compositeInstance) {
				this.composite = compositeInstance;
				this.LS_KEY = parentTable.config.storageKeys.calcCols;
			}

			_read() {
				try {
					return JSON.parse(localStorage.getItem(this.LS_KEY) || '[]');
				} catch {
					return [];
				}
			}

			_write(arr) {
				localStorage.setItem(this.LS_KEY, JSON.stringify(Array.isArray(arr) ? arr : []));
			}

			_autoWrapFields(expr) {
				if (!expr || /\bnumber\s*\(/.test(expr)) return expr;
				return expr.replace(/\b([a-zA-Z_]\w*)(?!\s*\()/g, 'number($1)');
			}

			_compileExpr(expr) {
				const src = String(expr || '').trim();
				if (!src) return null;
				const wrapped = this._autoWrapFields(src);
				return (row) => cc_evalExpression(wrapped, row);
			}

			_norm(cfg) {
				const mini = !!cfg.mini;
				const format = (cfg.format || 'currency').toLowerCase();
				const partsFormat = (
					cfg.partsFormat || (format === 'percent' ? 'currency' : format)
				).toLowerCase();

				return {
					...cfg,
					id: String(cfg.id || '').trim(),
					expression: String(cfg.expression || '').trim(),
					format: format,
					partsFormat: partsFormat,
					parts: Array.isArray(cfg.parts) ? cfg.parts : [],
					mini: mini,
					hideTop: mini,
					includeTotalAsPart: mini,
					onlyLevel0: cfg.onlyLevel0 ?? cfg.onlyRoot ?? true,
					after: cfg.after || 'Revenue',
				};
			}
			_migrateLegacyColumn(cfg) {
				const m = { ...cfg };
				if ((!m.parts || m.parts.length === 0) && m.expression) {
					const matches = (m.expression || '').match(/\b([a-zA-Z_]\w*)(?!\s*\()/g);
					if (matches) {
						const unique = [...new Set(matches)].filter(
							(f) => !['number', 'Math'].includes(f)
						);
						m.parts = unique
							.slice(0, 5)
							.map((f) => ({ label: f.replace(/_/g, ' '), expr: f }));
					}
				}
				return m;
			}

			_fmtBy(fmt, n) {
				if (!Number.isFinite(n)) return parentTable.config.text.emptyValue || '—';
				if (fmt === 'int') return intFmt.format(Math.round(n));
				if (fmt === 'raw') {
					return n.toLocaleString('pt-BR', {
						minimumFractionDigits: 2,
						maximumFractionDigits: 6,
					});
				}
				if (fmt === 'percent') return cc_percentFormat(n);
				return cc_currencyFormat(n);
			}

			_buildColDef(cfg) {
				const n = this._norm(cfg);
				const totalFn = this._compileExpr(n.expression);
				const partFns = (n.parts || []).map((p) => ({
					label: p.label,
					fn: this._compileExpr(p.expr),
				}));
				const defaultAfter = parentTable.config.behavior.defaultInsertAfter;

				// [PARAMETRIZADO] minWidth via config layout
				const minW = parentTable.config.layout.calcColMinWidth || 150;

				return {
					headerName: n.headerName || n.id,
					colId: n.id,
					minWidth: minW,
					flex: 1,
					sortable: false,
					filter: false,
					floatingFilter: false,
					valueGetter: (p) => (totalFn ? totalFn(p.data || {}) : null),
					valueFormatter: (p) => {
						const v = p.value;
						if (!Number.isFinite(v)) return '';
						return this._fmtBy(n.format, v);
					},
					tooltipValueGetter: (p) => {
						const row = p.data || {};
						const tot = totalFn ? totalFn(row) : null;
						const lines = [`${n.totalLabel || 'Total'}: ${this._fmtBy(n.format, tot)}`];
						partFns.forEach(({ label, fn }) => {
							lines.push(
								`${label}: ${this._fmtBy(
									n.partsFormat || n.format,
									fn ? fn(row) : null
								)}`
							);
						});
						return lines.join('\n');
					},
					cellRenderer: StackBelowRenderer,
					cellRendererParams: {
						format: n.format,
						partsMaxHeight: 40, // Pode ser parametrizado se necessário
						onlyLevel0: !!n.onlyLevel0,
						showTop: !n.hideTop,
						showLabels: !!n.mini,
						getParts: (p) => {
							const row = p.data || {};
							const list = [];
							if (n.includeTotalAsPart) {
								list.push({
									label: n.totalLabel || 'Total',
									value: totalFn ? totalFn(row) : null,
									isTotal: true,
									format: n.format,
								});
							}
							partFns.forEach(({ label, fn }) => {
								list.push({
									label,
									value: fn ? fn(row) : null,
									format: n.partsFormat,
								});
							});
							return list;
						},
					},
					__after: n.after || defaultAfter,
				};
			}

			add(config) {
				const cfg = this._norm(config);
				if (!cfg.id) return false;
				const bag = this._read();
				const idx = bag.findIndex((c) => String(c.id) === cfg.id);
				if (idx >= 0) bag[idx] = cfg;
				else bag.push(cfg);
				this._write(bag);

				const colDef = this._buildColDef(cfg);
				if (colDef) {
					this.composite.register(colDef.colId, () => colDef);
					this.composite.activate([colDef.colId]);
				}
				return true;
			}

			remove(id) {
				const key = String(id || '').trim();
				if (!key) return;
				this.composite.deactivate([key]);
				const bag = this._read().filter((c) => String(c.id) !== key);
				this._write(bag);
			}

			list() {
				return this._read();
			}

			activateAll() {
				const bag = this._read();
				const idsToActivate = [];
				for (const cfg of bag) {
					const m = this._migrateLegacyColumn(cfg);
					const colDef = this._buildColDef(m);
					if (colDef) {
						this.composite.register(colDef.colId, () => colDef);
						idsToActivate.push(colDef.colId);
					}
				}
				if (idsToActivate.length > 0) {
					this.composite.activate(idsToActivate);
					console.log(`[CalcCols] Batch activated ${idsToActivate.length} columns`);
				}
			}

			deactivateAllVisuals() {
				const bag = this._read();
				const ids = bag.map((c) => String(c.id));
				if (ids.length > 0) {
					this.composite.deactivate(ids);
					console.log('[CalcCols] Visuals deactivated (storage kept)');
				}
			}

			clear() {
				this.deactivateAllVisuals();
				this._write([]);
			}
			exportForPreset() {
				return this._read().map((c) => this._migrateLegacyColumn(c));
			}
			importFromPreset(cols) {
				if (Array.isArray(cols)) {
					this._write(cols);
					this.activateAll();
				}
			}
		}

		// [CORREÇÃO] Passa aliases configurados (config.aliases) para CompositeColumns
		this.composite = new LionCompositeColumns(this.config.aliases);
		this.calc = new LionCalcColumns(this.composite);
	}

	// === Helpers de Seletor Dinâmico ===
	_el(key) {
		const selector = this.config.selectors[key];
		return selector ? document.querySelector(selector) : null;
	}
	_sel(key) {
		return this.config.selectors[key] || '';
	}

	init() {
		this.ensureLoadingStyles();
		this.initModalEvents();
		this.CalcColsPopulate();
		this.setupToolbar();
		return this.makeGrid();
	}

	setupToolbar() {
		const tableInstance = this;

		const ensureApi = () => {
			if (!this.api) throw new Error('Grid API indisponível');
			return this.api;
		};

		const SS_KEY_STATE = this.config.storageKeys.gridState;
		const LS_KEY_PRESETS = this.config.storageKeys.presets;
		const LS_KEY_ACTIVE_PRESET = this.config.storageKeys.activePreset;

		const saveState = () => {
			const api = ensureApi();
			if (!api) return;
			try {
				const state = api.getState();
				sessionStorage.setItem(SS_KEY_STATE, JSON.stringify({ state }));
			} catch (e) {
				console.warn('Failed to save state', e);
			}
		};

		const syncTogglesUI = () => {
			const api = tableInstance.api;
			if (!api) return;

			const pinToggle = this._el('pinToggle');
			if (pinToggle) {
				const col = api.getColumn(this.config.behavior.selectionColumnId);
				const isPinned = col ? col.isPinnedLeft() : true;
				pinToggle.checked = !!isPinned;
				tableInstance._setPinnedState(!!isPinned);
			}

			const sizeToggle = this._el('sizeModeToggle');
			if (sizeToggle) {
				const mode = tableInstance._getSizeMode();
				sizeToggle.checked = mode === 'auto';
			}
		};

		const getState = () => ensureApi()?.getState() || null;
		const setState = (state, ignore) => {
			const api = ensureApi();
			if (api) api.setState(state, ignore || this.config.behavior.ignoreOnRestore);
		};

		const applySizeMode = (mode) => {
			const api = tableInstance.api;
			if (!api) return;
			try {
				if (mode === 'auto') {
					const all = api.getColumns()?.map((c) => c.getColId()) || [];
					api.autoSizeColumns(all, false);
				} else {
					api.sizeColumnsToFit();
				}
			} catch {}
		};

		// --- Ações de Presets ---

		const readPresets = () => {
			try {
				return JSON.parse(localStorage.getItem(LS_KEY_PRESETS) || '{}');
			} catch {
				return {};
			}
		};
		const writePresets = (obj) => localStorage.setItem(LS_KEY_PRESETS, JSON.stringify(obj));

		const listPresetNames = () =>
			Object.keys(readPresets()).sort((a, b) => a.localeCompare(b, this.config.behavior.locale));

		const refreshPresetUserSelect = () => {
			const sel = this._el('presetSelect');
			if (!sel) return;
			const activePreset = localStorage.getItem(LS_KEY_ACTIVE_PRESET) || '';
			while (sel.firstChild) sel.removeChild(sel.firstChild);
			sel.appendChild(new Option('Default', ''));
			listPresetNames().forEach((name) => sel.appendChild(new Option(name, name)));
			if (activePreset && [...sel.options].some((o) => o.value === activePreset))
				sel.value = activePreset;
			else sel.value = '';
		};

		const resetLayout = () => {
			const api = ensureApi();
			if (!api) return;
			try {
				sessionStorage.removeItem(SS_KEY_STATE);
				localStorage.removeItem(LS_KEY_ACTIVE_PRESET);
				const sel = this._el('presetSelect');
				if (sel) sel.value = '';

				tableInstance.calc?.deactivateAllVisuals?.();
				const pinToggle = this._el('pinToggle');
				if (pinToggle) pinToggle.checked = true;
				tableInstance._setPinnedState(true);
				const sizeToggle = this._el('sizeModeToggle');
				if (sizeToggle) sizeToggle.checked = false;
				tableInstance._setSizeMode('fit');

				api.setState({}, []);
				api.resetColumnState?.();
				api.setFilterModel?.(null);
				api.setSortModel?.([]);

				setTimeout(() => {
					tableInstance.togglePinnedColsFromCheckbox(true);
					applySizeMode('fit');
					syncTogglesUI();
					showToast(this.config.text.toastLayoutReset || 'Layout Reset', 'info');
				}, 50);
			} catch (e) {
				console.warn('resetLayout fail', e);
			}
		};

		const saveAsPreset = () => {
			const api = this.api;
			if (!api) return showToast('Grid API not ready', 'warning');
			const name = prompt('Preset name:');
			if (!name) return;
			let state;
			try {
				state = api.getState();
			} catch {
				return showToast('Error state', 'danger');
			}

			const calcColumns = tableInstance.calc?.exportForPreset?.() || [];
			const bag = readPresets();
			bag[name] = { version: 1, name, createdAt: Date.now(), gridState: state, calcColumns };
			writePresets(bag);
			refreshPresetUserSelect();
			localStorage.setItem(LS_KEY_ACTIVE_PRESET, name);
			const msg = (this.config.text.toastPresetSaved || 'Preset "{name}" saved').replace(
				'{name}',
				name
			);
			showToast(msg, 'success');
		};

		const applyPresetUser = (name) => {
			if (!name) return;
			const bag = readPresets();
			const p = bag[name];
			const stateToLoad = p?.gridState || p?.grid;
			if (!p || !stateToLoad) return showToast('Preset not found', 'warning');

			localStorage.setItem(LS_KEY_ACTIVE_PRESET, name);
			tableInstance.calc?.clear?.();
			if (Array.isArray(p.calcColumns) && p.calcColumns.length > 0) {
				tableInstance.calc?.importFromPreset(p.calcColumns);
			}

			const api = this.api;
			if (!api) return;
			try {
				api.setState(stateToLoad, this.config.behavior.ignoreOnRestore);
				tableInstance._setSizeMode('fit');
				setTimeout(() => syncTogglesUI(), 100);
			} catch (e) {}
			api.refreshHeader?.();
			api.redrawRows?.();
			const msg = (this.config.text.toastPresetApplied || 'Preset "{name}" applied').replace(
				'{name}',
				name
			);
			showToast(msg, 'success');
		};

		const deletePreset = () => {
			const sel = this._el('presetSelect');
			const name = sel?.value;
			if (!name) return showToast('Pick a preset first', 'warning');
			if (!confirm(`Delete preset "${name}"?`)) return;

			const bag = readPresets();
			delete bag[name];
			writePresets(bag);

			const active = localStorage.getItem(LS_KEY_ACTIVE_PRESET);
			if (active === name) localStorage.removeItem(LS_KEY_ACTIVE_PRESET);

			refreshPresetUserSelect();
			const msg = (this.config.text.toastPresetRemoved || 'Preset "{name}" removed').replace(
				'{name}',
				name
			);
			showToast(msg, 'info');
		};

		const downloadPreset = () => {
			const sel = this._el('presetSelect');
			const name = sel?.value;
			if (!name) return showToast('Pick a preset first', 'warning');

			const bag = readPresets();
			const p = bag[name];
			if (!p) return showToast('Preset data not found', 'warning');

			const blob = new Blob([JSON.stringify(p, null, 2)], {
				type: 'application/json;charset=utf-8',
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `lion-preset-${name}.json`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
			const msg = (this.config.text.toastPresetDownloaded || 'Preset "{name}" downloaded').replace(
				'{name}',
				name
			);
			showToast(msg, 'success');
		};

		const uploadPreset = () => {
			const input = this._el('presetFileInput');
			if (input) {
				input.value = '';
				input.click();
			}
		};

		this._el('presetFileInput')?.addEventListener('change', (e) => {
			const file = e.target.files?.[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = () => {
				try {
					const parsed = JSON.parse(String(reader.result || '{}'));
					if (!parsed?.gridState && !parsed?.grid) return showToast('Invalid File', 'danger');
					const name = prompt('Name:', parsed.name || file.name.replace(/\.json$/i, ''));
					if (!name) return;
					const bag = readPresets();
					bag[name] = {
						...parsed,
						name,
						importedAt: Date.now(),
						gridState: parsed.gridState || parsed.grid,
					};
					writePresets(bag);
					refreshPresetUserSelect();
					const sel = this._el('presetSelect');
					if (sel) sel.value = name;
					applyPresetUser(name);
				} catch {
					showToast('Error reading JSON', 'danger');
				}
			};
			reader.readAsText(file, 'utf-8');
		});

		this._el('btnResetLayout')?.addEventListener('click', resetLayout);
		this._el('presetSelect')?.addEventListener('change', (e) => {
			const v = e.target.value;
			if (!v) {
				resetLayout();
				return;
			}
			applyPresetUser(v);
		});

		const openCalcModal = (e) => {
			e.preventDefault();
			const modal = this._el('modalCalcCols');
			if (modal) {
				modal.dispatchEvent(new CustomEvent('lion:open:calc', { bubbles: true }));
			}
		};
		this._el('btnAddCalcCol')?.addEventListener('click', openCalcModal);
		this._el('btnManageCalcCols')?.addEventListener('click', openCalcModal);

		this._el('btnSavePreset')?.addEventListener('click', saveAsPreset);
		this._el('btnUploadPreset')?.addEventListener('click', uploadPreset);

		this._el('btnDownloadPreset')?.addEventListener('click', downloadPreset);
		this._el('btnDeletePreset')?.addEventListener('click', deletePreset);

		const sizeToggle = this._el('sizeModeToggle');
		if (sizeToggle) {
			sizeToggle.addEventListener('change', () => {
				const next = sizeToggle.checked ? 'auto' : 'fit';
				tableInstance._setSizeMode(next);
				applySizeMode(next);
				showToast(next === 'auto' ? 'Mode: Auto Size' : 'Mode: Size To Fit', 'info');
			});
			window.addEventListener('resize', () => applySizeMode(tableInstance._getSizeMode()));
		}

		const qFilter = this._el('quickFilter');
		if (qFilter) {
			try {
				qFilter.setAttribute('accesskey', 'k');
			} catch {}
			let t = null;
			qFilter.addEventListener('input', () => {
				clearTimeout(t);
				t = setTimeout(() => {
					GLOBAL_QUICK_FILTER = qFilter.value.trim();
					if (tableInstance.api) refreshSSRM(tableInstance.api);
				}, 250);
			});
		}

		refreshPresetUserSelect();

		globalThis.addEventListener('lionGridReady', () => {
			const activePreset = localStorage.getItem(LS_KEY_ACTIVE_PRESET);
			if (activePreset) {
				const bag = readPresets();
				const p = bag[activePreset];
				const stateToLoad = p?.gridState || p?.grid;
				if (stateToLoad) {
					setState(stateToLoad, this.config.behavior.ignoreOnRestore);
					setTimeout(syncTogglesUI, 100);
				}
			} else {
				const api = this.api;
				if (api) {
					try {
						api.setState({}, []);
						api.resetColumnState?.();
						api.setFilterModel?.(null);
						api.setSortModel?.([]);
						setTimeout(() => {
							const pinToggle = this._el('pinToggle');
							if (pinToggle) pinToggle.checked = true;
							tableInstance._setPinnedState(true);
							tableInstance.togglePinnedColsFromCheckbox(true);
							const szToggle = this._el('sizeModeToggle');
							if (szToggle) szToggle.checked = false;
							tableInstance._setSizeMode('fit');
							applySizeMode('fit');
							syncTogglesUI();
						}, 50);
					} catch (e) {}
				}
			}
		});

		Object.assign(this, {
			getState,
			setState,
			resetLayout,
			saveAsPreset,
			applyPresetUser,
			saveState,
		});
	}
	_setupQuickFilter() {
		const input = this._el('quickFilter');
		if (!input) return;

		this._quickFilterKeyHandler = (e) => {
			const tag = e.target?.tagName?.toLowerCase?.() || '';
			const editable = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
			if (editable) return;

			const key = String(e.key || '').toLowerCase();
			if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === 'k') {
				e.preventDefault();
				input.focus();
				input.select?.();
			}
		};
		window.addEventListener('keydown', this._quickFilterKeyHandler, { capture: true });

		if (input.value) {
			GLOBAL_QUICK_FILTER = String(input.value || '').trim();
			if (this.api) refreshSSRM(this.api);
		}
	}
	_getPinnedState() {
		const v = localStorage.getItem(this.config.storageKeys.pinnedState);
		return v === 'false' ? false : true;
	}
	_setPinnedState(state) {
		localStorage.setItem(this.config.storageKeys.pinnedState, state ? 'true' : 'false');
	}
	_getSizeMode() {
		const v = localStorage.getItem(this.config.storageKeys.sizeMode);
		return v === 'auto' ? 'auto' : 'fit';
	}
	_setSizeMode(mode) {
		localStorage.setItem(this.config.storageKeys.sizeMode, mode);
	}

	_bindPinnedToggle() {
		const el = this._el('pinToggle');
		if (!el) return;
		if (!el.hasAttribute('data-init-bound')) {
			el.checked = true;
			el.addEventListener('change', () => this.togglePinnedColsFromCheckbox(false));
			el.setAttribute('data-init-bound', '1');
		}
		try {
			this.togglePinnedColsFromCheckbox(true);
		} catch {}
	}

	togglePinnedColsFromCheckbox(silent = false) {
		const api = this.api;
		if (!api) return;

		const el = this._el('pinToggle');
		const checked = el ? !!el.checked : this._getPinnedState();
		this._setPinnedState(checked);

		const selectionColId = this.config.behavior.selectionColumnId;
		const autoGroupColId = this.config.behavior.autoGroupColumnId;

		const leftPins = [
			{ colId: selectionColId, pinned: checked ? 'left' : null },
			{ colId: autoGroupColId, pinned: checked ? 'left' : null },
			...this.config.behavior.pinnedLeft.map((colId) => ({
				colId,
				pinned: checked ? 'left' : null,
			})),
		];

		(this.config.behavior.legacyAutoGroupIds || []).forEach((id) => {
			leftPins.push({ colId: id, pinned: checked ? 'left' : null });
		});

		const rightPins = this.config.behavior.pinnedRight.map((colId) => ({
			colId,
			pinned: checked ? 'right' : null,
		}));

		api.applyColumnState({
			state: [...leftPins, ...rightPins],
			defaultState: { pinned: null },
			applyOrder: true,
		});

		if (checked) {
			try {
				api.moveColumn(selectionColId, 0);
			} catch (e) {}
		}
		if (!silent && el) {
			showToast(checked ? 'Columns Pinned' : 'Columns Unpinned', checked ? 'success' : 'info');
		}
	}
	CalcColsPopulate() {
		const $col1 = this._el('ccCol1');
		const $col2 = this._el('ccCol2');
		const $reload = this._el('ccReload');
		let lastSelection = { col1: null, col2: null };

		// [NOVO] Usa config.styles.backdrop para evitar CSS inline chumbado
		const backdropStyles = this.config.styles.backdrop;
		const modalZ = this.config.styles.modalZIndex;

		const ensureBackdrop = () => {
			if (!document.querySelector('.modal-backdrop')) {
				const bd = document.createElement('div');
				bd.className = 'modal-backdrop fade show';
				bd.style.cssText = `
					position: fixed;
					top: 0;
					left: 0;
					width: 100vw;
					height: 100vh;
					z-index: ${backdropStyles.zIndex || '1050'};
					background-color: ${backdropStyles.background || '#000 !important'};
					opacity: ${backdropStyles.opacity || '0.5 !important'};
					transition: opacity 0.15s linear;
				`;
				document.body.appendChild(bd);
			}
			document.body.classList.add('modal-open');
		};

		const modalShow = (selector) => {
			const el = selector ? document.querySelector(selector) : this._el('modalCalcCols');
			if (!el) return console.error('Modal não encontrado');

			el.classList.remove('hidden');
			el.style.removeProperty('display');
			el.setAttribute('aria-hidden', 'false');

			let libSuccess = false;
			try {
				if (window.KT?.Modal?.getOrCreateInstance) {
					window.KT.Modal.getOrCreateInstance(el).show();
					libSuccess = true;
				} else if (window.bootstrap?.Modal?.getOrCreateInstance) {
					window.bootstrap.Modal.getOrCreateInstance(el).show();
					libSuccess = true;
				}
			} catch (e) {
				console.warn('Lib falhou:', e);
			}

			setTimeout(
				() => {
					ensureBackdrop();
					el.style.display = 'block';
					el.style.zIndex = modalZ || '1055';
					el.style.opacity = '1';
					el.classList.add('show', 'kt-modal--open');
				},
				libSuccess ? 50 : 0
			);
		};

		const modalHide = () => {
			const el = this._el('modalCalcCols');
			if (!el) return;

			let handled = false;
			try {
				if (window.KT?.Modal?.getInstance(el)) {
					window.KT.Modal.getInstance(el).hide();
					handled = true;
				} else if (window.bootstrap?.Modal?.getInstance(el)) {
					window.bootstrap.Modal.getInstance(el).hide();
					handled = true;
				}
			} catch (e) {}

			setTimeout(
				() => {
					el.classList.add('hidden');
					el.style.display = 'none';
					el.classList.remove('show', 'kt-modal--open');
					el.setAttribute('aria-hidden', 'true');
					document.querySelectorAll('.modal-backdrop').forEach((b) => b.remove());
					document.body.classList.remove('modal-open');
					document.body.style.overflow = '';
					document.body.style.paddingRight = '';
				},
				handled ? 200 : 50
			);
		};

		const handleOpenModal = () => {
			console.log('[EVENT] handleOpenModal executado');
			clearForm();
			populateExpressionSelect();
			populateColumnSelects();
			renderList();
			modalShow();
		};

		const getOperators = () => this.config.calcConfig.operators;

		const _getSelectableColumns = () => {
			if (typeof this.config.callbacks.getCalculableColumns === 'function') {
				return this.config.callbacks.getCalculableColumns(this.api);
			}
			const api = this.api;
			if (!api) return [];
			let defs = [];
			try {
				const displayed = api.getAllDisplayedColumns?.() || [];
				if (displayed.length)
					defs = displayed.map((gc) => gc.getColDef?.() || gc.colDef).filter(Boolean);
			} catch {}
			if (!defs.length) {
				const flattenColDefs = (arr) => {
					const out = [];
					(arr || []).forEach((def) => {
						if (def?.children?.length) out.push(...flattenColDefs(def.children));
						else out.push(def);
					});
					return out;
				};
				defs = flattenColDefs(api.getColumnDefs?.() || []);
			}

			const deny = new Set([
				...this.config.behavior.calcDenyList,
				this.config.behavior.autoGroupColumnId,
			]);

			defs = defs.filter((def) => {
				if (!def) return false;
				const field = def.field || def.colId;
				if (!field || deny.has(field) || String(field).startsWith('__')) return false;
				if (def.checkboxSelection || def.rowGroup || def.pivot) return false;
				const h = String(def.headerName || field).toLowerCase();

				const ignored = this.config.calcConfig.ignoredHeaderPatterns;
				return !ignored.some((pattern) => h.includes(pattern.toLowerCase()));
			});

			const _isCalculable = (def) => {
				if (def.calcEligible === true) return true;
				if (
					def.calcType === 'numeric' ||
					def.valueType === 'number' ||
					def.cellDataType === 'number'
				)
					return true;
				if (def.type === 'numericColumn' || def.filter === 'agNumberColumnFilter') return true;
				return typeof def.valueParser === 'function';
			};
			defs = defs.filter(_isCalculable);
			const mapped = defs.map((def) => ({
				field: String(def.field || def.colId),
				headerName: String(def.headerName || def.field || def.colId),
			}));
			const unique = [];
			const seen = new Set();
			for (const it of mapped) {
				if (!seen.has(it.field)) {
					seen.add(it.field);
					unique.push(it);
				}
			}
			return unique.sort((a, b) =>
				a.headerName.localeCompare(b.headerName, this.config.behavior.locale)
			);
		};

		const _fillSelect = (selectEl, items, keepValue) => {
			if (!selectEl) return;
			const desired = keepValue ?? selectEl.value ?? '';
			while (selectEl.options.length) selectEl.remove(0);
			const ph = new Option('Select', '');
			if (!desired) ph.selected = true;
			selectEl.add(ph);
			for (const it of items) selectEl.add(new Option(`${it.headerName} (${it.field})`, it.field));
			if (desired) selectEl.value = desired;
			try {
				if (window.KT?.Select?.getInstance) window.KT.Select.getInstance(selectEl)?.init();
			} catch {}
		};

		const populateColumnSelects = () => {
			if (!$col1 || !$col2) return;
			const items = _getSelectableColumns();
			lastSelection.col1 = $col1.value || null;
			lastSelection.col2 = $col2.value || null;
			_fillSelect($col1, items, lastSelection.col1);
			_fillSelect($col2, items, lastSelection.col2);
		};

		const updateExpressionFromSelects = () => {
			const formatSel = this._el('ccFormat');
			const exprInput = this._el('ccExpression');
			const partsInput = this._el('ccParts');
			if (!formatSel || !$col1 || !$col2 || !exprInput) return;
			const selectedOp = formatSel.options[formatSel.selectedIndex];
			const template = selectedOp?.dataset?.template;
			if (!template || formatSel.value === 'custom') return;
			const val1 = $col1.value;
			const val2 = $col2.value;
			if (val1 && val2) {
				exprInput.value = template.replace(/{col1}/g, val1).replace(/{col2}/g, val2);
				if (partsInput) {
					const l1 = $col1.options[$col1.selectedIndex]?.textContent || val1;
					const l2 = $col2.options[$col2.selectedIndex]?.textContent || val2;
					const clean = (s) => s.replace(/\(.*\)$/, '').trim();
					partsInput.value = JSON.stringify(
						[
							{ label: clean(l1), expr: val1 },
							{ label: clean(l2), expr: val2 },
						],
						null,
						2
					);
				}
			}
		};

		const renderList = () => {
			const list = this._el('ccList');
			if (!list) return;
			const items = this.calc.list();
			list.innerHTML = '';
			const empty = this._el('ccEmpty');
			if (!items.length) {
				empty?.classList.remove('hidden');
				return;
			}
			empty?.classList.add('hidden');

			for (const c of items) {
				const li = document.createElement('li');
				li.className = 'flex items-center justify-between p-3 border-b border-gray-800';
				li.innerHTML = `
					<div class="min-w-0"><div class="font-medium text-sm">${
						c.headerName || c.id
					}</div><div class="text-xs opacity-60 font-mono mt-1 truncate">${
					c.expression
				}</div></div>
					<div class="flex items-center gap-2">
						<button class="kt-btn kt-btn-xs btn-activate">Activate</button>
						<button class="kt-btn kt-btn-light kt-btn-xs btn-edit">Edit</button>
						<button class="kt-btn kt-btn-danger kt-btn-xs btn-del">Remove</button>
					</div>`;
				li.querySelector('.btn-activate').addEventListener('click', (e) => {
					e.preventDefault();
					this.calc.add(c);
				});
				li.querySelector('.btn-edit').addEventListener('click', (e) => {
					e.preventDefault();
					this._el('ccId').value = c.id || '';
					this._el('ccHeader').value = c.headerName || '';
					this._el('ccType').value = c.format || 'currency';
					this._el('ccExpression').value = c.expression || '';
					this._el('ccParts').value = JSON.stringify(c.parts || []);
					this._el('ccOnlyLevel0').checked = !!c.onlyLevel0;
					this._el('ccAfter').value = c.after || 'Revenue';
					this._el('ccMini').checked = !!c.mini;
				});
				li.querySelector('.btn-del').addEventListener('click', (e) => {
					e.preventDefault();
					if (confirm(`Delete "${c.id}"?`)) {
						this.calc.remove(c.id);
						renderList();
					}
				});
				list.appendChild(li);
			}
		};

		const populateExpressionSelect = () => {
			const sel = this._el('ccFormat');
			if (!sel) return;
			sel.innerHTML = '';
			getOperators().forEach((op) => {
				const o = document.createElement('option');
				o.value = op.value;
				o.textContent = op.label;
				o.dataset.template = op.template;
				sel.appendChild(o);
			});
		};

		const clearForm = () => {
			['ccId', 'ccHeader', 'ccExpression', 'ccParts'].forEach((k) => {
				const el = this._el(k);
				if (el) el.value = '';
			});
			['ccOnlyLevel0', 'ccMini'].forEach((k) => {
				const el = this._el(k);
				if (el) el.checked = false;
			});
			const format = this._el('ccFormat');
			if (format) format.selectedIndex = 0;
			if ($col1) $col1.selectedIndex = 0;
			if ($col2) $col2.selectedIndex = 0;
		};

		const readForm = () => {
			const id = this._el('ccId')?.value?.trim();
			const headerName = this._el('ccHeader')?.value?.trim();
			const expression = this._el('ccExpression')?.value?.trim();
			const format = this._el('ccType')?.value || 'currency';
			const onlyLevel0 = !!this._el('ccOnlyLevel0')?.checked;
			const mini = !!this._el('ccMini')?.checked;
			const after = this._el('ccAfter')?.value || 'Revenue';
			let parts = [];
			try {
				parts = JSON.parse(this._el('ccParts')?.value || '[]');
			} catch {}
			let finalId = id;
			if (!finalId && headerName) finalId = headerName.toLowerCase().replace(/[^a-z0-9]/g, '_');
			return { id: finalId, headerName, expression, format, onlyLevel0, mini, after, parts };
		};

		this._el('ccFormat')?.addEventListener('change', updateExpressionFromSelects);
		if ($col1) $col1.addEventListener('change', updateExpressionFromSelects);
		if ($col2) $col2.addEventListener('change', updateExpressionFromSelects);

		this._el('ccSave')?.addEventListener('click', (e) => {
			e.preventDefault();
			const cfg = readForm();
			if (!cfg.id || !cfg.expression) return showToast('Missing Fields', 'danger');
			if (this.calc.add(cfg)) {
				modalHide();
				this.api?.refreshHeader?.();
				this.api?.redrawRows?.();
				renderList();
				showToast(this.config.text.toastColumnSaved || 'Column Saved', 'success');
			}
		});

		this._el('ccReset')?.addEventListener('click', (e) => {
			e.preventDefault();
			clearForm();
		});
		this._el('ccActivateAll')?.addEventListener('click', (e) => {
			e.preventDefault();
			this.calc.activateAll();
			renderList();
			showToast(this.config.text.toastActivated || 'Activated', 'success');
		});
		if ($reload) {
			$reload.addEventListener('click', (e) => {
				e.preventDefault();
				const old = $reload.innerHTML;
				$reload.innerHTML = '...';
				setTimeout(() => {
					populateColumnSelects();
					renderList();
					$reload.innerHTML = old;
				}, 300);
			});
		}

		document.addEventListener(
			'click',
			(e) => {
				const expectedAdd = this._sel('btnAddCalcCol') || '#btnCalcCols';
				const expectedManage = this._sel('btnManageCalcCols') || '#btnManageCalcCols';
				const btnAdd = e.target.closest(expectedAdd);
				const btnManage = e.target.closest(expectedManage);

				if (btnAdd || btnManage) {
					console.log(`[CAPTURE] Modal Acionado: ${btnAdd ? 'Add' : 'Manage'}`);
					e.preventDefault();
					e.stopPropagation();
					handleOpenModal();
				}
			},
			true
		);

		const modalSel = this._sel('modalCalcCols') || '#calcColsModal';
		document.addEventListener(
			'click',
			(e) => {
				const modal = document.querySelector(modalSel);
				if (!modal) return;
				const closeBtn = e.target.closest(
					`[data-kt-modal-dismiss="${modalSel}"], .kt-modal-close`
				);
				if (closeBtn && modal.contains(closeBtn)) {
					e.preventDefault();
					e.stopPropagation();
					modalHide();
				}
			},
			true
		);
	}
	makeGrid() {
		const AG = getAgGrid();
		const containerSelector = this.config.selectors.container;
		this.gridDiv = document.querySelector(containerSelector);
		if (!this.gridDiv) {
			console.error(`Container ${containerSelector} not found`);
			return null;
		}

		// [NOVO] Usa classe do grid parametrizada (ex: ag-theme-quartz)
		const themeClass = this.config.gridSetup.themeClass || 'ag-theme-quartz';
		this.gridDiv.classList.add(themeClass);

		const WRAP_FIELDS_LOCAL = this.config.behavior.wrapFields;
		const AUTO_GROUP_ID = this.config.behavior.autoGroupColumnId;
		const tableInstance = this;

		const autoGroupColumnDef = {
			headerName: this.config.behavior.autoGroupHeader,
			colId: AUTO_GROUP_ID,
			filter: 'agTextColumnFilter',
			floatingFilter: true,
			sortable: false,
			wrapText: true,
			minWidth: this.config.layout.autoGroupMinWidth,
			pinned: 'left',
			cellClass: (p) =>
				['camp-root', 'camp-child', 'camp-grand'][Math.min(p?.node?.level ?? 0, 2)],
			cellClassRules: {
				'ag-cell-loading': (p) => !!p?.data?.__rowLoading,
			},
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
						Object.assign(wrap.style, {
							display: 'inline-flex',
							flexDirection: 'column',
							lineHeight: '1.25',
						});
						const l1 = document.createElement('span');
						l1.textContent = label;
						l1.style.fontWeight = '600';
						wrap.appendChild(l1);
						if (utm) {
							const l2 = document.createElement('span');
							l2.textContent = utm;
							Object.assign(l2.style, {
								fontSize: '9px',
								opacity: '0.75',
								letterSpacing: '0.2px',
							});
							wrap.appendChild(l2);
						}
						return wrap;
					}
					return label;
				},
			},
			valueGetter: (p) => {
				const d = p.data || {};
				return ((d.__label || '') + ' ' + (d.utm_campaign || '')).trim();
			},
		};

		const _rowHeightMeasure = (() => {
			let box = null;
			return {
				measure(text, widthPx, fontFamily = 'IBM Plex Sans, system-ui') {
					if (!box) {
						box = document.createElement('div');
						box.id = 'lion-rowheight-measurer';
						Object.assign(box.style, {
							position: 'absolute',
							left: '-9999px',
							top: '-9999px',
							visibility: 'hidden',
							whiteSpace: 'normal',
							wordBreak: 'break-word',
							overflowWrap: 'anywhere',
							lineHeight: '1.25',
							fontSize: '14px', // Pode parametrizar em config.theme.fontSize
							padding: '0',
							margin: '0',
							width: '0',
						});
						document.body.appendChild(box);
					}
					box.style.width = Math.max(0, widthPx) + 'px';
					box.style.fontFamily = fontFamily;
					box.textContent = text || '';
					return box.scrollHeight || 0;
				},
			};
		})();

		function getAutoGroupContentWidth(api) {
			try {
				const col = api.getColumn(AUTO_GROUP_ID);
				if (!col) return 300;
				const colW = col.getActualWidth();
				// [PARAMETRIZADO] Usando layout.autoGroupOffset (antes era 44)
				const offset = tableInstance.config.layout.autoGroupOffset || 44;
				return Math.max(40, colW - offset);
			} catch {
				return 300;
			}
		}

		function getFieldContentWidth(api, field) {
			try {
				const col = api.getColumn(field);
				if (!col) return null;
				const w = col.getActualWidth?.();
				// [PARAMETRIZADO] Usando layout.measurePadding (antes era 12)
				const pad = tableInstance.config.layout.measurePadding || 12;
				return w && Number.isFinite(w) ? Math.max(0, w - pad) : null;
			} catch {
				return null;
			}
		}

		const _rowHCache = new Map();
		const BASE_ROW_MIN = this.config.layout.rowHeightMin;
		const VERT_PAD = this.config.layout.rowVertPad;
		const themeFont = this.config.theme?.fontFamily?.googleFont || 'IBM Plex Sans, system-ui';

		const gridOptions = {
			floatingFiltersHeight: this.config.layout.floatingFiltersHeight,
			groupHeaderHeight: this.config.layout.groupHeaderHeight,
			headerHeight: this.config.layout.headerHeight,

			context: { showToast: (msg, type) => showToast(msg, type) },
			rowModelType: 'serverSide',
			cacheBlockSize: this.config.layout.cacheBlockSize || 200,
			treeData: true,

			isServerSideGroup: (data) => data?.__nodeType === 'campaign' || data?.__nodeType === 'adset',
			getServerSideGroupKey: (data) => data?.__groupKey ?? '',

			getRowId: (params) => {
				const data = params.data;
				if (!data) return `${Math.random()}`;

				if (data.__nodeType === 'campaign') {
					return `c:${data.__groupKey}`;
				}
				if (data.__nodeType === 'adset') {
					return `s:${data.__groupKey}`;
				}
				if (data.__nodeType === 'ad') {
					const idKey = this.config.dataKeys.id;
					return `a:${data[idKey] || data.story_id || data.__label}`;
				}

				const idKey = this.config.dataKeys.id;
				return data[idKey] ? String(data[idKey]) : `${Math.random()}`;
			},

			columnDefs: [].concat(this.columnDefs),
			autoGroupColumnDef,
			defaultColDef: this.defaultColDef,

			rowSelection: {
				mode: 'multiRow',
				checkboxes: { enabled: true, header: true },
				selectionColumn: {
					id: this.config.behavior.selectionColumnId,
					// [PARAMETRIZADO] Width de selecao
					width: this.config.gridSetup.selectionColWidth || 36,
					pinned: 'left',
					suppressHeaderMenuButton: true,
					suppressHeaderFilterButton: true,
				},
			},

			rowHeight: BASE_ROW_MIN,

			getRowHeight: (p) => {
				const widthBag = {};
				widthBag.campaign = getAutoGroupContentWidth(p.api);

				if (WRAP_FIELDS_LOCAL.includes('bc_name')) {
					const bmW = getFieldContentWidth(p.api, 'bc_name');
					if (bmW != null) widthBag.bc_name = bmW;
				}

				const key =
					(p.node.id || Math.random()) +
					'|' +
					(widthBag.campaign + ':' + (widthBag.bc_name || 0));
				if (_rowHCache.has(key)) return _rowHCache.get(key);

				let maxTextH = 0;
				for (const field of WRAP_FIELDS_LOCAL) {
					const w = widthBag[field];
					if (!w) continue;
					const text = tableInstance.getCellTextForField(p, field);
					const textH = _rowHeightMeasure.measure(text, w, themeFont);
					if (textH > maxTextH) maxTextH = textH;
				}

				if (maxTextH <= 0) {
					_rowHCache.set(key, BASE_ROW_MIN);
					return BASE_ROW_MIN;
				}
				const h = Math.max(BASE_ROW_MIN, maxTextH + VERT_PAD);
				_rowHCache.set(key, h);
				return h;
			},

			onGridSizeChanged: () => {
				_rowHCache.clear();
				gridOptions.api?.resetRowHeights();
			},
			onColumnResized: () => {
				_rowHCache.clear();
				gridOptions.api?.resetRowHeights();
			},
			onFirstDataRendered: () => {
				_rowHCache.clear();
				gridOptions.api?.resetRowHeights();
			},
			onRowGroupOpened: () => {
				_rowHCache.clear();
				gridOptions.api?.resetRowHeights();
			},

			// [PARAMETRIZADO] Animate e SideBar
			animateRows: this.config.gridSetup.animateRows ?? true,
			sideBar: this.config.gridSetup.sideBar,

			theme: this.createAgTheme(),

			getContextMenuItems: (params) => {
				const d = params.node?.data || {};
				const colId = params.column?.getColDef?.().colId ?? params.column?.colId;

				const isCampaignColumn = colId === AUTO_GROUP_ID || colId === 'ag-Grid-AutoColumn';

				function buildCopyWithPartsText(p) {
					try {
						const inst = p.api.getCellRendererInstances({
							rowNodes: [p.node],
							columns: [p.column],
						})?.[0];
						if (inst && typeof inst.getCopyText === 'function') {
							const txt = String(inst.getCopyText() || '').trim();
							if (txt) return txt;
						}
					} catch {}
					return String(p.valueFormatted ?? p.value ?? '');
				}

				const items = ['cut', 'copy', 'copyWithHeaders', 'export', 'separator'];

				if (isCampaignColumn) {
					const label = d.__label || d.campaign_name || '';
					const utm = d.utm_campaign || '';
					if (label) {
						items.push({
							name: this.config.text.copyCampaign,
							action: () => {
								copyToClipboard(label);
								showToast('Campaign name copied', 'success');
							},
							icon: '<span class="ag-icon ag-icon-copy"></span>',
						});
					}
					if (utm) {
						items.push({
							name: this.config.text.copyUTM,
							action: () => {
								copyToClipboard(utm);
								showToast('UTM copied', 'success');
							},
							icon: '<span class="ag-icon ag-icon-copy"></span>',
						});
					}
				}

				const colDef = params.column?.getColDef?.() || params.colDef || {};
				if (
					colDef?.cellRenderer === StackBelowRenderer ||
					typeof colDef?.cellRendererParams?.getParts === 'function'
				) {
					items.push('separator');
					items.push({
						name: this.config.text.copyWithParts,
						action: () => {
							const txt = buildCopyWithPartsText(params);
							copyToClipboard(txt);
							showToast(
								this.config.text.toastCopiedParts || 'Copied (with parts)',
								'success'
							);
						},
						icon: '<span class="ag-icon ag-icon-copy"></span>',
					});
				}

				return items;
			},

			onCellClicked: (params) => {
				const node = params.node;
				const eventTarget = params.event?.target;
				if (node?.data?.__rowLoading) return;

				if (node.group) {
					const clickedExpander = !!eventTarget?.closest?.(
						'.ag-group-expanded, .ag-group-contracted, .ag-group-checkbox'
					);
					if (!clickedExpander) {
						node.setExpanded(!node.expanded);
						return;
					}
				}

				if (node.level > 0) return;

				const isAutoGroupCol =
					(typeof params.column?.isAutoRowGroupColumn === 'function' &&
						params.column.isAutoRowGroupColumn()) ||
					params.colDef?.colId === AUTO_GROUP_ID;

				const clickedExpander = !!eventTarget?.closest?.(
					'.ag-group-expanded, .ag-group-contracted, .ag-group-checkbox'
				);

				if (isAutoGroupCol && !clickedExpander && params?.data?.__nodeType === 'campaign') {
					const label = params.data.__label || this.config.text.noName || '(no name)';
					this.showKTModal({ title: this.config.text.modalCampaignTitle, content: label });
					return;
				}

				const MODAL_FIELDS = new Set(this.config.behavior.modalOpenFields);

				const field = params.colDef?.field;
				if (!field || !MODAL_FIELDS.has(field)) return;

				let display = String(params.valueFormatted || params.value || '');
				if (stripHtml) display = stripHtml(display);

				const title = params.colDef?.headerName || this.config.text.modalDetailsTitle;
				this.showKTModal({ title, content: display || '(empty)' });
			},

			onGridReady: (params) => {
				console.log('[GridReady] Grid initialized successfully');
				this.api = params.api;
				this.columnApi = params.columnApi;
				this.composite?.initGridApi(this.api, this.columnApi);

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

							if (groupKeys.length === 0) {
								if (!this.ROOT_CACHE) {
									let res = await fetch(this.config.endpoints.SSRM, {
										method: 'POST',
										headers: { 'Content-Type': 'application/json' },
										credentials: 'same-origin',
										body: JSON.stringify({ mode: 'full' }),
									});
									if (!res.ok)
										res = await fetch(this.config.endpoints.SSRM, {
											credentials: 'same-origin',
										});
									const data = await res.json().catch(() => ({ rows: [] }));
									this.ROOT_CACHE = {
										rowsRaw: Array.isArray(data.rows) ? data.rows : [],
									};
								}

								const all = this.ROOT_CACHE.rowsRaw;
								const filtered = this.frontApplyFilters(all, filterModelWithGlobal);
								const ordered = this.frontApplySort(filtered, sortModel || []);
								const rowsNorm = ordered.map((r) => this.normalizeCampaignRow(r));

								const slice = rowsNorm.slice(
									startRow,
									Math.min(endRow, rowsNorm.length)
								);

								const totals = this.computeClientTotals(ordered);
								const currency = this.config.behavior.currency;
								const locale = this.config.behavior.locale;
								const nfCur = new Intl.NumberFormat(locale, {
									style: 'currency',
									currency,
								});

								const k = this.config.dataKeys;

								const pinnedTotal = {
									id: '__pinned_total__',
									bc_name: 'TOTAL',
									__label: `${this.config.behavior.totalLabelPrefix}${intFmt.format(
										rowsNorm.length
									)}`,

									[k.impressions]: intFmt.format(totals[k.impressions] || 0),
									[k.clicks]: intFmt.format(totals[k.clicks] || 0),
									[k.visitors]: intFmt.format(totals[k.visitors] || 0),
									[k.conversions]: intFmt.format(totals[k.conversions] || 0),
									[k.real_conversions]: intFmt.format(totals[k.real_conversions] || 0),

									[k.ctr_total]: totals[k.ctr_total]
										? (totals[k.ctr_total] * 100).toFixed(2) + '%'
										: '0.00%',

									[k.spent]: nfCur.format(totals[k.spent] || 0),
									[k.revenue]: nfCur.format(totals[k.revenue] || 0),
									[k.fb_revenue]: nfCur.format(totals[k.fb_revenue] || 0),
									[k.push_revenue]: nfCur.format(totals[k.push_revenue] || 0),
									[k.profit]: nfCur.format(totals[k.profit] || 0),
									[k.budget]: nfCur.format(totals[k.budget] || 0),
									[k.cpc_total]: nfCur.format(totals[k.cpc_total] || 0),
									[k.cpa_fb_total]: nfCur.format(totals[k.cpa_fb_total] || 0),
									[k.real_cpa_total]: nfCur.format(totals[k.real_cpa_total] || 0),
									[k.mx_total]: totals[k.mx_total]
										? totals[k.mx_total].toFixed(2) + 'x'
										: '0x',
								};

								try {
									(req.api || params.api).setGridOption('pinnedBottomRowData', [
										pinnedTotal,
									]);
								} catch {}

								req.success({ rowData: slice, rowCount: rowsNorm.length });
								return;
							}

							// --- LEVEL 1: ADSETS ---
							if (groupKeys.length === 1) {
								const campaignId = groupKeys[0];
								const parentId = `c:${campaignId}`;
								const apiTarget = req.api ?? params.api;
								this.setParentRowLoading(apiTarget, parentId, true);

								const qs = new URLSearchParams({
									campaign_id: campaignId,
									period: this.config.drill.period,
									startRow: String(startRow),
									endRow: String(endRow),
									sortModel: JSON.stringify(sortModel || []),
									filterModel: JSON.stringify(filterModelWithGlobal || {}),
								});

								if (this.config.drill.fakeNetworkMs > 0)
									await sleep(this.config.drill.fakeNetworkMs);

								const data = await fetchJSON(
									`${this.config.endpoints.ADSETS}?${qs.toString()}`
								);
								const rows = (data.rows || []).map((row) => this.normalizeAdsetRow(row));

								await withMinSpinner(req.request, this.config.drill.minSpinnerMs);
								req.success({ rowData: rows, rowCount: data.lastRow ?? rows.length });
								this.setParentRowLoading(apiTarget, parentId, false);
								return;
							}

							// --- LEVEL 2: ADS ---
							if (groupKeys.length === 2) {
								const adsetId = groupKeys[1];
								const parentId = `s:${adsetId}`;
								const apiTarget = req.api ?? params.api;
								this.setParentRowLoading(apiTarget, parentId, true);

								const qs = new URLSearchParams({
									adset_id: adsetId,
									period: this.config.drill.period,
									startRow: String(startRow),
									endRow: String(endRow),
									sortModel: JSON.stringify(sortModel || []),
									filterModel: JSON.stringify(filterModelWithGlobal || {}),
								});

								if (this.config.drill.fakeNetworkMs > 0)
									await sleep(this.config.drill.fakeNetworkMs);

								const data = await fetchJSON(
									`${this.config.endpoints.ADS}?${qs.toString()}`
								);
								const rows = (data.rows || []).map((r) => this.normalizeAdRow(r));

								await withMinSpinner(req.request, this.config.drill.minSpinnerMs);
								req.success({ rowData: rows, rowCount: data.lastRow ?? rows.length });
								this.setParentRowLoading(apiTarget, parentId, false);
								return;
							}

							req.success({ rowData: [], rowCount: 0 });
						} catch (e) {
							console.error('[SSRM] getRows failed:', e);
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
					try {
						this.calc?.activateAll?.();
					} catch (e) {
						console.warn(e);
					}
					globalThis.dispatchEvent(new CustomEvent('lionGridReady'));
				}, 100);
			},
		};

		typeof AG.createGrid === 'function'
			? AG.createGrid(this.gridDiv, gridOptions)
			: new AG.Grid(this.gridDiv, gridOptions);

		this._bindPinnedToggle();
		return { api: this.api, gridDiv: this.gridDiv };
	}

	setParentRowLoading(api, parentId, on) {
		if (!api || !parentId) return;
		const node = api.getRowNode(parentId);
		if (!node || !node.data) return;
		node.data.__rowLoading = !!on;
		try {
			api.refreshCells({
				rowNodes: [node],
				columns: [this.config.behavior.autoGroupColumnId],
				force: true,
			});
		} catch {}
	}

	getCellTextForField(p, field) {
		if (typeof this.config.callbacks.getCellText === 'function') {
			return this.config.callbacks.getCellText(p, field);
		}
		const d = p?.data || {};
		if (p?.node?.group && field === this.config.behavior.autoGroupColumnId) {
			const label = String(d.__label || '');
			const meta = String(d.__groupKey || '');
			return meta ? `${label}\n${meta}` : label;
		}
		return String(d[field] ?? '');
	}

	ensureLoadingStyles() {
		if (document.getElementById('lion-loading-styles')) return;

		// [NOVO] Cores e estilos vindo do config.styles
		const styles = this.config.styles || {};
		const loadingColor = styles.loadingColor || '#9ca3af';
		const errorColor = styles.errorColor || '#ef4444';
		const errorBg = styles.errorBg || 'rgba(239, 68, 68, 0.12)';

		const css = `
.ag-cell.ag-cell-loading * { visibility: hidden !important; }
.ag-cell.ag-cell-loading::after {
  content:""; position:absolute; left:50%; top:50%; width:14px; height:14px;
  margin-left:-7px; margin-top:-7px; border-radius:50%; border:2px solid ${loadingColor};
  border-top-color:transparent; animation: lion-spin .8s linear infinite; z-index:2; pointer-events:none;
}
.lion-status-menu { position:absolute; min-width:160px; padding:6px 0; background:#111; color:#eee; border:1px solid rgba(255,255,255,.08); border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,.35); z-index:99999; }
.lion-status-menu__item { padding:8px 12px; font-size:12px; cursor:pointer; display:flex; align-items:center; gap:8px; }
.lion-status-menu__item:hover { background: rgba(255,255,255,.06); }
.lion-status-menu__item.is-active::before { content:"●"; font-size:10px; line-height:1; }
@keyframes lion-spin { to { transform: rotate(360deg); } }
.lion-editable-pen{ display:inline-flex; align-items:center; margin-left:6px; opacity:.45; pointer-events:none; font-size:12px; line-height:1; }
.ag-cell:hover .lion-editable-pen{ opacity:.85 }
.lion-editable-ok{ display:inline-flex; align-items:center; margin-left:6px; opacity:.9; pointer-events:none; font-size:12px; line-height:1; }
.ag-cell:hover .lion-editable-ok{ opacity:1 }
.lion-editable-err{ display:inline-flex; align-items:center; margin-left:6px; opacity:.95; pointer-events:none; font-size:12px; line-height:1; color:${errorColor}; }
.ag-cell:hover .lion-editable-err{ opacity:1 }
.ag-cell.lion-cell-error{ background: ${errorBg}; box-shadow: inset 0 0 0 1px rgba(239,68,68,.35); transition: background .2s ease, box-shadow .2s ease; }
.ag-cell.lion-cell-error .lion-editable-val{ color: ${errorColor}; font-weight: 600; }
.ag-cell.lion-cell-error.ag-cell-focus, .ag-cell.lion-cell-error:hover{ background: rgba(239, 68, 68, 0.18); box-shadow: inset 0 0 0 1px rgba(239,68,68,.5); }

.ag-theme-quartz :where(.ag-ltr) .ag-center-cols-container
  .ag-cell.lion-center-cell:not(.ag-cell-inline-editing):not([col-id="ag-Grid-AutoColumn"]):not([col-id="campaign"]) {
  padding-left: var(--ag-cell-horizontal-padding) !important;
  padding-right: var(--ag-cell-horizontal-padding) !important;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.ag-theme-quartz .ag-center-cols-container
  .ag-cell.lion-center-cell:not(.ag-cell-inline-editing) .ag-cell-wrapper {
  width: 100%;
}
.ag-theme-quartz .ag-center-cols-container
  .ag-cell.lion-center-cell:not(.ag-cell-inline-editing) .ag-cell-value {
  display: block;
  width: 100%;
  text-align: center;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
}
`;
		const el = document.createElement('style');
		el.id = 'lion-loading-styles';
		el.textContent = css;
		document.head.appendChild(el);
	}

	initModalEvents() {
		document.addEventListener(
			'keydown',
			(e) => {
				if (e.key !== 'Escape') return;
				const drilldownId = this.config.selectors.modalDrilldown.replace(/^#/, '');
				const ktModal = document.getElementById(drilldownId);
				if (
					ktModal &&
					!ktModal.classList.contains('hidden') &&
					ktModal.style.display !== 'none'
				) {
					this.closeKTModal(this.config.selectors.modalDrilldown);
					return;
				}
				const calcModal = this._el('modalCalcCols');
				const isVisible =
					calcModal &&
					!calcModal.classList.contains('hidden') &&
					calcModal.style.display !== 'none';

				if (isVisible) {
					const closeBtn = calcModal.querySelector('.kt-modal-close, [data-kt-modal-dismiss]');
					if (closeBtn) {
						closeBtn.click();
					} else {
						calcModal.style.display = 'none';
						calcModal.classList.add('hidden');
						document.querySelectorAll('.modal-backdrop').forEach((b) => b.remove());
						document.body.classList.remove('modal-open');
					}
				}
			},
			{ passive: true }
		);
	}

	showKTModal({ title = 'Details', content = '' } = {}) {
		this.ensureKtModalDom();
		const modalSelector = this.config.selectors.modalDrilldown;
		const modal = document.querySelector(modalSelector);
		if (!modal) return;

		const tEl = modal.querySelector(this.config.selectors.modalDrilldownTitle);
		if (tEl) tEl.textContent = title;

		const bEl = modal.querySelector(this.config.selectors.modalDrilldownBody);
		if (bEl) bEl.textContent = content;

		modal.setAttribute('aria-hidden', 'false');
		modal.style.display = 'flex';
		modal.classList.add('kt-modal--open');
		modal.classList.remove('hidden');
	}

	closeKTModal(selector) {
		const targetSelector = selector || this.config.selectors.modalDrilldown;
		const modal = document.querySelector(targetSelector);
		if (!modal) return;
		modal.setAttribute('aria-hidden', 'true');
		modal.style.display = 'none';
		modal.classList.remove('kt-modal--open');
		modal.classList.add('hidden');
	}

	ensureKtModalDom() {
		const modalSelector = this.config.selectors.modalDrilldown;
		const modalId = modalSelector.replace(/^#/, '');
		if (document.getElementById(modalId)) return;

		const tpl = document.createElement('div');
		let html = this.config.templates.modalDrilldown;
		if (html.includes('{id}')) {
			html = html.replace('{id}', modalId);
		}
		tpl.innerHTML = html;

		document.body.appendChild(tpl.firstElementChild);

		const closeSelector = this.config.selectors.modalDrilldownClose;
		const closeBtn = document.querySelector(`${modalSelector} ${closeSelector}`);
		closeBtn?.addEventListener('click', () => this.closeKTModal(modalSelector));

		const modalEl = document.getElementById(modalId);
		modalEl?.addEventListener('click', (e) => {
			if (e.target.id === modalId) this.closeKTModal(modalSelector);
		});
	}

	createAgTheme() {
		const AG = getAgGrid();
		const { themeQuartz, iconSetMaterial } = AG;
		if (!themeQuartz || !iconSetMaterial) return undefined;

		const t = this.config.theme || {};

		return themeQuartz.withPart(iconSetMaterial).withParams({
			browserColorScheme: t.browserColorScheme || 'dark',
			backgroundColor: t.backgroundColor || '#0C0C0D',
			foregroundColor: t.foregroundColor || '#f7f9ffff',
			headerBackgroundColor: t.headerBackgroundColor || '#141414',
			headerTextColor: t.headerTextColor || '#FFFFFF',
			accentColor: t.accentColor || '#15BDE8',
			borderColor: t.borderColor || '#FFFFFF0A',
			rowBorder: t.rowBorder ?? true,
			headerRowBorder: t.headerRowBorder ?? true,
			fontFamily: t.fontFamily || { googleFont: 'IBM Plex Sans' },
			fontSize: t.fontSize || 14,
			spacing: t.spacing || 6,
		});
	}

	normalizeCampaignRow(r) {
		if (typeof this.config.callbacks.normalizeRow === 'function') {
			return this.config.callbacks.normalizeRow(r, 'campaign', {
				stripHtml,
				...this.config.dataKeys,
			});
		}

		const k = this.config.dataKeys;
		const label = stripHtml(r[k.campaign_name] || this.config.text.noName || '(no name)');
		const utm = String(r[k.utm_campaign] || r[k.id] || '');
		return {
			__nodeType: 'campaign',
			__groupKey: utm,
			__label: label,
			campaign: (label + ' ' + utm).trim(),
			...r,
		};
	}
	normalizeAdsetRow(r) {
		if (typeof this.config.callbacks.normalizeRow === 'function') {
			return this.config.callbacks.normalizeRow(r, 'adset', {
				stripHtml,
				...this.config.dataKeys,
			});
		}

		const k = this.config.dataKeys;
		return {
			__nodeType: 'adset',
			__groupKey: String(r[k.id] || ''),
			__label: stripHtml(r[k.adset_name] || this.config.text.adsetDefault || '(adset)'),
			...r,
		};
	}
	normalizeAdRow(r) {
		if (typeof this.config.callbacks.normalizeRow === 'function') {
			return this.config.callbacks.normalizeRow(r, 'ad', { stripHtml, ...this.config.dataKeys });
		}

		const k = this.config.dataKeys;
		return {
			__nodeType: 'ad',
			__label: stripHtml(r[k.ad_name] || this.config.text.adDefault || '(ad)'),
			...r,
		};
	}

	frontApplySort(rows, sortModel) {
		if (!Array.isArray(sortModel) || !sortModel.length) return rows;
		if (typeof this.config.callbacks.customSort === 'function') {
			const customResult = this.config.callbacks.customSort(rows, sortModel, {
				frontToNumberBR,
				frontToNumberFirst,
			});
			if (customResult) return customResult;
		}
		const orderStatus = this.config.behavior.statusOrder;
		const revenueKey = this.config.dataKeys.revenue;

		return rows.slice().sort((a, b) => {
			for (const s of sortModel) {
				const { colId, sort } = s;
				const dir = sort === 'desc' ? -1 : 1;
				let av = a[colId],
					bv = b[colId];

				if (this.config.behavior.statusColIds.includes(colId)) {
					const ai = orderStatus.indexOf(String(av ?? '').toUpperCase());
					const bi = orderStatus.indexOf(String(bv ?? '').toUpperCase());
					const aIdx = ai === -1 ? Number.POSITIVE_INFINITY : ai;
					const bIdx = bi === -1 ? Number.POSITIVE_INFINITY : bi;
					if (aIdx !== bIdx) return (aIdx - bIdx) * dir;
					continue;
				}

				if (colId === revenueKey) {
					const an = frontToNumberFirst(av);
					const bn = frontToNumberFirst(bv);
					if (an == null && bn == null) continue;
					if (an == null) return -1 * dir;
					if (bn == null) return 1 * dir;
					if (an !== bn) return (an < bn ? -1 : 1) * dir;
					continue;
				}
				const an = frontToNumberBR(av);
				const bn = frontToNumberBR(bv);
				const bothNum = an != null && bn != null;
				let cmp = bothNum
					? an === bn
						? 0
						: an < bn
						? -1
						: 1
					: String(av ?? '').localeCompare(String(bv ?? ''), this.config.behavior.locale);
				if (cmp !== 0) return cmp * dir;
			}
			return 0;
		});
	}

	frontApplyFilters(rows, filterModel) {
		if (!filterModel || typeof filterModel !== 'object') return rows;

		const globalFilter = String(filterModel._global?.filter || '')
			.trim()
			.toLowerCase();

		const calcEvaluators = {};
		if (this.calc) {
			const calcList = this.calc.list();
			Object.keys(filterModel).forEach((field) => {
				const cfg = calcList.find((c) => c.id === field);
				if (cfg) {
					calcEvaluators[field] = this.calc._compileExpr(cfg.expression);
				}
			});
		}

		const checks = Object.entries(filterModel)
			.filter(([field]) => field !== '_global')
			.map(([field, f]) => {
				const ft = f.filterType || f.type || 'text';

				const autoGroupCol = this.config.behavior.autoGroupColumnId;
				const isCampaignColumn =
					field === 'campaign' ||
					field === autoGroupCol ||
					field === 'ag-Grid-AutoColumn' ||
					String(field).startsWith('ag-Grid-AutoColumn');

				if (isCampaignColumn) {
					const comp = String(f.type || 'contains');
					const needle = String(f.filter ?? '').toLowerCase();
					if (!needle) return () => true;

					const k = this.config.dataKeys;

					return (r) => {
						const name = String(r.__label || r[k.campaign_name] || '').toLowerCase();
						const utm = String(r[k.utm_campaign] || '').toLowerCase();
						const combined = (name + ' ' + utm).trim();

						switch (comp) {
							case 'equals':
								return combined === needle;
							case 'notEqual':
								return combined !== needle;
							case 'startsWith':
								return combined.startsWith(needle);
							case 'endsWith':
								return combined.endsWith(needle);
							case 'notContains':
								return !combined.includes(needle);
							case 'contains':
							default:
								return combined.includes(needle);
						}
					};
				}

				if (ft === 'includes' && Array.isArray(f.values)) {
					const set = new Set(f.values.map((v) => String(v).toLowerCase()));
					return (r) => set.has(String(r[field] ?? '').toLowerCase());
				}
				if (ft === 'excludes' && Array.isArray(f.values)) {
					const set = new Set(f.values.map((v) => String(v).toLowerCase()));
					return (r) => !set.has(String(r[field] ?? '').toLowerCase());
				}

				if (ft === 'text') {
					const comp = String(f.type || 'contains');
					const needle = String(f.filter ?? '').toLowerCase();
					if (!needle) return () => true;

					return (r) => {
						const val = String(r[field] ?? '').toLowerCase();
						switch (comp) {
							case 'equals':
								return val === needle;
							case 'notEqual':
								return val !== needle;
							case 'startsWith':
								return val.startsWith(needle);
							case 'endsWith':
								return val.endsWith(needle);
							case 'notContains':
								return !val.includes(needle);
							case 'contains':
							default:
								return val.includes(needle);
						}
					};
				}

				if (ft === 'number') {
					const comp = String(f.type || 'equals');
					let rawFilter = String(f.filter ?? '');
					if (rawFilter.includes(',')) rawFilter = rawFilter.replace(',', '.');
					const val = Number(rawFilter);

					return (r) => {
						let rawVal = r[field];
						if (rawVal === undefined && calcEvaluators[field]) {
							try {
								rawVal = calcEvaluators[field](r);
							} catch {}
						}

						const n = frontToNumberBR(rawVal);
						if (n == null) return false;
						switch (comp) {
							case 'equals':
								return n === val;
							case 'notEqual':
								return n !== val;
							case 'greaterThan':
								return n > val;
							case 'lessThan':
								return n < val;
							case 'greaterThanOrEqual':
								return n >= val;
							case 'lessThanOrEqual':
								return n <= val;
							default:
								return true;
						}
					};
				}

				return () => true;
			});

		return rows.filter((r) => {
			const globalMatch =
				!globalFilter ||
				Object.values(r).some((v) =>
					String(v ?? '')
						.toLowerCase()
						.includes(globalFilter)
				);
			return globalMatch && checks.every((fn) => fn(r));
		});
	}

	computeClientTotals(rows) {
		const cur = this.config.behavior.currency;

		if (typeof this.config.callbacks.computeTotals === 'function') {
			return this.config.callbacks.computeTotals(rows, {
				sumNum,
				safeDiv,
				intFmt,
				numBR: (val) => numBR(val, cur),
			});
		}

		const sum = sumNum;
		const div = safeDiv;
		const num = (val) => numBR(val, cur);
		const k = this.config.dataKeys;

		const spent_sum = sum(rows, (r) => num(r[k.spent]));
		const fb_revenue_sum = sum(rows, (r) => num(r[k.fb_revenue]));
		const push_revenue_sum = sum(rows, (r) => num(r[k.push_revenue]));

		const revenue_sum =
			(Number.isFinite(fb_revenue_sum) ? fb_revenue_sum : 0) +
				(Number.isFinite(push_revenue_sum) ? push_revenue_sum : 0) ||
			sum(rows, (r) => num(r[k.revenue]));

		const impressions_sum = sum(rows, (r) => num(r[k.impressions]));
		const clicks_sum = sum(rows, (r) => num(r[k.clicks]));
		const visitors_sum = sum(rows, (r) => num(r[k.visitors]));
		const conversions_sum = sum(rows, (r) => num(r[k.conversions]));
		const real_conversions_sum = sum(rows, (r) => num(r[k.real_conversions]));
		const profit_sum = sum(rows, (r) => num(r[k.profit]));
		const budget_sum = sum(rows, (r) => num(r[k.budget]));

		return {
			[k.impressions]: impressions_sum,
			[k.clicks]: clicks_sum,
			[k.visitors]: visitors_sum,
			[k.conversions]: conversions_sum,
			[k.real_conversions]: real_conversions_sum,
			[k.spent]: spent_sum,
			[k.fb_revenue]: fb_revenue_sum,
			[k.push_revenue]: push_revenue_sum,
			[k.revenue]: revenue_sum,
			[k.profit]: profit_sum,
			[k.budget]: budget_sum,

			[k.cpc_total]: div(spent_sum, clicks_sum),
			[k.cpa_fb_total]: div(spent_sum, conversions_sum),
			[k.real_cpa_total]: div(spent_sum, real_conversions_sum),
			[k.ctr_total]: div(clicks_sum, impressions_sum),
			[k.epc_total]: div(revenue_sum, clicks_sum),
			[k.mx_total]: div(revenue_sum, spent_sum),
		};
	}
	destroy() {
		if (this._quickFilterKeyHandler) {
			window.removeEventListener('keydown', this._quickFilterKeyHandler, { capture: true });
			this._quickFilterKeyHandler = null;
		}

		if (this.api) {
			this.saveState();
			this.api.destroy();
			this.api = null;
		}
	}
}
