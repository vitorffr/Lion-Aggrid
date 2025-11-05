/* ============================================================
 * Lion Renderers — Single-file bundle (sem imports/exports)
 * Expõe no global: globalThis.LionRenderers.{...}
 * Depende de utilidades globais já existentes (ex.: stripHtml, isPinnedOrTotal,
 * cc_currencyFormat, intFmt, cc_percentFormat, number, isCellLoading, isCellError,
 * isCellJustSaved, setCellLoading, markCellError, clearCellError, nudgeRenderer,
 * toggleFeature, updateCampaignStatusBackend, updateAdsetStatusBackend,
 * updateAdStatusBackend, showToast)
 * ========================================================== */
(function (global) {
	const R = {};

	/* ===== Helpers locais só deste bundle (não conflitam com suas utils) ===== */
	function pickStatusColor(labelUp) {
		if (labelUp === 'ACTIVE') return 'success';
		if (labelUp.includes('PAUSE') || labelUp === 'PAUSED') return 'warning';
		if (labelUp.includes('ERROR') || labelUp.includes('BAN')) return 'danger';
		if (labelUp.includes('INATIVA')) return 'secondary';
		return 'primary';
	}
	function renderBadge(label, color = 'primary') {
		const safe = String(label ?? '').trim();
		return `<span class="lion-badge lion-badge--${color}">${safe}</span>`;
	}
	function renderBadgeNode(label, color = 'primary') {
		const el = document.createElement('span');
		el.className = `lion-badge lion-badge--${color}`;
		el.textContent = String(label ?? '').trim();
		return el;
	}
	function parseRevenue(raw) {
		const txt = (global.stripHtml ? global.stripHtml(raw ?? '') : String(raw ?? '')).trim();
		const m = txt.match(/^(.*?)\s*\(\s*(.*?)\s*\|\s*(.*?)\s*\)\s*$/);
		if (!m) return { total: txt, parts: [] };
		return { total: m[1].trim(), parts: [m[2].trim(), m[3].trim()] };
	}
	const strongText = (s) => (global.stripHtml ? global.stripHtml(s) : String(s ?? ''));

	/* =========================================
	 * 1) statusPillRenderer
	 * =======================================*/
	function statusPillRenderer(p) {
		const raw = p.value ?? '';
		if ((global.isPinnedOrTotal && global.isPinnedOrTotal(p)) || !raw) {
			const span = document.createElement('span');
			span.textContent = (global.stripHtml ? global.stripHtml(raw) : String(raw)) || '';
			return span;
		}
		const labelClean = (
			strongText(raw) ||
			(global.stripHtml ? global.stripHtml(raw) : String(raw)) ||
			''
		).trim();
		const labelUp = labelClean.toUpperCase();

		if (/^\s*INATIVA\s+PAGAMENTO\s*$/i.test(labelClean)) {
			const el = document.createElement('span');
			el.className = 'lion-badge--inativa-pagamento';
			el.textContent = 'INATIVA\nPAGAMENTO';
			return el;
		}
		if (labelUp === 'ACTIVE') {
			const el = document.createElement('span');
			el.className = 'lion-badge--active';
			el.textContent = 'ACTIVE';
			return el;
		}
		const color = pickStatusColor(labelUp);
		return renderBadgeNode(labelUp, color);
	}

	/* =========================================
	 * 2) chipFractionBadgeRenderer
	 * =======================================*/
	function pickChipColorFromFraction(value) {
		const txt = (global.stripHtml ? global.stripHtml(value ?? '') : String(value ?? '')).trim();
		const m = txt.match(/^(\d+)\s*\/\s*(\d+)$/);
		if (!m) return { label: txt || '—', color: 'secondary' };
		const current = Number(m[1]);
		const total = Number(m[2]);
		if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0)
			return { label: `${current}/${total}`, color: 'secondary' };
		if (current <= 1) return { label: `${current}/${total}`, color: 'success' };
		const ratio = current / total;
		if (ratio > 0.5) return { label: `${current}/${total}`, color: 'danger' };
		return { label: `${current}/${total}`, color: 'warning' };
	}
	function chipFractionBadgeRenderer(p) {
		if ((global.isPinnedOrTotal && global.isPinnedOrTotal(p)) || !p.value) {
			const span = document.createElement('span');
			span.textContent =
				(global.stripHtml ? global.stripHtml(p.value) : String(p.value ?? '')) || '';
			return span;
		}
		const { label, color } = pickChipColorFromFraction(p.value);
		const host = document.createElement('span');
		host.innerHTML = renderBadge(label, color);
		return host.firstElementChild;
	}

	/* =========================================
	 * 3) profileCellRenderer
	 * =======================================*/
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

	/* =========================================
	 * 4) revenueCellRenderer
	 * =======================================*/
	function revenueCellRenderer(p) {
		const raw = p.value ?? p.data?.revenue ?? '';
		if ((global.isPinnedOrTotal && global.isPinnedOrTotal(p)) || !raw) {
			const span = document.createElement('span');
			span.textContent = (global.stripHtml ? global.stripHtml(raw) : String(raw)) || '';
			return span;
		}
		const { total } = parseRevenue(raw);
		const wrap = document.createElement('span');
		wrap.style.display = 'inline-flex';
		wrap.style.flexDirection = 'column';
		wrap.style.lineHeight = '1.15';
		wrap.style.gap = '2px';
		const totalEl = document.createElement('span');
		totalEl.textContent = total || '';
		wrap.appendChild(totalEl);
		return wrap;
	}

	/* =========================================
	 * 5) EditableMoneyCellRenderer (✓ / ✗ / lápis)
	 * =======================================*/
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

		wrap.appendChild(valueEl);
		wrap.appendChild(pen);
		wrap.appendChild(ok);
		wrap.appendChild(err);

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
	EditableMoneyCellRenderer.prototype.updateVisibility = function () {
		const p = this.p || {};
		const level = p?.node?.level ?? -1;
		const editableProp = p.colDef?.editable;
		const isEditable = typeof editableProp === 'function' ? !!editableProp(p) : !!editableProp;
		const loading = global.isCellLoading ? global.isCellLoading(p, this.colId) : false;
		const showBase =
			isEditable &&
			level === 0 &&
			!loading &&
			!(global.isPinnedOrTotal && global.isPinnedOrTotal(p));

		const justSaved = global.isCellJustSaved ? global.isCellJustSaved(p, this.colId) : false;
		const hasError = global.isCellError ? global.isCellError(p, this.colId) : false;

		this.err.style.display = showBase && hasError ? 'inline-flex' : 'none';
		this.ok.style.display = showBase && !hasError && justSaved ? 'inline-flex' : 'none';
		this.pen.style.display = showBase && !hasError && !justSaved ? 'inline-flex' : 'none';
	};
	EditableMoneyCellRenderer.prototype.destroy = function () {};

	/* =========================================
	 * 6) StatusSliderRenderer (toggle + menu)
	 * =======================================*/
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
		function isOpen() {
			return _isOpen;
		}
		function getAnchor() {
			return _anchor;
		}
		return { open, close, isOpen, getAnchor };
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

		if ((global.isPinnedOrTotal && global.isPinnedOrTotal(p)) || !interactive.has(level)) {
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

		let trackLenPx = 0;
		let rafToken = null;

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
			if (global.setCellLoading) {
				global.setCellLoading(p.node, colId, !!on);
				p.api.refreshCells({ rowNodes: [p.node], columns: [colId] });
			}
		};

		const commit = async (nextOrString, prevOn) => {
			const nextVal =
				typeof nextOrString === 'string'
					? nextOrString.toUpperCase()
					: nextOrString
					? 'ACTIVE'
					: 'PAUSED';

			const lvl = p.node?.level ?? 0;
			const id =
				lvl === 0
					? String(p.data?.id ?? p.data?.utm_campaign ?? '')
					: String(p.data?.id ?? '') || '';
			if (!id) return;

			const scope = lvl === 2 ? 'ad' : lvl === 1 ? 'adset' : 'campaign';

			setCellBusy(true);
			try {
				const okTest = global.toggleFeature
					? await global.toggleFeature('status', { scope, id, value: nextVal })
					: true;
				if (!okTest) {
					const rollbackVal = prevOn ? 'ACTIVE' : 'PAUSED';
					if (p.data) {
						if ('campaign_status' in p.data) p.data.campaign_status = rollbackVal;
						if ('status' in p.data) p.data.status = rollbackVal;
					}
					setProgress(prevOn ? 1 : 0);
					global.markCellError && global.markCellError(p.node, colId);
					p.api.refreshCells({ rowNodes: [p.node], columns: [colId], force: true });
					global.nudgeRenderer && global.nudgeRenderer(p, colId);
					return;
				}

				if (p.data) {
					if ('campaign_status' in p.data) p.data.campaign_status = nextVal;
					if ('status' in p.data) p.data.status = nextVal;
				}
				setProgress(nextVal === 'ACTIVE' ? 1 : 0);
				p.api.refreshCells({ rowNodes: [p.node], columns: [colId] });

				try {
					if (scope === 'ad' && global.updateAdStatusBackend) {
						await global.updateAdStatusBackend(id, nextVal);
					} else if (scope === 'adset' && global.updateAdsetStatusBackend) {
						await global.updateAdsetStatusBackend(id, nextVal);
					} else if (scope === 'campaign' && global.updateCampaignStatusBackend) {
						await global.updateCampaignStatusBackend(id, nextVal);
					}
					global.clearCellError && global.clearCellError(p.node, colId);
					p.api.refreshCells({ rowNodes: [p.node], columns: [colId] });
					if (this._userInteracted && global.showToast) {
						const scopeLabel =
							scope === 'ad' ? 'Ad' : scope === 'adset' ? 'Adset' : 'Campanha';
						const msg =
							nextVal === 'ACTIVE' ? `${scopeLabel} ativado` : `${scopeLabel} pausado`;
						global.showToast(msg, 'success');
					}
				} catch (e) {
					const rollbackVal = prevOn ? 'ACTIVE' : 'PAUSED';
					if (p.data) {
						if ('campaign_status' in p.data) p.data.campaign_status = rollbackVal;
						if ('status' in p.data) p.data.status = rollbackVal;
					}
					setProgress(prevOn ? 1 : 0);
					p.api.refreshCells({ rowNodes: [p.node], columns: [colId] });
					global.markCellError && global.markCellError(p.node, colId);
					p.api.refreshCells({ rowNodes: [p.node], columns: [colId], force: true });
					global.nudgeRenderer && global.nudgeRenderer(p, colId);
					global.showToast &&
						global.showToast(`Falha ao salvar status: ${e?.message || e}`, 'danger');
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
		const detachWindowListeners = () => {
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
			window.removeEventListener('touchmove', onTouchMove, { passive: true });
			window.removeEventListener('touchend', onTouchEnd);
		};
		const onMouseMove = (e) => onPointerMove(e.clientX);
		const onTouchMove = (e) => onPointerMove(e.touches[0].clientX);

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
			if (global.isCellLoading && global.isCellLoading({ data: p.node?.data }, colId)) return;
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
				if (LionStatusMenu.isOpen() && LionStatusMenu.getAnchor() === root) {
					LionStatusMenu.close();
				} else {
					cancelScheduledMenu();
					openMenu();
				}
			}
		});

		root.addEventListener('dblclick', (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (global.isCellLoading && global.isCellLoading({ data: p.node?.data }, colId)) return;
			cancelScheduledMenu();
			LionStatusMenu.close();
			const cur = getVal();
			const prevOn = cur === 'ACTIVE';
			const next = prevOn ? 'PAUSED' : 'ACTIVE';
			this._userInteracted = true;
			commit(next, prevOn);
		});

		const openMenu = () => {
			if (global.isCellLoading && global.isCellLoading({ data: p.node?.data }, colId)) return;
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
			cancelScheduledMenu();
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
		if (
			!this.eGui ||
			(global.isPinnedOrTotal && global.isPinnedOrTotal(p)) ||
			!interactive.has(level)
		)
			return false;

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
	 * 7) StackBelowRenderer
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

		if ((global.isPinnedOrTotal && global.isPinnedOrTotal(p)) || (onlyLevel0 && lvl !== 0)) {
			const span = document.createElement('span');
			span.textContent = global.stripHtml
				? global.stripHtml(p.value ?? '')
				: String(p.value ?? '');
			this.eGui.appendChild(span);
			return;
		}

		const formatVal = (v) => {
			if (v == null) return '';
			if (fmtKey === 'currency' && global.cc_currencyFormat)
				return global.cc_currencyFormat(Number(v));
			if (fmtKey === 'int' && global.intFmt) return global.intFmt.format(Math.round(Number(v)));
			if (fmtKey === 'percent' && global.cc_percentFormat)
				return global.cc_percentFormat(Number(v));
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
			const valNum = Number.isFinite(row?.value)
				? row.value
				: global.number
				? global.number(row?.value)
				: Number(row?.value);

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
	 * Exposição global
	 * =======================================*/
	R.statusPillRenderer = statusPillRenderer;
	R.chipFractionBadgeRenderer = chipFractionBadgeRenderer;
	R.profileCellRenderer = profileCellRenderer;
	R.revenueCellRenderer = revenueCellRenderer;
	R.EditableMoneyCellRenderer = EditableMoneyCellRenderer;
	R.StatusSliderRenderer = StatusSliderRenderer;
	R.StackBelowRenderer = StackBelowRenderer;

	R.helpers = {
		pickStatusColor,
		renderBadge,
		renderBadgeNode,
		parseRevenue,
	};

	global.LionRenderers = Object.assign(global.LionRenderers || {}, R);
})(globalThis);
