#!/usr/bin/env node
// Node >= 16 (ESM). Gera N objetos com TODOS os campos variados e consistentes.

const args = process.argv.slice(2);
const opt = (flag, def) => {
	const i = args.findIndex((a) => a === flag || a === short(flag));
	if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('-')) return args[i + 1];
	return def;
};
const has = (flag) => args.includes(flag) || args.includes(short(flag));
function short(f) {
	return { '--count': '-n' }[f] || f;
}

const COUNT = Number(opt('--count', 1));
if (!Number.isFinite(COUNT) || COUNT <= 0) {
	console.error('use --count > 0');
	process.exit(1);
}

const SEED = opt('--seed', null) ? Number(opt('--seed')) : null;
let _rng = mulberry32(SEED ?? Date.now() & 0xffffffff);

const BID_MEAN = Number(opt('--bid', 3.8)); // bid médio de referência
const BUD_MIN = Number(opt('--budget-min', 30));
const BUD_MAX = Number(opt('--budget-max', 150));

const BC_BASE = String(opt('--bc', 'Bm Agencia FbMax'));
const ACC_BASE = String(opt('--acc', 'Ca FbMax'));
const PROFIX = String(opt('--profile-prefix', 'ditarra'));

function mulberry32(a) {
	return function () {
		let t = (a += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rnd = () => _rng();
const rint = (min, max) => Math.floor(rnd() * (max - min + 1)) + min;
const rfloat = (min, max) => rnd() * (max - min) + min;
const sample = (arr) => arr[Math.floor(rnd() * arr.length)];
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));

let _lastTs = 0,
	_ctr = 0;
function gen18() {
	const now = Date.now();
	if (now !== _lastTs) {
		_lastTs = now;
		_ctr = 0;
	}
	return String(now) + String(_ctr++ % 100000).padStart(5, '0');
}

function tzParts(d = new Date(), tz = 'America/Sao_Paulo', opts) {
	return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, ...opts })
		.formatToParts(d)
		.reduce((a, p) => ((a[p.type] = p.value), a), {});
}
function fmtProfileDate(d = new Date()) {
	const p = tzParts(d, 'America/Sao_Paulo', {
		day: '2-digit',
		month: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	});
	return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
}
function fmtDM(d = new Date()) {
	const p = tzParts(d, 'America/Sao_Paulo', { day: '2-digit', month: '2-digit' });
	return `${p.day}/${p.month}`;
}
function toBRL(n) {
	return new Intl.NumberFormat('pt-BR', {
		style: 'currency',
		currency: 'BRL',
		minimumFractionDigits: 2,
	}).format(n);
}
function toUSD(n) {
	return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
		n
	);
}

const ACCOUNT_STATUSES = ['ACTIVE', 'DISABLED', 'PENDING', 'LIMITED'];
const CAMPAIGN_STATUSES = ['ACTIVE', 'PAUSED', 'LEARNING', 'ENDED'];
const BC_VARIANTS = ['FbMax', 'NovaHaus', 'Artemis', 'Orion', 'GigaAds', 'Pilotis', 'Vesta', 'Nimbus'];

function gaussianAround(mean, relSpread = 0.25) {
	// Box–Muller: retorna valor ~N(mean, (mean*relSpread)^2) truncado >= 0
	const u = 1 - rnd();
	const v = 1 - rnd();
	const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
	const sigma = Math.max(1e-6, Math.abs(mean * relSpread));
	return Math.max(0, mean + z * sigma);
}

