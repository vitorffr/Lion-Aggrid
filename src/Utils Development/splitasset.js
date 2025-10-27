#!/usr/bin/env node
// Node >=16
import { createReadStream, promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

const [, , input, outDirArg, maxArg] = process.argv;
if (!input || !outDirArg) {
	console.error('Uso: node split-asset.mjs <arquivo_entrada> <dir_saida> [--max=24000000]');
	process.exit(1);
}
const MAX = Number((maxArg || '').split('=')[1] ?? 24_000_000); // 24 MB por segurança (< 25MB)
const outDir = outDirArg;
await fs.mkdir(outDir, { recursive: true });

const stat = await fs.stat(input);
const size = stat.size;

function sha256(buf) {
	return crypto.createHash('sha256').update(buf).digest('hex');
}

const baseName = path.basename(input);
const ext = path.extname(baseName);
const stem = baseName.slice(0, -ext.length) || baseName;

const rs = createReadStream(input, { highWaterMark: 1024 * 1024 }); // 1MB
let partIdx = 0,
	partSize = 0,
	parts = [],
	current = [];
let totalHash = crypto.createHash('sha256');

function newPartName(i) {
	return `${stem}.part${String(i).padStart(2, '0')}${ext}`;
}

async function flushPart() {
	if (current.length === 0) return;
	const buf = Buffer.concat(current);
	const filename = newPartName(partIdx++);
	const outPath = path.join(outDir, filename);
	await fs.writeFile(outPath, buf);
	parts.push({ file: filename, size: buf.length, sha256: sha256(buf) });
	current = [];
	partSize = 0;
}

for await (const chunk of rs) {
	totalHash.update(chunk);
	if (partSize + chunk.length > MAX && partSize > 0) {
		await flushPart();
	}
	current.push(chunk);
	partSize += chunk.length;
}
await flushPart();

const manifest = {
	version: 1,
	original: baseName,
	total_size: size,
	total_sha256: totalHash.digest('hex'),
	content_type: ext === '.json' ? 'application/json; charset=utf-8' : 'application/octet-stream',
	parts,
};
await fs.writeFile(path.join(outDir, `${stem}.manifest.json`), JSON.stringify(manifest, null, 2));

console.log(`OK: ${parts.length} partes geradas em ${outDir}`);
