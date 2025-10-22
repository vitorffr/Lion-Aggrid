/* public/js/lion-grid.js */
const ENDPOINTS = { SSRM: '/api/ssrm/?clean=1' };
const DRILL_ENDPOINTS = { ADSETS: '/api/adsets/', ADS: '/api/ads/' };
const DRILL = { period: 'TODAY' };

/* ========= Grid State (sessionStorage) ========= */
const GRID_STATE_KEY = 'lion.aggrid.state.v1';
const GRID_STATE_IGNORE_ON_RESTORE = [
	// evitamos bagunça com SSRM
	'pagination',
	'scroll',
	'rowSelection',
	'focusedCell',
	// (se quiser manter filtro/sort atuais em vez do salvo, adicione 'filter'/'sort' aqui)
];
// === Fake network & min spinner ===
const DEV_FAKE_NETWORK_LATENCY_MS = 0; // mude p/ 600..1200 para simular rede
const MIN_SPINNER_MS = 500; // spinner visível por pelo menos X ms

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withMinSpinner(startMs, minMs) {
	const elapsed = performance.now() - startMs;
	if (elapsed < minMs) await sleep(minMs - elapsed);
}

/* ====== CSS de loading (injeção automática) ====== */
(function ensureLoadingStyles() {
	if (document.getElementById('lion-loading-styles')) return;
	const css = `
/* célula em loading: esconde todo conteúdo e mostra só a bolinha */
.ag-cell.ag-cell-loading {
  position: relative;
  pointer-events: none;

  /* some com texto cru */
  color: transparent !important;
  text-shadow: none !important;
  caret-color: transparent !important;
}

/* esconde qualquer elemento interno (renderers, spans, etc.) */
.ag-cell.ag-cell-loading * {
  visibility: hidden !important;
}

	/* SPINNER: centralizado no meio da célula, acima da capa */
	.ag-cell.ag-cell-loading::after {
	content: "";
	position: absolute;
	left: 50%;
	top: 50%;
	width: 14px;
	height: 14px;
	margin-left: -7px; /* metade da largura */
	margin-top: -7px; /* metade da altura */
	border-radius: 50%;
	border: 2px solid #9ca3af;
	border-top-color: transparent;
	animation: lion-spin .8s linear infinite;
	z-index: 2;
	pointer-events: none; /* não interfere com drag/resize do grid */
	will-change: transform; /* evita micro jitter */
	}
/* ===== Dropdown (status) ===== */
.lion-status-menu {
  position: absolute;
  min-width: 160px;
  padding: 6px 0;
  background: #111;
  color: #eee;
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0,0,0,.35);
  z-index: 99999;
}
.lion-status-menu__item {
  padding: 8px 12px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}
.lion-status-menu__item:hover {
  background: rgba(255,255,255,.06);
}
.lion-status-menu__item.is-active::before {
  content: "●";
  font-size: 10px;
  line-height: 1;
}

	@keyframes lion-spin { to { transform: rotate(360deg); } }
`;
	const el = document.createElement('style');
	el.id = 'lion-loading-styles';
	el.textContent = css;
	document.head.appendChild(el);
})();

