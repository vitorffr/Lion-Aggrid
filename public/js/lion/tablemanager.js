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

export let GLOBAL_QUICK_FILTER = ''; // 🔍 QUICK FILTER global (vai em filterModel._global.filter)

/* =========================================
 * 4) AG Grid: acesso + licença
 * =======================================*/
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
(function setupGlobalQuickFilter() {
	function focusQuickFilter() {
		const input = document.getElementById('quickFilter');
		if (!input) return;
		input.focus();
		input.select?.();
	}
	function applyGlobalFilter(val) {
		GLOBAL_QUICK_FILTER = String(val || '');
		const api = globalThis.LionGrid?.api;
		if (!api) return;
		refreshSSRM(api);
	}
	function init() {
		const input = document.getElementById('quickFilter');
		if (!input) return;
		try {
			input.setAttribute('accesskey', 'k');
		} catch {}
		let t = null;
		input.addEventListener('input', () => {
			clearTimeout(t);
			t = setTimeout(() => applyGlobalFilter(input.value.trim()), 250);
		});
		if (input.value) applyGlobalFilter(input.value.trim());
	}
	window.addEventListener(
		'keydown',
		(e) => {
			const tag = e.target?.tagName?.toLowerCase?.() || '';
			const editable = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
			if (editable) return;
			const key = String(e.key || '').toLowerCase();
			if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === 'k') {
				e.preventDefault();
				focusQuickFilter();
			}
		},
		{ capture: true }
	);
	globalThis.addEventListener('lionGridReady', init);
})();
function setParentRowLoading(api, parentId, on) {
	if (!api || !parentId) return;
	const node = api.getRowNode(parentId);
	if (!node || !node.data) return;
	node.data.__rowLoading = !!on;
}
function buildFilterModelWithGlobal(baseFilterModel) {
	const fm = { ...(baseFilterModel || {}) };
	const gf = (GLOBAL_QUICK_FILTER || '').trim();
	fm._global = Object.assign({}, fm._global, { filter: gf });
	return fm;
}

