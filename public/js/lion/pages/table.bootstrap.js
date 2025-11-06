import { Tabela, profileCellRenderer, stripHtml } from '../../lion-grid.js';

// Só as colunas mudam por página:
const columnDefs = [
	{ headerName: 'ID', field: 'id', width: 100 },
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
];

const tabela = new Tabela(columnDefs, {
	container: '#table', // seu container com tema já aplicado via classe do tema
	gridOptions: {
		// Aqui você passa apenas o que MUDA (endpoints, localeText, pagination, etc.)
		// Nada de rowData fixo — injete depois via API se quiser:
		// onGridReady extra? Pode passar (será chamado depois do interno).
	},
});

tabela.init();

// Se precisar trocar as colunas em runtime:
// tabela.setColumnDefs([{ headerName: 'Novo', field: 'novo' }]);