function makeOne(i) {
	const id = gen18();
	const dm = fmtDM();
	const profDate = fmtProfileDate();

	// variações de nomes/strings
	const bcChunk = sample(BC_VARIANTS);
	const bc_name = `${BC_BASE} ${bcChunk} #${String(i + 1).padStart(2, '0')}`;
	const account_name = `${ACC_BASE} ${rint(100, 999)}-${i + 1}`;
	const profile_name = `${PROFIX}-${rint(100, 999)} - ${profDate} #${i + 1}`;

	const account_status = sample(ACCOUNT_STATUSES);
	const account_limit = sample([-1, rint(500, 5000), rint(10000, 50000)]);

	// campanha: injeta tokens diferentes
	const geo = sample(['BR', 'MX', 'US', 'CL', 'PE', 'CO', 'AR', 'PT', 'ES']);
	const topic = sample(['JURO', 'PIX', 'CARTAO', 'SALARIO', 'BONUS', 'FGTS', 'IMPOSTO', 'SEGURO']);
	const tag = sample(['#ADX', '#PERF', '#LEADS', '#APP', '#WEB']);
	const device = sample(['ANDROID', 'iOS', 'MOBILE', 'DESKTOP']);
	const marker = sample(['TESTE1', 'LOT-A', 'ALFA', 'BETA', 'OMEGA']);
	const campaign_name = `[${dm}] (POL) API - ${topic} - (${tag}) - [${geo}] - [${dm}] (POL) API - ${topic} - (${tag}) - [] -MKTDIGITAL-${marker} ${id.slice(
		-5
	)}-${device}`;

	const utm_campaign = id;
	const select_line = i % 3 === 0 ? '' : `row-${i + 1}`;

	// métricas: coerência entre si
	const bid = +gaussianAround(BID_MEAN, 0.15).toFixed(2); // +-15%
	const budget = rint(BUD_MIN, BUD_MAX);
	const campaign_status = sample(CAMPAIGN_STATUSES);

	const impressions = rint(0, 50000);
	const ctr = rfloat(0.004, 0.06); // 0.4% a 6%
	let clicks = Math.min(impressions, Math.floor(impressions * ctr));
	// jitter de clique
	clicks = Math.max(0, clicks + rint(-Math.floor(clicks * 0.1), Math.floor(clicks * 0.1)));

	const visitors = clicks + rint(0, Math.floor(clicks * 0.25)); // até +25% por sharing

	// spend ~ cliques * bid * fator ruído
	const spendBase = clicks * bid * rfloat(0.6, 1.15);
	const spent = round2(spendBase);

	const cpc = clicks > 0 ? round2(spent / Math.max(1, clicks)) : null;

	// conversões ~ 0–12% dos cliques
	const convRate = rfloat(0.005, 0.12);
	let conversions = Math.min(clicks, Math.floor(clicks * convRate));
	// real_conversions com pequena variação
	const real_conversions = Math.max(
		0,
		conversions + rint(-Math.ceil(conversions * 0.15), Math.ceil(conversions * 0.15))
	);

	const cpa_fb = conversions > 0 ? round2(spent / conversions) : null;
	const real_cpa = real_conversions > 0 ? round2(spent / real_conversions) : null;

	// receita por conversão (BRL)
	const payout = rfloat(10, 180); // R$10–R$180
	const totalRevenue = round2(conversions * payout);
	const fb_revenue = round2(totalRevenue * rfloat(0.4, 0.8));
	const push_revenue = round2(Math.max(0, totalRevenue - fb_revenue));

	const revenueStr = `${toBRL(totalRevenue)} (${toBRL(fb_revenue)} | ${toBRL(push_revenue)})`;

	// mx string (ex.: USD + ROI)
	const usd = round2(totalRevenue / rfloat(4.5, 6.5)); // câmbio aleatório
	const roi = spent > 0 ? round2((totalRevenue - spent) / spent) : 0;
	const mx = `${toUSD(usd)} (${toUSD(roi)})`;

	const profit = round2(totalRevenue - spent);

	// xabu fields (a/b com a<=b)
	const adsetsTotal = rint(1, 6);
	const adsetsDone = rint(0, adsetsTotal);
	const adsTotal = rint(1, 6);
	const adsDone = rint(0, adsTotal);

	return {
		id,
		flag: i % 2 === 0 ? false : true,
		profile_name,
		bc_name: bc_name,
		account_name,
		account_status,
		account_limit,
		campaign_name,
		utm_campaign,
		select_line,
		bid,
		campaign_status,
		budget,
		xabu_ads: `${adsDone}/${adsTotal}`,
		xabu_adsets: `${adsetsDone}/${adsetsTotal}`,
		impressions,
		clicks,
		visitors,
		cpc,
		conversions,
		cpa_fb,
		real_conversions,
		real_cpa,
		spent,
		fb_revenue,
		push_revenue,
		revenue: revenueStr,
		mx,
		profit,
	};
}

function round2(x) {
	return Math.round((x + Number.EPSILON) * 100) / 100;
}

const arr = Array.from({ length: COUNT }, (_, i) => makeOne(i));
process.stdout.write(JSON.stringify(arr, null, 2) + '\n');
