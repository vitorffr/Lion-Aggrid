// /public/js/tables/campaigns.js
// Carregado DEPOIS do core. Só define o que você quer injetar.

// Exemplo: começar injetando apenas gridOptions (não mexe nas colunas do core)
globalThis.LionGridConfig = {
	// Se quiser externalizar as colunas, descomente e cole aqui seu array completo:
	columnDefs: [
		{
			headerName: 'Profile',
			field: 'profile_name',
			valueGetter: (p) => stripHtml(p.data?.profile_name),
			minWidth: 110,
			flex: 1.2,
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
	],

	gridOptions: {
		// Exemplos de overrides que respeitam o core:
		suppressMenuHide: true,
		enableCellTextSelection: true,
		// qualquer outra opção do AG Grid que você queira sobrepor
	},
};

// Nenhuma chamada extra necessária: o core monta a grid no DOMContentLoaded.
// Certifique-se apenas de que este arquivo é carregado DEPOIS do infinitetable.js.
