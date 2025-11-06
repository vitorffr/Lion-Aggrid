import { Tabela, stripHtml } from '../../lion-grid.js';

let LION_CURRENCY = 'BRL'; // 'BRL' | 'USD'
const DEV_FAKE_NETWORK_LATENCY_MS = 0;
const MIN_SPINNER_MS = 500;
/**
 * Garante spinner mínimo num fluxo async.
 * @param {number} startMs performance.now() no início
 * @param {number} minMs   ms mínimo de spinner
 */
async function withMinSpinner(startMs, minMs) {
	const elapsed = performance.now() - startMs;
	if (elapsed < minMs) await sleep(minMs - elapsed);
}

/* =========================================
 * 3) Utilidades (tempo/edição/parsing)
 * =======================================*/
/**
 * Sleep async
 * @param {number} ms
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Marca que o próximo setDataValue para a célula NÃO deve disparar onCellValueChanged.
 * @param {*} p params do AG Grid
 * @param {string} colId
 */
function shouldSuppressCellChange(p, colId) {
	const key = `__suppress_${colId}`;
	if (p?.data?.[key]) {
		p.data[key] = false;
		return true;
	}
	return false;
}

/**
 * Faz update de célula sem disparar handlers de edição.
 * @param {*} p params do AG Grid
 * @param {string} colId
 * @param {*} value
 */
function setCellSilently(p, colId, value) {
	const key = `__suppress_${colId}`;
	if (p?.data) p.data[key] = true;
	p.node.setDataValue(colId, value);
}

function isCellJustSaved(p, colId) {
	return !!p?.data?.__justSaved?.[colId];
}

/* =========================================
 * 10) Backend API (update*, fetchJSON, toggleFeature)
 * =======================================*/
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