export class Table {
	constructor(columnDefs = [], opts = {}) {
		this.container = opts.container || '#lionGrid';
		this.columnDefs = Array.isArray(columnDefs) ? columnDefs : [];
		this.gridDiv = null;
		this.gridApi = null;
		this.gridColumnApi = null;
		this.WRAP_FIELDS = opts.WRAP_FIELDS || ['campaign', 'bc_name', 'account_name'];
		this.REVENUE_LABELS = opts.REVENUE_LABELS ?? ['A', 'B'];

		this.GRID_STATE_KEY = opts.GRID_STATE_KEY ?? 'lion.aggrid.state.v1';

		this.GRID_STATE_IGNORE_ON_RESTORE = opts.GRID_STATE_IGNORE_ON_RESTORE ?? [
			'pagination',
			'scroll',
			'rowSelection',
			'focusedCell',
		];
		// Endpoints configuráveis
		this.endpoints = Object.assign(
			{
				SSRM: '/api/ssrm/?clean=1&mode=full',
				ADSETS: '/api/adsets/',
				ADS: '/api/ads/',
			},
			opts.endpoints || {}
		);

		// Knobs de drill configuráveis
		this.drill = Object.assign(
			{
				period: 'TODAY',
				minSpinnerMs: 900,
				fakeNetworkMs: 0,
			},
			opts.drill || {}
		);

		this.ROOT_CACHE = opts.ROOT_CACHE ?? null;
		this.LION_CURRENCY = opts.LION_CURRENCY ?? 'BRL';

		// Seletor do checkbox de pinar colunas
		this.pinToggleSelector = opts.pinToggleSelector || '#pinToggle';
		// Adicionar seletor para colSizeModeToggle
		this.colSizeModeToggleSelector = opts.colSizeModeToggleSelector || '#colSizeModeToggle';
		// Key para storage do estado da grid
		this.gridStateKey = `lionGrid_state_${this.container.replace(/[^a-z0-9]/gi, '_')}`;
		this.defaultColDef = opts.defaultColDef;
		this.selectionColumn = opts.selectionColumn || 'ag-Grid-Selection';
		class LionCompositeColumns {
			constructor() {
				this.registry = new Map();
				this.api = null;
				this.columnApi = null;
			}

			// método chamado *depois* que a grid estiver pronta
			initGridApi(api, columnApi) {
				this.api = api;
				this.columnApi = columnApi;
				this.activate(); // só agora é seguro ativar
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
				else {
					const colApi = api.getColumnApi?.();
					if (colApi?.setColumnDefs) colApi.setColumnDefs(defs);
					else throw new Error('api.setColumnDefs is not available');
				}
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

			_walkDefs(defs, visit, parentCtx = null) {
				(defs || []).forEach((d, idx) => {
					const ctx = { parent: parentCtx?.node || null, arr: defs, idx, node: d };
					if (d && Array.isArray(d.children) && d.children.length) {
						this._walkDefs(d.children, visit, ctx);
					} else {
						visit(d, ctx);
					}
				});
			}

			_buildColIndex(allDefs) {
				const map = new Map();
				this._walkDefs(allDefs, (leaf, ctx) => {
					const keys = [
						this._normKey(leaf?.colId),
						this._normKey(leaf?.field),
						this._normKey(leaf?.headerName),
					].filter(Boolean);
					keys.forEach((k) => {
						if (!map.has(k)) map.set(k, { arr: ctx.arr, idx: ctx.idx, leaf });
					});
				});
				return map;
			}

			_aliasList(raw) {
				const s = String(raw || '')
					.trim()
					.toLowerCase();
				const base = [raw];
				const map = {
					revenue: ['revenue', 'receita', 'receitas', 'rev', 'fat', 'faturamento'],
					spent: [
						'spent',
						'gasto',
						'gastos',
						'spend',
						'despesa',
						'despesas',
						'cost',
						'custo',
						'custos',
					],
					profit: ['profit', 'lucro', 'resultado', 'ganho', 'ganhos'],
					mx: ['mx', 'roi', 'roas', 'retorno'],
					ctr: ['ctr', 'taxadeclique', 'taxa de clique'],
					clicks: ['clicks', 'cliques', 'clique'],
				};
				for (const [k, arr] of Object.entries(map)) {
					if (arr.includes(s)) return [k, ...arr];
				}
				return base;
			}

			_pickHitByTargets(allDefs, idxMap, afterTargets) {
				const norm = (x) =>
					(x == null ? '' : String(x))
						.toLowerCase()
						.normalize('NFD')
						.replace(/[\u0300-\u036f]/g, '')
						.replace(/[^a-z0-9]/g, '');

				for (const raw of afterTargets.flatMap((r) => this._aliasList(r))) {
					const key = norm(raw);
					if (key && idxMap.has(key)) return idxMap.get(key);
				}

				const leaves = [];
				this._walkDefs(allDefs, (leaf, ctx) => leaves.push({ leaf, ctx }));
				for (const raw of afterTargets.flatMap((r) => this._aliasList(r))) {
					const needle = norm(raw);
					if (!needle) continue;
					for (const { leaf, ctx } of leaves) {
						const bag = [leaf?.headerName, leaf?.field, leaf?.colId]
							.map(norm)
							.filter(Boolean);
						if (bag.some((s) => s.includes(needle)))
							return { arr: ctx.arr, idx: ctx.idx, leaf };
					}
				}
				return null;
			}

			_insertAfter(allDefs, newDef, afterKey, fallbackGroupNode) {
				const targets = (Array.isArray(afterKey) ? afterKey : [afterKey]).filter(
					(k) => k != null && String(k).trim() !== ''
				);

				const idxMap = this._buildColIndex(allDefs);
				const hit = this._pickHitByTargets(allDefs, idxMap, targets);

				if (hit) {
					const { arr, idx } = hit;
					arr.splice(idx + 1, 0, newDef);
					return;
				}

				if (fallbackGroupNode && Array.isArray(fallbackGroupNode.children)) {
					fallbackGroupNode.children.push(newDef);
					return;
				}
				allDefs.push(newDef);
			}

			_removeCols(allDefs, idsSet) {
				const filterArray = (arr) => {
					for (let i = arr.length - 1; i >= 0; i--) {
						const d = arr[i];
						if (d?.children?.length) {
							filterArray(d.children);
						} else {
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

				for (const id of ids) {
					const builder = this.registry.get(String(id));
					if (!builder) continue;

					const colDef = builder();
					if (!colDef || typeof colDef !== 'object') continue;

					const colKey = this._normKey(String(colDef.colId || colDef.field || ''));
					if (!colKey) continue;
					if (idxMap.has(colKey)) continue;

					let afterRaw = colDef.__afterId || colDef.__after || 'Revenue';
					const afterTargets = Array.isArray(afterRaw) ? afterRaw : [afterRaw];

					this._insertAfter(newDefs, colDef, afterTargets, fallbackGroupNode);
					idxMap = this._buildColIndex(newDefs);
				}

				this._setColumnDefs(api, newDefs);
				try {
					api.sizeColumnsToFit?.();
				} catch {}
				return true;
			}

			deactivate(ids = []) {
				const api = this._ensureApi();
				const defsRef = this._getColumnDefs(api);
				const newDefs = Array.isArray(defsRef) ? defsRef.slice() : [];
				const idsSet = new Set(ids.map(String));

				this._removeCols(newDefs, idsSet);

				this._setColumnDefs(api, newDefs);
				try {
					api.sizeColumnsToFit?.();
				} catch {}
				return true;
			}
		}
		class LionCalcColumns {
			constructor(compositeInstance) {
				this.composite = compositeInstance; // injeta instância de LionCompositeColumns
				this.LS_KEY = 'lion.aggrid.calcCols.v1';
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
				if (!expr) return expr;
				if (/\bnumber\s*\(/.test(expr)) return expr;
				return expr.replace(/\b([a-zA-Z_]\w*)(?!\s*\()/g, 'number($1)');
			}

			_compileExpr(expr) {
				const src = String(expr || '').trim();
				if (!src) return null;
				const wrapped = this._autoWrapFields(src);
				return (row) => cc_evalExpression(wrapped, row);
			}

			_norm(cfg) {
				const id = String(cfg.id || '').trim();
				const headerName = String(cfg.headerName || id || 'Calc').trim();
				const expression = String(cfg.expression || '').trim();
				const format = (cfg.format || 'currency').toLowerCase();
				const partsFormat = (
					cfg.partsFormat || (format === 'percent' ? 'currency' : format)
				).toLowerCase();
				const onlyLevel0 = cfg.onlyLevel0 ?? cfg.onlyRoot ?? true;
				const after = cfg.after || 'Revenue';
				const totalLabel = String(cfg.totalLabel ?? 'Total').trim();
				const mini = !!cfg.mini;
				const hideTop = mini;
				const includeTotalAsPart = mini;
				const partsLabelOnly = false;
				const maxParts = 0;
				const parts = Array.isArray(cfg.parts)
					? cfg.parts.map((p) => ({
							label: String(p.label || '').trim(),
							expr: String(p.expr || '').trim(),
					  }))
					: [];
				return {
					id,
					headerName,
					expression,
					format,
					partsFormat,
					parts,
					onlyLevel0,
					after,
					totalLabel,
					mini,
					hideTop,
					includeTotalAsPart,
					partsLabelOnly,
					maxParts,
				};
			}

			_fmtBy(fmt, n) {
				if (!Number.isFinite(n)) return '—';
				if (fmt === 'int') return intFmt.format(Math.round(n));
				if (fmt === 'raw') return String(n);
				if (fmt === 'percent') return cc_percentFormat(n);
				return cc_currencyFormat(n);
			}

			_buildColDef(cfg) {
				const n = this._norm(cfg);
				const totalFn = this._compileExpr(n.expression);
				const partFns = n.parts.map((p) => ({ label: p.label, fn: this._compileExpr(p.expr) }));
				const valueFormatter = (p) => {
					const v0 = typeof p.value === 'number' ? p.value : number(p.value);
					const v = Number.isFinite(v0) ? v0 : null;
					if (v == null) return p.value ?? '';
					if (n.format === 'int') return intFmt.format(Math.round(v));
					if (n.format === 'raw') return String(v);
					if (n.format === 'percent') return cc_percentFormat(v);
					return currencyFormatter({ value: v });
				};
				const tooltipValueGetter = (p) => {
					const row = p?.data || {};
					const tot = totalFn ? totalFn(row) : null;
					const lines = [`${n.totalLabel}: ${this._fmtBy(n.format, tot)}`];
					for (const { label, fn } of partFns)
						lines.push(`${label || ''}: ${this._fmtBy(n.partsFormat, fn ? fn(row) : null)}`);
					return lines.join('\n');
				};
				return {
					headerName: n.headerName,
					colId: n.id,
					minWidth: 150,
					flex: 1,
					pinned: null,
					valueGetter: (p) => {
						const row = p?.data || {};
						const val = totalFn ? totalFn(row) : null;
						return Number.isFinite(val) ? val : null;
					},
					valueFormatter,
					tooltipValueGetter,
					cellRenderer: StackBelowRenderer,
					cellRendererParams: {
						partsMaxHeight: 40,
						onlyLevel0: !!n.onlyLevel0,
						format:
							n.partsFormat === 'int'
								? 'int'
								: n.partsFormat === 'raw'
								? 'raw'
								: n.partsFormat === 'percent'
								? 'percent'
								: 'currency',
						showTop: !n.hideTop,
						partsLabelOnly: !!n.partsLabelOnly,
						showLabels: n.mini,
						forceShowLabels: n.mini,
						maxParts: Number(n.maxParts) || 0,
						getParts: (p) => {
							const row = p?.data || {};
							const list = [];
							const pushPart = (label, value, isTotal, fmt) => {
								const formatted = Number.isFinite(value) ? this._fmtBy(fmt, value) : '—';
								list.push({
									label,
									name: label,
									value,
									text: `${label}: ${formatted}`,
									labelWithValue: `${label}: ${formatted}`,
									isTotal: !!isTotal,
								});
							};
							if (n.includeTotalAsPart) {
								const tot = totalFn ? totalFn(row) : null;
								pushPart(n.totalLabel, tot, true, n.format);
							}
							for (const { label, fn } of partFns) {
								const v = fn ? fn(row) : null;
								pushPart(label, v, false, n.partsFormat);
							}
							return list;
						},
					},
					__after: n.after,
				};
			}

			_registerAndActivate(cfg) {
				const colDef = this._buildColDef(cfg);
				if (!colDef) return false;
				this.composite.register(colDef.colId, () => colDef);
				console.log(`[CalcCols] Registering "${colDef.colId}":`, colDef.cellRendererParams);
				try {
					return this.composite.activate([colDef.colId]) || true;
				} catch (e) {
					console.warn('[CalcCols] activate failed', e);
					return false;
				}
			}

			_migrateLegacyColumn(cfg) {
				if (cfg.parts && cfg.parts.length > 0) return cfg;
				const fieldMatches = (cfg.expression || '').match(/\b([a-zA-Z_]\w*)(?!\s*\()/g);
				if (fieldMatches && fieldMatches.length > 0) {
					const known = ['number', 'cc_evalExpression', 'Math'];
					const unique = [...new Set(fieldMatches)].filter((f) => !known.includes(f));
					cfg.parts = unique.slice(0, 5).map((field) => ({
						label: field
							.replace(/_/g, ' ')
							.replace(/\b\w/g, (l) => l.toUpperCase())
							.trim(),
						expr: field,
					}));
					console.log(`[CalcCols] Migrated "${cfg.id}" with auto-parts:`, cfg.parts);
				}
				return cfg;
			}

			add(config) {
				let cfg = this._norm(config);
				cfg = this._migrateLegacyColumn(cfg);
				if (!cfg.id || !cfg.expression) {
					showToast('Invalid config (id/expression required)', 'danger');
					return false;
				}
				if (!this._compileExpr(cfg.expression)) {
					showToast('Invalid expression', 'danger');
					return false;
				}
				for (const p of cfg.parts) {
					if (p.expr && !this._compileExpr(p.expr)) {
						showToast(`Invalid part: ${p.label || '(no label)'}`, 'danger');
						return false;
					}
				}
				const bag = this._read();
				const idx = bag.findIndex((c) => String(c.id) === cfg.id);
				if (idx >= 0) bag[idx] = cfg;
				else bag.push(cfg);
				this._write(bag);
				const ok = this._registerAndActivate(cfg);
				if (ok) showToast(`Column "${cfg.headerName}" ready`, 'success');
				return !!ok;
			}

			remove(id) {
				const key = String(id || '').trim();
				if (!key) return;
				try {
					this.composite.deactivate([key]);
				} catch {}
				const bag = this._read().filter((c) => String(c.id) !== key);
				this._write(bag);
				showToast(`Column removed: ${key}`, 'info');
			}

			list() {
				return this._read();
			}

			activateAll() {
				const bag = this._read();
				const migrated = [];
				let cnt = 0;
				for (const cfg of bag) {
					const m = this._migrateLegacyColumn(cfg);
					if (m.parts && m.parts.length > 0 && (!cfg.parts || cfg.parts.length === 0)) cnt++;
					migrated.push(m);
					this._registerAndActivate(m);
				}
				if (cnt > 0) {
					this._write(migrated);
					console.log(`[CalcCols] Migrated ${cnt} column(s)`);
				}
			}

			getAvailableFields() {
				return [
					'revenue',
					'fb_revenue',
					'push_revenue',
					'spent',
					'profit',
					'clicks',
					'impressions',
					'visitors',
					'conversions',
					'real_conversions',
					'cpc',
					'cpa_fb',
					'real_cpa',
					'budget',
					'bid',
					'mx',
					'ctr',
				];
			}

			exportForPreset() {
				return this._read().map((cfg) => this._migrateLegacyColumn(cfg));
			}

			importFromPreset(columns) {
				if (!Array.isArray(columns)) return;
				this._write(columns);
				this.activateAll();
			}

			clear() {
				const bag = this._read();
				for (const cfg of bag) {
					try {
						this.composite.deactivate([cfg.id]);
					} catch {}
				}
				this._write([]);
			}
		}
		this.composite = new LionCompositeColumns(this); // ✅ Passar 'this'
		this.calc = new LionCalcColumns(this.composite);
		// se quiser expor globalmente
	}
	init() {
		this.ensureLoadingStyles();
		this.bindCalcColsModalClose();
		this.initModalClickEvents();
		this.initModalEvents();
		this.CalcColsPopulate();
		this.setupToolbar();

		return this.makeGrid();
	}

	setupToolbar() {
		const tableInstance = this; // ✅ Guarda referência da instância Table
		const byId = (id) => document.getElementById(id);

		const ensureApi = () => {
			if (!this.api) throw new Error('[CompositeColumns] Grid API indisponível');
			return this.api;
		};

		const SS_KEY_STATE = this.GRID_STATE_KEY || 'lion.aggrid.state.v1';
		const LS_KEY_PRESETS = 'lion.aggrid.presets.v1';
		const LS_KEY_ACTIVE_PRESET = 'lion.aggrid.activePreset.v1';

		const getState = () => {
			// ✅ Arrow function
			const api = ensureApi();
			if (!api) return null;
			try {
				return api.getState();
			} catch {
				return null;
			}
		};

		const setState = (state, ignore = []) => {
			// ✅ Arrow function
			const api = ensureApi();
			if (!api) return;
			try {
				api.setState(state, ignore || []);
			} catch (e) {
				console.warn('setState fail', e);
			}
		};

		const resetLayout = () => {
			// ✅ Arrow function
			const api = ensureApi();
			if (!api) return;
			try {
				sessionStorage.removeItem(SS_KEY_STATE);
				localStorage.removeItem(LS_KEY_ACTIVE_PRESET);
				api.setState({}, []);
				api.resetColumnState?.();
				api.setFilterModel?.(null);
				api.setSortModel?.([]);
				refreshPresetUserSelect();
				showToast('Layout Reset', 'info');
			} catch (e) {
				console.warn('resetLayout fail', e);
			}
		};

		const readPresets = () => {
			// ✅ Arrow function
			try {
				return JSON.parse(localStorage.getItem(LS_KEY_PRESETS) || '{}');
			} catch {
				return {};
			}
		};

		const writePresets = (obj) => {
			// ✅ Arrow function
			localStorage.setItem(LS_KEY_PRESETS, JSON.stringify(obj));
		};

		const listPresetNames = () => {
			// ✅ Arrow function
			return Object.keys(readPresets()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
		};

		const refreshPresetUserSelect = () => {
			// ✅ Arrow function
			const sel = byId('presetUserSelect');
			if (!sel) return;
			const activePreset = localStorage.getItem(LS_KEY_ACTIVE_PRESET) || '';
			while (sel.firstChild) sel.removeChild(sel.firstChild);
			const placeholderText = 'Default';
			sel.appendChild(new Option(placeholderText, ''));
			listPresetNames().forEach((name) => sel.appendChild(new Option(name, name)));
			if (activePreset && [...sel.options].some((o) => o.value === activePreset))
				sel.value = activePreset;
			else sel.value = '';
		};

		// ===== Calculated Columns Modal (KTUI) =====
		(function setupCalcColsModal(instance) {
			// ✅ Recebe a instância como parâmetro
			const tableInstance = instance; // ✅ Usa a referência passada
			const $ = (sel) => document.querySelector(sel);
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
			];

			const populateExpressionSelect = () => {
				// ✅ Arrow function
				const sel = $('#cc-format');
				if (!sel) return;
				sel.innerHTML = '';
				DEFAULT_OPERATORS.forEach((op) => {
					const option = document.createElement('option');
					option.value = op.value;
					option.textContent = op.label;
					option.dataset.template = op.template;
					sel.appendChild(option);
				});
				if (globalThis.KT && KT.Select && KT.Select.getOrCreateInstance) {
					try {
						const instance = KT.Select.getOrCreateInstance(sel);
						if (instance) {
							instance.destroy();
							KT.Select.getInstance(sel)?.init();
						}
					} catch (e) {
						console.warn('Failed to reinitialize cc-format select:', e);
					}
				}
			};

			const populateColumnSelects = () => {
				// ✅ Arrow function
				const api = ensureApi();
				if (!api) return;

				const _isCalculableByDef = (def) => {
					// ✅ Arrow function
					if (!def) return false;
					if (def.calcEligible === true) return true;
					if (def.calcType === 'numeric') return true;
					if (def.valueType === 'number') return true;
					if (def.cellDataType === 'number') return true;
					if (def.type === 'numericColumn') return true;
					if (def.filter === 'agNumberColumnFilter') return true;
					if (typeof def.valueParser === 'function') return true;
					return false;
				};

				const _flattenColDefs = (defOrArray) => {
					// ✅ Arrow function
					const out = [];
					const walk = (arr) => {
						(arr || []).forEach((def) => {
							if (def?.children?.length) walk(def.children);
							else out.push(def);
						});
					};
					if (Array.isArray(defOrArray)) walk(defOrArray);
					else if (defOrArray) walk([defOrArray]);
					return out;
				};

				const _getSelectableColumns = () => {
					// ✅ Arrow function
					let defs = [];
					try {
						const displayed = api.getAllDisplayedColumns?.() || [];
						if (displayed.length) {
							defs = displayed
								.map((gc) => gc.getColDef?.() || gc.colDef || null)
								.filter(Boolean);
						}
					} catch {}
					if (!defs.length) {
						const columnState = api.getColumnState?.() || [];
						const viaState = columnState
							.map((s) => api.getColumn?.(s.colId)?.getColDef?.())
							.filter(Boolean);
						if (viaState.length) defs = viaState;
						else defs = (api.getColumnDefs?.() || []).flatMap(_flattenColDefs);
					}

					const deny = new Set(['ag-Grid-AutoColumn', 'ag-Grid-RowGroup', '__autoGroup']);
					defs = defs.filter((def) => {
						if (!def) return false;
						const field = def.field || def.colId;
						const header = def.headerName || field;
						if (!field || !header) return false;
						if (deny.has(field)) return false;
						if (String(field).startsWith('__')) return false;
						if (def.checkboxSelection) return false;
						if (def.rowGroup || def.pivot) return false;
						const h = String(header).toLowerCase();
						if (h.includes('select') || h.includes('ação') || h.includes('action'))
							return false;
						return true;
					});

					defs = defs.filter(_isCalculableByDef);

					const mapped = defs.map((def) => ({
						field: String(def.field || def.colId),
						label: String(def.headerName || def.field || def.colId),
					}));
					const seen = new Set();
					const unique = [];
					for (const it of mapped) {
						if (seen.has(it.field)) continue;
						seen.add(it.field);
						unique.push(it);
					}
					unique.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
					return unique;
				};

				const col1Sel = document.querySelector('#cc-col1');
				const col2Sel = document.querySelector('#cc-col2');
				if (!col1Sel || !col2Sel) return;

				const options = _getSelectableColumns();
				[col1Sel, col2Sel].forEach((sel) => {
					sel.innerHTML = '';
					for (const col of options) {
						const opt = document.createElement('option');
						opt.value = col.field;
						opt.textContent = `${col.label} (${col.field})`;
						sel.appendChild(opt);
					}
					if (globalThis.KT && KT.Select && KT.Select.getOrCreateInstance) {
						try {
							const instance = KT.Select.getOrCreateInstance(sel);
							if (instance) {
								instance.destroy();
								KT.Select.getInstance(sel)?.init();
							}
						} catch (e) {
							console.warn('Failed to reinitialize column select:', e);
						}
					}
				});
			};

			const updateExpressionFromSelects = () => {
				// ✅ Arrow function
				const formatSel = $('#cc-format');
				const col1Sel = $('#cc-col1');
				const col2Sel = $('#cc-col2');
				const exprInput = $('#cc-expression');
				const partsInput = $('#cc-parts');
				if (!formatSel || !col1Sel || !col2Sel || !exprInput) return;
				const selectedOp = formatSel.options[formatSel.selectedIndex];
				const template = selectedOp?.dataset?.template;
				if (!template || formatSel.value === 'custom') return;
				const col1 = col1Sel.value;
				const col2 = col2Sel.value;
				if (col1 && col2) {
					const expression = template.replace(/{col1}/g, col1).replace(/{col2}/g, col2);
					exprInput.value = expression;
					if (partsInput) {
						const col1Label = col1Sel.options[col1Sel.selectedIndex]?.textContent || col1;
						const col2Label = col2Sel.options[col2Sel.selectedIndex]?.textContent || col2;
						const parts = [
							{ label: col1Label.replace(/number/gi, '').trim(), expr: col1 },
							{ label: col2Label.replace(/number/gi, '').trim(), expr: col2 },
						];
						partsInput.value = JSON.stringify(parts, null, 2);
					}
				}
			};

			const modalShow = (selector) => {
				// ✅ Arrow function
				const el = document.querySelector(selector);
				if (!el) return;
				if (globalThis.KT && KT.Modal && KT.Modal.getOrCreateInstance)
					KT.Modal.getOrCreateInstance(el).show();
				else {
					el.classList.remove('hidden');
					el.style.display = 'block';
					el.setAttribute('aria-hidden', 'false');
					el.classList.add('kt-modal--open');
				}
			};

			const modalHide = (selector) => {
				// ✅ Arrow function
				const el = document.querySelector(selector);
				if (!el) return;
				if (globalThis.KT && KT.Modal && KT.Modal.getOrCreateInstance)
					KT.Modal.getOrCreateInstance(el).hide();
				else {
					el.style.display = 'none';
					el.classList.add('hidden');
					el.classList.remove('kt-modal--open');
					el.setAttribute('aria-hidden', 'true');
				}
			};

			const btn = document.getElementById('btnCalcCols');
			if (btn) {
				btn.addEventListener('click', (e) => {
					const sel = btn.getAttribute('data-kt-modal-toggle') || '#calcColsModal';
					setTimeout(() => {
						modalShow(sel);
						clearForm();
						populateExpressionSelect();
						populateColumnSelects();
						renderList();
					}, 0);
				});
			}

			const formatSel = $('#cc-format');
			const col1Sel = $('#cc-col1');
			const col2Sel = $('#cc-col2');
			if (formatSel) formatSel.addEventListener('change', updateExpressionFromSelects);
			if (col1Sel) col1Sel.addEventListener('change', updateExpressionFromSelects);
			if (col2Sel) col2Sel.addEventListener('change', updateExpressionFromSelects);

			const modalEl = document.getElementById('calcColsModal');
			if (modalEl)
				modalEl.addEventListener('show.kt.modal', () => {
					clearForm();
					populateExpressionSelect();
					populateColumnSelects();
					renderList();
				});

			const list = $('#cc-list');
			const empty = $('#cc-empty');
			const saveBtn = $('#cc-save');
			const reloadBtn = $('#cc-reload');
			const resetBtn = $('#cc-reset-form');
			const activateAllBtn = $('#cc-activate-all');

			if (typeof document !== 'undefined') {
				if (document.readyState === 'loading') {
					document.addEventListener('DOMContentLoaded', () => {
						setTimeout(() => {
							populateExpressionSelect();
							populateColumnSelects();
						}, 100);
					});
				} else {
					setTimeout(() => {
						populateExpressionSelect();
						populateColumnSelects();
					}, 100);
				}
			}

			const readForm = () => {
				// ✅ Arrow function
				const headerName = ($('#cc-header')?.value || '').trim();
				let id = ($('#cc-id')?.value || '').trim();
				const format = ($('#cc-type')?.value || 'currency').trim().toLowerCase();
				const expression = ($('#cc-expression')?.value || '').trim();
				const onlyLevel0 = !!$('#cc-only-level0')?.checked;
				const after = ($('#cc-after')?.value || 'Revenue').trim() || 'Revenue';
				const mini = !!$('#cc-mini')?.checked;

				if (!id && headerName)
					id = headerName.toLowerCase().replace(/\s+/g, '_').replace(/[^\w]/g, '');

				let parts = [];
				const raw = ($('#cc-parts')?.value || '').trim();
				if (raw) {
					try {
						parts = JSON.parse(raw);
					} catch {
						showToast('Invalid Parts JSON', 'danger');
						parts = null;
					}
				}
				return { id, headerName, format, expression, parts, onlyLevel0, after, mini };
			};

			const clearForm = () => {
				// ✅ Arrow function
				$('#cc-header').value = '';
				$('#cc-id').value = '';
				const formatSel = $('#cc-format');
				if (formatSel && formatSel.options.length > 0) formatSel.selectedIndex = 0;
				const col1Sel = $('#cc-col1');
				const col2Sel = $('#cc-col2');
				if (col1Sel && col1Sel.options.length > 0) col1Sel.selectedIndex = 0;
				if (col2Sel && col2Sel.options.length > 0) col2Sel.selectedIndex = 0;
				$('#cc-expression').value = '';
				$('#cc-parts').value = '[]';
				$('#cc-only-level0').checked = true;
				$('#cc-after').value = 'Revenue';
				$('#cc-type').value = 'currency';
				const miniEl = $('#cc-mini');
				if (miniEl) miniEl.checked = false;
				updateExpressionFromSelects();
			};

			const renderList = () => {
				// ✅ Arrow function
				if (!list) return;
				// ✅ Usa tableInstance em vez de this
				const items = tableInstance?.calc?.list() || [];
				list.innerHTML = '';
				if (!items.length) {
					empty?.classList.remove('hidden');
					return;
				}
				empty?.classList.add('hidden');

				for (const c of items) {
					const li = document.createElement('li');
					li.className = 'flex items-center justify-between p-3';
					const left = document.createElement('div');
					left.className = 'min-w-0';
					left.innerHTML = `
                    <div class="font-medium">${c.headerName || c.id}</div>
                    <div class="text-xs opacity-70 break-words">id: <code>${c.id}</code></div>
                    <div class="text-xs opacity-70 break-words">expr: <code>${c.expression}</code></div>
                `;
					const right = document.createElement('div');
					right.className = 'flex items-center gap-2';

					const btnApply = document.createElement('button');
					btnApply.className = 'kt-btn kt-btn-xs';
					btnApply.textContent = 'Activate';
					btnApply.addEventListener('click', () => {
						tableInstance.calc.add(c); // ✅ Usa tableInstance
					});

					const btnEdit = document.createElement('button');
					btnEdit.className = 'kt-btn kt-btn-light kt-btn-xs';
					btnEdit.textContent = 'Edit';
					btnEdit.addEventListener('click', () => {
						$('#cc-header').value = c.headerName || '';
						$('#cc-id').value = c.id || '';
						$('#cc-type').value = c.format || 'currency';
						$('#cc-expression').value = c.expression || '';
						$('#cc-parts').value = (c.parts && JSON.stringify(c.parts)) || '';
						$('#cc-only-level0').checked = !!c.onlyLevel0;
						$('#cc-after').value = c.after || 'Revenue';
						const miniEl = $('#cc-mini');
						if (miniEl) miniEl.checked = !!c.mini;
					});

					const btnRemove = document.createElement('button');
					btnRemove.className = 'kt-btn kt-btn-danger kt-btn-xs';
					btnRemove.textContent = 'Remove';
					btnRemove.addEventListener('click', () => {
						if (!confirm(`Remove column "${c.id}"?`)) return;
						tableInstance.calc.remove(c.id); // ✅ Usa tableInstance
						renderList();
					});

					right.append(btnApply, btnEdit, btnRemove);
					li.append(left, right);
					list.appendChild(li);
				}
			};

			saveBtn?.addEventListener('click', (e) => {
				e.preventDefault();

				const cfg = readForm();
				if (!cfg) return;
				if (!cfg.id || !cfg.expression) {
					showToast('ID and Expression are required', 'danger');
					return;
				}

				try {
					const ok = tableInstance.calc.add(cfg); // ✅ Usa tableInstance
					if (!ok) return;

					try {
						modalHide('#calcColsModal');
					} catch {}

					const api = globalThis.LionGrid?.api || null;
					if (api) {
						try {
							api.ensureColumnVisible(cfg.id, 'auto');
						} catch {}
						try {
							api.refreshHeader?.();
						} catch {}
						try {
							api.redrawRows?.();
						} catch {}

						try {
							refreshSSRM(api);
						} catch {}

						setTimeout(() => {
							try {
								api.sizeColumnsToFit?.();
							} catch {}
							try {
								api.resetRowHeights?.();
							} catch {}
						}, 50);
					}

					renderList();
					showToast('Calculated column saved and applied!', 'success');
				} catch (err) {
					showToast('Failed to save column ', 'danger');
					console.warn(err);
				}
			});

			resetBtn?.addEventListener('click', (e) => {
				e.preventDefault();
				clearForm();
			});

			reloadBtn?.addEventListener('click', (e) => {
				e.preventDefault();
				populateColumnSelects();
				renderList();
			});

			activateAllBtn?.addEventListener('click', (e) => {
				e.preventDefault();
				try {
					tableInstance.calc.activateAll(); // ✅ Usa tableInstance
					showToast('All calculated columns activated', 'success');
				} catch (err) {
					showToast('Failed to activate all', 'danger');
				}
			});

			document.addEventListener('click', (ev) => {
				const t = ev.target;
				if (!(t instanceof Element)) return;
				const toggle = t.closest('[data-kt-modal-toggle="#calcColsModal"]');
				if (toggle) {
					setTimeout(() => {
						clearForm();
						populateExpressionSelect();
						populateColumnSelects();
						renderList();
					}, 50);
				}
			});
		})(tableInstance); // ✅ Passa a instância Table para o IIFE

		const saveAsPreset = () => {
			// ✅ Arrow function
			const api = globalThis.LionGrid?.api;
			if (!api) return showToast('Grid API not ready', 'warning');
			const name = prompt('Preset name:');
			if (!name) return;

			let state;
			try {
				state = api.getState();
				if (!state) throw new Error('Null state');
			} catch (e) {
				return showToast("Couldn't capture grid state", 'danger');
			}

			const calcColumns = tableInstance.calc?.exportForPreset?.() || []; // ✅ Usa tableInstance
			const bag = readPresets();
			bag[name] = {
				version: 1,
				name,
				createdAt: Date.now(),
				gridState: state,
				calcColumns,
			};
			writePresets(bag);
			refreshPresetUserSelect();
			showToast(`Preset "${name}" saved`, 'success');
		};

		const applyPresetUser = (name) => {
			// ✅ Arrow function
			if (!name) return;
			const bag = readPresets();
			const p = bag[name];
			if (!p || !p.gridState) {
				return showToast('Preset not found or invalid', 'warning');
			}

			tableInstance.calc?.clear?.(); // ✅ Usa tableInstance

			if (Array.isArray(p.calcColumns) && p.calcColumns.length > 0) {
				tableInstance.calc?.importFromPreset(p.calcColumns); // ✅ Usa tableInstance
			}

			const api = globalThis.LionGrid?.api;
			if (!api) {
				return showToast('Grid API not ready', 'warning');
			}
			try {
				api.setState(p.gridState, ['pagination', 'scroll', 'rowSelection', 'focusedCell']);
			} catch (e) {
				console.error('applyPresetUser setState error', e);
			}

			api.refreshHeader?.();
			api.redrawRows?.();
			showToast(`Preset "${name}" applied`, 'success');
		};

		const deletePreset = () => {
			// ✅ Arrow function
			const sel = byId('presetUserSelect');
			const name = sel?.value || '';
			if (!name) return showToast('Pick a preset first', 'warning');
			if (!confirm(`Delete preset "${name}"?`)) return;
			const bag = readPresets();
			delete bag[name];
			writePresets(bag);
			const activePreset = localStorage.getItem(LS_KEY_ACTIVE_PRESET);
			if (activePreset === name) localStorage.removeItem(LS_KEY_ACTIVE_PRESET);
			refreshPresetUserSelect();
			showToast(`Preset "${name}" removed`, 'info');
		};

		const downloadPreset = () => {
			// ✅ Arrow function
			const sel = byId('presetUserSelect');
			const name = sel?.value || '';
			if (!name) return showToast('Pick a preset first', 'warning');
			const bag = readPresets();
			const p = bag[name];
			if (!p) return showToast('Preset not found', 'warning');
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
			// ✅ Arrow function
			const input = byId('presetFileInput');
			if (!input) return;
			input.value = '';
			input.click();
		};

		byId('presetFileInput')?.addEventListener('change', (e) => {
			const file = e.target.files?.[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = () => {
				try {
					const parsed = JSON.parse(String(reader.result || '{}'));
					if (!parsed?.grid) return showToast('Invalid preset file', 'danger');
					const name = prompt(
						'Name to save this preset as:',
						parsed.name || file.name.replace(/\.json$/i, '')
					);
					if (!name) return;
					const bag = readPresets();
					bag[name] = { ...parsed, name, importedAt: Date.now() };
					writePresets(bag);
					refreshPresetUserSelect();
					const sel = byId('presetUserSelect');
					if (sel) sel.value = name;
					applyPresetUser(name);
				} catch {
					showToast('Failed to read JSON', 'danger');
				}
			};
			reader.readAsText(file, 'utf-8');
		});

		const LS_KEY_SIZE_MODE = 'lion.aggrid.sizeMode';
		const applySizeMode = (mode) => {
			// ✅ Arrow function
			const api = (globalThis.LionGrid || {}).api;
			if (!api) return;
			try {
				if (mode === 'auto') {
					const all = api.getColumns()?.map((c) => c.getColId()) || [];
					api.autoSizeColumns(all, false);
				} else api.sizeColumnsToFit();
			} catch {}
		};

		const getSizeMode = () => {
			// ✅ Arrow function
			const v = localStorage.getItem(LS_KEY_SIZE_MODE);
			return v === 'auto' ? 'auto' : 'fit';
		};

		const setSizeMode = (mode) => {
			// ✅ Arrow function
			localStorage.setItem(LS_KEY_SIZE_MODE, mode);
		};

		(function initSizeModeToggle() {
			const el = byId('colSizeModeToggle');
			if (!el) return;
			const mode = getSizeMode();
			el.checked = mode === 'auto';
			applySizeMode(mode);
			el.addEventListener('change', () => {
				const next = el.checked ? 'auto' : 'fit';
				setSizeMode(next);
				applySizeMode(next);
				showToast(next === 'auto' ? 'Mode: Auto Size' : 'Mode: Size To Fit', 'info');
			});
			window.addEventListener('resize', () => applySizeMode(getSizeMode()));
		})();

		byId('btnResetLayout')?.addEventListener('click', resetLayout);
		byId('presetUserSelect')?.addEventListener('change', (e) => {
			const v = e.target.value;
			if (!v) {
				resetLayout();
				localStorage.removeItem(LS_KEY_ACTIVE_PRESET);
				refreshPresetUserSelect();
				return;
			}
			applyPresetUser(v);
		});

		byId('btnAddCalcCol')?.addEventListener('click', () => {
			try {
				tableInstance.calc.openQuickBuilder(); // ✅ Usa tableInstance
			} catch (e) {
				console.warn(e);
			}
		});

		byId('btnManageCalcCols')?.addEventListener('click', () => {
			try {
				tableInstance.calc.manage(); // ✅ Usa tableInstance
			} catch (e) {
				console.warn(e);
			}
		});

		byId('btnSaveAsPreset')?.addEventListener('click', saveAsPreset);
		byId('btnDeletePreset')?.addEventListener('click', deletePreset);
		byId('btnDownloadPreset')?.addEventListener('click', downloadPreset);
		byId('btnUploadPreset')?.addEventListener('click', uploadPreset);

		refreshPresetUserSelect();

		globalThis.addEventListener('lionGridReady', () => {
			const activePreset = localStorage.getItem(LS_KEY_ACTIVE_PRESET);
			if (activePreset) {
				const bag = readPresets();
				const p = bag[activePreset];
				if (p?.grid) {
					setState(p.grid, ['pagination', 'scroll', 'rowSelection', 'focusedCell']);
					console.log(`[Preset] Auto-applied: "${activePreset}"`);
				}
			} else {
				const api = globalThis.LionGrid?.api;
				if (api) {
					try {
						api.setState({}, []);
						api.resetColumnState?.();
						api.setFilterModel?.(null);
						api.setSortModel?.([]);
						console.log('[Preset] Complete initialization applied - no active preset');
					} catch (e) {
						console.warn('[Preset] Failed to apply complete initialization:', e);
					}
				}
			}
		});

		globalThis.LionGrid = Object.assign(globalThis.LionGrid || {}, {
			getState,
			setState,
			resetLayout,
			saveAsPreset,
			applyPresetUser,
		});
	}
	_applySizeMode(mode) {
		const api = this.api || globalThis.LionGrid?.api;
		if (!api) return;
		try {
			if (mode === 'auto') {
				const all = api.getColumns?.()?.map((c) => c.getColId()) || [];
				api.autoSizeColumns?.(all, false);
			} else {
				api.sizeColumnsToFit?.();
			}
		} catch {}
	}
	_getPinnedState() {
		const LS_KEY_PINNED_STATE = 'lion.aggrid.pinnedState';
		const v = localStorage.getItem(LS_KEY_PINNED_STATE);
		return v === 'false' ? false : true; // default é true (pinned)
	}

	_setPinnedState(state) {
		const LS_KEY_PINNED_STATE = 'lion.aggrid.pinnedState';
		localStorage.setItem(LS_KEY_PINNED_STATE, state ? 'true' : 'false');
	}
	_getSizeMode() {
		const LS_KEY_SIZE_MODE = 'lion.aggrid.sizeMode';
		const v = localStorage.getItem(LS_KEY_SIZE_MODE);
		return v === 'auto' ? 'auto' : 'fit';
	}

	_setSizeMode(mode) {
		const LS_KEY_SIZE_MODE = 'lion.aggrid.sizeMode';
		localStorage.setItem(LS_KEY_SIZE_MODE, mode);
	}

	_bindPinnedToggle() {
		const el = document.querySelector(this.pinToggleSelector);
		if (!el) return;
		if (!el.hasAttribute('data-init-bound')) {
			el.checked = true;
			el.addEventListener('change', () => this.togglePinnedColsFromCheckbox(false));
			el.setAttribute('data-init-bound', '1');
		}
		// aplica silencioso no load
		try {
			this.togglePinnedColsFromCheckbox(true);
		} catch {}
	}

	togglePinnedColsFromCheckbox(silent = false) {
		const api = this.api;
		if (!api) return;
		const el = document.getElementById('pinToggle');
		if (!el) return;
		const checked = !!el.checked;

		// ✅ SALVAR ESTADO
		this._setPinnedState(checked);

		const selectionColId = this.getSelectionColId(api);
		const leftPins = [
			{ colId: 'ag-Grid-SelectionColumn', pinned: checked ? 'left' : null },
			{ colId: 'ag-Grid-AutoColumn', pinned: checked ? 'left' : null },
			{ colId: 'profile_name', pinned: checked ? 'left' : null },
		];
		if (selectionColId) leftPins.push({ colId: selectionColId, pinned: checked ? 'left' : null });
		const rightPins = [
			{ colId: 'spent', pinned: checked ? 'right' : null },
			{ colId: 'revenue', pinned: checked ? 'right' : null },
			{ colId: 'mx', pinned: checked ? 'right' : null },
			{ colId: 'profit', pinned: checked ? 'right' : null },
		];
		api.applyColumnState({ state: [...leftPins, ...rightPins], defaultState: { pinned: null } });
		if (!silent)
			showToast(checked ? 'Columns Pinned' : 'Columns Unpinned', checked ? 'success' : 'info');
	}

	initModalClickEvents() {
		const el = document.getElementById('calcColsModal');
		if (!el) return;

		el.addEventListener(
			'click',
			(e) => {
				// só fecha se o clique for no fundo (e não no conteúdo interno)
				if (e.target.id !== 'calcColsModal') return;

				try {
					if (window.KT?.Modal?.getOrCreateInstance) {
						window.KT.Modal.getOrCreateInstance(el).hide();
						return;
					}
				} catch {}

				el.style.display = 'none';
				el.classList.add('hidden');
				el.classList.remove('kt-modal--open');
				el.setAttribute('aria-hidden', 'true');
			},
			{ passive: true }
		);
	}
	initModalEvents() {
		document.addEventListener(
			'keydown',
			(e) => {
				if (e.key !== 'Escape') return;
				const el = document.getElementById('calcColsModal');
				if (!el || el.getAttribute('aria-hidden') !== 'false') return;

				try {
					if (window.KT?.Modal?.getOrCreateInstance) {
						window.KT.Modal.getOrCreateInstance(el).hide();
						return;
					}
				} catch {}

				el.style.display = 'none';
				el.classList.add('hidden');
				el.classList.remove('kt-modal--open');
				el.setAttribute('aria-hidden', 'true');
			},
			{ passive: true }
		);
	}

	getSelectionColId(api) {
		try {
			const selectionColumn = this.selectionColumn;
			const cols = api.getColumns() || [];
			const ids = cols.map((c) => c.getColId());
			if (ids.includes(selectionColumn)) return selectionColumn;
			const found = cols.find(
				(c) => c.getColDef()?.headerCheckboxSelection || c.getColDef()?.checkboxSelection
			);
			return found?.getColId() || null;
		} catch {
			return null;
		}
	}

	isPinnedOrGroup(params) {
		return params?.node?.rowPinned || params?.node?.group;
	}

	bindCalcColsModalClose() {
		const modal = document.getElementById('calcColsModal');
		if (!modal) return;

		function hideModal() {
			// Prefer KT if present
			try {
				if (window.KT?.Modal?.getOrCreateInstance) {
					window.KT.Modal.getOrCreateInstance(modal).hide();
					return;
				}
			} catch {}
			// Fallback manual
			modal.style.display = 'none';
			modal.classList.add('hidden');
			modal.classList.remove('kt-modal--open');
			modal.setAttribute('aria-hidden', 'true');
		}

		// Wire both the "Close" button and the X icon
		const closeBtns = modal.querySelectorAll(
			'[data-kt-modal-dismiss="#calcColsModal"], .kt-modal-close'
		);
		closeBtns.forEach((btn) => {
			btn.addEventListener(
				'click',
				(e) => {
					e.preventDefault();
					hideModal();
				},
				{ passive: true }
			);
		});
	}

	ensureLoadingStyles() {
		if (document.getElementById('lion-loading-styles')) return;
		const css = `
.ag-cell.ag-cell-loading * { visibility: hidden !important; }
.ag-cell.ag-cell-loading::after {
  content:""; position:absolute; left:50%; top:50%; width:14px; height:14px;
  margin-left:-7px; margin-top:-7px; border-radius:50%; border:2px solid #9ca3af;
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
.lion-editable-err{ display:inline-flex; align-items:center; margin-left:6px; opacity:.95; pointer-events:none; font-size:12px; line-height:1; color:#ef4444; }
.ag-cell:hover .lion-editable-err{ opacity:1 }
.ag-cell.lion-cell-error{ background: rgba(239, 68, 68, 0.12); box-shadow: inset 0 0 0 1px rgba(239,68,68,.35); transition: background .2s ease, box-shadow .2s ease; }
.ag-cell.lion-cell-error .lion-editable-val{ color: #ef4444; font-weight: 600; }
.ag-cell.lion-cell-error.ag-cell-focus, .ag-cell.lion-cell-error:hover{ background: rgba(239, 68, 68, 0.18); box-shadow: inset 0 0 0 1px rgba(239,68,68,.5); }

/* ===== Centralização real para células que podem quebrar linha ===== */
/* 1) Remove o viés de -1px do tema nas colunas marcadas como 'lion-center-cell' */
.ag-theme-quartz :where(.ag-ltr) .ag-center-cols-container
  .ag-cell.lion-center-cell:not(.ag-cell-inline-editing):not([col-id="ag-Grid-AutoColumn"]):not([col-id="campaign"]) {
  padding-left: var(--ag-cell-horizontal-padding) !important;
  padding-right: var(--ag-cell-horizontal-padding) !important;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;      /* texto multi-linha centraliza */
}

/* 2) Faz os wrappers ocuparem a largura toda */
.ag-theme-quartz .ag-center-cols-container
  .ag-cell.lion-center-cell:not(.ag-cell-inline-editing) .ag-cell-wrapper {
  width: 100%;
}

/* 3) Garante que o conteúdo (quebrando linha) centralize */
.ag-theme-quartz .ag-center-cols-container
  .ag-cell.lion-center-cell:not(.ag-cell-inline-editing) .ag-cell-value {
  display: block;          /* evita inline-size encolhendo */
  width: 100%;             /* ocupa a célula toda */
  text-align: center;      /* linhas quebradas centralizadas */
  white-space: normal;     /* habilita wrap */
  word-break: break-word;
  overflow-wrap: anywhere;
}
`;
		const el = document.createElement('style');
		el.id = 'lion-loading-styles';
		el.textContent = css;
		document.head.appendChild(el);
	}

	// Agora você chama manualmente quando quiser:
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
	frontApplySort(rows, sortModel) {
		if (!Array.isArray(sortModel) || !sortModel.length) return rows;
		const orderStatus = ['ACTIVE', 'PAUSED', 'DISABLED', 'CLOSED'];
		return rows.slice().sort((a, b) => {
			for (const s of sortModel) {
				const { colId, sort } = s;
				const dir = sort === 'desc' ? -1 : 1;
				let av = a[colId],
					bv = b[colId];

				// status custom
				if (colId === 'account_status' || colId === 'campaign_status' || colId === 'status') {
					const ai = orderStatus.indexOf(String(av ?? '').toUpperCase());
					const bi = orderStatus.indexOf(String(bv ?? '').toUpperCase());
					const aIdx = ai === -1 ? Number.POSITIVE_INFINITY : ai;
					const bIdx = bi === -1 ? Number.POSITIVE_INFINITY : bi;
					const cmp = (aIdx - bIdx) * dir;
					if (cmp !== 0) return cmp;
					continue;
				}

				// revenue: pega primeiro número da string
				if (colId === 'revenue') {
					const an = frontToNumberFirst(av);
					const bn = frontToNumberFirst(bv);
					if (an == null && bn == null) continue;
					if (an == null) return -1 * dir;
					if (bn == null) return 1 * dir;
					if (an !== bn) return (an < bn ? -1 : 1) * dir;
					continue;
				}

				// padrão: numérico se possível, senão texto
				const an = frontToNumberBR(av);
				const bn = frontToNumberBR(bv);
				const bothNum = an != null && bn != null;
				let cmp;
				if (bothNum) cmp = an === bn ? 0 : an < bn ? -1 : 1;
				else {
					const as = String(av ?? '').toLowerCase();
					const bs = String(bv ?? '').toLowerCase();
					cmp = as.localeCompare(bs, 'pt-BR');
				}
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

		const checks = Object.entries(filterModel)
			.filter(([field]) => field !== '_global')
			.map(([field, f]) => {
				const ft = f.filterType || f.type || 'text';
				const isCampaignCol =
					field === 'campaign' ||
					field === 'ag-Grid-AutoColumn' ||
					field.startsWith('ag-Grid-AutoColumn');

				// CAMPANHA (nome + UTM)
				if (isCampaignCol) {
					const comp = String(f.type || 'contains');
					const needle = String(f.filter ?? '').toLowerCase();
					if (!needle) return () => true;
					return (r) => {
						const name = String(r.__label || r.campaign_name || '').toLowerCase();
						const utm = String(r.utm_campaign || '').toLowerCase();
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

				// includes / excludes (lista)
				if (ft === 'includes' && Array.isArray(f.values)) {
					const set = new Set(f.values.map((v) => String(v).toLowerCase()));
					return (r) => set.has(String(r[field] ?? '').toLowerCase());
				}
				if (ft === 'excludes' && Array.isArray(f.values)) {
					const set = new Set(f.values.map((v) => String(v).toLowerCase()));
					return (r) => !set.has(String(r[field] ?? '').toLowerCase());
				}

				// texto (genérico)
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

				// number
				if (ft === 'number') {
					const comp = String(f.type || 'equals');
					const val = Number(f.filter);
					return (r) => {
						const n = frontToNumberBR(r[field]);
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
							case 'contains':
								return String(n).includes(String(val));
							case 'notContains':
								return !String(n).includes(String(val));
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
		// Garante que existam as funções auxiliares, usando fallback
		const sum = this.sumNum || sumNum;
		const num = this.numBR || numBR;
		const div = this.safeDiv || safeDiv;

		// Cálculos principais
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

		const cpc_total = div(spent_sum, clicks_sum);
		const cpa_fb_total = div(spent_sum, conversions_sum);
		const real_cpa_total = div(spent_sum, real_conversions_sum);
		const ctr_total = div(clicks_sum, impressions_sum);
		const epc_total = div(revenue_sum, clicks_sum);
		const mx_total = div(revenue_sum, spent_sum);

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
			cpc_total,
			cpa_fb_total,
			real_cpa_total,
			ctr_total,
			epc_total,
			mx_total,
		};
	}

	/**
	 * Reseta o layout da grid para o padrão
	 */
	resetLayout() {
		if (!this.api) {
			console.warn('[LionGrid] API não inicializada');
			return;
		}

		try {
			sessionStorage.removeItem(this.gridStateKey);
			this.api.setState({}, []);

			setTimeout(() => {
				this.api.sizeColumnsToFit();
				this.api.resetRowHeights();
			}, 50);

			showToast('Layout Reset', 'info');
		} catch (error) {
			console.error('[LionGrid] Erro ao resetar layout:', error);
		}
	}

	/**
	 * Retorna a API do AG-Grid
	 */
	getApi() {
		return this.api;
	}

	/**
	 * Salva o estado atual da grid
	 */
	saveState() {
		if (!this.api) return;

		try {
			const state = this.api.getState();
			sessionStorage.setItem(this.gridStateKey, JSON.stringify(state));
		} catch (error) {
			console.error('[LionGrid] Erro ao salvar estado:', error);
		}
	}

	/**
	 * Restaura o estado salvo da grid
	 */
	restoreState() {
		if (!this.api) return;

		try {
			const savedState = sessionStorage.getItem(this.gridStateKey);
			if (savedState) {
				this.api.setState(JSON.parse(savedState), []);
			}
		} catch (error) {
			console.error('[LionGrid] Erro ao restaurar estado:', error);
		}
	}
	ensureKtModalDom() {
		if (document.getElementById('lionKtModal')) return;
		const tpl = document.createElement('div');
		tpl.innerHTML = `
<div class="kt-modal hidden" data-kt-modal="true" id="lionKtModal" aria-hidden="true">
  <div class="kt-modal-content max-w-[420px] top-[10%]">
    <div class="kt-modal-header">
      <h3 class="kt-modal-title">Details</h3>
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
			?.addEventListener('click', () => this.closeKTModal('#lionKtModal'));
		document.getElementById('lionKtModal')?.addEventListener('click', (e) => {
			if (e.target.id === 'lionKtModal') this.closeKTModal('#lionKtModal');
		});
	}

	showKTModal({ title = 'Details', content = '' } = {}) {
		this.ensureKtModalDom(); // ✅ Adicionado this.
		const modal = document.querySelector('#lionKtModal');
		if (!modal) return;

		modal.querySelector('.kt-modal-title').textContent = title;
		modal.querySelector('.kt-modal-body > pre').textContent = content;

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

	createAgTheme() {
		const AG = getAgGrid();
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

	// Este método agora inclui: listeners dos selects, renderList, readForm, clearForm, save/load, etc.
	CalcColsPopulate() {
		const $ = (sel) => document.querySelector(sel);
		const $col1 = document.getElementById('cc-col1');
		const $col2 = document.getElementById('cc-col2');
		let lastSelection = { col1: null, col2: null };

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
					defs = displayed.map((gc) => gc.getColDef?.() || gc.colDef || null).filter(Boolean);
			} catch {}
			if (!defs.length) {
				const columnState = api.getColumnState?.() || [];
				const viaState = columnState
					.map((s) => api.getColumn?.(s.colId)?.getColDef?.())
					.filter(Boolean);
				if (viaState.length) defs = viaState;
				else {
					const flattenColDefs = (defOrArray) => {
						const out = [];
						const walk = (arr) => {
							(arr || []).forEach((def) => {
								if (def?.children?.length) walk(def.children);
								else out.push(def);
							});
						};
						if (Array.isArray(defOrArray)) walk(defOrArray);
						else if (defOrArray) walk([defOrArray]);
						return out;
					};
					defs = (api.getColumnDefs?.() || []).flatMap(flattenColDefs);
				}
			}
			const _isCalculableByDef = (def) => {
				if (!def) return false;
				if (def.calcEligible === true) return true;
				if (def.calcType === 'numeric') return true;
				if (def.valueType === 'number') return true;
				if (def.cellDataType === 'number') return true;
				if (def.type === 'numericColumn') return true;
				if (def.filter === 'agNumberColumnFilter') return true;
				if (typeof def.valueParser === 'function') return true;
				return false;
			};
			const deny = new Set(['ag-Grid-AutoColumn', 'ag-Grid-RowGroup', '__autoGroup']);
			defs = defs.filter((def) => {
				if (!def) return false;
				const field = def.field || def.colId;
				const header = def.headerName || field;
				if (!field || !header) return false;
				if (deny.has(field)) return false;
				if (String(field).startsWith('__')) return false;
				if (def.checkboxSelection) return false;
				if (def.rowGroup || def.pivot) return false;
				const h = String(header).toLowerCase();
				if (h.includes('select') || h.includes('ação') || h.includes('action')) return false;
				return true;
			});
			defs = defs.filter(_isCalculableByDef);
			const mapped = defs.map((def) => ({
				field: String(def.field || def.colId),
				headerName: String(def.headerName || def.field || def.colId),
			}));
			const seen = new Set();
			const unique = [];
			for (const it of mapped) {
				if (seen.has(it.field)) continue;
				seen.add(it.field);
				unique.push(it);
			}
			return unique;
		};

		const _fillSelect = (selectEl, items, keepValue) => {
			if (!selectEl) return;
			const current = selectEl.value || null;
			const desired = keepValue ?? current ?? '';
			while (selectEl.options.length) selectEl.remove(0);
			const placeholderText =
				selectEl.getAttribute('data-kt-select-placeholder') ||
				selectEl.getAttribute('title') ||
				'Select';
			const hasDesired = desired && items.some((it) => it.field === desired);
			const ph = new Option(placeholderText, '');
			if (!hasDesired) {
				ph.disabled = true;
				ph.selected = true;
			}
			selectEl.add(ph);
			for (const it of items) {
				const label = `${String(it.headerName)} (${String(it.field)})`;
				const opt = new Option(label, String(it.field));
				selectEl.add(opt);
			}
			if (hasDesired) selectEl.value = desired;
			try {
				if (globalThis.KT && KT.Select && KT.Select.getOrCreateInstance) {
					const instance = KT.Select.getOrCreateInstance(selectEl);
					if (instance) {
						instance.destroy();
						KT.Select.getInstance(selectEl)?.init();
					}
				}
			} catch {}
		};

		const populateColumnSelects = () => {
			if (!$col1 || !$col2) return;
			const items = _getSelectableColumns();
			if (!items.length) return;
			if (!$col1.value) lastSelection.col1 = lastSelection.col1 || null;
			else lastSelection.col1 = $col1.value;
			if (!$col2.value) lastSelection.col2 = lastSelection.col2 || null;
			else lastSelection.col2 = $col2.value;
			_fillSelect($col1, items, lastSelection.col1);
			_fillSelect($col2, items, lastSelection.col2);
		};

		const updateExpressionFromSelects = () => {
			const formatSel = $('#cc-format');
			const col1Sel = $('#cc-col1');
			const col2Sel = $('#cc-col2');
			const exprInput = $('#cc-expression');
			const partsInput = $('#cc-parts');
			if (!formatSel || !col1Sel || !col2Sel || !exprInput) return;
			const selectedOp = formatSel.options[formatSel.selectedIndex];
			const template = selectedOp?.dataset?.template;
			if (!template || formatSel.value === 'custom') return;
			const col1 = col1Sel.value;
			const col2 = col2Sel.value;
			if (col1 && col2) {
				const expression = template.replace(/{col1}/g, col1).replace(/{col2}/g, col2);
				exprInput.value = expression;
				if (partsInput) {
					const col1Label = col1Sel.options[col1Sel.selectedIndex]?.textContent || col1;
					const col2Label = col2Sel.options[col2Sel.selectedIndex]?.textContent || col2;
					const parts = [
						{ label: col1Label.replace(/number/gi, '').trim(), expr: col1 },
						{ label: col2Label.replace(/number/gi, '').trim(), expr: col2 },
					];
					partsInput.value = JSON.stringify(parts, null, 2);
				}
			}
		};

		const modalShow = (selector) => {
			const el = document.querySelector(selector);
			if (!el) return;
			if (globalThis.KT && KT.Modal && KT.Modal.getOrCreateInstance)
				KT.Modal.getOrCreateInstance(el).show();
			else {
				el.classList.remove('hidden');
				el.style.display = 'block';
				el.setAttribute('aria-hidden', 'false');
				el.classList.add('kt-modal--open');
			}
		};

		const modalHide = (selector) => {
			const el = document.querySelector(selector);
			if (!el) return;
			if (globalThis.KT && KT.Modal && KT.Modal.getOrCreateInstance)
				KT.Modal.getOrCreateInstance(el).hide();
			else {
				el.style.display = 'none';
				el.classList.add('hidden');
				el.classList.remove('kt-modal--open');
				el.setAttribute('aria-hidden', 'true');
			}
		};

		const renderList = () => {
			const list = $('#cc-list');
			if (!list) return;
			const items = this.calc.list();
			list.innerHTML = '';
			const empty = $('#cc-empty');
			if (!items.length) {
				empty?.classList.remove('hidden');
				return;
			}
			empty?.classList.add('hidden');
			for (const c of items) {
				const li = document.createElement('li');
				li.className = 'flex items-center justify-between p-3';
				const left = document.createElement('div');
				left.className = 'min-w-0';
				left.innerHTML = `
					<div class="font-medium">${c.headerName || c.id}</div>
					<div class="text-xs opacity-70 break-words">id: <code>${c.id}</code></div>
					<div class="text-xs opacity-70 break-words">expr: <code>${c.expression}</code></div>
				`;
				const right = document.createElement('div');
				right.className = 'flex items-center gap-2';
				const btnApply = document.createElement('button');
				btnApply.className = 'kt-btn kt-btn-xs';
				btnApply.textContent = 'Activate';
				btnApply.addEventListener('click', () => {
					try {
						this.calc.add(c);
					} catch (e) {
						console.warn(e);
					}
				});
				const btnEdit = document.createElement('button');
				btnEdit.className = 'kt-btn kt-btn-light kt-btn-xs';
				btnEdit.textContent = 'Edit';
				btnEdit.addEventListener('click', () => {
					$('#cc-header').value = c.headerName || '';
					$('#cc-id').value = c.id || '';
					$('#cc-type').value = c.format || 'currency';
					$('#cc-expression').value = c.expression || '';
					$('#cc-parts').value = (c.parts && JSON.stringify(c.parts)) || '';
					$('#cc-only-level0').checked = !!c.onlyLevel0;
					$('#cc-after').value = c.after || 'Revenue';
					const miniEl = $('#cc-mini');
					if (miniEl) miniEl.checked = !!c.mini;
				});
				const btnRemove = document.createElement('button');
				btnRemove.className = 'kt-btn kt-btn-danger kt-btn-xs';
				btnRemove.textContent = 'Remove';
				btnRemove.addEventListener('click', () => {
					if (!confirm(`Remove column "${c.id}"?`)) return;
					try {
						this.calc.remove(c.id);
						renderList();
					} catch (e) {
						console.warn(e);
					}
				});
				right.append(btnApply, btnEdit, btnRemove);
				li.append(left, right);
				list.appendChild(li);
			}
		};

		const readForm = () => {
			const headerName = ($('#cc-header')?.value || '').trim();
			let id = ($('#cc-id')?.value || '').trim();
			const format = ($('#cc-type')?.value || 'currency').trim().toLowerCase();
			const expression = ($('#cc-expression')?.value || '').trim();
			const onlyLevel0 = !!$('#cc-only-level0')?.checked;
			const after = ($('#cc-after')?.value || 'Revenue').trim() || 'Revenue';
			const mini = !!$('#cc-mini')?.checked;
			if (!id && headerName)
				id = headerName.toLowerCase().replace(/\s+/g, '_').replace(/[^\w]/g, '');
			let parts = [];
			const raw = ($('#cc-parts')?.value || '').trim();
			if (raw) {
				try {
					parts = JSON.parse(raw);
				} catch {
					showToast('Invalid Parts JSON', 'danger');
					parts = null;
				}
			}
			return { id, headerName, format, expression, parts, onlyLevel0, after, mini };
		};

		const clearForm = () => {
			$('#cc-header').value = '';
			$('#cc-id').value = '';
			const formatSel = $('#cc-format');
			if (formatSel && formatSel.options.length > 0) formatSel.selectedIndex = 0;
			const col1Sel = $('#cc-col1');
			const col2Sel = $('#cc-col2');
			if (col1Sel && col1Sel.options.length > 0) col1Sel.selectedIndex = 0;
			if (col2Sel && col2Sel.options.length > 0) col2Sel.selectedIndex = 0;
			$('#cc-expression').value = '';
			$('#cc-parts').value = '[]';
			$('#cc-only-level0').checked = true;
			$('#cc-after').value = 'Revenue';
			$('#cc-type').value = 'currency';
			const miniEl = $('#cc-mini');
			if (miniEl) miniEl.checked = false;
			updateExpressionFromSelects();
		};

		const populateExpressionSelect = () => {
			const formatSel = $('#cc-format');
			if (!formatSel) return;
			formatSel.innerHTML = '';
			for (const op of DEFAULT_OPERATORS) {
				const optGroup = document.createElement('option');
				optGroup.value = op.value;
				optGroup.textContent = op.label;
				optGroup.dataset.template = op.template;
				formatSel.appendChild(optGroup);
			}
		};

		const list = $('#cc-list');
		const empty = $('#cc-empty');
		const saveBtn = $('#cc-save');
		const reloadBtn = $('#cc-reload');
		const resetBtn = $('#cc-reset-form');
		const activateAllBtn = $('#cc-activate-all');
		const btnCalcCols = document.getElementById('btnCalcCols');

		if (btnCalcCols) {
			btnCalcCols.addEventListener('click', (e) => {
				const sel = btnCalcCols.getAttribute('data-kt-modal-toggle') || '#calcColsModal';
				setTimeout(() => {
					modalShow(sel);
					clearForm();
					populateExpressionSelect();
					populateColumnSelects();
					renderList();
				}, 0);
			});
		}

		const formatSel = $('#cc-format');
		const col1Sel = $('#cc-col1');
		const col2Sel = $('#cc-col2');
		if (formatSel) formatSel.addEventListener('change', updateExpressionFromSelects);
		if (col1Sel) col1Sel.addEventListener('change', updateExpressionFromSelects);
		if (col2Sel) col2Sel.addEventListener('change', updateExpressionFromSelects);

		const modalEl = document.getElementById('calcColsModal');
		if (modalEl)
			modalEl.addEventListener('show.kt.modal', () => {
				clearForm();
				populateExpressionSelect();
				populateColumnSelects();
				renderList();
			});

		if (typeof document !== 'undefined') {
			if (document.readyState === 'loading') {
				document.addEventListener('DOMContentLoaded', () => {
					setTimeout(() => {
						populateExpressionSelect();
						populateColumnSelects();
					}, 100);
				});
			} else {
				setTimeout(() => {
					populateExpressionSelect();
					populateColumnSelects();
				}, 100);
			}
		}

		saveBtn?.addEventListener('click', (e) => {
			e.preventDefault();
			const cfg = readForm();
			if (!cfg) return;
			if (!cfg.id || !cfg.expression) {
				showToast('ID and Expression are required', 'danger');
				return;
			}
			try {
				const ok = this.calc.add(cfg);
				if (ok) {
					clearForm();
					renderList();
					modalHide('#calcColsModal');
				}
			} catch (e) {
				console.warn(e);
			}
		});

		resetBtn?.addEventListener('click', (e) => {
			e.preventDefault();
			clearForm();
		});

		activateAllBtn?.addEventListener('click', (e) => {
			e.preventDefault();
			try {
				this.calc.activateAll();
				renderList();
				showToast('All columns activated', 'success');
			} catch (e) {
				console.warn(e);
			}
		});

		reloadBtn?.addEventListener('click', (e) => {
			e.preventDefault();
			populateColumnSelects();
			renderList();
		});
	}

	getCellTextForField(p, field) {
		const d = p?.data || {};
		if (field === 'campaign') {
			if ((p?.node?.level ?? 0) !== 0) return String(d.__label || '');
			const label = String(d.__label || '');
			const utm = String(d.utm_campaign || '');
			return utm ? `${label}\n${utm}` : label;
		}
		if (field === 'bc_name') {
			return String(d.bc_name || '');
		}
		return String(d[field] ?? '');
	}

	makeGrid() {
		const AG = getAgGrid();
		this.gridDiv = document.querySelector(this.container);
		if (!this.gridDiv) {
			console.error('[LionGrid] #lionGrid not found');
			return null;
		}
		this.gridDiv.classList.add('ag-theme-quartz');

		const autoGroupColumnDef = {
			headerName: 'Campaign',
			colId: 'campaign',
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
						wrap.style.display = 'inline-flex';
						wrap.style.flexDirection = 'column';
						wrap.style.lineHeight = '1.25';
						const l1 = document.createElement('span');
						l1.textContent = label;
						l1.style.fontWeight = '600';
						wrap.appendChild(l1);
						if (utm) {
							const l2 = document.createElement('span');
							l2.textContent = utm;
							l2.style.fontSize = '9px';
							l2.style.opacity = '0.75';
							l2.style.letterSpacing = '0.2px';
							wrap.appendChild(l2);
						}
						return wrap;
					}
					return label;
				},
			},
			valueGetter: (p) => {
				const d = p.data || {};
				const name = d.__label || '';
				const utm = d.utm_campaign || '';
				return (name + ' ' + utm).trim();
			},
		};
		// ===== [1] Medidor offscreen (singleton) =====
		const _rowHeightMeasure = (() => {
			let box = null;
			return {
				ensure() {
					if (box) return box;
					box = document.createElement('div');
					box.id = 'lion-rowheight-measurer';
					Object.assign(box.style, {
						position: 'absolute',
						left: '-99999px',
						top: '-99999px',
						visibility: 'hidden',
						whiteSpace: 'normal',
						wordBreak: 'break-word',
						overflowWrap: 'anywhere',
						lineHeight: '1.25',
						fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
						fontSize: '14px',
						padding: '0',
						margin: '0',
						border: '0',
					});
					document.body.appendChild(box);
					return box;
				},
				measure(text, widthPx) {
					const el = this.ensure();
					el.style.width = Math.max(0, widthPx) + 'px';
					el.textContent = text || '';
					return el.scrollHeight || 0;
				},
			};
		})();

		// ===== [2] Largura útil da coluna autoGroup =====
		function getAutoGroupContentWidth(api) {
			try {
				const col =
					api.getColumn('campaign') ||
					api.getDisplayedCenterColumns().find((c) => c.getColId?.() === 'campaign');
				if (!col) return 300;
				api.getDisplayedColAfter?.(col);
				const colW = col.getActualWidth();
				const padding = 16;
				const iconArea = 28;
				return Math.max(40, colW - padding - iconArea);
			} catch {
				return 300;
			}
		}

		// ===== [2.1] Largura útil de QUALQUER coluna folha =====
		function getFieldContentWidth(api, field) {
			try {
				const col = api.getColumn(field);
				if (!col) return null;
				const w = col.getActualWidth?.();
				if (!w || !Number.isFinite(w)) return null;
				const horizontalPadding = 12;
				return Math.max(0, w - horizontalPadding);
			} catch {
				return null;
			}
		}

		// ===== [3] Texto que realmente aparece na célula por campo =====

		// ===== [4] Cache simples por rowId + largura =====
		const _rowHCache = new Map();

		// ===== [5] getRowHeight dinâmico por nº de linhas =====
		const BASE_ROW_MIN = 50;
		const VERT_PAD = 12;

		const gridOptions = {
			floatingFiltersHeight: 35,
			groupHeaderHeight: 35,
			headerHeight: 62,
			context: { showToast: (msg, type) => Toastify({ text: msg }).showToast() },
			rowModelType: 'serverSide',
			cacheBlockSize: 200,
			treeData: true,

			isServerSideGroup: (data) => data?.__nodeType === 'campaign' || data?.__nodeType === 'adset',
			getServerSideGroupKey: (data) => data?.__groupKey ?? '',
			getRowId: function (params) {
				if (params.data && params.data.__nodeType === 'campaign') {
					return `c:${params.data.__groupKey}`;
				}
				if (params.data && params.data.__nodeType === 'adset') {
					return `s:${params.data.__groupKey}`;
				}
				if (params.data && params.data.__nodeType === 'ad') {
					return `a:${params.data.id || params.data.story_id || params.data.__label}`;
				}
				return params.data && params.data.id != null
					? String(params.data.id)
					: `${Math.random()}`;
			},

			columnDefs: [].concat(this.columnDefs),
			autoGroupColumnDef,
			defaultColDef: this.defaultColDef,

			rowSelection: {
				mode: 'multiRow',
				checkboxes: { enabled: true, header: true },
				selectionColumn: {
					id: 'ag-Grid-SelectionColumn',
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
				const bmW = getFieldContentWidth(p.api, 'bc_name');
				if (bmW != null) widthBag.bc_name = bmW;

				const key =
					(p?.node?.id ||
						(p?.node?.data?.__nodeType === 'campaign'
							? `c:${p?.node?.data?.__groupKey}`
							: p?.node?.data?.__nodeType === 'adset'
							? `s:${p?.node?.data?.__groupKey}`
							: p?.node?.data?.id || Math.random())) +
					'|' +
					Object.entries(widthBag)
						.map(([k, v]) => `${k}:${Math.round(v || 0)}`)
						.join('|');

				if (_rowHCache.has(key)) return _rowHCache.get(key);

				let maxTextH = 0;
				for (const field of this.WRAP_FIELDS) {
					const w = widthBag[field];
					if (!w) continue;
					const text = this.getCellTextForField(p, field);
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
			sideBar: {
				toolPanels: ['columns', 'filters'],
				defaultToolPanel: null,
				position: 'right',
			},
			theme: this.createAgTheme(),

			getContextMenuItems: (params) => {
				const d = params.node?.data || {};
				const colId = params.column?.getColDef?.().colId ?? params.column?.colId;
				const isCampaignColumn = colId === 'ag-Grid-AutoColumn';

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

					try {
						const colDef = p.column?.getColDef?.() || p.colDef || {};
						const getParts = colDef?.cellRendererParams?.getParts;
						const row = p.node?.data || {};
						const top = p.valueFormatted ?? p.value ?? '';
						const lines = [];
						const push = (s) => {
							const v = s == null ? '' : String(s).trim();
							if (v && v !== '—') lines.push(v);
						};
						push(top);

						if (typeof getParts === 'function') {
							const parts =
								getParts({
									data: row,
									colDef,
									node: p.node,
									api: p.api,
									column: p.column,
									value: p.value,
									valueFormatted: p.valueFormatted,
								}) || [];

							for (const it of parts) {
								const txt =
									it?.text ||
									it?.labelWithValue ||
									(String(it?.label || it?.name || '').trim()
										? `${String(it?.label || it?.name || '').trim()}: ${
												Number.isFinite(it?.value)
													? cc_currencyFormat(Number(it.value))
													: String(it?.value ?? '—')
										  }`
										: `${
												Number.isFinite(it?.value)
													? cc_currencyFormat(Number(it.value))
													: String(it?.value ?? '—')
										  }`);
								push(txt);
							}
						}
						return lines.join('\n') || String(top || '');
					} catch {
						return String(p.valueFormatted ?? p.value ?? '');
					}
				}

				const items = [
					'cut',
					'copy',
					'copyWithHeaders',
					'copyWithGroupHeaders',
					'export',
					'separator',
				];

				if (isCampaignColumn) {
					const label = d.__label || d.campaign_name || '';
					const utm = d.utm_campaign || '';
					if (label) {
						items.push({
							name: 'Copy Campaign',
							action: () => copyToClipboard(label),
							icon: '<span class="ag-icon ag-icon-copy"></span>',
						});
					}
					if (utm) {
						items.push({
							name: 'Copy UTM',
							action: () => copyToClipboard(utm),
							icon: '<span class="ag-icon ag-icon-copy"></span>',
						});
					}
				}

				(function maybeAddCopyWithParts() {
					const colDef = params.column?.getColDef?.() || params.colDef || {};
					const hasRenderer =
						colDef?.cellRenderer === StackBelowRenderer ||
						typeof colDef?.cellRendererParams?.getParts === 'function';

					if (!hasRenderer) return;

					items.push('separator');
					items.push({
						name: 'Copy with parts',
						action: () => {
							const txt = buildCopyWithPartsText(params);
							copyToClipboard(txt);
							try {
								showToast('Copied (with parts)', 'success');
							} catch {}
						},
						icon: '<span class="ag-icon ag-icon-copy"></span>',
					});
				})();

				return items;
			},

			onCellClicked: (params) => {
				const node = params.node;
				const eventTarget = params.event?.target;

				if (node?.data?.__rowLoading) {
					return;
				}

				if (node.group) {
					const clickedExpanderOrCheckbox = !!eventTarget?.closest?.(
						'.ag-group-expanded, .ag-group-contracted, .ag-group-checkbox'
					);
					if (!clickedExpanderOrCheckbox) {
						node.setExpanded(!node.expanded);
						return;
					}
				}

				if (node.level > 0) return;

				const isAutoGroupCol =
					(typeof params.column?.isAutoRowGroupColumn === 'function' &&
						params.column.isAutoRowGroupColumn()) ||
					params.colDef?.colId === 'ag-Grid-AutoColumn' ||
					!!params.colDef?.showRowGroup ||
					params?.column?.getColId?.() === 'campaign';
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
					'xabu_ads',
					'xabu_adsets',
				]);
				const field = params.colDef?.field;
				if (!field || !MODAL_FIELDS.has(field)) return;

				let display;
				const vfmt = params.valueFormatted;
				if (vfmt != null && vfmt !== '') {
					display = String(vfmt);
				} else {
					const val = params.value;
					if (typeof val === 'string') {
						display = stripHtml(val);
					} else if (val == null) {
						display = '';
					} else if (
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
						const currency = getAppCurrency();
						const locale = currency === 'USD' ? 'en-US' : 'pt-BR';
						display =
							n == null
								? ''
								: new Intl.NumberFormat(locale, {
										style: 'currency',
										currency,
								  }).format(n);
					} else if (
						[
							'impressions',
							'clicks',
							'visitors',
							'conversions',
							'real_conversions',
						].includes(field)
					) {
						const n = Number(val);
						display = Number.isFinite(n) ? intFmt.format(n) : String(val);
					} else if (field === 'account_status' || field === 'campaign_status') {
						display = strongText(String(val || ''));
					} else {
						display = String(val);
					}
				}

				const title = params.colDef?.headerName || 'Details';
				this.showKTModal({ title: 'Details', content: display || '(empty)' });
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

							// Nível 0 — CAMPANHAS
							if (groupKeys.length === 0) {
								if (!this.ROOT_CACHE) {
									let res = await fetch(this.endpoints.SSRM, {
										method: 'POST',
										headers: { 'Content-Type': 'application/json' },
										credentials: 'same-origin',
										body: JSON.stringify({ mode: 'full' }),
									});
									if (!res.ok) {
										res = await fetch(this.endpoints.SSRM, {
											credentials: 'same-origin',
										});
									}
									const data = await res.json().catch(() => ({ rows: [] }));
									const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
									this.ROOT_CACHE = { rowsRaw };
								}

								const all = this.ROOT_CACHE.rowsRaw;
								const filtered = this.frontApplyFilters(all, filterModelWithGlobal);
								const ordered = this.frontApplySort(filtered, sortModel || []);
								const rowsNorm = ordered.map(this.normalizeCampaignRow);

								const totalCount = rowsNorm.length;
								const slice = rowsNorm.slice(startRow, Math.min(endRow, totalCount));

								const totals = this.computeClientTotals(ordered);
								const currency = getAppCurrency();
								const locale = currency === 'USD' ? 'en-US' : 'pt-BR';
								const nfCur = new Intl.NumberFormat(locale, {
									style: 'currency',
									currency,
								});

								const pinnedTotal = {
									id: '__pinned_total__',
									bc_name: 'TOTAL',
									impressions: totals.impressions_sum ?? 0,
									clicks: totals.clicks_sum ?? 0,
									visitors: totals.visitors_sum ?? 0,
									conversions: totals.conversions_sum ?? 0,
									real_conversions: totals.real_conversions_sum ?? 0,
									spent: totals.spent_sum ?? 0,
									fb_revenue: totals.fb_revenue_sum ?? 0,
									push_revenue: totals.push_revenue_sum ?? 0,
									revenue: totals.revenue_sum ?? 0,
									profit: totals.profit_sum ?? 0,
									budget: totals.budget_sum ?? 0,
									cpc: totals.cpc_total ?? 0,
									cpa_fb: totals.cpa_fb_total ?? 0,
									real_cpa: totals.real_cpa_total ?? 0,
									mx: totals.mx_total ?? 0,
									ctr: totals.ctr_total ?? 0,
									__label: `CAMPAIGNS: ${intFmt.format(totalCount)}`,
								};

								for (const k of [
									'spent',
									'fb_revenue',
									'push_revenue',
									'revenue',
									'profit',
									'budget',
									'cpc',
									'cpa_fb',
									'real_cpa',
									'mx',
								]) {
									pinnedTotal[k] = nfCur.format(Number(pinnedTotal[k]) || 0);
								}
								for (const k of [
									'impressions',
									'clicks',
									'visitors',
									'conversions',
									'real_conversions',
								]) {
									pinnedTotal[k] = intFmt.format(Number(pinnedTotal[k]) || 0);
								}
								if (typeof pinnedTotal.ctr === 'number') {
									pinnedTotal.ctr = (pinnedTotal.ctr * 100).toFixed(2) + '%';
								}

								const targetApi = req.api ?? params.api;
								try {
									targetApi.setPinnedBottomRowData?.([pinnedTotal]) ||
										targetApi.setGridOption?.('pinnedBottomRowData', [pinnedTotal]);
								} catch (e) {
									console.warn('Error applying pinned bottom row:', e);
								}

								req.success({ rowData: slice, rowCount: totalCount });
								return;
							}

							// Nível 1 — ADSETS
							if (groupKeys.length === 1) {
								const campaignId = groupKeys[0];
								const parentId = `c:${campaignId}`;
								const apiTarget = req.api ?? params.api;
								const parentNode = apiTarget.getRowNode(parentId);

								if (parentNode?.data?.__rowLoading) {
									if (parentNode.expanded) {
										req.success({ rowData: [], rowCount: 0 });
										return;
									}
								}

								setParentRowLoading(apiTarget, parentId, true);

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

								if (parentNode && typeof parentNode.setExpanded === 'function') {
									parentNode.setExpanded(true, true);
								}

								req.success({ rowData: rows, rowCount: data.lastRow ?? rows.length });

								setParentRowLoading(apiTarget, parentId, false);
								return;
							}

							// Nível 2 — ADS
							if (groupKeys.length === 2) {
								const adsetId = groupKeys[1];
								const parentId = `s:${adsetId}`;
								const apiTarget = req.api ?? params.api;
								const parentNode = apiTarget.getRowNode(parentId);

								if (parentNode?.data?.__rowLoading) {
									if (parentNode.expanded) {
										req.success({ rowData: [], rowCount: 0 });
										return;
									}
								}

								setParentRowLoading(apiTarget, parentId, true);

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

								if (parentNode && typeof parentNode.setExpanded === 'function') {
									parentNode.setExpanded(true, true);
								}

								req.success({ rowData: rows, rowCount: data.lastRow ?? rows.length });

								setParentRowLoading(apiTarget, parentId, false);
								return;
							}

							req.success({ rowData: [], rowCount: 0 });
						} catch (e) {
							console.error('[TREE SSRM] getRows failed:', e);
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
					globalThis.dispatchEvent(new CustomEvent('lionGridReady'));

					// ✅ Ativar composite SOMENTE quando API está pronta
					try {
						this.composite.activate();
						console.log('[GridReady] Composite columns activated');
					} catch (e) {
						console.warn('[GridReady] Erro ao ativar composite:', e);
					}
				}, 100);
			},
		};

		const apiOrInstance =
			typeof AG.createGrid === 'function'
				? AG.createGrid(this.gridDiv, gridOptions)
				: new AG.Grid(this.gridDiv, gridOptions);

		this._bindPinnedToggle();

		return { api: this.api, gridDiv: this.gridDiv };
	}

	/**
	 * Destrói a grid e limpa recursos
	 */
	destroy() {
		if (this.api) {
			this.saveState();
			this.api.destroy();
			this.api = null;
		}
	}
}
