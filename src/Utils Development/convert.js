// scripts/convert-rows.mjs
// Uso:
//   node scripts/convert-rows.mjs in.json out.json
//
// Lê `in.json` (pode ser um array de linhas ou { rows: [...] })
// e grava `out.json` como um array de objetos normalizados
// { id, flag?, <name>: <content>, ... }.

import fs from 'node:fs/promises';
import path from 'node:path';

function rowToNamedMap(row) {
	let cells = [];
	const out = {};

	if (Array.isArray(row)) {
		if (typeof row[0] === 'string' || typeof row[0] === 'number') out.id = row[0];
		if (typeof row[1] === 'boolean') out.flag = row[1];
		cells = row.slice(2).filter((c) => c && typeof c === 'object');
	} else if (row && Array.isArray(row.cells)) {
		if ('id' in row) out.id = row.id;
		if ('flag' in row) out.flag = row.flag;
		cells = row.cells;
	} else {
		return out;
	}

	for (const c of cells) {
		if (!c || typeof c !== 'object' || !('name' in c)) continue;
		out[c.name] = c.content; // mantém content “puro”, inclusive HTML
	}

	return out;
}

function rowsToNamedMaps(rows) {
	if (!Array.isArray(rows)) return [];
	return rows.map(rowToNamedMap);
}

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) {
	console.error('Uso: node scripts/convert-rows.mjs <in.json> <out.json>');
	process.exit(1);
}

const raw = await fs.readFile(IN, 'utf-8');
let data;
try {
	data = JSON.parse(raw);
} catch (e) {
	console.error('Arquivo de entrada não é JSON válido:', e.message);
	process.exit(1);
}

// suporta tanto array direto quanto objeto com { rows: [...] }
const rows = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : [];
const mapped = rowsToNamedMaps(rows);

// grava só o array convertido
await fs.writeFile(OUT, JSON.stringify(mapped, null, 2), 'utf-8');

console.log(`OK: ${mapped.length} linhas convertidas → ${path.resolve(OUT)}`);