function setCellValueNoEvent(p, colId, value) {
	if (!p?.node?.data) return;
	const key = `__suppress_${colId}`;
	p.node.data[key] = true; // belt & suspenders
	p.node.data[colId] = value; // 🔴 direto no data (sem setDataValue)
	p.api.refreshCells({
		rowNodes: [p.node],
		columns: [colId],
		force: true,
		suppressFlash: true,
	});
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
function nudgeRenderer(p, colId) {
	// encerra a edição (gera blur/commit do editor)
	p.api.stopEditing(false);
	// força re-render só da célula alvo
	p.api.refreshCells({ rowNodes: [p.node], columns: [colId], force: true });
	blurLikeClickElsewhere(p);
}

function isStatusActiveVal(v) {
	return String(v ?? '').toUpperCase() === 'ACTIVE';
}
function getRowStatusValue(p) {
	return p?.data?.campaign_status ?? p?.data?.status ?? p?.value ?? '';
}
function setRowStatus(data, on) {
	const next = on ? 'ACTIVE' : 'PAUSED';
	if (data) {
		if ('campaign_status' in data) data.campaign_status = next;
		if ('status' in data) data.status = next;
	}
}
function setCellLoading(node, colId, on) {
	if (!node?.data) return;
	node.data.__loading = node.data.__loading || {};
	node.data.__loading[colId] = !!on;
}

/** Marca a célula como "acabou de salvar" e volta ao normal após ms. */
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

function blurLikeClickElsewhere(p) {
	const api = p.api;
	const rowIdx = p.node.rowIndex;
	const colId = p.column.getColId();

	// 1) “Clique fora”: encerra edição (commit) — igual blur
	api.stopEditing(false);

	// 2) Escolhe uma coluna vizinha segura (qualquer uma ≠ a atual e ≠ campaign_status)
	const allCols = (api.getAllDisplayedColumns?.() || []).map((c) => c.getColId());
	const neighborColId = allCols.find((id) => id !== colId && id !== 'campaign_status') || colId;

	// 3) Move o foco rapidamente para a vizinha (simula click fora)
	api.setFocusedCell(rowIdx, neighborColId);

	// 4) (Opcional) volta o foco e refresca somente a célula alterada
	setTimeout(() => {
		api.setFocusedCell(rowIdx, colId);
		api.refreshCells({
			rowNodes: [p.node],
			columns: [colId],
			force: true,
			suppressFlash: true,
		});
	}, 0);
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
		console.log(`[Toast] ${msg}`);
	}
}
/** Marca a célula como "erro ao salvar" e limpa após ms (default 14s). */
function clearCellError(node, colId) {
	if (!node?.data?.__err) return;
	delete node.data.__err[colId];
	const api = globalThis.LionGrid?.api;
	api?.refreshCells?.({
		rowNodes: [node],
		columns: [colId],
		force: true,
		suppressFlash: true,
	});
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
function markCellError(node, colId, ms = 60000) {
	if (!node?.data) return;
	node.data.__err = node.data.__err || {};
	node.data.__err[colId] = true;
	const api = globalThis.LionGrid?.api;
	api?.refreshCells?.({
		rowNodes: [node],
		columns: [colId],
		force: true,
		suppressFlash: true,
	});
	setTimeout(() => clearCellError(node, colId), ms);
}

function parseRevenue(raw) {
	const txt = stripHtml(raw ?? '').trim();
	const m = txt.match(/^(.*?)\s*\(\s*(.*?)\s*\|\s*(.*?)\s*\)\s*$/);
	if (!m) return { total: txt, parts: [] };
	return { total: m[1].trim(), parts: [m[2].trim(), m[3].trim()] };
}

/** Cores fallback para badges (sem tailwind). */
const FALLBACK_STYLE = {
	success: { bg: '#22c55e', fg: '#ffffff' },
	primary: { bg: '#3b82f6', fg: '#ffffff' },
	danger: { bg: '#dc2626', fg: '#ffffff' },
	warning: { bg: '#eab308', fg: '#111111' },
	info: { bg: '#06b6d4', fg: '#ffffff' },
	secondary: { bg: '#334155', fg: '#ffffff' },
	light: { bg: '#e5e7eb', fg: '#111111' },
	dark: { bg: '#1f2937', fg: '#ffffff' },
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
function renderBadge(label, colorKey) {
	return renderBadgeNode(label, colorKey).outerHTML;
}

const BID_TYPE_VALUES = ['LOWEST_COST', 'COST_CAP'];
const BID_TYPE_LABEL = {
	LOWEST_COST: 'Lowest Cost',
	COST_CAP: 'Cost Cap',
};
const intFmt = new Intl.NumberFormat('pt-BR');
const strongText = (s) => {
	if (typeof s !== 'string') return s;
	const m = s.match(/<strong[^>]*>(.*?)<\/strong>/i);
	return stripHtml(m ? m[1] : s);
};
function isPinnedOrTotal(params) {
	return (
		params?.node?.rowPinned === 'bottom' ||
		params?.node?.rowPinned === 'top' ||
		params?.data?.__nodeType === 'total' ||
		params?.node?.group === true
	);
}

function isCellLoading(p, colId) {
	return !!p?.data?.__loading?.[colId];
}
function isCellError(p, colId) {
	return !!p?.data?.__err?.[colId];
}

/**
 * Parser tolerante a BRL/USD (string → number)
 * @param {string|number|null} value
 * @param {'USD'|'BRL'} [mode]
 * @returns {number|null}
 */
function parseCurrencyFlexible(value, mode = getAppCurrency()) {
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

/**
 * Altera a moeda da aplicação em runtime.
 * @param {'USD'|'BRL'} mode
 */
function setLionCurrency(mode) {
	const m = String(mode || '').toUpperCase();
	if (m === 'USD' || m === 'BRL') LION_CURRENCY = m;
	else console.warn('[Currency] modo inválido:', mode);
}
function getAppCurrency() {
	return LION_CURRENCY;
}

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
	valueEl.textContent = p.valueFormatted != null ? String(p.valueFormatted) : String(p.value ?? '');

	const pen = document.createElement('i');
	pen.className = 'lion-editable-pen ki-duotone ki-pencil';

	const ok = document.createElement('i');
	ok.className = 'lion-editable-ok ki-duotone ki-check';

	// 👇 novo: X vermelho
	const err = document.createElement('i');
	err.className = 'lion-editable-err ki-duotone ki-cross'; // se preferir: ki-cross-circle

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
	const loading = isCellLoading(p, this.colId);
	const showBase = isEditable && level === 0 && !loading && !isPinnedOrTotal(p);

	const justSaved = isCellJustSaved(p, this.colId);
	const hasError = isCellError(p, this.colId);

	// prioridade: ERRO > ✓ > lápis
	this.err.style.display = showBase && hasError ? 'inline-flex' : 'none';
	this.ok.style.display = showBase && !hasError && justSaved ? 'inline-flex' : 'none';
	this.pen.style.display = showBase && !hasError && !justSaved ? 'inline-flex' : 'none';
};

EditableMoneyCellRenderer.prototype.destroy = function () {};
function parseCurrencyInput(params) {
	return parseCurrencyFlexible(params.newValue, getAppCurrency());
}
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

	// Opções (ALL + valores do BID_TYPE_VALUES com rótulo via BID_TYPE_LABEL)
	const opts = [['', 'ALL']].concat(
		(Array.isArray(BID_TYPE_VALUES) ? BID_TYPE_VALUES : ['LOWEST_COST', 'COST_CAP']).map((code) => [
			code,
			BID_TYPE_LABEL?.[code] || code,
		])
	);
	for (const [value, label] of opts) {
		const o = document.createElement('option');
		o.value = value;
		o.textContent = label;
		sel.appendChild(o);
	}

	// Sincroniza o select a partir do modelo do filtro pai
	const applyFromModel = (model) => {
		if (!model) {
			sel.value = '';
			return;
		}
		const v = String(model.filter ?? '').toUpperCase();
		sel.value = opts.some(([code]) => code === v) ? v : '';
	};
	applyFromModel(params.parentModel);

	// Aplica “equals” no filtro de texto do pai com o CODE (LOWEST_COST / COST_CAP)
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
BidTypeFloatingFilter.prototype.onParentModelChanged = function (parentModel) {
	if (!this.sel) return;
	if (!parentModel) {
		this.sel.value = '';
		return;
	}
	const v = String(parentModel.filter ?? '').toUpperCase();
	this.sel.value = v;
};

function CurrencyMaskEditor() {}
CurrencyMaskEditor.prototype.init = function (params) {
	this.params = params;
	const startNumber =
		typeof params.value === 'number'
			? params.value
			: parseCurrencyFlexible(params.value, getAppCurrency());

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
		if (!Number.isFinite(intCents)) return null;
		return intCents / 100;
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
	this.input.addEventListener('input', this.onInput);

	this.onKeyDown = (e) => {
		if (e.key === 'Escape') this.input.value = fmt(startNumber);
	};
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

/** Formatter de moeda dinâmico (BRL/USD) para AG Grid. */
function currencyFormatter(p) {
	const currency = getAppCurrency();
	const locale = currency === 'USD' ? 'en-US' : 'pt-BR';
	let n = typeof p.value === 'number' ? p.value : parseCurrencyFlexible(p.value, currency);
	if (!Number.isFinite(n)) return p.value ?? '';
	return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
}
const intFormatter = (p) => {
	const n = toNumberBR(p.value);
	return n == null ? p.value ?? '' : intFmt.format(Math.round(n));
};

/* ======= Campaign Status Slider Renderer (otimizado) ======= */
function StatusSliderRenderer() {}
const LionStatusMenu = (() => {
	let el = null,
		onPick = null;
	let _isOpen = false,
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

		// 1) Clique dentro do MENU? não fecha.
		if (ev.target === el || el.contains(ev.target)) return;

		// 2) Clique no ANCHOR (o slider) ou dentro dele? deixe o handler do anchor decidir (toggle).
		const anchor = _anchor;
		if (anchor && (ev.target === anchor || anchor.contains(ev.target))) {
			return;
		}

		// 3) Qualquer outro lugar: fecha.
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

		// listeners de fechar (usar capture pra fechar antes do click em outro lugar)
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
		if (!model) {
			sel.value = '';
			return;
		}
		const v = String(model.filter ?? '').toUpperCase();
		sel.value = v === 'ACTIVE' || v === 'PAUSED' ? v : '';
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
CampaignStatusFloatingFilter.prototype.onParentModelChanged = function (parentModel) {
	if (!this.sel) return;
	if (!parentModel) {
		this.sel.value = '';
		return;
	}
	const v = String(parentModel.filter ?? '').toUpperCase();
	this.sel.value = v === 'ACTIVE' || v === 'PAUSED' ? v : '';
};
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
			const okTest = await toggleFeature('status', {
				scope,
				id,
				value: nextVal,
			});
			if (!okTest) {
				const rollbackVal = prevOn ? 'ACTIVE' : 'PAUSED';
				if (p.data) {
					if ('campaign_status' in p.data) p.data.campaign_status = rollbackVal;
					if ('status' in p.data) p.data.status = rollbackVal;
				}
				setProgress(prevOn ? 1 : 0);
				markCellError(p.node, colId);
				p.api.refreshCells({
					rowNodes: [p.node],
					columns: [colId],
					force: true,
				});
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
					const scopeLabel = scope === 'ad' ? 'Ad' : scope === 'adset' ? 'Adset' : 'Campanha';
					const msg = nextVal === 'ACTIVE' ? `${scopeLabel} ativado` : `${scopeLabel} pausado`;
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
				// 👇 exceção: marca erro
				markCellError(p.node, colId);
				p.api.refreshCells({
					rowNodes: [p.node],
					columns: [colId],
					force: true,
				});
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

	// ===== DEBOUNCE de clique x duplo clique =====
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
			// Tratar como um "single click" com debounce:
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
	root.addEventListener('touchstart', (e) => beginDrag(e.touches[0].clientX, e), { passive: false });

	// Clique simples -> agenda menu; o dblclick abaixo cancela essa agenda
	root.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (dragging) return;
		if (isCellLoading({ data: p.node?.data }, colId)) return;

		// mata qualquer agendamento pendente para evitar reabrir logo após fechar
		cancelScheduledMenu();

		if (LionStatusMenu.isOpen() && LionStatusMenu.getAnchor() === root) {
			// já está aberto neste anchor -> fecha (toggle-off)
			LionStatusMenu.close();
			return;
		}

		// estava fechado -> abre (toggle-on) com debounce de single click
		scheduleOpenMenu();
	});

	// Teclado abre menu imediato
	root.addEventListener('keydown', (e) => {
		if (e.code === 'Space' || e.code === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			if (LionStatusMenu.isOpen() && LionStatusMenu.getAnchor() === root) {
				LionStatusMenu.close();
			} else {
				cancelScheduledMenu();
				openMenu(); // teclado abre imediato
			}
		}
	});

	// Duplo clique -> troca status e cancela o menu agendado
	root.addEventListener('dblclick', (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (isCellLoading({ data: p.node?.data }, colId)) return;
		cancelScheduledMenu(); // impede abrir menu
		LionStatusMenu.close(); // se por acaso estiver aberto
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

		// se já estiver aberto neste mesmo anchor, apenas fecha (toggle imediato)
		if (LionStatusMenu.isOpen() && LionStatusMenu.getAnchor() === root) {
			LionStatusMenu.close();
			return;
		}

		LionStatusMenu.open({
			left: rect.left,
			top: rect.bottom,
			width: rect.width,
			current: cur,
			anchor: root, // 👈 importantíssimo
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
		if (!model) {
			sel.value = '';
			return;
		}
		const v = String(model.filter ?? '').toUpperCase();
		sel.value = v === 'ACTIVE' || v === 'INATIVA PAGAMENTO' ? v : '';
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
AccountStatusFloatingFilter.prototype.onParentModelChanged = function (parentModel) {
	if (!this.sel) return;
	if (!parentModel) {
		this.sel.value = '';
		return;
	}
	const v = String(parentModel.filter ?? '').toUpperCase();
	this.sel.value = v === 'ACTIVE' || v === 'INATIVA PAGAMENTO' ? v : '';
};

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
function revenueCellRenderer(p) {
	const raw = p.value ?? p.data?.revenue ?? '';
	if (isPinnedOrTotal(p) || !raw) {
		const span = document.createElement('span');
		span.textContent = stripHtml(raw) || '';
		return span;
	}
	const { total, parts } = parseRevenue(raw);
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
function pickChipColorFromFraction(value) {
	const txt = stripHtml(value ?? '').trim();
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
	if (isPinnedOrTotal(p) || !p.value) {
		const span = document.createElement('span');
		span.textContent = stripHtml(p.value) || '';
		return span;
	}
	const { label, color } = pickChipColorFromFraction(p.value);
	const host = document.createElement('span');
	host.innerHTML = renderBadge(label, color);
	return host.firstElementChild;
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

// Só as colunas mudam por página:
const columnDefs = [
	{
		headerName: 'Profile',
		field: 'profile_name',
		valueGetter: (p) => stripHtml(p.data?.profile_name),
		minWidth: 110,
		flex: 1.2,
		cellRenderer: profileCellRenderer,
		pinned: 'left',
		tooltipValueGetter: (p) => p.value || '',
	},
	{
		headerName: 'Identification',
		groupId: 'grp-id',
		marryChildren: true,
		openByDefault: true,
		children: [
			{
				headerName: 'BM',
				field: 'bc_name',
				valueGetter: (p) => stripHtml(p.data?.bc_name),
				minWidth: 110,
				flex: 1.0,
				wrapText: true,
				cellStyle: (p) =>
					p?.node?.level === 0 ? { fontSize: '13px', lineHeight: '1.6' } : null,
				tooltipValueGetter: (p) => p.value || '',
			},
			{
				headerName: 'Account',
				field: 'account_name',
				valueGetter: (p) => stripHtml(p.data?.account_name),
				minWidth: 100,
				flex: 1.3,
				wrapText: true,
				cellStyle: (p) =>
					p?.node?.level === 0 ? { fontSize: '13px', lineHeight: '1.6' } : null,
				tooltipValueGetter: (p) => p.value || '',
			},
		],
	},
	{
		headerName: 'Operation & Setup',
		groupId: 'grp-op',
		marryChildren: true,
		openByDefault: true,
		children: [
			{
				headerName: 'Account Status',
				field: 'account_status',
				minWidth: 110,
				flex: 0.7,
				cellRenderer: statusPillRenderer,
				filter: 'agTextColumnFilter',
				floatingFilter: true,
				floatingFilterComponent: AccountStatusFloatingFilter,
				floatingFilterComponentParams: { suppressFilterButton: true },
			},
			{
				headerName: 'Daily Limit',
				field: 'account_limit',
				calcEligible: true,
				valueGetter: (p) => toNumberBR(p.data?.account_limit),
				valueFormatter: currencyFormatter,
				minWidth: 80,
				flex: 0.8,
			},
			{
				headerName: 'Campaign Status',
				field: 'campaign_status',
				cellClass: ['lion-center-cell'],
				minWidth: 115,
				flex: 0.8,
				cellRenderer: StatusSliderRenderer,
				cellRendererParams: { interactiveLevels: [0, 1, 2], smallKnob: true },
				suppressKeyboardEvent: () => true,
				cellClassRules: {
					'ag-cell-loading': (p) => isCellLoading(p, 'campaign_status'),
					'lion-cell-error': (p) => isCellError(p, 'campaign_status'),
				},
				filter: 'agTextColumnFilter',
				floatingFilter: true,
				floatingFilterComponent: CampaignStatusFloatingFilter,
				floatingFilterComponentParams: { suppressFilterButton: true },
			},
			{
				headerName: 'Budget',
				field: 'budget',
				calcEligible: true,

				editable: (p) => p.node?.level === 0 && !isCellLoading(p, 'budget'),
				cellEditor: CurrencyMaskEditor, // 👈 trocado
				valueParser: parseCurrencyInput, // já usa parseCurrencyFlexible (ok com vírgula)
				valueFormatter: currencyFormatter,
				minWidth: 120,
				cellRenderer: EditableMoneyCellRenderer, // 👈 ADICIONE ISTO

				flex: 0.6,

				cellClassRules: {
					'ag-cell-loading': (p) => isCellLoading(p, 'budget'),
					'lion-cell-error': (p) => isCellError(p, 'budget'),
				},
				onCellValueChanged: async (p) => {
					try {
						if (shouldSuppressCellChange(p, 'budget')) return;
						if ((p?.node?.level ?? 0) !== 0) return;
						const row = p?.data || {};
						const id = String(row.id ?? row.utm_campaign ?? '');
						if (!id) return;
						const currency = getAppCurrency();
						const oldN = parseCurrencyFlexible(p.oldValue, currency);
						const newN = parseCurrencyFlexible(p.newValue, currency);
						if (Number.isFinite(oldN) && Number.isFinite(newN) && oldN === newN) return;

						if (!Number.isFinite(newN) || newN < 0) {
							setCellSilently(p, 'budget', p.oldValue);
							markCellError(p.node, 'budget'); // 👈 erro: input inválido
							showToast('Budget inválido', 'danger');
							nudgeRenderer(p, 'budget');
							return;
						}

						setCellLoading(p.node, 'budget', true);
						p.api.refreshCells({ rowNodes: [p.node], columns: ['budget'] });

						const okTest = await toggleFeature('budget', { id, value: newN });
						if (!okTest) {
							setCellSilently(p, 'budget', p.oldValue);
							markCellError(p.node, 'budget'); // 👈 erro: pré-check falhou
							nudgeRenderer(p, 'budget'); // 👈 col certa

							p.api.refreshCells({ rowNodes: [p.node], columns: ['budget'] });
							return;
						}

						await updateCampaignBudgetBackend(id, newN);

						setCellSilently(p, 'budget', newN);
						clearCellError(p.node, 'budget'); // 👈 sucesso: limpa erro
						p.api.refreshCells({ rowNodes: [p.node], columns: ['budget'] });
						markCellJustSaved(p.node, 'budget');
						nudgeRenderer(p, 'budget');

						showToast('Budget atualizado', 'success');
					} catch (e) {
						setCellSilently(p, 'budget', p.oldValue);
						markCellError(p.node, 'budget'); // 👈 erro: exceção no backend
						nudgeRenderer(p, 'budget'); // 👈 col certa

						showToast(`Erro ao salvar Budget: ${e?.message || e}`, 'danger');
					} finally {
						setCellLoading(p.node, 'budget', false);
						p.api.refreshCells({ rowNodes: [p.node], columns: ['budget'] });
					}
				},
			},

			{
				headerName: 'Bid',
				field: 'bid',
				calcEligible: true,

				cellRenderer: EditableMoneyCellRenderer, // 👈 ADICIONE ISTO

				editable: (p) => p.node?.level === 0 && !isCellLoading(p, 'bid'),
				cellEditor: CurrencyMaskEditor, // 👈 trocado
				valueParser: parseCurrencyInput, // já usa parseCurrencyFlexible (ok com vírgula)
				valueFormatter: currencyFormatter,
				minWidth: 80,
				flex: 0.6,
				cellClassRules: {
					'ag-cell-loading': (p) => isCellLoading(p, 'bid'),
					'lion-cell-error': (p) => isCellError(p, 'bid'), // 👈 AQUI
				},
				onCellValueChanged: async (p) => {
					try {
						if (shouldSuppressCellChange(p, 'bid')) return;
						if ((p?.node?.level ?? 0) !== 0) return;
						const row = p?.data || {};
						const id = String(row.id ?? row.utm_campaign ?? '');
						if (!id) return;
						const currency = getAppCurrency();
						const oldN = parseCurrencyFlexible(p.oldValue, currency);
						const newN = parseCurrencyFlexible(p.newValue, currency);
						if (Number.isFinite(oldN) && Number.isFinite(newN) && oldN === newN) return;

						if (!Number.isFinite(newN) || newN < 0) {
							setCellSilently(p, 'bid', p.oldValue);
							markCellError(p.node, 'bid'); // 👈 erro: input inválido
							nudgeRenderer(p, 'bid'); // 👈 col certa

							showToast('Bid inválido', 'danger');
							return;
						}

						setCellLoading(p.node, 'bid', true);
						p.api.refreshCells({ rowNodes: [p.node], columns: ['bid'] });

						const okTest = await toggleFeature('bid', { id, value: newN });
						if (!okTest) {
							setCellSilently(p, 'bid', p.oldValue);
							markCellError(p.node, 'bid'); // 👈 erro: pré-check falhou
							nudgeRenderer(p, 'bid'); // 👈 col certa

							p.api.refreshCells({ rowNodes: [p.node], columns: ['bid'] });
							return;
						}

						await updateCampaignBidBackend(id, newN);

						setCellSilently(p, 'bid', newN);
						clearCellError(p.node, 'bid'); // 👈 sucesso: limpa erro
						p.api.refreshCells({ rowNodes: [p.node], columns: ['bid'] });
						markCellJustSaved(p.node, 'bid');
						nudgeRenderer(p, 'bid'); // 👈 col certa

						showToast('Bid atualizado', 'success');
					} catch (e) {
						setCellSilently(p, 'bid', p.oldValue);
						markCellError(p.node, 'bid'); // 👈 erro: exceção no backend
						nudgeRenderer(p, 'bid'); // 👈 col certa

						showToast(`Erro ao salvar Bid: ${e?.message || e}`, 'danger');
					} finally {
						setCellLoading(p.node, 'bid', false);
						p.api.refreshCells({ rowNodes: [p.node], columns: ['bid'] });
					}
				},
			},

			{
				headerName: 'Bid Type',
				field: 'bid_type',
				minWidth: 110,
				flex: 0.8,
				// filtro “legalzinho” (igual campaign_status, mas com os 2 valores do bid_type)
				filter: 'agTextColumnFilter',
				floatingFilter: true,
				floatingFilterComponent: BidTypeFloatingFilter,
				floatingFilterComponentParams: { suppressFilterButton: true },

				editable: (p) => p.node?.level === 0 && !isCellLoading(p, 'bid_type'),
				cellEditor: 'agSelectCellEditor',
				cellEditorParams: { values: BID_TYPE_VALUES },
				// 1) valueFormatter: só o rótulo, SEM seta
				valueFormatter: (p) => {
					const v = String(p.value || '').toUpperCase();
					return BID_TYPE_LABEL[v] || p.value || '';
				},

				// 2) cellRenderer: adiciona a setinha sempre visível
				cellRenderer: (p) => {
					const v = String(p.value || '').toUpperCase();
					const label = BID_TYPE_LABEL[v] || p.value || '';
					const el = document.createElement('span');
					el.textContent = label + ' ';
					const caret = document.createElement('span');
					caret.textContent = '▾';
					caret.style.opacity = '0.9';
					el.appendChild(caret);
					return el;
				},

				cellClassRules: {
					'ag-cell-loading': (p) => isCellLoading(p, 'bid_type'),
					'lion-cell-error': (p) => isCellError(p, 'bid_type'),
				},

				onCellValueChanged: async (p) => {
					try {
						if (shouldSuppressCellChange(p, 'bid_type')) return;
						if ((p?.node?.level ?? 0) !== 0) return;

						const row = p?.data || {};
						const id = String(row.id ?? row.utm_campaign ?? '');
						if (!id) return;

						const oldV = String(p.oldValue || '').toUpperCase();
						const newV = String(p.newValue || '').toUpperCase();
						if (oldV === newV) return;

						if (!BID_TYPE_VALUES.includes(newV)) {
							p.api.stopEditing(false); // encerra editor sem re-commit
							setCellValueNoEvent(p, 'bid_type', oldV); // rollback “mudo”
							markCellError(p.node, 'bid_type');
							showToast('Bid Type inválido', 'danger');
							return;
						}

						setCellLoading(p.node, 'bid_type', true);
						p.api.refreshCells({ rowNodes: [p.node], columns: ['bid_type'] });

						const okTest = await toggleFeature('bid_type', { id, value: newV });
						if (!okTest) {
							p.api.stopEditing(false); // garante que não há editor aberto
							setCellValueNoEvent(p, 'bid_type', oldV); // rollback sem novo evento
							markCellError(p.node, 'bid_type');
							return; // ✅ sem PUT após falha no teste
						}

						await updateCampaignBidTypeBackend(id, newV);

						p.api.stopEditing(false);
						setCellValueNoEvent(p, 'bid_type', newV); // aplica valor final sem reentrar
						clearCellError(p.node, 'bid_type');
						markCellJustSaved(p.node, 'bid_type');
						showToast('Bid Type atualizado', 'success');
					} catch (e) {
						p.api.stopEditing(false);
						setCellValueNoEvent(p, 'bid_type', p.oldValue);
						markCellError(p.node, 'bid_type');
						showToast(`Erro ao salvar Bid Type: ${e?.message || e}`, 'danger');
					} finally {
						setCellLoading(p.node, 'bid_type', false);
						if (p?.data) p.data.__suppress_bid_type = false; // limpa trava
						p.api.refreshCells({ rowNodes: [p.node], columns: ['bid_type'] });
					}
				},
			},

			{
				headerName: 'Ads',
				field: '_ads',
				minWidth: 70,
				maxWidth: 120,
				tooltipValueGetter: (p) => stripHtml(p.data?.xabu_ads),
				cellRenderer: chipFractionBadgeRenderer,
			},
			{
				headerName: 'Adsets',
				field: '_adsets',
				minWidth: 84,
				maxWidth: 130,
				tooltipValueGetter: (p) => stripHtml(p.data?.xabu_adsets),
				cellRenderer: chipFractionBadgeRenderer,
			},
		],
	},
	{
		headerName: 'Metrics & Revenue',
		groupId: 'grp-metrics-rev',
		marryChildren: true,
		openByDefault: true,
		children: [
			{
				headerName: 'Imp',
				field: 'impressions',
				valueFormatter: intFormatter,
				minWidth: 70,
				calcEligible: true,

				flex: 0.7,
			},
			{
				headerName: 'Clicks',
				field: 'clicks',
				valueFormatter: intFormatter,
				minWidth: 80,
				calcEligible: true,

				flex: 0.6,
			},
			{
				headerName: 'Visitors',
				field: 'visitors',
				valueFormatter: intFormatter,
				minWidth: 88,
				calcEligible: true,

				flex: 0.6,
			},
			{
				headerName: 'CPC',
				field: 'cpc',
				valueGetter: (p) => toNumberBR(p.data?.cpc),
				valueFormatter: currencyFormatter,
				minWidth: 70,
				calcEligible: true,

				flex: 0.6,
			},
			{
				headerName: 'Convs',
				field: 'conversions',
				valueFormatter: intFormatter,
				minWidth: 80,
				calcEligible: true,

				flex: 0.6,
			},
			{
				headerName: 'CPA FB',
				field: 'cpa_fb',
				valueGetter: (p) => toNumberBR(p.data?.cpa_fb),
				valueFormatter: currencyFormatter,
				minWidth: 70,
				calcEligible: true,

				flex: 0.6,
			},
			{
				headerName: 'Real Convs',
				field: 'real_conversions',
				valueGetter: (p) => toNumberBR(p.data?.real_conversions),
				valueFormatter: intFormatter,
				minWidth: 80,
				calcEligible: true,

				flex: 0.7,
			},
			{
				headerName: 'Real CPA',
				field: 'real_cpa',
				valueGetter: (p) => toNumberBR(p.data?.real_cpa),
				valueFormatter: currencyFormatter,
				minWidth: 80,
				calcEligible: true,

				flex: 0.6,
			},
			{
				headerName: 'Spend',
				field: 'spent',
				valueGetter: (p) => toNumberBR(p.data?.spent),
				valueFormatter: currencyFormatter,
				minWidth: 90,
				calcEligible: true,

				pinned: 'right',
				flex: 0.8,
			},
			{
				headerName: 'Facebook Revenue',
				field: 'fb_revenue',
				valueGetter: (p) => toNumberBR(p.data?.fb_revenue),
				valueFormatter: currencyFormatter,
				minWidth: 100,
				calcEligible: true,

				flex: 0.8,
			},
			{
				headerName: 'Push Revenue',
				field: 'push_revenue',
				valueGetter: (p) => toNumberBR(p.data?.push_revenue),
				valueFormatter: currencyFormatter,
				minWidth: 94,
				calcEligible: true,

				flex: 0.8,
			},
			{
				headerName: 'Revenue',
				field: 'revenue',
				valueGetter: (p) => stripHtml(p.data?.revenue),
				minWidth: 115,
				flex: 1.0,
				calcEligible: true,

				pinned: 'right',
				wrapText: true,
				cellRenderer: revenueCellRenderer,
				tooltipValueGetter: (p) => p.data?.revenue || '',
			},
			{
				headerName: 'MX',
				field: 'mx',
				minWidth: 80,
				calcEligible: true,

				pinned: 'right',
				valueGetter: (p) => stripHtml(p.data?.mx),
				flex: 0.7,
			},
			{
				headerName: 'Profit',
				field: 'profit',
				pinned: 'right',
				calcEligible: true,

				valueGetter: (p) => toNumberBR(p.data?.profit),
				valueFormatter: currencyFormatter,
				minWidth: 95,
				flex: 0.8,
			},
		],
	},
	{
		headerName: 'Adsets',
		groupId: 'grp-adsets',
		marryChildren: true,
		openByDefault: true,
		children: [
			{
				headerName: 'CTR',
				field: 'ctr',
				minWidth: 70,
				calcEligible: true,

				filter: 'agNumberColumnFilter',
				flex: 0.8,
			},
		],
	},
];

const tabela = new Tabela(columnDefs, {
	container: '#lionGrid', // seu container com tema já aplicado via classe do tema
	gridOptions: {
		// Aqui você passa apenas o que MUDA (endpoints, localeText, pagination, etc.)
		// Nada de rowData fixo — injete depois via API se quiser:
		// onGridReady extra? Pode passar (será chamado depois do interno).
	},
});

tabela.init();

// Se precisar trocar as colunas em runtime:
// tabela.setColumnDefs([{ headerName: 'Novo', field: 'novo' }]);
