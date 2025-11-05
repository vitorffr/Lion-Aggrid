// 1) Defina as injeções que você quer (todas opcionais)
globalThis.__lionInject = {
	columnDefs: [
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
	],

	// autoGroupColumnDef (opcional) — se não setar, o core usa o original
	// autoGroupColumnDef: { ... },

	// overrides pontuais no gridOptions (shallow merge)
	gridOptions: {
		// exemplo: defaultToolPanel inicial
		sideBar: { toolPanels: ['columns', 'filters'], defaultToolPanel: null, position: 'right' },
	},

	// endpoints (opcional): override só o que precisar
	endpoints: {
		SSRM: '/api/ssrm/?clean=1&mode=full', // se quiser apontar para outro endpoint de dataset raiz
	},

	// drill endpoints (opcional)
	drillEndpoints: {
		ADSETS: '/api/adsets',
		ADS: '/api/ads',
	},
};

// 2) Inicializa a grid quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
	try {
		makeGrid(); // mesma API de antes
	} catch (e) {
		console.error('[Bootstrap] Falha ao iniciar grid:', e);
	}
});