/* ==== Toolbar actions (state/layout + presets built-in & custom) ==== */
(function setupToolbar() {
	const byId = (id) => document.getElementById(id);

	function ensureApi() {
		const api = globalThis.LionGrid?.api;
		if (!api) {
			console.warn('Grid API ainda não disponível');
			return null;
		}
		return api;
	}

	/* ========== chaves de storage ========== */
	const SS_KEY_STATE = GRID_STATE_KEY || 'lion.aggrid.state.v1'; // já vem do topo do arquivo
	const LS_KEY_PRESETS = 'lion.aggrid.presets.v1';
	const LS_KEY_ACTIVE_PRESET = 'lion.aggrid.activePreset.v1';
	const PRESET_VERSION = 1;

	/* ========== helpers básicos get/set state ========== */
	function getState() {
		const api = ensureApi();
		if (!api) return null;
		try {
			return api.getState();
		} catch {
			return null;
		}
	}
	function setState(state, ignore = []) {
		const api = ensureApi();
		if (!api) return;
		try {
			api.setState(state, ignore || []);
		} catch (e) {
			console.warn('setState fail', e);
		}
	}

	/* ========== sessionStorage (state atual) ========== */

	function resetLayout() {
		const api = ensureApi();
		if (!api) return;
		try {
			sessionStorage.removeItem(SS_KEY_STATE);
			localStorage.removeItem(LS_KEY_ACTIVE_PRESET); // 👈 Limpa preset ativo

			api.setState({}, []);
			api.resetColumnState?.();
			api.setFilterModel?.(null);
			api.setSortModel?.([]);

			refreshPresetUserSelect(); // 👈 Atualiza o dropdown
			showToast('Layout Reset', 'info');
		} catch (e) {
			console.warn('resetLayout fail', e);
		}
	}
	/* ========== “Meus presets” (localStorage) ========== */
	function readPresets() {
		try {
			return JSON.parse(localStorage.getItem(LS_KEY_PRESETS) || '{}');
		} catch {
			return {};
		}
	}
	function writePresets(obj) {
		localStorage.setItem(LS_KEY_PRESETS, JSON.stringify(obj));
	}
	function listPresetNames() {
		return Object.keys(readPresets()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
	}
	function refreshPresetUserSelect() {
		const sel = byId('presetUserSelect');
		if (!sel) return;

		// Lê o preset ativo salvo
		const activePreset = localStorage.getItem(LS_KEY_ACTIVE_PRESET) || '';

		// Limpa e reconstroi as options
		while (sel.firstChild) sel.removeChild(sel.firstChild);

		// Placeholder com nome do preset ativo ou texto padrão
		const placeholderText = 'User Presets';
		sel.appendChild(new Option(placeholderText, ''));

		// Adiciona todos os presets
		listPresetNames().forEach((name) => sel.appendChild(new Option(name, name)));

		// Se há preset ativo válido, seleciona ele
		if (activePreset && [...sel.options].some((o) => o.value === activePreset)) {
			sel.value = activePreset;
		}
	}

	function saveAsPreset() {
		const api = ensureApi();
		if (!api) return;
		const name = prompt('Preset name:');
		if (!name) return;
		let state;
		try {
			state = api.getState();
		} catch {}
		if (!state) return showToast("Couldn't capture grid state", 'danger');

		const bag = readPresets();
		bag[name] = { v: PRESET_VERSION, name, createdAt: Date.now(), grid: state };
		writePresets(bag);
		refreshPresetUserSelect();
		const sel = byId('presetUserSelect');
		if (sel) sel.value = name;
		showToast(`Preset "${name}" saved`, 'success');
	}

	function applyPresetUser(name) {
		if (!name) return;
		const bag = readPresets();
		const p = bag[name];
		if (!p?.grid) return showToast('Preset not found', 'warning');

		setState(p.grid, ['pagination', 'scroll', 'rowSelection', 'focusedCell']);

		// 👈 Salva o preset ativo
		localStorage.setItem(LS_KEY_ACTIVE_PRESET, name);

		// Atualiza o placeholder do dropdown
		refreshPresetUserSelect();

		showToast(`Preset "${name}" applied`, 'success');
	}

	function deletePreset() {
		const sel = byId('presetUserSelect');
		const name = sel?.value || '';
		if (!name) return showToast('Pick a preset first', 'warning');
		if (!confirm(`Delete preset "${name}"?`)) return;

		const bag = readPresets();
		delete bag[name];
		writePresets(bag);

		// 👈 Se estava ativo, limpa
		const activePreset = localStorage.getItem(LS_KEY_ACTIVE_PRESET);
		if (activePreset === name) {
			localStorage.removeItem(LS_KEY_ACTIVE_PRESET);
		}

		refreshPresetUserSelect();
		showToast(`Preset "${name}" removed`, 'info');
	}

	/* ========== Download/Upload de preset (arquivo .json) ========== */
	function downloadPreset() {
		const sel = byId('presetUserSelect');
		const name = sel?.value || '';
		if (!name) return showToast('Pick a preset first', 'warning');
		const bag = readPresets();
		const p = bag[name];
		if (!p) return showToast('Preset not found', 'warning');

		const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `lion-preset-${name}.json`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
		showToast(`Preset "${name}" downloaded`, 'success');
	}

	function uploadPreset() {
		const input = byId('presetFileInput'); // precisa existir no HTML
		if (!input) return;
		input.value = '';
		input.click();
	}
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

	/* ===== Toggle: modo de ajuste de colunas ===== */
	const LS_KEY_SIZE_MODE = 'lion.aggrid.sizeMode'; // 'auto' | 'fit'

	// aplica o modo atual imediatamente
	function applySizeMode(mode) {
		const api = (globalThis.LionGrid || {}).api;
		if (!api) return;
		try {
			if (mode === 'auto') {
				// AutoSize todas as colunas, sem incluir headers
				const all = api.getColumns()?.map((c) => c.getColId()) || [];
				api.autoSizeColumns(all, false);
			} else {
				// SizeToFit distribui para caber no viewport
				api.sizeColumnsToFit();
			}
		} catch {}
	}

	// lê/salva preferência
	function getSizeMode() {
		const v = localStorage.getItem(LS_KEY_SIZE_MODE);
		return v === 'auto' ? 'auto' : 'fit';
	}
	function setSizeMode(mode) {
		localStorage.setItem(LS_KEY_SIZE_MODE, mode);
	}

	// inicializa o toggle de UI (ligado = auto; desligado = fit)
	(function initSizeModeToggle() {
		const el = byId('colSizeModeToggle');
		if (!el) return;
		// estado inicial a partir de localStorage
		const mode = getSizeMode();
		el.checked = mode === 'auto';

		// aplica imediatamente ao montar (opcional)
		applySizeMode(mode);

		// quando o usuário troca, aplica e salva
		el.addEventListener('change', () => {
			const next = el.checked ? 'auto' : 'fit';
			setSizeMode(next);
			applySizeMode(next);
			showToast(next === 'auto' ? 'Mode: Auto Size' : 'Mode: Size To Fit', 'info');
		});

		// reaplica em resize de janela
		window.addEventListener('resize', () => {
			const cur = getSizeMode();
			applySizeMode(cur);
		});
	})();

	/* ========== binds (botões/menus são opcionais) ========== */
	byId('btnResetLayout')?.addEventListener('click', resetLayout);

	// meus presets
	byId('presetUserSelect')?.addEventListener('change', (e) => {
		const v = e.target.value;
		if (!v) return;
		applyPresetUser(v);
	});
	byId('btnSaveAsPreset')?.addEventListener('click', saveAsPreset);
	byId('btnDeletePreset')?.addEventListener('click', deletePreset);
	byId('btnDownloadPreset')?.addEventListener('click', downloadPreset);
	byId('btnUploadPreset')?.addEventListener('click', uploadPreset);

	// popula a combo de "Meus presets" se existir no HTML
	refreshPresetUserSelect();
	//  Auto-aplica preset ativo quando a grid estiver pronta
	globalThis.addEventListener('lionGridReady', () => {
		const activePreset = localStorage.getItem(LS_KEY_ACTIVE_PRESET);
		if (activePreset) {
			// Aplica silenciosamente (sem toast)
			const bag = readPresets();
			const p = bag[activePreset];
			if (p?.grid) {
				setState(p.grid, ['pagination', 'scroll', 'rowSelection', 'focusedCell']);
				console.log(`[Preset] Auto-aplicado: "${activePreset}"`);
			}
		}
	});

	/* ========== expõe alguns helpers p/ debug no console ========== */
	globalThis.LionGrid = Object.assign(globalThis.LionGrid || {}, {
		getState,
		setState,
		resetLayout,
		saveAsPreset,
		applyPresetUser,
	});
})();

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
		api.setState(saved, GRID_STATE_IGNORE_ON_RESTORE);
		return true;
	} catch (e) {
		console.warn('[GridState] restore failed:', e);
		return false;
	}
}

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

