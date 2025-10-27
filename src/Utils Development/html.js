// scripts/convert-cru.mjs
// Uso:
//   node scripts/convert-cru.mjs in.json out.json
//
// Lê um array de objetos (como o seu exemplo) e escreve um novo JSON
// "cru": sem HTML, números normalizados, e chaves consistentes.

import fs from 'node:fs/promises';
import path from 'node:path';

const [, , IN, OUT = 'out-clean.json'] = process.argv;
if (!IN) {
	console.error('Uso: node scripts/convert-cru.mjs <in.json> [out.json]');
	process.exit(1);
}

// ===== Helpers =====
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
	const inner = m ? m[1] : s;
	return stripHtml(inner);
};

// "R$ 1.618,65" -> 1618.65 | "-" -> null
const toNumberBR = (v) => {
	if (v == null) return null;
	if (typeof v === 'number') return v;
	const s = String(v).replace(/\u00A0/g, ' '); // NBSP
	if (s.trim() === '-' || s.trim() === '') return null;

	// mantém o sinal se houver (ex.: "-R$ 1,00")
	const sign = s.includes('-') ? -1 : 1;

	// só dígitos, ponto, vírgula
	const raw = s
		.replace(/[^\d.,-]/g, '')
		.replace(/-/g, '') // remove o hífen para não atrapalhar parseFloat
		.replace(/\./g, '') // separador de milhar
		.replace(',', '.'); // decimal

	const n = parseFloat(raw);
	if (!Number.isFinite(n)) return null;
	return sign * n;
};

const toInt = (v) => {
	if (v == null) return null;
	if (typeof v === 'number') return Math.trunc(v);
	const s = String(v).replace(/[^\d-]/g, '');
	const n = parseInt(s, 10);
	return Number.isFinite(n) ? n : null;
};

// campos que viram número (moeda/valor)
const CURRENCY_FIELDS = new Set([
	'bid',
	'budget',
	'cpc',
	'cpa_fb',
	'real_cpa',
	'spent',
	'fb_revenue',
	'push_revenue',
	'profit',
]);

// campos que viram int
const INT_FIELDS = new Set(['impressions', 'clicks', 'visitors', 'conversions', 'real_conversions']);

// campos de texto com HTML que devem ser “limpos”
const STRIP_HTML_FIELDS = new Set([
	'profile_name',
	'bc_name',
	'account_name',
	'campaign_name',
	'revenue',
	'mx',
	'xabu_ads',
	'xabu_adsets',
]);

// status: extrai <strong> se houver, senão tira HTML
const STATUS_FIELDS = new Set(['account_status', 'campaign_status']);

// renomes pontuais
const RENAME = {
	'select-line': 'select_line',
};

// regras especiais por campo
function normalizeField(key, val) {
	// renome
	const outKey = RENAME[key] || key;

	// status -> texto forte/limpo
	if (STATUS_FIELDS.has(key)) return [outKey, strongText(val)];

	// select_line vira string vazia (não precisamos do HTML do checkbox)
	if (outKey === 'select_line') return [outKey, ''];

	// account_limit: "-" -> null; "R$ ..." -> número (com sinal)
	if (key === 'account_limit') {
		if (val == null) return [outKey, null];
		const s = String(val).trim();
		if (s === '-' || s === '–') return [outKey, null];
		return [outKey, toNumberBR(s)];
	}

	// currency-like
	if (CURRENCY_FIELDS.has(key)) return [outKey, toNumberBR(val)];

	// ints
	if (INT_FIELDS.has(key)) return [outKey, toInt(val)];

	// strip html text
	if (STRIP_HTML_FIELDS.has(key)) return [outKey, stripHtml(val)];

	// default: retorna como está
	return [outKey, val];
}

function normalizeRow(row) {
	if (!row || typeof row !== 'object') return row;

	const out = {};
	// preserve id e flag se existirem
	if ('id' in row) out.id = row.id;
	if ('flag' in row) out.flag = row.flag;

	for (const [k, v] of Object.entries(row)) {
		if (k === 'id' || k === 'flag') continue;
		const [nk, nv] = normalizeField(k, v);
		out[nk] = nv;
	}
	return out;
}

// ===== Main =====
const inputPath = path.resolve(IN);
const raw = await fs.readFile(inputPath, 'utf-8');

let data;
try {
	data = JSON.parse(raw);
} catch (e) {
	console.error('Arquivo de entrada não é um JSON válido.');
	throw e;
}

const arr = Array.isArray(data) ? data : [data];
const cleaned = arr.map(normalizeRow);

// grava
await fs.writeFile(path.resolve(OUT), JSON.stringify(cleaned, null, 2), 'utf-8');
console.log(`OK: ${cleaned.length} registro(s) → ${OUT}`);
