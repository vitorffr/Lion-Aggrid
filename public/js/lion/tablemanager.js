import {
	withMinSpinner,
	getAppCurrency,
	showToast,
	sleep,
	stripHtml,
	strongText,
	intFmt,
	toNumberBR,
	frontToNumberBR,
	frontToNumberFirst,
	number,
	sumNum,
	safeDiv,
	numBR,
	cc_currencyFormat,
	cc_percentFormat,
	currencyFormatter,
	copyToClipboard,
	StackBelowRenderer,
	cc_evalExpression,
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

function buildFilterModelWithGlobal(baseFilterModel) {
	const fm = { ...(baseFilterModel || {}) };
	const gf = (GLOBAL_QUICK_FILTER || '').trim();
	fm._global = Object.assign({}, fm._global, { filter: gf });
	return fm;
}

export class Table {
	constructor(columnDefs = [], opts = {}) {
		// =================================================================
		// 1. CONFIGURAÇÃO CENTRALIZADA (Dynamic Config w/ Fallbacks)
		// =================================================================
		this.config = {
			// Seletores DOM (IDs e Classes)
			selectors: {
				container: opts.container || opts.selectors?.container || '#lionGrid',
				quickFilter: opts.selectors?.quickFilter || '#quickFilter',
				pinToggle: opts.selectors?.pinToggle || '#pinToggle',
				sizeModeToggle: opts.selectors?.sizeModeToggle || '#colSizeModeToggle',

				// Toolbar & Presets
				presetSelect: opts.selectors?.presetSelect || '#presetUserSelect',
				presetFileInput: opts.selectors?.presetFileInput || '#presetFileInput',
				btnResetLayout: opts.selectors?.btnResetLayout || '#btnResetLayout',
				btnSavePreset: opts.selectors?.btnSavePreset || '#btnSaveAsPreset',
				btnDeletePreset: opts.selectors?.btnDeletePreset || '#btnDeletePreset',
				btnDownloadPreset: opts.selectors?.btnDownloadPreset || '#btnDownloadPreset',
				btnUploadPreset: opts.selectors?.btnUploadPreset || '#btnUploadPreset',

				// Calc Columns Modal & Botões
				modalCalcCols: opts.selectors?.modalCalcCols || '#calcColsModal',
				btnAddCalcCol: opts.selectors?.btnAddCalcCol || '#btnCalcCols',
				btnManageCalcCols: opts.selectors?.btnManageCalcCols || '#btnManageCalcCols',
				// Campos internos do Modal (IDs sem # se preferir, mas aqui assumo seletores)
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
			},

			// Chaves de LocalStorage/SessionStorage
			storageKeys: {
				gridState: opts.storageKeys?.gridState || opts.GRID_STATE_KEY || 'lion.aggrid.state.v1',
				presets: opts.storageKeys?.presets || 'lion.aggrid.presets.v1',
				activePreset: opts.storageKeys?.activePreset || 'lion.aggrid.activePreset.v1',
				pinnedState: opts.storageKeys?.pinnedState || 'lion.aggrid.pinnedState',
				sizeMode: opts.storageKeys?.sizeMode || 'lion.aggrid.sizeMode',
				calcCols: opts.storageKeys?.calcCols || 'lion.aggrid.calcCols.v1',
			},

			// Comportamento
			behavior: {
				currency: opts.currency || opts.LION_CURRENCY || 'BRL',
				locale: opts.locale || 'pt-BR',
				wrapFields: opts.wrapFields ||
					opts.WRAP_FIELDS || ['campaign', 'bc_name', 'account_name'],
				selectionColumnId:
					opts.selectionColumnId || opts.selectionColumn || 'ag-Grid-SelectionColumn',
				autoGroupColumnId: opts.autoGroupColumnId || 'campaign',
				legacyAutoGroupIds: ['ag-Grid-AutoColumn'], // Para compatibilidade
				ignoreOnRestore: opts.ignoreOnRestore || [
					'pagination',
					'scroll',
					'rowSelection',
					'focusedCell',
				],
			},
		};

		// Propriedades da Classe
		this.columnDefs = Array.isArray(columnDefs) ? columnDefs : [];
		this.defaultColDef = opts.defaultColDef;
		this.gridDiv = null;
		this.gridApi = null; // Legacy alias
		this.gridColumnApi = null; // Legacy alias
		this.api = null; // Main API reference

		// Endpoints
		this.endpoints = Object.assign(
			{ SSRM: '/api/ssrm/?clean=1&mode=full', ADSETS: '/api/adsets/', ADS: '/api/ads/' },
			opts.endpoints || {}
		);

		// Drill settings
		this.drill = Object.assign(
			{ period: 'TODAY', minSpinnerMs: 900, fakeNetworkMs: 0 },
			opts.drill || {}
		);

		// === 2. CLASSES INTERNAS (Usam config do pai) ===
		const parentTable = this;

		class LionCompositeColumns {
			constructor() {
				this.registry = new Map();
				this.api = null;
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
				const map = {
					revenue: ['revenue', 'receita', 'receitas', 'rev', 'fat', 'faturamento'],
					spent: ['spent', 'gasto', 'gastos', 'spend', 'despesa', 'custo'],
					profit: ['profit', 'lucro', 'resultado', 'ganho'],
					mx: ['mx', 'roi', 'roas', 'retorno'],
					ctr: ['ctr', 'taxadeclique'],
					clicks: ['clicks', 'cliques'],
				};
				for (const [k, arr] of Object.entries(map)) {
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

					let afterRaw = colDef.__afterId || colDef.__after || 'Revenue';
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
				this.LS_KEY = parentTable.config.storageKeys.calcCols; // Chave dinâmica
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
				// Normalização simplificada
				return {
					...cfg,
					id: String(cfg.id || '').trim(),
					expression: String(cfg.expression || '').trim(),
					format: (cfg.format || 'currency').toLowerCase(),
					parts: Array.isArray(cfg.parts) ? cfg.parts : [],
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
				if (!Number.isFinite(n)) return '—';
				if (fmt === 'int') return intFmt.format(Math.round(n));
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

				return {
					headerName: n.headerName || n.id,
					colId: n.id,
					minWidth: 150,
					flex: 1,
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
						partsMaxHeight: 40,
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
								});
							}
							partFns.forEach(({ label, fn }) => {
								list.push({ label, value: fn ? fn(row) : null });
							});
							return list;
						},
					},
					__after: n.after,
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

		this.composite = new LionCompositeColumns();
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

		// Chaves dinâmicas
		const SS_KEY_STATE = this.config.storageKeys.gridState;
		const LS_KEY_PRESETS = this.config.storageKeys.presets;
		const LS_KEY_ACTIVE_PRESET = this.config.storageKeys.activePreset;

		// --- Helper UI Sync ---
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

				// Reset visual
				tableInstance.calc?.deactivateAllVisuals?.();
				const pinToggle = this._el('pinToggle');
				if (pinToggle) pinToggle.checked = true;
				tableInstance._setPinnedState(true);
				const sizeToggle = this._el('sizeModeToggle');
				if (sizeToggle) sizeToggle.checked = false;
				tableInstance._setSizeMode('fit');

				// Reset Grid
				api.setState({}, []);
				api.resetColumnState?.();
				api.setFilterModel?.(null);
				api.setSortModel?.([]);

				setTimeout(() => {
					tableInstance.togglePinnedColsFromCheckbox(true);
					applySizeMode('fit');
					syncTogglesUI();
					showToast('Layout Reset', 'info');
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
			showToast(`Preset "${name}" saved`, 'success');
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
			showToast(`Preset "${name}" applied`, 'success');
		};

		// === FIX: Implementação do Delete ===
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
			showToast(`Preset "${name}" removed`, 'info');
		};

		// === FIX: Implementação do Download ===
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
			showToast(`Preset "${name}" downloaded`, 'success');
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

		// --- Listeners ---
		this._el('btnResetLayout')?.addEventListener('click', resetLayout);
		this._el('presetSelect')?.addEventListener('change', (e) => {
			const v = e.target.value;
			if (!v) {
				resetLayout();
				return;
			}
			applyPresetUser(v);
		});

		// Listeners dos botões de modal
		const openCalcModal = (e) => {
			e.preventDefault();
			const modal = this._el('modalCalcCols');
			if (modal) {
				// Aciona evento customizado que o CalcColsPopulate escuta
				modal.dispatchEvent(new CustomEvent('lion:open:calc', { bubbles: true }));
			}
		};
		this._el('btnAddCalcCol')?.addEventListener('click', openCalcModal);
		this._el('btnManageCalcCols')?.addEventListener('click', openCalcModal);

		this._el('btnSavePreset')?.addEventListener('click', saveAsPreset);
		this._el('btnUploadPreset')?.addEventListener('click', uploadPreset);
		// FIX: Bind do Download e Delete
		this._el('btnDownloadPreset')?.addEventListener('click', downloadPreset);
		this._el('btnDeletePreset')?.addEventListener('click', deletePreset);

		// Size Mode
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

		// Quick Filter
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

		// Grid Ready Listener
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

		Object.assign(this, { getState, setState, resetLayout, saveAsPreset, applyPresetUser });
	}
	_setupQuickFilter() {
		const input = this._el('quickFilter');
		if (!input) return;

		// 1. Atalho de Teclado (Ctrl+K / Cmd+K)
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

		// 2. Lógica de Input (Já existente no setupToolbar, mas reforçamos o foco inicial se tiver valor)
		if (input.value) {
			GLOBAL_QUICK_FILTER = String(input.value || '').trim();
			// Se a API já estiver pronta, aplica. Se não, o onGridReady pega depois.
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
			{ colId: 'profile_name', pinned: checked ? 'left' : null },
		];

		// Adiciona legados
		(this.config.behavior.legacyAutoGroupIds || []).forEach((id) => {
			leftPins.push({ colId: id, pinned: checked ? 'left' : null });
		});

		const rightPins = [
			{ colId: 'spent', pinned: checked ? 'right' : null },
			{ colId: 'revenue', pinned: checked ? 'right' : null },
			{ colId: 'mx', pinned: checked ? 'right' : null },
			{ colId: 'profit', pinned: checked ? 'right' : null },
		];

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
			el.checked = checked;
			showToast(checked ? 'Columns Pinned' : 'Columns Unpinned', checked ? 'success' : 'info');
		}
	}
	CalcColsPopulate() {
		// ============================================================
		// 1. PREPARAÇÃO E ESTADO
		// ============================================================
		const $col1 = this._el('ccCol1');
		const $col2 = this._el('ccCol2');
		const $reload = this._el('ccReload');
		let lastSelection = { col1: null, col2: null };

		// ============================================================
		// 2. FUNÇÕES DO MODAL (VISUAL NATIVO)
		// ============================================================

		// Cria o fundo preto IDÊNTICO ao nativo (Bootstrap/Metronic)
		const ensureBackdrop = () => {
			if (!document.querySelector('.modal-backdrop')) {
				const bd = document.createElement('div');
				bd.className = 'modal-backdrop fade show'; // Classes padrão

				// CSS inline para garantir o visual exato
				bd.style.cssText = `
					position: fixed;
					top: 0;
					left: 0;
					width: 100vw;
					height: 100vh;
					z-index: 1050;
					background-color: #000 !important; /* Preto Sólido */
					opacity: 0.5 !important;           /* Intensidade Padrão (Ajuste para 0.6 ou 0.7 se quiser mais escuro) */
					transition: opacity 0.15s linear;
				`;
				document.body.appendChild(bd);
			}
			document.body.classList.add('modal-open');
		};

		const modalShow = (selector) => {
			const el = selector ? document.querySelector(selector) : this._el('modalCalcCols');
			if (!el) return console.error('Modal não encontrado');

			// Limpeza
			el.classList.remove('hidden');
			el.style.removeProperty('display');
			el.setAttribute('aria-hidden', 'false');

			// Tenta via biblioteca
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

			// GARANTIA VISUAL (Backdrop + Z-Index)
			setTimeout(
				() => {
					// 1. Cria o fundo preto padrão
					ensureBackdrop();

					// 2. Força o modal para frente
					el.style.display = 'block';
					el.style.zIndex = '1055'; // Acima do backdrop (1050)
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

			// Limpeza Forçada
			setTimeout(
				() => {
					el.classList.add('hidden');
					el.style.display = 'none';
					el.classList.remove('show', 'kt-modal--open');
					el.setAttribute('aria-hidden', 'true');

					// Remove backdrop
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

		// ============================================================
		// 3. LÓGICA DO FORMULÁRIO
		// ============================================================
		const DEFAULT_OPERATORS = [
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
			{ value: 'add', label: '+ Addition (A + B)', template: 'number({col1}) + number({col2})' },
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
		];

		const _getSelectableColumns = () => {
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
				'ag-Grid-AutoColumn',
				'ag-Grid-RowGroup',
				'__autoGroup',
				this.config.behavior.autoGroupColumnId,
			]);
			defs = defs.filter((def) => {
				if (!def) return false;
				const field = def.field || def.colId;
				if (!field || deny.has(field) || String(field).startsWith('__')) return false;
				if (def.checkboxSelection || def.rowGroup || def.pivot) return false;
				const h = String(def.headerName || field).toLowerCase();
				return !(h.includes('select') || h.includes('ação') || h.includes('action'));
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
			DEFAULT_OPERATORS.forEach((op) => {
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

		// Listeners
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
				showToast('Column Saved', 'success');
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
			showToast('Activated', 'success');
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

		// ============================================================
		// 4. EVENT DELEGATION (Capture Phase)
		// ============================================================

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
	} // Fim do CalcColsPopulate
	makeGrid() {
		const AG = getAgGrid();
		const containerSelector = this.config.selectors.container;
		this.gridDiv = document.querySelector(containerSelector);
		if (!this.gridDiv) {
			console.error(`Container ${containerSelector} not found`);
			return null;
		}
		this.gridDiv.classList.add('ag-theme-quartz');

		const WRAP_FIELDS_LOCAL = this.config.behavior.wrapFields;
		const AUTO_GROUP_ID = this.config.behavior.autoGroupColumnId;
		const tableInstance = this;

		const autoGroupColumnDef = {
			headerName: 'Campaign',
			colId: AUTO_GROUP_ID,
			filter: 'agTextColumnFilter',
			floatingFilter: true,
			sortable: false,
			wrapText: true,
			minWidth: 280,
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

		// --- Helpers de Medição de Layout ---
		const _rowHeightMeasure = (() => {
			let box = null;
			return {
				measure(text, widthPx) {
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
							fontFamily: 'IBM Plex Sans, system-ui',
							fontSize: '14px',
							padding: '0',
							margin: '0',
							width: '0',
						});
						document.body.appendChild(box);
					}
					box.style.width = Math.max(0, widthPx) + 'px';
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
				return Math.max(40, colW - 44);
			} catch {
				return 300;
			}
		}

		function getFieldContentWidth(api, field) {
			try {
				const col = api.getColumn(field);
				if (!col) return null;
				const w = col.getActualWidth?.();
				return w && Number.isFinite(w) ? Math.max(0, w - 12) : null;
			} catch {
				return null;
			}
		}

		const _rowHCache = new Map();
		const BASE_ROW_MIN = 50;
		const VERT_PAD = 12;

		const gridOptions = {
			floatingFiltersHeight: 35,
			groupHeaderHeight: 35,
			headerHeight: 62,
			// FIX: Usa showToast importado para garantir compatibilidade com utils.js
			context: { showToast: (msg, type) => showToast(msg, type) },
			rowModelType: 'serverSide',
			cacheBlockSize: 200,
			treeData: true,

			isServerSideGroup: (data) => data?.__nodeType === 'campaign' || data?.__nodeType === 'adset',
			getServerSideGroupKey: (data) => data?.__groupKey ?? '',

			getRowId: function (params) {
				if (params.data?.__nodeType === 'campaign') return `c:${params.data.__groupKey}`;
				if (params.data?.__nodeType === 'adset') return `s:${params.data.__groupKey}`;
				if (params.data?.__nodeType === 'ad')
					return `a:${params.data.id || params.data.story_id || params.data.__label}`;
				return params.data?.id ? String(params.data.id) : `${Math.random()}`;
			},

			columnDefs: [].concat(this.columnDefs),
			autoGroupColumnDef,
			defaultColDef: this.defaultColDef,

			rowSelection: {
				mode: 'multiRow',
				checkboxes: { enabled: true, header: true },
				selectionColumn: {
					id: this.config.behavior.selectionColumnId,
					width: 36,
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
					const textH = _rowHeightMeasure.measure(text, w);
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

			animateRows: true,
			sideBar: { toolPanels: ['columns', 'filters'], defaultToolPanel: null, position: 'right' },
			theme: this.createAgTheme(),

			// === FIX: Menu de Contexto (Copy UTM / Campaign) ===
			getContextMenuItems: (params) => {
				const d = params.node?.data || {};
				const colId = params.column?.getColDef?.().colId ?? params.column?.colId;

				// Verifica se é a coluna de grupo (usando config ou fallback)
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
							name: 'Copy Campaign',
							action: () => {
								// Usa utils.js
								copyToClipboard(label);
								showToast('Campaign name copied', 'success');
							},
							icon: '<span class="ag-icon ag-icon-copy"></span>',
						});
					}
					if (utm) {
						items.push({
							name: 'Copy UTM',
							action: () => {
								copyToClipboard(utm);
								showToast('UTM copied', 'success');
							},
							icon: '<span class="ag-icon ag-icon-copy"></span>',
						});
					}
				}

				// Copy with parts
				const colDef = params.column?.getColDef?.() || params.colDef || {};
				if (
					colDef?.cellRenderer === StackBelowRenderer ||
					typeof colDef?.cellRendererParams?.getParts === 'function'
				) {
					items.push('separator');
					items.push({
						name: 'Copy with parts',
						action: () => {
							const txt = buildCopyWithPartsText(params);
							copyToClipboard(txt);
							showToast('Copied (with parts)', 'success');
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
					const label = params.data.__label || '(no name)';
					this.showKTModal({ title: 'Campaign', content: label });
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
				]);
				const field = params.colDef?.field;
				if (!field || !MODAL_FIELDS.has(field)) return;

				let display = String(params.valueFormatted || params.value || '');
				if (stripHtml) display = stripHtml(display);

				const title = params.colDef?.headerName || 'Details';
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

							// --- LEVEL 0: CAMPAIGNS ---
							if (groupKeys.length === 0) {
								if (!this.ROOT_CACHE) {
									let res = await fetch(this.endpoints.SSRM, {
										method: 'POST',
										headers: { 'Content-Type': 'application/json' },
										credentials: 'same-origin',
										body: JSON.stringify({ mode: 'full' }),
									});
									if (!res.ok)
										res = await fetch(this.endpoints.SSRM, {
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
								const rowsNorm = ordered.map(this.normalizeCampaignRow);
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

								const pinnedTotal = {
									id: '__pinned_total__',
									bc_name: 'TOTAL',
									__label: `CAMPAIGNS: ${intFmt.format(rowsNorm.length)}`,
									impressions: intFmt.format(totals.impressions_sum || 0),
									clicks: intFmt.format(totals.clicks_sum || 0),
									visitors: intFmt.format(totals.visitors_sum || 0),
									conversions: intFmt.format(totals.conversions_sum || 0),
									real_conversions: intFmt.format(totals.real_conversions_sum || 0),
									ctr: totals.ctr_total
										? (totals.ctr_total * 100).toFixed(2) + '%'
										: '0.00%',
									spent: nfCur.format(totals.spent_sum || 0),
									revenue: nfCur.format(totals.revenue_sum || 0),
									fb_revenue: nfCur.format(totals.fb_revenue_sum || 0),
									push_revenue: nfCur.format(totals.push_revenue_sum || 0),
									profit: nfCur.format(totals.profit_sum || 0),
									budget: nfCur.format(totals.budget_sum || 0),
									cpc: nfCur.format(totals.cpc_total || 0),
									cpa_fb: nfCur.format(totals.cpa_fb_total || 0),
									real_cpa: nfCur.format(totals.real_cpa_total || 0),
									mx: totals.mx_total ? totals.mx_total.toFixed(2) + 'x' : '0x',
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
									period: this.drill.period,
									startRow: String(startRow),
									endRow: String(endRow),
									sortModel: JSON.stringify(sortModel || []),
									filterModel: JSON.stringify(filterModelWithGlobal || {}),
								});

								if (this.drill.fakeNetworkMs > 0) await sleep(this.drill.fakeNetworkMs);

								const data = await fetchJSON(
									`${this.endpoints.ADSETS}?${qs.toString()}`
								);
								const rows = (data.rows || []).map((row) => this.normalizeAdsetRow(row));

								await withMinSpinner(req.request, this.drill.minSpinnerMs);
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
									period: this.drill.period,
									startRow: String(startRow),
									endRow: String(endRow),
									sortModel: JSON.stringify(sortModel || []),
									filterModel: JSON.stringify(filterModelWithGlobal || {}),
								});

								if (this.drill.fakeNetworkMs > 0) await sleep(this.drill.fakeNetworkMs);

								const data = await fetchJSON(`${this.endpoints.ADS}?${qs.toString()}`);
								const rows = (data.rows || []).map(this.normalizeAdRow);

								await withMinSpinner(req.request, this.drill.minSpinnerMs);
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
	// --- Métodos Utilitários e de Estado ---

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
		const d = p?.data || {};
		if (field === 'campaign') {
			if ((p?.node?.level ?? 0) !== 0) return String(d.__label || '');
			const label = String(d.__label || '');
			const utm = String(d.utm_campaign || '');
			return utm ? `${label}\n${utm}` : label;
		}
		if (field === 'bc_name') return String(d.bc_name || '');
		return String(d[field] ?? '');
	}

	ensureLoadingStyles() {
		if (document.getElementById('lion-loading-styles')) return;
		const css = `
			.ag-cell.ag-cell-loading * { visibility: hidden !important; }
			.ag-cell.ag-cell-loading::after { content:""; position:absolute; left:50%; top:50%; width:14px; height:14px; margin-left:-7px; margin-top:-7px; border-radius:50%; border:2px solid #9ca3af; border-top-color:transparent; animation: lion-spin .8s linear infinite; z-index:2; pointer-events:none; }
			@keyframes lion-spin { to { transform: rotate(360deg); } }
			.ag-theme-quartz .ag-cell.lion-center-cell { text-align: center; display: flex; align-items: center; justify-content: center; padding: 0 4px; }
			.ag-theme-quartz .ag-cell.lion-center-cell .ag-cell-value { width: 100%; white-space: normal; word-break: break-word; line-height: 1.2; }
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
				const ktModal = document.getElementById('lionKtModal');
				if (
					ktModal &&
					!ktModal.classList.contains('hidden') &&
					ktModal.style.display !== 'none'
				) {
					this.closeKTModal('#lionKtModal');
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
		const modal = document.getElementById('lionKtModal');
		if (!modal) return;
		const tEl = modal.querySelector('.kt-modal-title');
		if (tEl) tEl.textContent = title;
		const bEl = modal.querySelector('.kt-modal-body > pre');
		if (bEl) bEl.textContent = content;
		modal.setAttribute('aria-hidden', 'false');
		modal.style.display = 'flex';
		modal.classList.add('kt-modal--open');
		modal.classList.remove('hidden');
	}

	closeKTModal(selector = '#lionKtModal') {
		const modal = document.querySelector(selector);
		if (!modal) return;
		modal.setAttribute('aria-hidden', 'true');
		modal.style.display = 'none';
		modal.classList.remove('kt-modal--open');
		modal.classList.add('hidden');
	}

	ensureKtModalDom() {
		if (document.getElementById('lionKtModal')) return;
		const tpl = document.createElement('div');
		tpl.innerHTML = `
			<div class="kt-modal hidden" id="lionKtModal" aria-hidden="true" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;align-items:center;justify-content:center;">
				<div class="kt-modal-content" style="background:#09090B;color:#fff;padding:20px;border-radius:8px;max-width:500px;width:90%;max-height:80vh;overflow:auto;position:relative;">
					<div class="kt-modal-header" style="display:flex;justify-content:space-between;margin-bottom:15px;">
						<h3 class="kt-modal-title" style="font-weight:bold;font-size:1.1rem;">Details</h3>
						<button type="button" class="kt-modal-close" style="background:none;border:none;color:#fff;font-size:1.2rem;cursor:pointer;">✕</button>
					</div>
					<div class="kt-modal-body"><pre class="whitespace-pre-wrap text-sm" style="white-space:pre-wrap;word-break:break-word;"></pre></div>
				</div>
			</div>`;
		document.body.appendChild(tpl.firstElementChild);
		document
			.querySelector('#lionKtModal .kt-modal-close')
			?.addEventListener('click', () => this.closeKTModal('#lionKtModal'));
		document.getElementById('lionKtModal')?.addEventListener('click', (e) => {
			if (e.target.id === 'lionKtModal') this.closeKTModal('#lionKtModal');
		});
	}

	// ============================================================
	// MÉTODOS UTILITÁRIOS & TEMA (Colar após makeGrid)
	// ============================================================

	createAgTheme() {
		const AG = getAgGrid();
		const { themeQuartz, iconSetMaterial } = AG;
		if (!themeQuartz || !iconSetMaterial) return undefined;

		// Permite customização via opts.theme ou usa defaults
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

	// Normalizadores de Linha (Usados no DataSource do makeGrid)
	normalizeCampaignRow(r) {
		const label = stripHtml(r.campaign_name || '(no name)');
		const utm = String(r.utm_campaign || r.id || '');
		return {
			__nodeType: 'campaign',
			__groupKey: utm,
			__label: label,
			campaign: (label + ' ' + utm).trim(),
			...r,
		};
	}
	normalizeAdsetRow(r) {
		return {
			__nodeType: 'adset',
			__groupKey: String(r.id || ''),
			__label: stripHtml(r.name || '(adset)'),
			...r,
		};
	}
	normalizeAdRow(r) {
		return { __nodeType: 'ad', __label: stripHtml(r.name || '(ad)'), ...r };
	}

	// Lógica de Sort/Filter no Front (Usados no DataSource)
	frontApplySort(rows, sortModel) {
		if (!Array.isArray(sortModel) || !sortModel.length) return rows;
		const orderStatus = ['ACTIVE', 'PAUSED', 'DISABLED', 'CLOSED'];
		return rows.slice().sort((a, b) => {
			for (const s of sortModel) {
				const { colId, sort } = s;
				const dir = sort === 'desc' ? -1 : 1;
				let av = a[colId],
					bv = b[colId];

				if (['account_status', 'campaign_status', 'status'].includes(colId)) {
					const ai = orderStatus.indexOf(String(av ?? '').toUpperCase());
					const bi = orderStatus.indexOf(String(bv ?? '').toUpperCase());
					const aIdx = ai === -1 ? Number.POSITIVE_INFINITY : ai;
					const bIdx = bi === -1 ? Number.POSITIVE_INFINITY : bi;
					if (aIdx !== bIdx) return (aIdx - bIdx) * dir;
					continue;
				}
				if (colId === 'revenue') {
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
		// Global filter já aplicado na origem ou aqui se necessário
		const globalFilter = String(filterModel._global?.filter || '')
			.trim()
			.toLowerCase();

		const checks = Object.entries(filterModel)
			.filter(([field]) => field !== '_global')
			.map(([field, f]) => {
				const ft = f.filterType || f.type || 'text';
				// ... lógica de filtro (simplificada para brevidade, traga a sua original se tiver lógica custom complexa)
				// Para manter compatibilidade com o original:
				if (ft === 'text') {
					const needle = String(f.filter ?? '').toLowerCase();
					return (r) =>
						String(r[field] ?? '')
							.toLowerCase()
							.includes(needle);
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
		const sum = sumNum;
		const num = numBR;
		const div = safeDiv;
		const spent_sum = sum(rows, (r) => num(r.spent));
		const fb_revenue_sum = sum(rows, (r) => num(r.fb_revenue));
		const push_revenue_sum = sum(rows, (r) => num(r.push_revenue));
		const revenue_sum =
			(Number.isFinite(fb_revenue_sum) ? fb_revenue_sum : 0) +
				(Number.isFinite(push_revenue_sum) ? push_revenue_sum : 0) ||
			sum(rows, (r) => num(r.revenue));
		const impressions_sum = sum(rows, (r) => num(r.impressions));
		const clicks_sum = sum(rows, (r) => num(r.clicks));
		const visitors_sum = sum(rows, (r) => num(r.visitors));
		const conversions_sum = sum(rows, (r) => num(r.conversions));
		const real_conversions_sum = sum(rows, (r) => num(r.real_conversions));
		const profit_sum = sum(rows, (r) => num(r.profit));
		const budget_sum = sum(rows, (r) => num(r.budget));

		return {
			impressions_sum,
			clicks_sum,
			visitors_sum,
			conversions_sum,
			real_conversions_sum,
			spent_sum,
			fb_revenue_sum,
			push_revenue_sum,
			revenue_sum,
			profit_sum,
			budget_sum,
			cpc_total: div(spent_sum, clicks_sum),
			cpa_fb_total: div(spent_sum, conversions_sum),
			real_cpa_total: div(spent_sum, real_conversions_sum),
			ctr_total: div(clicks_sum, impressions_sum),
			epc_total: div(revenue_sum, clicks_sum),
			mx_total: div(revenue_sum, spent_sum),
		};
	}

	destroy() {
		// Limpeza do listener global de teclado
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
