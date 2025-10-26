// scripts/pull-raw-limit.mjs
// Uso:
//   node scripts/pull-raw-limit.mjs "https://lion-cache.highstakes.tech/read/<KEY>" out.json 1000
//
// Requisitos: Node 18+ (fetch nativo)

import fs from 'node:fs/promises';

const [, , URL_IN, OUT = 'out.json', MAX = '1000'] = process.argv;
if (!URL_IN) {
	console.error('Uso: node scripts/pull-raw-limit.mjs <url> [out.json] [maxItems]');
	process.exit(1);
}
const MAX_ITEMS = Number.isFinite(Number(MAX)) && Number(MAX) > 0 ? Number(MAX) : 1000;

const res = await fetch(URL_IN);
if (!res.ok) {
	const txt = await res.text().catch(() => '');
	throw new Error(`Falha ao baixar (${res.status}): ${txt.slice(0, 300)}`);
}

const text = await res.text();

// Para limitar a 1000 "linhas/itens", precisamos entender o JSON.
// Faremos o mínimo: parseia, corta, regrava igual (sem normalizar campos).
let obj;
try {
	obj = JSON.parse(text);
} catch {
	// Se não for JSON válido, salvamos bruto mesmo (sem limite, pois não dá pra cortar com segurança).
	await fs.writeFile(OUT, text, 'utf-8');
	console.warn('AVISO: resposta não é JSON — salvei bruto, sem limitar.');
	process.exit(0);
}

// Corta somente onde fizer sentido:
// - Se existir "rows" como array, limita por ela.
// - Senão, se o topo for um array, limita o topo.
// - Caso contrário, não há o que limitar de forma segura.
if (Array.isArray(obj?.rows)) {
	obj = { ...obj, rows: obj.rows.slice(0, MAX_ITEMS) };
} else if (Array.isArray(obj)) {
	obj = obj.slice(0, MAX_ITEMS);
} else {
	console.warn('AVISO: não encontrei array em obj.rows nem no topo; salvei sem cortes.');
}

// Regrava em JSON (sem alterar estrutura além do corte)
await fs.writeFile(OUT, JSON.stringify(obj, null, 2), 'utf-8');

const count = Array.isArray(obj?.rows) ? obj.rows.length : Array.isArray(obj) ? obj.length : 0;

console.log(`OK: ${count || '—'} itens salvos → ${OUT}`);