/* ============ Helpers/formatters ============ */
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

const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const intFmt = new Intl.NumberFormat('pt-BR');

const currencyFormatter = (p) => {
	const n = toNumberBR(p.value);
	return n == null ? p.value ?? '' : brlFmt.format(n);
};

const intFormatter = (p) => {
	const n = toNumberBR(p.value);
	return n == null ? p.value ?? '' : intFmt.format(Math.round(n));
};

// fallback (hex) – independente de Tailwind
const FALLBACK_STYLE = {
	success: { bg: '#22c55e', fg: '#ffffff' }, // green-500
	primary: { bg: '#3b82f6', fg: '#ffffff' }, // blue-500
	danger: { bg: '#dc2626', fg: '#ffffff' }, // red-600
	warning: { bg: '#eab308', fg: '#111111' }, // yellow-500
	info: { bg: '#06b6d4', fg: '#ffffff' }, // cyan-500
	secondary: { bg: '#334155', fg: '#ffffff' }, // gray-500
	light: { bg: '#e5e7eb', fg: '#111111' }, // gray-200
	dark: { bg: '#1f2937', fg: '#ffffff' }, // gray-800
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

function statusPillRenderer(p) {
	const raw = p.value ?? '';
	if (isPinnedOrTotal(p) || !raw) {
		const span = document.createElement('span');
		span.textContent = stripHtml(raw) || '';
		return span;
	}
	const label = (strongText(raw) || stripHtml(raw) || '').toUpperCase();
	const color = pickStatusColor(label);
	const host = document.createElement('span');
	host.innerHTML = renderBadge(label, color);
	return host.firstElementChild;
}

function pickChipColorFromFraction(value) {
	const txt = stripHtml(value ?? '').trim();
	const m = txt.match(/^(\d+)\s*\/\s*(\d+)$/);
	if (!m) return { label: txt || '—', color: 'secondary' };
	const current = Number(m[1]);
	const total = Number(m[2]);
	if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
		return { label: `${current}/${total}`, color: 'secondary' };
	}
	if (current <= 1) return { label: `${current}/${total}`, color: 'success' }; // 0%
	const ratio = current / total;
	if (ratio > 0.5) return { label: `${current}/${total}`, color: 'danger' }; // >50%
	return { label: `${current}/${total}`, color: 'warning' }; // (0,50%]
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

	// garante spinner mínimo mesmo se o back for rápido
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

// helper mínimo para GET/POST JSON (fetch de dados SSRM/DRILL)
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

/* ======= Utils de status e de loading ======= */
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
// flags por célula para spinner
function setCellLoading(node, colId, on) {
	if (!node?.data) return;
	node.data.__loading = node.data.__loading || {};
	node.data.__loading[colId] = !!on;
}
function isCellLoading(p, colId) {
	return !!p?.data?.__loading?.[colId];
}

/* ============ Modal simples (KTUI-like) ============ */
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

/* ============ Colunas ============ */
const defaultColDef = {
	sortable: true,
	filter: true, // continua habilitando o filtro
	floatingFilter: true,
	resizable: true,
	cellClass: ['lion-center-cell'], // 👈 NOVO
	// unSortIcon: true,
	wrapHeaderText: true,
	autoHeaderHeight: true,
	enableRowGroup: true,
	enablePivot: true,
	enableValue: true,
	suppressHeaderFilterButton: true, // 👈 esconde o funil no header
};
function parseCurrencyInput(params) {
	return toNumberBR(params.newValue);
}
function isPinnedOrGroup(params) {
	return params?.node?.rowPinned || params?.node?.group;
}

function profileCellRenderer(params) {
	const raw = String(params?.value ?? '').trim();
	if (!raw) return '';
	const idx = raw.lastIndexOf(' - ');
	const name = idx > -1 ? raw.slice(0, idx).trim() : raw;
	const meta = idx > -1 ? raw.slice(idx + 3).trim() : '';

	const wrap = document.createElement('span');
	wrap.style.display = 'inline-flex';
	wrap.style.flexDirection = 'column'; // 👈 empilha
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

/* Revenue renderer (total + partes) */
const REVENUE_LABELS = ['A', 'B'];
function parseRevenue(raw) {
	const txt = stripHtml(raw ?? '').trim();
	const m = txt.match(/^(.*?)\s*\(\s*(.*?)\s*\|\s*(.*?)\s*\)\s*$/);
	if (!m) return { total: txt, parts: [] };
	return { total: m[1].trim(), parts: [m[2].trim(), m[3].trim()] };
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

	// linha 1: total
	const totalEl = document.createElement('span');
	totalEl.textContent = total || '';
	wrap.appendChild(totalEl);

	// linhas 2 e 3: (A: ...) e (B: ...)
	if (parts.length === 2) {
		const aEl = document.createElement('span');
		aEl.textContent = `(${REVENUE_LABELS[0] || 'A'}: ${parts[0]})`;
		aEl.style.fontSize = '11px';
		aEl.style.opacity = '0.75';

		const bEl = document.createElement('span');
		bEl.textContent = `(${REVENUE_LABELS[1] || 'B'}: ${parts[1]})`;
		bEl.style.fontSize = '11px';
		bEl.style.opacity = '0.75';

		wrap.appendChild(aEl);
		wrap.appendChild(bEl);
	}

	return wrap;
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
		// SUCESSO
		showToast(data.message || 'Aplicado', 'success');
		return true;
	}

	// FALHA “negocial” (200 com ok:false) ou HTTP 4xx/5xx
	const msg = data?.error || `Erro (${res.status})`;
	showToast(msg, 'danger');
	return false;
}

/* ======= Campaign Status Renderer (otimizado) ======= */
function StatusSliderRenderer() {}

/* Menu flutuante singleton p/ todas as células */
const LionStatusMenu = (() => {
	let el = null,
		onPick = null;

	function ensure() {
		if (el) return el;
		el = document.createElement('div');
		el.className = 'lion-status-menu';
		el.style.position = 'absolute';
		el.style.minWidth = '160px';
		el.style.padding = '6px 0';
		el.style.display = 'none';
		document.body.appendChild(el);
		return el;
	}
	function close() {
		if (!el) return;
		el.style.display = 'none';
		onPick = null;
		document.removeEventListener('mousedown', onDocClose, true);
		window.removeEventListener('blur', close, true);
	}
	function onDocClose(ev) {
		if (!el) return;
		if (ev.target === el || el.contains(ev.target)) return;
		close();
	}
	function open({ left, top, width, current, pick }) {
		const host = ensure();
		host.innerHTML = '';
		onPick = pick;

		['ACTIVE', 'PAUSED'].forEach((st) => {
			const item = document.createElement('div');
			item.className = 'lion-status-menu__item' + (current === st ? ' is-active' : '');
			item.textContent = st;
			item.addEventListener('mousedown', (e) => e.preventDefault());
			item.addEventListener('click', (e) => {
				e.preventDefault();
				if (onPick) onPick(st);
				close();
			});
			host.appendChild(item);
		});

		// centraliza sob o pill
		const menuW = 180;
		host.style.left = `${Math.max(8, left + (width - menuW) / 2)}px`;
		host.style.top = `${top + 6}px`;
		host.style.display = 'block';

		setTimeout(() => {
			document.addEventListener('mousedown', onDocClose, true);
			window.addEventListener('blur', close, true);
		}, 0);
	}
	return { open, close };
})();

StatusSliderRenderer.prototype.init = function (p) {
	this.p = p;

	const cfg = p.colDef?.cellRendererParams || {};
	const interactive = new Set(Array.isArray(cfg.interactiveLevels) ? cfg.interactiveLevels : [0]);
	const smallKnob = !!cfg.smallKnob;
	const level = p?.node?.level ?? 0; // 0 = campaign, 1 = adset, 2 = ad
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

	const computeTrackLen = () => Math.max(0, root.clientWidth - root.clientHeight);
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

	// ==== NOVO commit: passa pela rota de teste antes de aplicar ====
	const commit = async (nextOrString, prevOn) => {
		const nextVal =
			typeof nextOrString === 'string'
				? nextOrString.toUpperCase()
				: nextOrString
				? 'ACTIVE'
				: 'PAUSED';

		const id =
			(p.node?.level === 0
				? String(p.data?.id ?? p.data?.utm_campaign ?? '')
				: String(p.data?.id ?? '')) || '';
		if (!id) return;

		const scope = (p.node?.level ?? 0) === 1 ? 'adset' : 'campaign';

		setCellBusy(true);
		try {
			// 1) TESTE
			const okTest = await toggleFeature('status', { scope, id, value: nextVal });
			if (!okTest) {
				// erro no teste => ROLLBACK VISUAL E NO DADO
				const rollbackVal = prevOn ? 'ACTIVE' : 'PAUSED';
				if (p.data) {
					if ('campaign_status' in p.data) p.data.campaign_status = rollbackVal;
					if ('status' in p.data) p.data.status = rollbackVal;
				}
				setProgress(prevOn ? 1 : 0);
				p.api.refreshCells({ rowNodes: [p.node], columns: [colId] });
				return;
			}

			// 2) aplica otimista
			if (p.data) {
				if ('campaign_status' in p.data) p.data.campaign_status = nextVal;
				if ('status' in p.data) p.data.status = nextVal;
			}
			setProgress(nextVal === 'ACTIVE' ? 1 : 0);
			p.api.refreshCells({ rowNodes: [p.node], columns: [colId] });

			// 3) backend real
			try {
				if ((p.node?.level ?? 0) === 1) {
					await updateAdsetStatusBackend(id, nextVal);
				} else {
					await updateCampaignStatusBackend(id, nextVal);
				}
				if (this._userInteracted) {
					const scopeLabel = scope === 'adset' ? 'Adset' : 'Campanha';
					const msg = nextVal === 'ACTIVE' ? `${scopeLabel} ativado` : `${scopeLabel} pausado`;
					showToast(msg, 'success');
				}
			} catch (e) {
				// rollback se o backend real falhar
				const rollbackVal = prevOn ? 'ACTIVE' : 'PAUSED';
				if (p.data) {
					if ('campaign_status' in p.data) p.data.campaign_status = rollbackVal;
					if ('status' in p.data) p.data.status = rollbackVal;
				}
				setProgress(prevOn ? 1 : 0);
				p.api.refreshCells({ rowNodes: [p.node], columns: [colId] });
				showToast(`Falha ao salvar status: ${e?.message || e}`, 'danger');
			}
		} finally {
			setCellBusy(false);
		}
	};
	// ==== fim commit ====

	const MOVE_THRESHOLD = 6;
	let dragging = false,
		startX = 0,
		startOn = false,
		moved = false;

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
			openMenu();
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

	root.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
	});
	root.addEventListener('keydown', (e) => {
		if (e.code === 'Space' || e.code === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			openMenu();
		}
	});

	const openMenu = () => {
		if (isCellLoading({ data: p.node?.data }, colId)) return;
		const cur = getVal();
		const rect = root.getBoundingClientRect();
		LionStatusMenu.open({
			left: rect.left,
			top: rect.bottom,
			width: rect.width,
			current: cur,
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

	const trackLenPx = Math.max(0, this.eGui.clientWidth - this.eGui.clientHeight);
	requestAnimationFrame(() => {
		fill.style.width = (isOn ? 100 : 0) + '%';
		knob.style.transform = `translateX(${(isOn ? 1 : 0) * trackLenPx}px)`;
		label.textContent = isOn ? 'ACTIVE' : 'PAUSED';
		this.eGui.setAttribute('aria-checked', String(isOn));
	});

	LionStatusMenu.close(); // fecha menu se estava aberto para outra célula
	return true;
};

StatusSliderRenderer.prototype.destroy = function () {
	this._cleanup?.();
};

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
	// ====== Grupo 1: Identificação ======
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
				minWidth: 100,
				flex: 1.0,
				autoHeight: true,
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
				autoHeight: true,

				flex: 1.3,
				wrapText: true,
				cellStyle: (p) =>
					p?.node?.level === 0 ? { fontSize: '13px', lineHeight: '1.6' } : null,
				tooltipValueGetter: (p) => p.value || '',
			},
			// {
			// 	headerName: 'UTM',
			// 	field: 'utm_campaign',
			// 	minWidth: 180,
			// 	cellStyle: (p) =>
			// 		p?.node?.level === 0 ? { fontSize: '13px', lineHeight: '1.6' } : null,
			// 	flex: 0.9,
			// 	tooltipValueGetter: (p) => p.value || '',
			// },
		],
	},

	// ====== Grupo 2: Operação & Setup ======
	{
		headerName: 'Operation & Setup',
		groupId: 'grp-op',
		marryChildren: true,
		openByDefault: true,
		children: [
			{
				headerName: 'Account Status',
				field: 'account_status',
				minWidth: 95,
				flex: 0.7,
				cellRenderer: statusPillRenderer,
			},
			{
				headerName: 'Daily Limit',
				field: 'account_limit',
				valueGetter: (p) => toNumberBR(p.data?.account_limit),
				valueFormatter: currencyFormatter,
				minWidth: 80,
				flex: 0.8,
			},
			{
				headerName: 'Campaign Status',
				field: 'campaign_status',
				cellClass: ['lion-center-cell'], // 👈 NOVO

				minWidth: 105,
				flex: 0.8,
				cellRenderer: StatusSliderRenderer,
				cellRendererParams: {
					interactiveLevels: [0, 1, 2],
					smallKnob: true,
				},
				suppressKeyboardEvent: () => true,
				// 👇 faz a célula usar a capa + spinner quando flagged
				cellClassRules: {
					'ag-cell-loading': (p) => isCellLoading(p, 'campaign_status'),
				},
			},

			{
				headerName: 'Budget',
				field: 'budget',
				editable: (p) => p.node?.level === 0 && !isCellLoading(p, 'budget'),
				cellEditor: 'agNumberCellEditor',
				valueParser: parseCurrencyInput,
				valueFormatter: currencyFormatter,
				minWidth: 90,
				flex: 0.6,
				cellClassRules: {
					'ag-cell-loading': (p) => isCellLoading(p, 'budget'),
				},
				onCellValueChanged: async (p) => {
					try {
						if ((p?.node?.level ?? 0) !== 0) return;
						const row = p?.data || {};
						const id = String(row.id ?? row.utm_campaign ?? '');
						if (!id) return;

						const n = toNumberBR(p.newValue);
						if (!Number.isFinite(n) || n < 0) {
							p.node.setDataValue('budget', p.oldValue);
							showToast('Budget inválido', 'danger');
							return;
						}

						// loading ON
						setCellLoading(p.node, 'budget', true);
						p.api.refreshCells({ rowNodes: [p.node], columns: ['budget'] });

						// 1) TESTE
						const okTest = await toggleFeature('budget', { id, value: n });
						if (!okTest) {
							// falha no teste => NÃO aplica alteração
							p.node.setDataValue('budget', p.oldValue);
							p.api.refreshCells({ rowNodes: [p.node], columns: ['budget'] });
							return;
						}

						// 2) backend real
						await updateCampaignBudgetBackend(id, n);

						// aplica valor final + refresh
						p.node.setDataValue('budget', n);
						p.api.refreshCells({ rowNodes: [p.node], columns: ['budget'] });
						showToast('Budget atualizado', 'success');
					} catch (e) {
						p.node.setDataValue('budget', p.oldValue);
						showToast(`Erro ao salvar Budget: ${e?.message || e}`, 'danger');
					} finally {
						// loading OFF
						setCellLoading(p.node, 'budget', false);
						p.api.refreshCells({ rowNodes: [p.node], columns: ['budget'] });
					}
				},
			},
			{
				headerName: 'Bid',
				field: 'bid',
				editable: (p) => p.node?.level === 0 && !isCellLoading(p, 'bid'),
				cellEditor: 'agNumberCellEditor',
				valueParser: parseCurrencyInput,
				valueFormatter: currencyFormatter,
				minWidth: 70,
				flex: 0.6,
				cellClassRules: {
					'ag-cell-loading': (p) => isCellLoading(p, 'bid'),
				},
				onCellValueChanged: async (p) => {
					try {
						if ((p?.node?.level ?? 0) !== 0) return;
						const row = p?.data || {};
						const id = String(row.id ?? row.utm_campaign ?? '');
						if (!id) return;

						const n = toNumberBR(p.newValue);
						if (!Number.isFinite(n) || n < 0) {
							p.node.setDataValue('bid', p.oldValue);
							showToast('Bid inválido', 'danger');
							return;
						}

						// loading ON
						setCellLoading(p.node, 'bid', true);
						p.api.refreshCells({ rowNodes: [p.node], columns: ['bid'] });

						// 1) TESTE
						const okTest = await toggleFeature('bid', { id, value: n });
						if (!okTest) {
							// falha no teste => NÃO aplica alteração
							p.node.setDataValue('bid', p.oldValue);
							p.api.refreshCells({ rowNodes: [p.node], columns: ['bid'] });
							return;
						}

						// 2) backend real
						await updateCampaignBidBackend(id, n);

						p.node.setDataValue('bid', n);
						p.api.refreshCells({ rowNodes: [p.node], columns: ['bid'] });
						showToast('Bid atualizado', 'success');
					} catch (e) {
						p.node.setDataValue('bid', p.oldValue);
						showToast(`Erro ao salvar Bid: ${e?.message || e}`, 'danger');
					} finally {
						// loading OFF
						setCellLoading(p.node, 'bid', false);
						p.api.refreshCells({ rowNodes: [p.node], columns: ['bid'] });
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

	// ====== Grupo 3: Métricas & Receita ======
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
				flex: 0.7,
			},
			{
				headerName: 'Clicks',
				field: 'clicks',
				valueFormatter: intFormatter,
				minWidth: 80,
				flex: 0.6,
			},
			{
				headerName: 'Visitors',
				field: 'visitors',
				valueFormatter: intFormatter,
				minWidth: 88,
				flex: 0.6,
			},
			{
				headerName: 'CPC',
				field: 'cpc',
				valueGetter: (p) => toNumberBR(p.data?.cpc),
				valueFormatter: currencyFormatter,
				minWidth: 70,
				flex: 0.6,
			},
			{
				headerName: 'Convs',
				field: 'conversions',
				valueFormatter: intFormatter,
				minWidth: 80,
				flex: 0.6,
			},
			{
				headerName: 'CPA FB',
				field: 'cpa_fb',
				valueGetter: (p) => toNumberBR(p.data?.cpa_fb),
				valueFormatter: currencyFormatter,
				minWidth: 70,
				flex: 0.6,
			},
			{
				headerName: 'Real Convs',
				field: 'real_conversions',
				valueGetter: (p) => toNumberBR(p.data?.real_conversions),
				valueFormatter: intFormatter,
				minWidth: 80,
				flex: 0.7,
			},
			{
				headerName: 'Real CPA',
				field: 'real_cpa',
				valueGetter: (p) => toNumberBR(p.data?.real_cpa),
				valueFormatter: currencyFormatter,
				minWidth: 80,
				flex: 0.6,
			},
			{
				headerName: 'Spend',
				field: 'spent',
				valueGetter: (p) => toNumberBR(p.data?.spent),
				valueFormatter: currencyFormatter,
				minWidth: 85,
				flex: 0.8,
			},
			{
				headerName: 'Facebook Revenue',
				field: 'fb_revenue',
				valueGetter: (p) => toNumberBR(p.data?.fb_revenue),
				valueFormatter: currencyFormatter,
				minWidth: 100,
				flex: 0.8,
			},
			{
				headerName: 'Push Revenue',
				field: 'push_revenue',
				pinned: 'right',

				valueGetter: (p) => toNumberBR(p.data?.push_revenue),
				valueFormatter: currencyFormatter,
				minWidth: 94,
				flex: 0.8,
			},
			{
				headerName: 'Revenue',
				field: 'revenue',
				valueGetter: (p) => stripHtml(p.data?.revenue),
				minWidth: 115,
				flex: 1.0,
				pinned: 'right',
				wrapText: true,
				autoHeight: false,
				cellRenderer: revenueCellRenderer,
				tooltipValueGetter: (p) => p.data?.revenue || '',
			},
			{
				headerName: 'MX',
				field: 'mx',
				minWidth: 80,
				pinned: 'right',

				valueGetter: (p) => stripHtml(p.data?.mx),
				flex: 0.7,
			},
			{
				headerName: 'Profit',
				field: 'profit',
				pinned: 'right',

				valueGetter: (p) => toNumberBR(p.data?.profit),
				valueFormatter: currencyFormatter,
				minWidth: 80,
				flex: 0.8,
			},
		],
	},
];

/* ============ Normalizadores tree ============ */
function normalizeCampaignRow(r) {
	return {
		__nodeType: 'campaign',
		__groupKey: String(r.utm_campaign || r.id || ''),
		__label: stripHtml(r.campaign_name || '(sem nome)'),
		...r,
	};
}
function normalizeAdsetRow(r) {
	return {
		__nodeType: 'adset',
		__groupKey: String(r.id || ''),
		__label: stripHtml(r.name || '(adset)'),
		...r,
	};
}
function normalizeAdRow(r) {
	return { __nodeType: 'ad', __label: stripHtml(r.name || '(ad)'), ...r };
}

/* ============ Grid (Tree Data + SSRM) ============ */
function makeGrid() {
	const AG = getAgGrid();
	const gridDiv = document.getElementById('lionGrid');
	if (!gridDiv) {
		console.error('[LionGrid] #lionGrid não encontrado');
		return null;
	}
	gridDiv.classList.add('ag-theme-quartz');

	const autoGroupColumnDef = {
		headerName: 'Campaign',
		sortable: false,
		wrapText: true,
		autoHeight: false,
		minWidth: 270,
		pinned: 'left',
		cellStyle: (p) => (p?.node?.level === 0 ? { fontSize: '12px', lineHeight: '1.6' } : null),
		cellRendererParams: { suppressCount: true, innerRenderer: (p) => p.data?.__label || '' },
	};

	const gridOptions = {
		floatingFiltersHeight: 35,
		groupHeaderHeight: 35,
		headerHeight: 62,
		context: { showToast: (msg, type) => Toastify({ text: msg }).showToast() },
		rowModelType: 'serverSide',
		cacheBlockSize: 200,
		maxBlocksInCache: 4,
		treeData: true,
		isServerSideGroup: (data) => data?.__nodeType === 'campaign' || data?.__nodeType === 'adset',
		getServerSideGroupKey: (data) => data?.__groupKey ?? '',
		getRowId: (p) => {
			if (p.data?.__nodeType === 'campaign') return `c:${p.data.__groupKey}`;
			if (p.data?.__nodeType === 'adset') return `s:${p.data.__groupKey}`;
			if (p.data?.__nodeType === 'ad')
				return `a:${p.data.id || p.data.story_id || p.data.__label}`;
			return Math.random().toString(36).slice(2);
		},

		columnDefs: [].concat(columnDefs),
		autoGroupColumnDef,
		defaultColDef,
		rowSelection: {
			mode: 'multiRow',
			checkboxes: true,
			headerCheckbox: true,
			selectionColumn: { width: 80, pinned: 'left', suppressHeaderFilterButton: true },
		},
		rowHeight: 60,
		animateRows: true,
		sideBar: { toolPanels: ['columns', 'filters'], defaultToolPanel: null, position: 'right' },
		theme: createAgTheme(),

		// Obs.: o toggle de status é feito no próprio renderer (drag-only) com backend otimista.

		onCellClicked(params) {
			if (params?.node?.level > 0) return;

			const isAutoGroupCol =
				(typeof params.column?.isAutoRowGroupColumn === 'function' &&
					params.column.isAutoRowGroupColumn()) ||
				params.colDef?.colId === 'ag-Grid-AutoColumn' ||
				!!params.colDef?.showRowGroup;
			const clickedExpanderOrCheckbox = !!params.event?.target?.closest?.(
				'.ag-group-expanded, .ag-group-contracted, .ag-group-checkbox'
			);

			if (
				isAutoGroupCol &&
				!clickedExpanderOrCheckbox &&
				params?.data?.__nodeType === 'campaign'
			) {
				const label = params.data.__label || '(sem nome)';
				showKTModal({ title: 'Campaign', content: label });
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

			const vfmt = params.valueFormatted;
			let display;
			if (vfmt != null && vfmt !== '') display = String(vfmt);
			else {
				const val = params.value;
				if (typeof val === 'string') display = stripHtml(val);
				else if (val == null) display = '';
				else if (
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
					display = n == null ? '' : brlFmt.format(n);
				} else if (
					['impressions', 'clicks', 'visitors', 'conversions', 'real_conversions'].includes(
						field
					)
				) {
					const n = Number(val);
					display = Number.isFinite(n) ? intFmt.format(n) : String(val);
				} else if (field === 'account_status' || field === 'campaign_status') {
					display = strongText(String(val || ''));
				} else display = String(val);
			}
			const title = params.colDef?.headerName || 'Detalhes';
			showKTModal({ title, content: display || '(vazio)' });
		},

		onGridReady(params) {
			applySavedStateIfAny(params.api);

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

						// Nível 0 => campanhas
						if (groupKeys.length === 0) {
							let res = await fetch(ENDPOINTS.SSRM, {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ startRow, endRow, sortModel, filterModel }),
								credentials: 'same-origin',
							});
							if (!res.ok) {
								const qs = new URLSearchParams({
									startRow: String(startRow),
									endRow: String(endRow),
									sortModel: JSON.stringify(sortModel || []),
									filterModel: JSON.stringify(filterModel || {}),
								});
								res = await fetch(`${ENDPOINTS.SSRM}&${qs.toString()}`, {
									credentials: 'same-origin',
								});
							}
							const data = await res.json().catch(() => ({ rows: [], lastRow: 0 }));
							const totals = data?.totals || {};
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
							])
								pinnedTotal[k] = brlFmt.format(Number(pinnedTotal[k]) || 0);
							for (const k of [
								'impressions',
								'clicks',
								'visitors',
								'conversions',
								'real_conversions',
							])
								pinnedTotal[k] = intFmt.format(Number(pinnedTotal[k]) || 0);
							if (typeof pinnedTotal.ctr === 'number')
								pinnedTotal.ctr = (pinnedTotal.ctr * 100).toFixed(2) + '%';

							const rows = (data.rows || []).map(normalizeCampaignRow);
							try {
								const api = params.api;
								if (api?.setPinnedBottomRowData)
									api.setPinnedBottomRowData([pinnedTotal]);
								else params.api?.setGridOption?.('pinnedBottomRowData', [pinnedTotal]);
							} catch (e) {
								console.warn('Erro ao aplicar pinned bottom row:', e);
							}

							req.success({ rowData: rows, rowCount: data.lastRow ?? -1 });
							return;
						}

						// Nível 1 => adsets
						if (groupKeys.length === 1) {
							const campaignId = groupKeys[0];
							const qs = new URLSearchParams({
								campaign_id: campaignId,
								period: DRILL.period,
								startRow: String(startRow),
								endRow: String(endRow),
							});
							const data = await fetchJSON(`${DRILL_ENDPOINTS.ADSETS}?${qs.toString()}`);
							const rows = (data.rows || []).map(normalizeAdsetRow);
							req.success({ rowData: rows, rowCount: data.lastRow ?? rows.length });
							return;
						}

						// Nível 2 => ads
						if (groupKeys.length === 2) {
							const adsetId = groupKeys[1];
							const qs = new URLSearchParams({
								adset_id: adsetId,
								period: DRILL.period,
								startRow: String(startRow),
								endRow: String(endRow),
							});
							const data = await fetchJSON(`${DRILL_ENDPOINTS.ADS}?${qs.toString()}`);
							const rows = (data.rows || []).map(normalizeAdRow);
							req.success({ rowData: rows, rowCount: data.lastRow ?? rows.length });
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
			}, 100);
		},
	};

	const apiOrInstance =
		typeof AG.createGrid === 'function'
			? AG.createGrid(gridDiv, gridOptions)
			: new AG.Grid(gridDiv, gridOptions);

	const api = gridOptions.api || apiOrInstance;

	// expõe a API pra outras funções (toggle / reset state se quiser)
	globalThis.LionGrid = globalThis.LionGrid || {};
	globalThis.LionGrid.api = api;
	globalThis.LionGrid.resetLayout = function () {
		try {
			sessionStorage.removeItem(GRID_STATE_KEY);
			api.setState({}, []);
			showToast('Layout Reset', 'info');
		} catch {}
	};

	return { api, gridDiv };
}

