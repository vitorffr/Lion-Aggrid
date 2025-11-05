/* public/js/lion/core.js
 *
 * Lion Grid — CORE (Master Module)
 * --------------------------------
 * Mantém TODA a lógica compartilhada do monolito original:
 * - Estado global (moeda, quick filter), helpers (número/moeda/html)
 * - CSS de loading + CSS do menu de status (compat base)
 * - Tema Quartz + Material Icons + licença
 * - Badges/helpers visuais
 * - Renderers: status pill, chip fraction, profile, revenue (stack minimal), EditableMoney
 * - StatusSliderRenderer (com menu e drag) — idêntico ao base
 * - Floating Filters: BidType, CampaignStatus, AccountStatus
 * - CurrencyMaskEditor
 * - Backend API (update*, fetchJSON, toggleFeature)
 * - SSRM helpers, quick filter global, grid state (load/apply)
 * - Toggle de pin, Toolbar hooks (presets, upload/download) — sem UI visual aqui
 * - CompositeColumns (registry preservando funções)
 * - LionCalcColumns (calculated columns framework) + helpers
 * - KTUI Modal helpers (ensure/open/close/show) — compat base
 * - CalcCols UI populate (IIFE) — repopula <select> Col1/Col2 no modal (se existir no DOM)
 *
 * NÃO opina em data source e NÃO define columnDefs específicos.
 * Cada página/boot declara seus columnDefs e gridOptions e chama LionGrid.makeGrid(...).
 */