/* ============ Toast simples (Toastify) ============ */
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

/* ============ Toggle de colunas pinadas ============ */
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

	const base = [
		{ colId: 'ag-Grid-AutoColumn', pinned: checked ? 'left' : null },
		{ colId: 'profile_name', pinned: checked ? 'left' : null },
	];
	if (selectionColId) base.push({ colId: selectionColId, pinned: checked ? 'left' : null });

	api.applyColumnState({ state: base, defaultState: { pinned: null } });

	if (!silent) {
		showToast(checked ? 'Columns Pinned' : 'Columns Unpinned', checked ? 'success' : 'info');
	}
}

/* ============ Page module ============ */
const LionPage = (() => {
	let gridRef = null;
	function mount() {
		gridRef = makeGrid();

		const el = document.getElementById('pinToggle');
		if (el) {
			if (!el.hasAttribute('data-init-bound')) {
				el.checked = true; // default pinado
				el.addEventListener('change', () => togglePinnedColsFromCheckbox(false));
				el.setAttribute('data-init-bound', '1');
			}
		}

		togglePinnedColsFromCheckbox(true); // silencioso no load
	}

	if (document.readyState !== 'loading') mount();
	else document.addEventListener('DOMContentLoaded', mount);

	return { mount };
})();
globalThis.LionGrid = globalThis.LionGrid || {};