(function () {
	'use strict';

	/* =========================================
	 * Guard e AG Grid access + License
	 * =======================================*/
	function getAgGrid() {
		const AG = globalThis.agGrid;
		if (!AG) throw new Error('AG Grid UMD não carregado. Verifique a ordem dos scripts.');
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

	/* =========================================
	 *  Estado global (moeda / quick filter)
	 * =======================================*/
	let LION_CURRENCY = 'BRL'; // 'BRL' | 'USD'
	let GLOBAL_QUICK_FILTER = '';

	function setCurrency(mode) {
		const m = String(mode || '').toUpperCase();
		if (m === 'USD' || m === 'BRL') LION_CURRENCY = m;
		else console.warn('[Currency] modo inválido:', mode);
	}
	function getCurrency() {
		return LION_CURRENCY;
	}
	// aliases p/ compat
	function setLionCurrency(mode) {
		setCurrency(mode);
	}
	function getAppCurrency() {
		return getCurrency();
	}

	function setGlobalQuickFilter(text) {
		GLOBAL_QUICK_FILTER = String(text || '');
		const api = globalThis.LionGrid?.api;
		if (!api) return;
		try {
			if (typeof api.setGridOption === 'function') {
				api.setGridOption('quickFilterText', GLOBAL_QUICK_FILTER);
			} else if (typeof api.setQuickFilter === 'function') {
				api.setQuickFilter(GLOBAL_QUICK_FILTER);
			}
		} catch {}
		if (typeof api.onFilterChanged === 'function') api.onFilterChanged();
	}
	function getGlobalQuickFilter() {
		return GLOBAL_QUICK_FILTER;
	}

	/* =========================================
	 * Helpers (tempo, html, números, moeda)
	 * =======================================*/
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	async function withMinSpinner(startMs, minMs) {
		const elapsed = performance.now() - startMs;
		if (elapsed < minMs) await sleep(minMs - elapsed);
	}
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
	function parseCurrencyFlexible(value, mode = getCurrency()) {
		if (value == null || value === '') return null;
		if (typeof value === 'number') return Number.isFinite(value) ? value : null;
		let s = String(value).trim();
		s = s.replace(/[^\d.,\-+]/g, '');
		if (!s) return null;
		const lastDot = s.lastIndexOf('.');
		const lastComma = s.lastIndexOf(',');
		const hasSep = lastDot !== -1 || lastComma !== -1;
		let normalized;
		if (!hasSep) {
			normalized = s.replace(/[^\d\-+]/g, '');
		} else {
			const decSep = lastDot > lastComma ? '.' : ',';
			const i = s.lastIndexOf(decSep);
			const intPart = s.slice(0, i).replace(/[^\d\-+]/g, '');
			const fracPart = s.slice(i + 1).replace(/[^\d]/g, '');
			normalized = intPart + (fracPart ? '.' + fracPart : '');
		}
		const n = parseFloat(normalized);
		return Number.isFinite(n) ? n : null;
	}
	const intFmt = new Intl.NumberFormat('pt-BR');
	function currencyFormatter(p) {
		const currency = getCurrency();
		const locale = currency === 'USD' ? 'en-US' : 'pt-BR';
		let n = typeof p.value === 'number' ? p.value : parseCurrencyFlexible(p.value, currency);
		if (!Number.isFinite(n)) return p.value ?? '';
		return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
	}
	const intFormatter = (p) => {
		const n = toNumberBR(p.value);
		return n == null ? p.value ?? '' : intFmt.format(Math.round(n));
	};

	/* =========================================
	 * CSS (loading + status menu + editable states)
	 * =======================================*/
	(function ensureLoadingStyles() {
		if (document.getElementById('lion-loading-styles')) return;
		const css = `
.ag-cell.ag-cell-loading * { visibility: hidden !important; }
.ag-cell.ag-cell-loading::after {
  content:""; position:absolute; left:50%; top:50%; width:14px; height:14px;
  margin-left:-7px; margin-top:-7px; border-radius:50%; border:2px solid #9ca3af;
  border-top-color:transparent; animation: lion-spin .8s linear infinite; z-index:2; pointer-events:none;
}
@keyframes lion-spin { to { transform: rotate(360deg); } }

.lion-editable-pen{ display:inline-flex; align-items:center; margin-left:6px; opacity:.45; pointer-events:none; font-size:12px; line-height:1; }
.ag-cell:hover .lion-editable-pen{ opacity:.85 }
.lion-editable-ok{ display:inline-flex; align-items:center; margin-left:6px; opacity:.9; pointer-events:none; font-size:12px; line-height:1; }
.ag-cell:hover .lion-editable-ok{ opacity:1 }
.lion-editable-err{ display:inline-flex; align-items:center; margin-left:6px; opacity:.95; pointer-events:none; font-size:12px; line-height:1; color:#ef4444; }
.ag-cell:hover .lion-editable-err{ opacity:1 }
.ag-cell.lion-cell-error{ background: rgba(239, 68, 68, 0.12); box-shadow: inset 0 0 0 1px rgba(239,68,68,.35); }
.ag-cell.lion-cell-error .lion-editable-val{ color:#ef4444; font-weight:600; }

.lion-status-menu { position:absolute; min-width:160px; padding:6px 0; background:#111; color:#eee; border:1px solid rgba(255,255,255,.08); border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,.35); z-index:99999; }
.lion-status-menu__item { padding:8px 12px; font-size:12px; cursor:pointer; display:flex; align-items:center; gap:8px; }
.lion-status-menu__item:hover { background: rgba(255,255,255,.06); }

.ag-theme-quartz .lion-center-cell { text-align:center; }
`;
		const el = document.createElement('style');
		el.id = 'lion-loading-styles';
		el.textContent = css;
		document.head.appendChild(el);
	})();

	/* =========================================
	 * Tema (Quartz + Material icons)
	 * =======================================*/
	function createAgTheme() {
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

	/* =========================================
	 * Badges/cores e helpers visuais
	 * =======================================*/
	const FALLBACK_STYLE = {
		success: { bg: '#22c55e', fg: '#ffffff' },
		primary: { bg: '#3b82f6', fg: '#ffffff' },
		danger: { bg: '#dc2626', fg: '#ffffff' },
		warning: { bg: '#eab308', fg: '#111111' },
		secondary: { bg: '#334155', fg: '#ffffff' },
	};
	function renderBadgeNode(label, colorKey) {
		const fb = FALLBACK_STYLE[colorKey] || FALLBACK_STYLE.secondary;
		const span = document.createElement('span');
		span.textContent = label;
		span.style.display = 'inline-block';
		span.style.padding = '2px 8px';
		span.style.borderRadius = '999px';
		span.style.fontSize = '12px';
		span.style.fontWeight = '600';
		span.style.lineHeight = '1.4';
		span.style.backgroundColor = fb.bg;
		span.style.color = fb.fg;
		return span;
	}
	function pickStatusColor(raw) {
		const s = String(raw || '')
			.trim()
			.toLowerCase();
		return s === 'active' ? 'success' : 'secondary';
	}
	function isPinnedOrTotal(params) {
		return (
			params?.node?.rowPinned === 'bottom' ||
			params?.node?.rowPinned === 'top' ||
			params?.data?.__nodeType === 'total' ||
			params?.node?.group === true
		);
	}

	/* =========================================
	 * Renderers base
	 * =======================================*/
	function statusPillRenderer(p) {
		const raw = p.value ?? '';
		if (isPinnedOrTotal(p) || !raw) {
			const span = document.createElement('span');
			span.textContent = stripHtml(raw) || '';
			return span;
		}
		const labelClean = (strongText(raw) || stripHtml(raw) || '').trim();
		const labelUp = labelClean.toUpperCase();
		if (/^\s*INATIVA\s+PAGAMENTO\s*$/i.test(labelClean)) {
			const el = document.createElement('span');
			el.textContent = 'INATIVA PAGAMENTO';
			el.style.whiteSpace = 'pre';
			el.className = 'lion-badge--inativa';
			return el;
		}
		const color = pickStatusColor(labelUp);
		return renderBadgeNode(labelUp, color);
	}
	function profileCellRenderer(params) {
		const raw = String(params?.value ?? '').trim();
		if (!raw) return '';
		const idx = raw.lastIndexOf(' - ');
		const name = idx > -1 ? raw.slice(0, idx).trim() : raw;
		const meta = idx > -1 ? raw.slice(idx + 3).trim() : '';
		const wrap = document.createElement('span');
		wrap.style.display = 'inline-flex';
		wrap.style.flexDirection = 'column';
		wrap.style.lineHeight = '1.2';
		const nameEl = document.createElement('span');
		nameEl.textContent = name;
		nameEl.style.fontWeight = '500';
		wrap.appendChild(nameEl);
		if (meta) {
			const metaEl = document.createElement('span');
			metaEl.textContent = meta;
			metaEl.style.fontSize = '10px';
			metaEl.style.opacity = '0.65';
			metaEl.style.letterSpacing = '0.2px';
			wrap.appendChild(metaEl);
		}
		return wrap;
	}
	function revenueCellRenderer(p) {
		const raw = p.value ?? p.data?.revenue ?? '';
		if (isPinnedOrTotal(p) || !raw) {
			const span = document.createElement('span');
			span.textContent = stripHtml(raw) || '';
			return span;
		}
		const wrap = document.createElement('span');
		wrap.style.display = 'inline-flex';
		wrap.style.flexDirection = 'column';
		wrap.style.lineHeight = '1.15';
		wrap.style.gap = '2px';
		const totalEl = document.createElement('span');
		totalEl.textContent = stripHtml(raw);
		wrap.appendChild(totalEl);
		return wrap;
	}

	function EditableMoneyCellRenderer() {}
	EditableMoneyCellRenderer.prototype.init = function (p) {
		this.p = p;
		this.colId = p?.column?.getColId?.() || '';
		const wrap = document.createElement('span');
		wrap.style.display = 'inline-flex';
		wrap.style.alignItems = 'center';
		wrap.style.gap = '4px';
		const valueEl = document.createElement('span');
		valueEl.className = 'lion-editable-val';
		valueEl.textContent =
			p.valueFormatted != null ? String(p.valueFormatted) : String(p.value ?? '');
		const pen = document.createElement('i');
		pen.className = 'lion-editable-pen ki-duotone ki-pencil';
		const ok = document.createElement('i');
		ok.className = 'lion-editable-ok ki-duotone ki-check';
		const err = document.createElement('i');
		err.className = 'lion-editable-err ki-duotone ki-cross';
		ok.style.display = 'none';
		err.style.display = 'none';
		wrap.append(valueEl, pen, ok, err);
		this.eGui = wrap;
		this.valueEl = valueEl;
		this.pen = pen;
		this.ok = ok;
		this.err = err;
		this.updateVisibility();
	};
	EditableMoneyCellRenderer.prototype.getGui = function () {
		return this.eGui;
	};
	EditableMoneyCellRenderer.prototype.refresh = function (p) {
		this.p = p;
		this.valueEl.textContent =
			p.valueFormatted != null ? String(p.valueFormatted) : String(p.value ?? '');
		this.updateVisibility();
		return true;
	};
	function isCellLoading(p, colId) {
		return !!p?.data?.__loading?.[colId];
	}
	function isCellJustSaved(p, colId) {
		return !!p?.data?.__justSaved?.[colId];
	}
	function isCellError(p, colId) {
		return !!p?.data?.__err?.[colId];
	}
	EditableMoneyCellRenderer.prototype.updateVisibility = function () {
		const p = this.p || {};
		const editableProp = p.colDef?.editable;
		const isEditable = typeof editableProp === 'function' ? !!editableProp(p) : !!editableProp;
		const show =
			isEditable &&
			(p?.node?.level ?? -1) === 0 &&
			!isPinnedOrTotal(p) &&
			!isCellLoading(p, this.colId);
		const justSaved = isCellJustSaved(p, this.colId);
		const hasError = isCellError(p, this.colId);
		this.err.style.display = show && hasError ? 'inline-flex' : 'none';
		this.ok.style.display = show && !hasError && justSaved ? 'inline-flex' : 'none';
		this.pen.style.display = show && !hasError && !justSaved ? 'inline-flex' : 'none';
	};

	/* ===== Chip "a/b" ===== */
	function chipFractionBadgeRenderer(p) {
		if (isPinnedOrTotal(p) || !p.value) {
			const span = document.createElement('span');
			span.textContent = stripHtml(p.value) || '';
			return span;
		}
		const txt = stripHtml(p.value ?? '').trim();
		const m = txt.match(/^(\d+)\s*\/\s*(\d+)$/);
		let color = 'secondary',
			label = txt || '—';
		if (m) {
			const current = Number(m[1]),
				total = Number(m[2]);
			if (Number.isFinite(current) && Number.isFinite(total) && total > 0) {
				if (current <= 1) color = 'success';
				else if (current / total > 0.5) color = 'danger';
				else color = 'warning';
				label = `${current}/${total}`;
			}
		}
		return renderBadgeNode(label, color);
	}

	/* =========================================
	 * Status Slider (com menu)
	 * =======================================*/
	function setCellLoading(node, colId, on) {
		if (!node?.data) return;
		node.data.__loading = node.data.__loading || {};
		node.data.__loading[colId] = !!on;
	}
	function markCellJustSaved(node, colId, ms = 60000) {
		if (!node?.data) return;
		node.data.__justSaved = node.data.__justSaved || {};
		node.data.__justSaved[colId] = true;
		const api = globalThis.LionGrid?.api;
		api?.refreshCells?.({ rowNodes: [node], columns: [colId] });
		setTimeout(() => {
			try {
				if (!node?.data?.__justSaved) return;
				delete node.data.__justSaved[colId];
				api?.refreshCells?.({ rowNodes: [node], columns: [colId] });
			} catch {}
		}, ms);
	}
	function clearCellError(node, colId) {
		if (!node?.data?.__err) return;
		delete node.data.__err[colId];
		const api = globalThis.LionGrid?.api;
		api?.refreshCells?.({ rowNodes: [node], columns: [colId], force: true, suppressFlash: true });
	}
	function markCellError(node, colId, ms = 60000) {
		if (!node?.data) return;
		node.data.__err = node.data.__err || {};
		node.data.__err[colId] = true;
		const api = globalThis.LionGrid?.api;
		api?.refreshCells?.({ rowNodes: [node], columns: [colId], force: true, suppressFlash: true });
		setTimeout(() => clearCellError(node, colId), ms);
	}
	function nudgeRenderer(p, colId) {
		p.api.stopEditing(false);
		p.api.refreshCells({ rowNodes: [p.node], columns: [colId], force: true });
		const allCols = (p.api.getAllDisplayedColumns?.() || []).map((c) => c.getColId());
		const neighborColId = allCols.find((id) => id !== colId && id !== 'campaign_status') || colId;
		const rowIdx = p.node.rowIndex;
		p.api.setFocusedCell(rowIdx, neighborColId);
		setTimeout(() => {
			p.api.setFocusedCell(rowIdx, colId);
			p.api.refreshCells({
				rowNodes: [p.node],
				columns: [colId],
				force: true,
				suppressFlash: true,
			});
		}, 0);
	}

	function StatusSliderRenderer() {}
	const LionStatusMenu = (() => {
		let el = null,
			onPick = null,
			_isOpen = false,
			_anchor = null;
		function ensure() {
			if (el) return el;
			el = document.createElement('div');
			el.className = 'lion-status-menu';
			el.style.display = 'none';
			el.style.position = 'absolute';
			el.style.minWidth = '160px';
			el.style.padding = '6px 0';
			el.style.background = '#111';
			el.style.color = '#eee';
			el.style.border = '1px solid rgba(255,255,255,.08)';
			el.style.borderRadius = '8px';
			el.style.boxShadow = '0 10px 30px rgba(0,0,0,.35)';
			el.style.zIndex = '99999';
			document.body.appendChild(el);
			return el;
		}
		function onDocClose(ev) {
			if (!el) return;
			if (ev.target === el || el.contains(ev.target)) return;
			const anchor = _anchor;
			if (anchor && (ev.target === anchor || anchor.contains(ev.target))) return;
			close();
		}
		function open({ left, top, width, current, pick, anchor = null }) {
			const host = ensure();
			host.innerHTML = '';
			onPick = pick;
			_anchor = anchor;
			_isOpen = true;
			['ACTIVE', 'PAUSED'].forEach((st) => {
				const item = document.createElement('div');
				item.className = 'lion-status-menu__item' + (current === st ? ' is-active' : '');
				item.style.padding = '8px 12px';
				item.style.fontSize = '12px';
				item.style.cursor = 'pointer';
				item.textContent = st;
				item.addEventListener('mousedown', (e) => e.preventDefault());
				item.addEventListener('click', (e) => {
					e.preventDefault();
					try {
						onPick && onPick(st);
					} finally {
						close();
					}
				});
				host.appendChild(item);
			});
			const menuW = 180;
			host.style.left = `${Math.max(8, left + (width - menuW) / 2)}px`;
			host.style.top = `${top + 6}px`;
			host.style.width = `${menuW}px`;
			host.style.display = 'block';
			setTimeout(() => {
				document.addEventListener('mousedown', onDocClose, true);
				window.addEventListener('blur', close, true);
			}, 0);
		}
		function close() {
			if (!el) return;
			el.style.display = 'none';
			onPick = null;
			_isOpen = false;
			_anchor = null;
			document.removeEventListener('mousedown', onDocClose, true);
			window.removeEventListener('blur', close, true);
		}
		return {
			open,
			close,
			isOpen() {
				return _isOpen;
			},
			getAnchor() {
				return _anchor;
			},
		};
	})();

	StatusSliderRenderer.prototype.init = function (p) {
		this.p = p;
		const cfg = p.colDef?.cellRendererParams || {};
		const interactive = new Set(Array.isArray(cfg.interactiveLevels) ? cfg.interactiveLevels : [0]);
		const smallKnob = !!cfg.smallKnob;
		const level = p?.node?.level ?? 0;
		const colId = p.column.getColId();
		const getVal = () =>
			String(p.data?.campaign_status ?? p.data?.status ?? p.value ?? '').toUpperCase();
		const isOnVal = () => getVal() === 'ACTIVE';

		if (isPinnedOrTotal(p) || !interactive.has(level)) {
			this.eGui = document.createElement('span');
			this.eGui.textContent = strongText(String(p.value ?? ''));
			return;
		}
		const root = document.createElement('div');
		root.className = 'ag-status-pill';
		root.setAttribute('role', 'switch');
		root.setAttribute('tabindex', '0');
		const fill = document.createElement('div');
		fill.className = 'ag-status-fill';
		const knob = document.createElement('div');
		knob.className = 'ag-status-knob';
		if (smallKnob) knob.classList.add('ag-status-knob--sm');
		const label = document.createElement('div');
		label.className = 'ag-status-label';
		root.append(fill, label, knob);
		this.eGui = root;

		let trackLenPx = 0,
			rafToken = null;
		const computeTrackLen = () => {
			const pad = parseFloat(getComputedStyle(root).paddingLeft || '0');
			const knobW = knob.clientWidth || 0;
			const edgeGap = parseFloat(getComputedStyle(root).getPropertyValue('--edge-gap') || '0');
			const travel = root.clientWidth - 2 * pad - 2 * edgeGap - knobW;
			return Math.max(0, travel);
		};
		const setProgress = (pct01) => {
			const pct = Math.max(0, Math.min(1, pct01));
			fill.style.width = pct * 100 + '%';
			knob.style.transform = `translateX(${pct * trackLenPx}px)`;
			const on = pct >= 0.5;
			label.textContent = on ? 'ACTIVE' : 'PAUSED';
			root.setAttribute('aria-checked', String(on));
		};
		requestAnimationFrame(() => {
			trackLenPx = computeTrackLen();
			setProgress(isOnVal() ? 1 : 0);
		});

		const setCellBusy = (on) => {
			setCellLoading(p.node, colId, !!on);
			p.api.refreshCells({ rowNodes: [p.node], columns: [colId] });
		};

		const commit = async (nextOrString, prevOn) => {
			const nextVal =
				typeof nextOrString === 'string'
					? nextOrString.toUpperCase()
					: nextOrString
					? 'ACTIVE'
					: 'PAUSED';
			const level = p.node?.level ?? 0;
			const id =
				level === 0
					? String(p.data?.id ?? p.data?.utm_campaign ?? '')
					: String(p.data?.id ?? '') || '';
			if (!id) return;
			const scope = level === 2 ? 'ad' : level === 1 ? 'adset' : 'campaign';

			setCellBusy(true);
			try {
				const okTest = await toggleFeature('status', { scope, id, value: nextVal });
				if (!okTest) {
					const rollbackVal = prevOn ? 'ACTIVE' : 'PAUSED';
					if (p.data) {
						if ('campaign_status' in p.data) p.data.campaign_status = rollbackVal;
						if ('status' in p.data) p.data.status = rollbackVal;
					}
					setProgress(prevOn ? 1 : 0);
					markCellError(p.node, colId);
					p.api.refreshCells({ rowNodes: [p.node], columns: [colId], force: true });
					nudgeRenderer(p, colId);
					return;
				}
				if (p.data) {
					if ('campaign_status' in p.data) p.data.campaign_status = nextVal;
					if ('status' in p.data) p.data.status = nextVal;
				}
				setProgress(nextVal === 'ACTIVE' ? 1 : 0);
				p.api.refreshCells({ rowNodes: [p.node], columns: [colId] });
				try {
					if (scope === 'ad') await updateAdStatusBackend(id, nextVal);
					else if (scope === 'adset') await updateAdsetStatusBackend(id, nextVal);
					else await updateCampaignStatusBackend(id, nextVal);
					clearCellError(p.node, colId);
					p.api.refreshCells({ rowNodes: [p.node], columns: [colId] });
					if (this._userInteracted) {
						const scopeLabel =
							scope === 'ad' ? 'Ad' : scope === 'adset' ? 'Adset' : 'Campanha';
						const msg =
							nextVal === 'ACTIVE' ? `${scopeLabel} ativado` : `${scopeLabel} pausado`;
						showToast(msg, 'success');
					}
				} catch (e) {
					const rollbackVal = prevOn ? 'ACTIVE' : 'PAUSED';
					if (p.data) {
						if ('campaign_status' in p.data) p.data.campaign_status = rollbackVal;
						if ('status' in p.data) p.data.status = rollbackVal;
					}
					setProgress(prevOn ? 1 : 0);
					p.api.refreshCells({ rowNodes: [p.node], columns: [colId] });
					markCellError(p.node, colId);
					p.api.refreshCells({ rowNodes: [p.node], columns: [colId], force: true });
					nudgeRenderer(p, colId);
					showToast(`Falha ao salvar status: ${e?.message || e}`, 'danger');
				}
			} finally {
				setCellBusy(false);
			}
		};

		const MOVE_THRESHOLD = 6;
		let dragging = false,
			startX = 0,
			startOn = false,
			moved = false;
		const CLICK_DELAY_MS = 280;
		let clickTimer = null;
		const scheduleOpenMenu = () => {
			clearTimeout(clickTimer);
			clickTimer = setTimeout(() => {
				clickTimer = null;
				openMenu();
			}, CLICK_DELAY_MS);
		};
		const cancelScheduledMenu = () => {
			if (clickTimer) {
				clearTimeout(clickTimer);
				clickTimer = null;
			}
		};
		const onPointerMove = (x) => {
			if (!dragging || rafToken) return;
			rafToken = requestAnimationFrame(() => {
				rafToken = null;
				const dx = x - startX;
				if (!moved && Math.abs(dx) > MOVE_THRESHOLD) moved = true;
				if (!moved) return;
				const p0 = startOn ? 1 : 0;
				const pgr = p0 + dx / Math.max(1, trackLenPx);
				setProgress(pgr);
			});
		};
		const onMouseMove = (e) => onPointerMove(e.clientX);
		const onTouchMove = (e) => onPointerMove(e.touches[0].clientX);
		const detachWindowListeners = () => {
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
			window.removeEventListener('touchmove', onTouchMove, { passive: true });
			window.removeEventListener('touchend', onTouchEnd);
		};
		const endDrag = (x, ev) => {
			if (!dragging) return;
			dragging = false;
			detachWindowListeners();
			if (!moved) {
				ev?.preventDefault?.();
				ev?.stopPropagation?.();
				scheduleOpenMenu();
				return;
			}
			const pct = parseFloat(fill.style.width) / 100;
			const finalOn = pct >= 0.5;
			if (finalOn !== startOn) commit(finalOn, startOn);
			else setProgress(startOn ? 1 : 0);
			ev?.preventDefault?.();
			ev?.stopPropagation?.();
		};
		const onMouseUp = (e) => endDrag(e.clientX, e);
		const onTouchEnd = (e) => endDrag(e.changedTouches[0].clientX, e);
		const beginDrag = (x, ev) => {
			this._userInteracted = true;
			dragging = true;
			moved = false;
			startX = x;
			startOn = root.getAttribute('aria-checked') === 'true';
			trackLenPx = computeTrackLen();
			window.addEventListener('mousemove', onMouseMove);
			window.addEventListener('mouseup', onMouseUp);
			window.addEventListener('touchmove', onTouchMove, { passive: true });
			window.addEventListener('touchend', onTouchEnd);
			ev?.preventDefault?.();
			ev?.stopPropagation?.();
		};
		root.addEventListener('mousedown', (e) => beginDrag(e.clientX, e));
		root.addEventListener('touchstart', (e) => beginDrag(e.touches[0].clientX, e), {
			passive: false,
		});

		root.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (dragging) return;
			if (isCellLoading({ data: p.node?.data }, colId)) return;
			cancelScheduledMenu();
			if (LionStatusMenu.isOpen() && LionStatusMenu.getAnchor() === root) {
				LionStatusMenu.close();
				return;
			}
			scheduleOpenMenu();
		});
		root.addEventListener('keydown', (e) => {
			if (e.code === 'Space' || e.code === 'Enter') {
				e.preventDefault();
				e.stopPropagation();
				if (LionStatusMenu.isOpen() && LionStatusMenu.getAnchor() === root)
					LionStatusMenu.close();
				else {
					cancelScheduledMenu();
					openMenu();
				}
			}
		});
		root.addEventListener('dblclick', (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (isCellLoading({ data: p.node?.data }, colId)) return;
			cancelScheduledMenu();
			LionStatusMenu.close();
			const cur = getVal();
			const prevOn = cur === 'ACTIVE';
			const next = prevOn ? 'PAUSED' : 'ACTIVE';
			this._userInteracted = true;
			commit(next, prevOn);
		});
		const openMenu = () => {
			if (isCellLoading({ data: p.node?.data }, colId)) return;
			const cur = getVal();
			const rect = root.getBoundingClientRect();
			if (LionStatusMenu.isOpen() && LionStatusMenu.getAnchor() === root) {
				LionStatusMenu.close();
				return;
			}
			LionStatusMenu.open({
				left: rect.left,
				top: rect.bottom,
				width: rect.width,
				current: cur,
				anchor: root,
				pick: async (st) => {
					if (st === cur) return;
					this._userInteracted = true;
					const prevOn = cur === 'ACTIVE';
					await commit(st, prevOn);
				},
			});
		};
		this._cleanup = () => {
			LionStatusMenu.close();
			detachWindowListeners();
			if (rafToken) cancelAnimationFrame(rafToken);
		};
	};
	StatusSliderRenderer.prototype.getGui = function () {
		return this.eGui;
	};
	StatusSliderRenderer.prototype.refresh = function (p) {
		const cfg = p.colDef?.cellRendererParams || {};
		const interactive = new Set(Array.isArray(cfg.interactiveLevels) ? cfg.interactiveLevels : [0]);
		const level = p?.node?.level ?? 0;
		if (!this.eGui || isPinnedOrTotal(p) || !interactive.has(level)) return false;
		const raw = String(p.data?.campaign_status ?? p.data?.status ?? p.value ?? '').toUpperCase();
		const isOn = raw === 'ACTIVE';
		const fill = this.eGui.querySelector('.ag-status-fill');
		const knob = this.eGui.querySelector('.ag-status-knob');
		const label = this.eGui.querySelector('.ag-status-label');
		const cs = getComputedStyle(this.eGui);
		const pad = parseFloat(cs.paddingLeft || '0');
		const edgeGap = parseFloat(cs.getPropertyValue('--edge-gap') || '0');
		const rectW = this.eGui.getBoundingClientRect().width;
		const kRectW = this.eGui.querySelector('.ag-status-knob').getBoundingClientRect().width || 0;
		const trackLenPx = Math.max(0, rectW - 2 * pad - 2 * edgeGap - kRectW);
		requestAnimationFrame(() => {
			fill.style.width = (isOn ? 100 : 0) + '%';
			const onNudge = parseFloat(cs.getPropertyValue('--knob-on-nudge') || '0') || 0;
			const offNudge = parseFloat(cs.getPropertyValue('--knob-off-nudge') || '0') || 0;
			const nudgePx = isOn ? onNudge : offNudge;
			let x = (isOn ? 1 : 0) * trackLenPx;
			knob.style.transform = `translateX(${x + nudgePx}px)`;
			label.textContent = isOn ? 'ACTIVE' : 'PAUSED';
			this.eGui.setAttribute('aria-checked', String(isOn));
		});
		LionStatusMenu.close();
		return true;
	};
	StatusSliderRenderer.prototype.destroy = function () {
		this._cleanup?.();
	};

	/* =========================================
	 * Floating Filters
	 * =======================================*/
	const BID_TYPE_VALUES = ['LOWEST_COST', 'COST_CAP'];
	const BID_TYPE_LABEL = { LOWEST_COST: 'Lowest Cost', COST_CAP: 'Cost Cap' };

	function BidTypeFloatingFilter() {}
	BidTypeFloatingFilter.prototype.init = function (params) {
		this.params = params;
		const wrap = document.createElement('div');
		wrap.style.display = 'flex';
		wrap.style.alignItems = 'center';
		wrap.style.height = '100%';
		wrap.style.padding = '0 6px';
		const sel = document.createElement('select');
		sel.className = 'ag-input-field-input ag-text-field-input lion-ff-select--inputlike';
		sel.style.width = '100%';
		sel.style.height = '28px';
		sel.style.fontSize = '12px';
		sel.style.padding = '2px 8px';
		sel.style.boxSizing = 'border-box';
		const opts = [['', 'ALL']].concat(
			BID_TYPE_VALUES.map((code) => [code, BID_TYPE_LABEL?.[code] || code])
		);
		for (const [value, label] of opts) {
			const o = document.createElement('option');
			o.value = value;
			o.textContent = label;
			sel.appendChild(o);
		}
		const applyFromModel = (model) => {
			sel.value = model ? String(model.filter ?? '').toUpperCase() : '';
		};
		applyFromModel(params.parentModel);
		const applyTextEquals = (val) => {
			params.parentFilterInstance((parent) => {
				if (!val) parent.setModel(null);
				else parent.setModel({ filterType: 'text', type: 'equals', filter: val });
				if (typeof parent.onBtApply === 'function') parent.onBtApply();
				params.api.onFilterChanged();
			});
		};
		sel.addEventListener('change', () => {
			const v = sel.value ? String(sel.value).toUpperCase() : '';
			applyTextEquals(v);
		});
		wrap.appendChild(sel);
		this.eGui = wrap;
		this.sel = sel;
	};
	BidTypeFloatingFilter.prototype.getGui = function () {
		return this.eGui;
	};
	BidTypeFloatingFilter.prototype.onParentModelChanged = function (model) {
		if (!this.sel) return;
		this.sel.value = model ? String(model.filter ?? '').toUpperCase() : '';
	};

	function CampaignStatusFloatingFilter() {}
	CampaignStatusFloatingFilter.prototype.init = function (params) {
		this.params = params;
		const wrap = document.createElement('div');
		wrap.style.display = 'flex';
		wrap.style.alignItems = 'center';
		wrap.style.height = '100%';
		wrap.style.padding = '0 6px';
		const sel = document.createElement('select');
		sel.className = 'ag-input-field-input ag-text-field-input lion-ff-select--inputlike';
		sel.style.width = '100%';
		sel.style.height = '28px';
		sel.style.fontSize = '12px';
		sel.style.padding = '2px 8px';
		sel.style.boxSizing = 'border-box';
		[
			['', 'ALL'],
			['ACTIVE', 'ACTIVE'],
			['PAUSED', 'PAUSED'],
		].forEach(([v, t]) => {
			const o = document.createElement('option');
			o.value = v;
			o.textContent = t;
			sel.appendChild(o);
		});
		const applyFromModel = (model) => {
			sel.value = model ? String(model.filter ?? '').toUpperCase() : '';
		};
		applyFromModel(params.parentModel);
		const applyTextEquals = (val) => {
			params.parentFilterInstance((parent) => {
				if (!val) parent.setModel(null);
				else parent.setModel({ filterType: 'text', type: 'equals', filter: val });
				if (typeof parent.onBtApply === 'function') parent.onBtApply();
				params.api.onFilterChanged();
			});
		};
		sel.addEventListener('change', () => {
			const v = sel.value ? String(sel.value).toUpperCase() : '';
			applyTextEquals(v);
		});
		wrap.appendChild(sel);
		this.eGui = wrap;
		this.sel = sel;
	};
	CampaignStatusFloatingFilter.prototype.getGui = function () {
		return this.eGui;
	};
	CampaignStatusFloatingFilter.prototype.onParentModelChanged = function (m) {
		if (!this.sel) return;
		this.sel.value = m ? String(m.filter ?? '').toUpperCase() : '';
	};

	function AccountStatusFloatingFilter() {}
	AccountStatusFloatingFilter.prototype.init = function (params) {
		this.params = params;
		const wrap = document.createElement('div');
		wrap.style.display = 'flex';
		wrap.style.alignItems = 'center';
		wrap.style.height = '100%';
		wrap.style.padding = '0 6px';
		const sel = document.createElement('select');
		sel.className = 'ag-input-field-input ag-text-field-input lion-ff-select--inputlike';
		sel.style.width = '100%';
		sel.style.height = '28px';
		sel.style.fontSize = '12px';
		sel.style.padding = '2px 8px';
		sel.style.boxSizing = 'border-box';
		[
			['', 'ALL'],
			['ACTIVE', 'ACTIVE'],
			['INATIVA PAGAMENTO', 'INATIVA PAGAMENTO'],
		].forEach(([v, t]) => {
			const o = document.createElement('option');
			o.value = v;
			o.textContent = t;
			sel.appendChild(o);
		});
		const applyFromModel = (model) => {
			sel.value = model ? String(model.filter ?? '').toUpperCase() : '';
		};
		applyFromModel(params.parentModel);
		const applyTextEquals = (val) => {
			params.parentFilterInstance((parent) => {
				if (!val) parent.setModel(null);
				else parent.setModel({ filterType: 'text', type: 'equals', filter: val });
				if (typeof parent.onBtApply === 'function') parent.onBtApply();
				params.api.onFilterChanged();
			});
		};
		sel.addEventListener('change', () => {
			const v = sel.value ? String(sel.value).toUpperCase() : '';
			applyTextEquals(v);
		});
		wrap.appendChild(sel);
		this.eGui = wrap;
		this.sel = sel;
	};
	AccountStatusFloatingFilter.prototype.getGui = function () {
		return this.eGui;
	};
	AccountStatusFloatingFilter.prototype.onParentModelChanged = function (m) {
		if (!this.sel) return;
		this.sel.value = m ? String(m.filter ?? '').toUpperCase() : '';
	};

	/* =========================================
	 * CurrencyMaskEditor (mesmo do base)
	 * =======================================*/
	function CurrencyMaskEditor() {}
	CurrencyMaskEditor.prototype.init = function (params) {
		this.params = params;
		const startNumber =
			typeof params.value === 'number'
				? params.value
				: parseCurrencyFlexible(params.value, getCurrency());
		this.input = document.createElement('input');
		this.input.type = 'text';
		this.input.className = 'ag-input-field-input ag-text-field-input';
		this.input.style.width = '100%';
		this.input.style.height = '100%';
		this.input.style.boxSizing = 'border-box';
		this.input.style.padding = '2px 6px';
		this.input.autocomplete = 'off';
		this.input.inputMode = 'numeric';
		const fmt = (n) =>
			n == null || !Number.isFinite(n)
				? ''
				: new Intl.NumberFormat('pt-BR', {
						minimumFractionDigits: 2,
						maximumFractionDigits: 2,
				  }).format(n);
		const asNumberFromDigits = (digits) => {
			if (!digits) return null;
			const intCents = parseInt(digits, 10);
			return Number.isFinite(intCents) ? intCents / 100 : null;
		};
		const formatFromRawInput = () => {
			const raw = (this.input.value || '').replace(/\D+/g, '');
			const n = asNumberFromDigits(raw);
			this.input.value = n == null ? '' : fmt(n);
		};
		this.input.value = fmt(startNumber);
		this.onInput = () => {
			formatFromRawInput();
			this.input.setSelectionRange(this.input.value.length, this.input.value.length);
		};
		this.onKeyDown = (e) => {
			if (e.key === 'Escape') this.input.value = fmt(startNumber);
		};
		this.input.addEventListener('input', this.onInput);
		this.input.addEventListener('keydown', this.onKeyDown);
	};
	CurrencyMaskEditor.prototype.getGui = function () {
		return this.input;
	};
	CurrencyMaskEditor.prototype.afterGuiAttached = function () {
		this.input.focus();
		this.input.select();
	};
	CurrencyMaskEditor.prototype.getValue = function () {
		return this.input.value;
	};
	CurrencyMaskEditor.prototype.destroy = function () {
		this.input?.removeEventListener?.('input', this.onInput);
		this.input?.removeEventListener?.('keydown', this.onKeyDown);
	};
	CurrencyMaskEditor.prototype.isPopup = function () {
		return false;
	};

	/* =========================================
	 * Backend API (update*, fetchJSON, toggleFeature)
	 * =======================================*/
	const DEV_FAKE_NETWORK_LATENCY_MS = 0;
	const MIN_SPINNER_MS = 500;

	async function updateAdStatusBackend(id, status) {
		const t0 = performance.now();
		if (DEV_FAKE_NETWORK_LATENCY_MS > 0) await sleep(DEV_FAKE_NETWORK_LATENCY_MS);
		const res = await fetch(`/api/ads/${encodeURIComponent(id)}/status/`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ status }),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || data?.ok === false) throw new Error(data?.error || 'Ad status update failed');
		await withMinSpinner(t0, MIN_SPINNER_MS);
		return data;
	}
	async function updateAdsetStatusBackend(id, status) {
		const t0 = performance.now();
		if (DEV_FAKE_NETWORK_LATENCY_MS > 0) await sleep(DEV_FAKE_NETWORK_LATENCY_MS);
		const res = await fetch(`/api/adsets/${encodeURIComponent(id)}/status/`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ status }),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || data?.ok === false) throw new Error(data?.error || 'Adset status update failed');
		await withMinSpinner(t0, MIN_SPINNER_MS);
		return data;
	}
	async function updateCampaignStatusBackend(id, status) {
		const t0 = performance.now();
		if (DEV_FAKE_NETWORK_LATENCY_MS > 0) await sleep(DEV_FAKE_NETWORK_LATENCY_MS);
		const res = await fetch(`/api/campaigns/${encodeURIComponent(id)}/status/`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ status }),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || data?.ok === false) throw new Error(data?.error || 'Status update failed');
		await withMinSpinner(t0, MIN_SPINNER_MS);
		return data;
	}
	async function updateCampaignBidTypeBackend(id, bidType) {
		const t0 = performance.now();
		if (DEV_FAKE_NETWORK_LATENCY_MS > 0) await sleep(DEV_FAKE_NETWORK_LATENCY_MS);
		const res = await fetch(`/api/campaigns/${encodeURIComponent(id)}/bid_type/`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ bid_type: bidType }),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || data?.ok === false) throw new Error(data?.error || 'Bid Type update failed');
		await withMinSpinner(t0, MIN_SPINNER_MS);
		return data;
	}
	async function updateCampaignBudgetBackend(id, budgetNumber) {
		const t0 = performance.now();
		if (DEV_FAKE_NETWORK_LATENCY_MS > 0) await sleep(DEV_FAKE_NETWORK_LATENCY_MS);
		const res = await fetch(`/api/campaigns/${encodeURIComponent(id)}/budget/`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ budget: budgetNumber }),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || data?.ok === false) throw new Error(data?.error || 'Budget update failed');
		await withMinSpinner(t0, MIN_SPINNER_MS);
		return data;
	}
	async function updateCampaignBidBackend(id, bidNumber) {
		const t0 = performance.now();
		if (DEV_FAKE_NETWORK_LATENCY_MS > 0) await sleep(DEV_FAKE_NETWORK_LATENCY_MS);
		const res = await fetch(`/api/campaigns/${encodeURIComponent(id)}/bid/`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ bid: bidNumber }),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || data?.ok === false) throw new Error(data?.error || 'Bid update failed');
		await withMinSpinner(t0, MIN_SPINNER_MS);
		return data;
	}
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
	function showToast(msg, type = 'info') {
		const colors = {
			info: 'linear-gradient(90deg,#06b6d4,#3b82f6)',
			success: 'linear-gradient(90deg,#22c55e,#16a34a)',
			warning: 'linear-gradient(90deg,#f59e0b,#eab308)',
			danger: 'linear-gradient(90deg,#ef4444,#dc2626)',
		};
		if (globalThis.Toastify) {
			Toastify({
				text: msg,
				duration: 2200,
				close: true,
				gravity: 'bottom',
				position: 'right',
				stopOnFocus: true,
				backgroundColor: colors[type] || colors.info,
			}).showToast();
		} else {
			console.log(`[Toast] ${type.toUpperCase()}: ${msg}`);
		}
	}
	async function toggleFeature(feature, value) {
		const res = await fetch('/api/dev/test-toggle/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ feature, value }),
		});
		const data = await res.json();
		if (res.ok && data.ok) {
			showToast(data.message || 'Aplicado', 'success');
			return true;
		}
		const msg = data?.error || `Erro (${res.status})`;
		showToast(msg, 'danger');
		return false;
	}

	/* =========================================
	 * SSRM & Quick Filter & State
	 * =======================================*/
	function refreshSSRM(api) {
		if (!api) return;
		if (typeof api.refreshServerSideStore === 'function')
			api.refreshServerSideStore({ purge: true });
		else if (typeof api.purgeServerSideCache === 'function') api.purgeServerSideCache();
		else if (typeof api.refreshServerSide === 'function') api.refreshServerSide({ purge: true });
		else if (typeof api.onFilterChanged === 'function') api.onFilterChanged();
	}
	const GRID_STATE_KEY = 'lion.aggrid.state.v1';
	const GRID_STATE_IGNORE_ON_RESTORE = ['pagination', 'scroll', 'rowSelection', 'focusedCell'];

	function buildFilterModelWithGlobal(baseFilterModel) {
		const fm = { ...(baseFilterModel || {}) };
		const gf = (GLOBAL_QUICK_FILTER || '').trim();
		fm._global = Object.assign({}, fm._global, { filter: gf });
		return fm;
	}
	function loadSavedState() {
		try {
			const raw = sessionStorage.getItem(GRID_STATE_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			return parsed?.state || null;
		} catch {
			return null;
		}
	}
	function applySavedStateIfAny(api) {
		const saved = loadSavedState();
		if (!saved) return false;
		try {
			sessionStorage.removeItem(GRID_STATE_KEY);
			api.setState(saved, GRID_STATE_IGNORE_ON_RESTORE);
			return true;
		} catch (e) {
			console.warn('[GridState] restore failed, clearing saved state:', e);
			sessionStorage.removeItem(GRID_STATE_KEY);
			return false;
		}
	}
	function getSelectionColId(api) {
		try {
			const cols = api.getColumns() || [];
			const ids = cols.map((c) => c.getColId());
			if (ids.includes('ag-Grid-Selection')) return 'ag-Grid-Selection';
			const found = cols.find(
				(c) => c.getColDef()?.headerCheckboxSelection || c.getColDef()?.checkboxSelection
			);
			return found?.getColId() || null;
		} catch {
			return null;
		}
	}
	function togglePinnedColsFromCheckbox(silent = false) {
		const api = globalThis.LionGrid?.api;
		if (!api) return;
		const el = document.getElementById('pinToggle');
		if (!el) return;
		const checked = !!el.checked;
		const selectionColId = getSelectionColId(api);
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

	/* =========================================
	 * CompositeColumns (registry preservando funções)
	 * =======================================*/
	const CompositeColumns = (() => {
		const registry = new Map();
		function register(id, builder) {
			registry.set(String(id), builder);
		}
		function _ensureApi() {
			const api = globalThis.LionGrid?.api;
			if (!api) throw new Error('[CompositeColumns] Grid API indisponível');
			return api;
		}
		function _getColumnDefs(api) {
			if (typeof api.getColumnDefs === 'function') return api.getColumnDefs() || [];
			const cols = api.getColumns?.() || [];
			return cols.map((c) => c.getColDef?.()).filter(Boolean);
		}
		function _setColumnDefs(api, defs) {
			if (typeof api.setGridOption === 'function') api.setGridOption('columnDefs', defs);
			else if (typeof api.setColumnDefs === 'function') api.setColumnDefs(defs);
			else {
				const colApi = api.getColumnApi?.();
				if (colApi?.setColumnDefs) colApi.setColumnDefs(defs);
				else throw new Error('api.setColumnDefs is not available');
			}
		}
		function _findGroup(defs, groupId) {
			for (const d of defs) if (d?.groupId === groupId) return d;
			return null;
		}
		function _insertAfter(children, newDef, afterFieldOrHeader) {
			const key = String(afterFieldOrHeader || '').trim();
			if (!key) {
				children.push(newDef);
				return;
			}
			const idx = children.findIndex((c) => {
				const cid = String(c.colId || c.field || '').trim();
				const hn = String(c.headerName || '').trim();
				return cid === key || hn === key;
			});
			if (idx === -1) children.push(newDef);
			else children.splice(idx + 1, 0, newDef);
		}
		function activate(ids = []) {
			const api = _ensureApi();
			const defsRef = _getColumnDefs(api);
			const newDefs = defsRef.slice();
			const group = _findGroup(newDefs, 'grp-metrics-rev');
			if (!group || !Array.isArray(group.children)) {
				console.warn('[CompositeColumns] Grupo "Metrics & Revenue" não encontrado');
				return;
			}
			const newChildren = group.children.slice();
			ids.forEach((id) => {
				const builder = registry.get(String(id));
				if (!builder) return;
				const colDef = builder();
				if (!colDef || typeof colDef !== 'object') return;
				const colKey = String(colDef.colId || colDef.field);
				const exists = newChildren.some((c) => String(c.colId || c.field) === colKey);
				if (exists) return;
				const afterKey = (colDef.__after && String(colDef.__after).trim()) || 'Revenue';
				_insertAfter(newChildren, colDef, afterKey);
			});
			group.children = newChildren;
			_setColumnDefs(api, newDefs);
			try {
				api.sizeColumnsToFit?.();
			} catch {}
			return true;
		}
		function deactivate(ids = []) {
			const api = _ensureApi();
			const defsRef = _getColumnDefs(api);
			const newDefs = defsRef.slice();
			const group = _findGroup(newDefs, 'grp-metrics-rev');
			if (!group || !Array.isArray(group.children)) return;
			const idsSet = new Set(ids.map(String));
			const newChildren = group.children.filter((c) => !idsSet.has(String(c.colId || c.field)));
			group.children = newChildren;
			_setColumnDefs(api, newDefs);
			try {
				api.sizeColumnsToFit?.();
			} catch {}
			return true;
		}
		return { register, activate, deactivate };
	})();

	/* =========================================
	 * Calculated Columns framework (LionCalcColumns)
	 * =======================================*/
	function number(x) {
		const n1 = toNumberBR(x);
		if (Number.isFinite(n1)) return n1;
		const n2 = parseCurrencyFlexible(x, getCurrency());
		return Number.isFinite(n2) ? n2 : 0;
	}
	function cc_evalExpression(expr, row) {
		if (!expr || typeof expr !== 'string') return null;
		if (!/^[\w\s()+\-*/]+$/.test(expr)) return null;
		const tokens = expr.match(/[A-Za-z_]\w*/g) || [];
		const allowed = new Set(['number', ...Object.keys(row || {})]);
		for (const t of tokens) if (!allowed.has(t)) return null;
		try {
			const keys = [...allowed].filter((k) => k !== 'number');
			const fn = new Function(
				'number',
				'row',
				`const { ${keys.join(', ')} } = row; return (${expr});`
			);
			const val = fn(number, row || {});
			return Number.isFinite(val) ? val : null;
		} catch {
			return null;
		}
	}
	function cc_currencyFormat(n) {
		if (!Number.isFinite(n)) return '';
		const cur = getCurrency();
		const locale = cur === 'USD' ? 'en-US' : 'pt-BR';
		return new Intl.NumberFormat(locale, { style: 'currency', currency: cur }).format(n);
	}
	function cc_percentFormat(n, digits = 1) {
		if (!Number.isFinite(n)) return '';
		return (n * 100).toFixed(digits) + '%';
	}

	const LionCalcColumns = (() => {
		const LS_KEY = 'lion.aggrid.calcCols.v1';
		function _read() {
			try {
				return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
			} catch {
				return [];
			}
		}
		function _write(arr) {
			localStorage.setItem(LS_KEY, JSON.stringify(Array.isArray(arr) ? arr : []));
		}
		function _autoWrapFields(expr) {
			if (!expr) return expr;
			if (/\bnumber\s*\(/.test(expr)) return expr;
			return expr.replace(/\b([a-zA-Z_]\w*)(?!\s*\()/g, 'number($1)');
		}
		function _compileExpr(expr) {
			const src = String(expr || '').trim();
			if (!src) return null;
			const wrapped = _autoWrapFields(src);
			return (row) => cc_evalExpression(wrapped, row);
		}
		function _norm(cfg) {
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
			const hideTop = mini,
				includeTotalAsPart = mini,
				partsLabelOnly = false,
				maxParts = 0;
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
		function _fmtBy(fmt, n) {
			if (!Number.isFinite(n)) return '—';
			if (fmt === 'int') return intFmt.format(Math.round(n));
			if (fmt === 'raw') return String(n);
			if (fmt === 'percent') return cc_percentFormat(n);
			return cc_currencyFormat(n);
		}
		function _buildColDef(cfg) {
			const {
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
			} = _norm(cfg);
			const totalFn = _compileExpr(expression);
			const partFns = parts.map((p) => ({ label: p.label, fn: _compileExpr(p.expr) }));
			const valueFormatter = (p) => {
				const v0 = typeof p.value === 'number' ? p.value : number(p.value);
				const v = Number.isFinite(v0) ? v0 : null;
				if (v == null) return p.value ?? '';
				if (format === 'int') return intFmt.format(Math.round(v));
				if (format === 'raw') return String(v);
				if (format === 'percent') return cc_percentFormat(v);
				return currencyFormatter({ value: v });
			};
			const tooltipValueGetter = (p) => {
				const row = p?.data || {};
				const tot = totalFn ? totalFn(row) : null;
				const lines = [`${totalLabel}: ${_fmtBy(format, tot)}`];
				for (const { label, fn } of partFns)
					lines.push(`${label || ''}: ${_fmtBy(partsFormat, fn ? fn(row) : null)}`);
				return lines.join('\n');
			};
			return {
				headerName,
				colId: id,
				minWidth: 150,
				flex: 1,
				pinned: 'right',
				valueGetter: (p) => {
					const row = p?.data || {};
					const val = totalFn ? totalFn(row) : null;
					return Number.isFinite(val) ? val : null;
				},
				valueFormatter,
				tooltipValueGetter,
				cellRenderer: StackBelowRenderer,
				cellRendererParams: {
					onlyLevel0: !!onlyLevel0,
					format:
						partsFormat === 'int'
							? 'int'
							: partsFormat === 'raw'
							? 'raw'
							: partsFormat === 'percent'
							? 'percent'
							: 'currency',
					showTop: !hideTop,
					partsLabelOnly: !!partsLabelOnly,
					showLabels: mini,
					forceShowLabels: mini,
					maxParts: Number(maxParts) || 0,
					getParts: (p) => {
						const row = p?.data || {};
						const list = [];
						const pushPart = (label, value, isTotal, fmt) => {
							const formatted = Number.isFinite(value) ? _fmtBy(fmt, value) : '—';
							list.push({
								label,
								name: label,
								value,
								text: `${label}: ${formatted}`,
								labelWithValue: `${label}: ${formatted}`,
								isTotal: !!isTotal,
							});
						};
						if (includeTotalAsPart) {
							const tot = totalFn ? totalFn(row) : null;
							pushPart(totalLabel, tot, true, format);
						}
						for (const { label, fn } of partFns) {
							const v = fn ? fn(row) : null;
							pushPart(label, v, false, partsFormat);
						}
						return list;
					},
				},
				__after: after,
			};
		}
		function _registerAndActivate(cfg) {
			const colDef = _buildColDef(cfg);
			if (!colDef) return false;
			CompositeColumns.register(colDef.colId, () => colDef);
			try {
				return CompositeColumns.activate([colDef.colId]) || true;
			} catch (e) {
				console.warn('[CalcCols] activate failed', e);
				return false;
			}
		}
		function _migrateLegacyColumn(cfg) {
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
			}
			return cfg;
		}
		function add(config) {
			let cfg = _norm(config);
			cfg = _migrateLegacyColumn(cfg);
			if (!cfg.id || !cfg.expression) {
				showToast('Config inválida (id/expressão obrigatórios)', 'danger');
				return false;
			}
			if (!_compileExpr(cfg.expression)) {
				showToast('Expressão inválida', 'danger');
				return false;
			}
			for (const p of cfg.parts) {
				if (p.expr && !_compileExpr(p.expr)) {
					showToast(`Parte inválida: ${p.label || '(sem rótulo)'}`, 'danger');
					return false;
				}
			}
			const bag = _read();
			const idx = bag.findIndex((c) => String(c.id) === cfg.id);
			if (idx >= 0) bag[idx] = cfg;
			else bag.push(cfg);
			_write(bag);
			const ok = _registerAndActivate(cfg);
			if (ok) showToast(`Coluna "${cfg.headerName}" pronta`, 'success');
			return !!ok;
		}
		function remove(id) {
			const key = String(id || '').trim();
			if (!key) return;
			try {
				CompositeColumns.deactivate([key]);
			} catch {}
			const bag = _read().filter((c) => String(c.id) !== key);
			_write(bag);
			showToast(`Coluna removida: ${key}`, 'info');
		}
		function list() {
			return _read();
		}
		function activateAll() {
			const bag = _read();
			const migrated = [];
			let cnt = 0;
			for (const cfg of bag) {
				const m = _migrateLegacyColumn(cfg);
				if (m.parts && m.parts.length > 0 && (!cfg.parts || cfg.parts.length === 0)) cnt++;
				migrated.push(m);
				_registerAndActivate(m);
			}
			if (cnt > 0) {
				_write(migrated);
				console.log(`[CalcCols] Migrated ${cnt} column(s)`);
			}
		}
		function getAvailableFields() {
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
		function exportForPreset() {
			return _read().map((cfg) => _migrateLegacyColumn(cfg));
		}
		function importFromPreset(columns) {
			if (!Array.isArray(columns)) return;
			_write(columns);
			activateAll();
		}
		function clear() {
			const bag = _read();
			for (const cfg of bag) {
				try {
					CompositeColumns.deactivate([cfg.id]);
				} catch {}
			}
			_write([]);
		}
		return {
			add,
			remove,
			list,
			activateAll,
			getAvailableFields,
			exportForPreset,
			importFromPreset,
			clear,
		};
	})();

	/* =========================================
	 * defaultColDef (compartilhado)
	 * =======================================*/
	const defaultColDef = {
		sortable: true,
		filter: 'agTextColumnFilter',
		floatingFilter: true,
		resizable: true,
		cellClass: () => 'lion-center-cell',
		wrapHeaderText: true,
		autoHeaderHeight: true,
		enableRowGroup: true,
		enablePivot: true,
		enableValue: true,
		suppressHeaderFilterButton: true,
	};

	/* =========================================
	 * StackBelowRenderer (p/ calc columns / revenue stack)
	 * =======================================*/
	function StackBelowRenderer() {}
	StackBelowRenderer.prototype.init = function (p) {
		this.p = p;
		this.eGui = document.createElement('span');
		this.eGui.style.display = 'inline-flex';
		this.eGui.style.flexDirection = 'column';
		this.eGui.style.lineHeight = '1.15';
		this.eGui.style.gap = '2px';
		const lvl = p?.node?.level ?? -1;
		const params = p?.colDef?.cellRendererParams || {};
		const onlyLevel0 = !!params.onlyLevel0;
		const showTop = params.showTop !== false;
		const partsLabelOnly = !!params.partsLabelOnly;
		const maxParts = Number(params.maxParts) || 0;
		const fmtKey = String(params.format || 'raw');
		if (isPinnedOrTotal(p) || (onlyLevel0 && lvl !== 0)) {
			const span = document.createElement('span');
			span.textContent = stripHtml(p.value ?? '');
			this.eGui.appendChild(span);
			return;
		}
		const formatVal = (v) => {
			if (v == null) return '';
			if (fmtKey === 'currency') return cc_currencyFormat(Number(v));
			if (fmtKey === 'int') return intFmt.format(Math.round(Number(v)));
			if (fmtKey === 'percent') return cc_percentFormat(Number(v));
			return String(v);
		};
		if (showTop) {
			const topEl = document.createElement('span');
			topEl.textContent = p.valueFormatted != null ? p.valueFormatted : p.value;
			this.eGui.appendChild(topEl);
		}
		const partsFn = p?.colDef?.cellRendererParams?.getParts;
		let parts = [];
		try {
			parts = typeof partsFn === 'function' ? partsFn(p) : [];
		} catch {}
		if (!Array.isArray(parts)) parts = [];
		if (maxParts > 0) parts = parts.slice(0, maxParts);
		parts.forEach((row) => {
			const line = document.createElement('span');
			line.style.fontSize = '11px';
			line.style.opacity = '0.85';
			const lab = String(row?.label ?? '').trim();
			const valNum = Number.isFinite(row?.value) ? row.value : number(row?.value);
			const preFormatted = row?.text || row?.labelWithValue;
			line.textContent = partsLabelOnly
				? lab || ''
				: preFormatted || (lab ? `${lab}: ` : '') + formatVal(valNum);
			this.eGui.appendChild(line);
		});
	};
	StackBelowRenderer.prototype.getGui = function () {
		return this.eGui;
	};
	StackBelowRenderer.prototype.refresh = function (p) {
		this.init(p);
		return true;
	};

	/* =========================================
	 * KTUI Modal helpers (compat base)
	 * =======================================*/
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
		modal.querySelector('.kt-modal-title').textContent = title;
		modal.querySelector('.kt-modal-body > pre').textContent = content;
		openKTModal('#lionKtModal');
	}

	/* =========================================
	 * CalcCols UI Populate (compat base, opcional)
	 * - Se existir um modal com #calcColsModal e selects #cc-col1 #cc-col2,
	 *   preenche com colunas calculáveis visíveis.
	 * =======================================*/
	(function CalcColsPopulate() {
		const $col1 = document.getElementById('cc-col1');
		const $col2 = document.getElementById('cc-col2');
		const $reload = document.getElementById('cc-reload');
		let lastSelection = { col1: null, col2: null };

		function resolveGridApis() {
			if (globalThis.gridOptions?.api) return { api: globalThis.gridOptions.api };
			if (globalThis.LionGrid?.api) return { api: globalThis.LionGrid.api };
			if (typeof globalThis.getAgGridApis === 'function') {
				const apis = globalThis.getAgGridApis();
				if (apis?.api) return { api: apis.api };
			}
			return { api: null };
		}
		function _isCalculableByDef(def) {
			if (!def) return false;
			if (def.calcEligible === true) return true;
			if (def.calcType === 'numeric') return true;
			if (def.valueType === 'number') return true;
			if (def.cellDataType === 'number') return true;
			if (def.type === 'numericColumn') return true;
			if (def.filter === 'agNumberColumnFilter') return true;
			if (typeof def.valueParser === 'function') return true;
			return false;
		}
		function flattenColDefs(defOrArray) {
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
		}
		function getSelectableColumns(api) {
			if (!api) return [];
			let defs = [];
			try {
				const displayed = api.getAllDisplayedColumns?.() || [];
				if (displayed.length) {
					defs = displayed.map((gc) => gc.getColDef?.() || gc.colDef || null).filter(Boolean);
				}
			} catch {}
			if (!defs.length) {
				const fromApi = api.getColumnDefs?.() || [];
				defs = (fromApi || []).flatMap(flattenColDefs);
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
		}
		function fillSelect(selectEl, items, keepValue) {
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
				selectEl.dispatchEvent(new CustomEvent('kt:select:refresh', { bubbles: true }));
				if (window.KT?.select?.refresh) window.KT.select.refresh(selectEl);
				if (window.KT?.reinitSelect) window.KT.reinitSelect(selectEl);
				selectEl.dispatchEvent(new Event('change', { bubbles: true }));
			} catch {}
		}
		function populateColSelects() {
			const { api } = resolveGridApis();
			if (!$col1 || !$col2 || !api) return;
			if (!$col1.value) lastSelection.col1 = lastSelection.col1 || null;
			else lastSelection.col1 = $col1.value;
			if (!$col2.value) lastSelection.col2 = lastSelection.col2 || null;
			else lastSelection.col2 = $col2.value;
			const items = getSelectableColumns(api);
			fillSelect($col1, items, lastSelection.col1);
			fillSelect($col2, items, lastSelection.col2);
		}
		function bindEventsOnce() {
			if ($reload) {
				$reload.addEventListener('click', () => populateColSelects(), { passive: true });
				document
					.getElementById('cc-save')
					?.setAttribute('data-kt-modal-dismiss', '#calcColsModal');
			}
			const modal = document.getElementById('calcColsModal');
			if (modal) {
				modal.addEventListener('kt:modal:shown', populateColSelects, { passive: true });
				modal.addEventListener('shown.bs.modal', populateColSelects, { passive: true });
				const obs = new MutationObserver((muts) => {
					for (const m of muts) {
						if (m.type === 'attributes' && m.attributeName === 'aria-hidden') {
							if (modal.getAttribute('aria-hidden') === 'false') populateColSelects();
						}
					}
				});
				obs.observe(modal, { attributes: true });
			}
		}
		globalThis.CalcColsUI = { populateSelects: populateColSelects };
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', () => {
				bindEventsOnce();
				populateColSelects();
			});
		} else {
			bindEventsOnce();
			populateColSelects();
		}
	})();

	/* =========================================
	 * makeGrid(container, columnDefs, gridOptions)
	 * =======================================*/
	function makeGrid(container, columnDefs, gridOptions = {}) {
		const AG = getAgGrid();
		const el =
			typeof container === 'string'
				? document.getElementById(container.startsWith('#') ? container.slice(1) : container)
				: container;

		if (!el) {
			console.error('[LionGrid] container não encontrado');
			return null;
		}
		el.classList.add('ag-theme-quartz');

		const baseOptions = {
			theme: createAgTheme(),
			columnDefs: Array.isArray(columnDefs) ? columnDefs.slice() : [],
			defaultColDef,
			animateRows: true,
			sideBar: { toolPanels: ['columns', 'filters'], defaultToolPanel: null, position: 'right' },

			quickFilterText: getGlobalQuickFilter(),

			onGridReady(e) {
				globalThis.LionGrid.api = e.api;
				globalThis.LionGrid.columnApi = e.columnApi || e.api;

				try {
					applySavedStateIfAny(e.api);
				} catch {}
				try {
					const qf = getGlobalQuickFilter();
					if (typeof e.api.setGridOption === 'function')
						e.api.setGridOption('quickFilterText', qf);
					else if (typeof e.api.setQuickFilter === 'function') e.api.setQuickFilter(qf);
				} catch {}
				try {
					globalThis.LionGrid?.LionCalcColumns?.activateAll?.();
				} catch {}
				try {
					togglePinnedColsFromCheckbox(true);
				} catch {}
				try {
					e.api.sizeColumnsToFit?.();
				} catch {}
				try {
					globalThis.dispatchEvent(new Event('lionGridReady'));
				} catch {}
			},

			onFilterChanged(e) {
				try {
					const qf = getGlobalQuickFilter();
					const gridQf =
						typeof e.api.getGridOption === 'function'
							? e.api.getGridOption('quickFilterText')
							: null;
					if (gridQf !== null && gridQf !== qf) {
						if (typeof e.api.setGridOption === 'function')
							e.api.setGridOption('quickFilterText', qf);
						else if (typeof e.api.setQuickFilter === 'function') e.api.setQuickFilter(qf);
					}
				} catch {}
				if (typeof gridOptions.onFilterChanged === 'function') {
					try {
						gridOptions.onFilterChanged(e);
					} catch {}
				}
			},
		};

		const merged = Object.assign({}, baseOptions, gridOptions);

		let gridOrApi = null;
		if (typeof AG.createGrid === 'function') gridOrApi = AG.createGrid(el, merged);
		else if (typeof AG.Grid === 'function') gridOrApi = new AG.Grid(el, merged);
		else throw new Error('AG Grid UMD encontrado, mas sem createGrid nem Grid. Verifique o bundle.');

		return gridOrApi;
	}

	/* =========================================
	 * Exposição global
	 * =======================================*/
	const helpers = {
		sleep,
		withMinSpinner,
		stripHtml,
		strongText,
		toNumberBR,
		parseCurrencyFlexible,
		intFmt,
		currencyFormatter,
		intFormatter,
		showToast,
		setCurrency,
		getCurrency,
		setLionCurrency,
		getAppCurrency,
		setGlobalQuickFilter,
		getGlobalQuickFilter,
		createAgTheme,
		buildFilterModelWithGlobal,
		loadSavedState,
		applySavedStateIfAny,
		togglePinnedColsFromCheckbox,
		refreshSSRM,
		ensureKtModalDom,
		openKTModal,
		closeKTModal,
		showKTModal,
	};
	const renderers = {
		statusPillRenderer,
		profileCellRenderer,
		revenueCellRenderer,
		EditableMoneyCellRenderer,
		chipFractionBadgeRenderer,
		StatusSliderRenderer,
		StackBelowRenderer,

		BidTypeFloatingFilter,
		CampaignStatusFloatingFilter,
		AccountStatusFloatingFilter,
		CurrencyMaskEditor,
	};

	globalThis.LionGrid = Object.assign(globalThis.LionGrid || {}, {
		makeGrid,
		helpers,
		renderers,

		CompositeColumns,
		LionCalcColumns,
		api: undefined,
		columnApi: undefined,
	});

	// Compatibilidade com bases antigas que usam símbolos globais fora de LionGrid:
	globalThis.LionCalcColumns = globalThis.LionCalcColumns || LionCalcColumns;
	globalThis.LionCompositeColumns = globalThis.LionCompositeColumns || CompositeColumns;
})();
