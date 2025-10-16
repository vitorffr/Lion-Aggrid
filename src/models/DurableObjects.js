// src/models/DurableObjects.js
import { DurableObject } from 'cloudflare:workers';

function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
}

async function readJsonSafe(request) {
	try {
		const text = await request.text();
		if (!text) return {};
		return JSON.parse(text);
	} catch {
		return {};
	}
}

/**
 * Aceita:
 *  - { ttl: <segundos> }           -> { kind:'ttl', option:{ expirationTtl } }
 *  - { expiration: <epoch s> }     -> { kind:'abs', option:{ expiration } }
 * `ttl` e `expiration` podem ser number ou string numérica.
 */
function parseTtlOption(body) {
	const ttl = Number(body?.ttl);
	if (Number.isFinite(ttl) && ttl > 0) {
		return { kind: 'ttl', option: { expirationTtl: Math.floor(ttl) } };
	}
	const exp = Number(body?.expiration);
	if (Number.isFinite(exp) && exp > 0) {
		return { kind: 'abs', option: { expiration: Math.floor(exp) } };
	}
	return { kind: 'none', option: undefined };
}

// prefixo para “índice” de expiração
const EXP_PREFIX = '__exp__'; // formato: __exp__<expiresAtMs>__<key>

/** Durable Object que expõe rotas HTTP tipo Redis básico (com TTL “soft”) */
export class ObjectStoreDO extends DurableObject {
	constructor(ctx, env) {
		super(ctx, env);
		this.ctx = ctx;
		this.env = env;
	}

	// ===== Utilidades de TTL “soft” =====
	_markerKey(expiresAtMs, key) {
		return `${EXP_PREFIX}${expiresAtMs}__${key}`;
	}

	_parseMarker(markerKey) {
		// __exp__<expMs>__<key>
		if (!markerKey?.startsWith(EXP_PREFIX)) return null;
		const rest = markerKey.slice(EXP_PREFIX.length);
		const idx = rest.indexOf('__');
		if (idx < 0) return null;
		const expMs = Number(rest.slice(0, idx));
		const key = rest.slice(idx + 2);
		if (!Number.isFinite(expMs) || !key) return null;
		return { expMs, key };
	}
	// SUBSTITUA a função inteira por esta
	async _setNextAlarmToEarliest() {
		const now = Date.now();
		const list = await this.ctx.storage.list({ prefix: EXP_PREFIX });

		let best = null;
		for (const [k] of list) {
			const parsed = this._parseMarker(k);
			if (!parsed) continue;
			// só queremos futuros; os vencidos o alarm atual/GET/SCAN limpam
			if (parsed.expMs <= now) continue;
			if (best == null || parsed.expMs < best) best = parsed.expMs;
		}

		if (best != null) {
			// garante > agora
			const when = Math.max(best, now + 10);
			await this.ctx.storage.setAlarm(when);
		} else {
			// sem futuros: remove qualquer alarme pendente
			if (typeof this.ctx.storage.deleteAlarm === 'function') {
				await this.ctx.storage.deleteAlarm();
			} else {
				// fallback seguro: não arma nada
			}
		}
	}

	async _removeOldMarkerIfAny(key) {
		// se o valor atual é embrulhado e contém __exp, remova marcador antigo
		const current = await this.ctx.storage.get(key);
		if (current && typeof current === 'object' && current.__exp && Number.isFinite(current.__exp)) {
			const oldMarker = this._markerKey(current.__exp, key);
			await this.ctx.storage.delete(oldMarker);
		}
	}

	async _putWithSoftTTL(key, value, parsedTtl) {
		// Apaga marcador antigo (se existir)
		await this._removeOldMarkerIfAny(key);

		let expiresAt = null;

		if (parsedTtl.kind === 'ttl') {
			const ttlSec =
				Math.floor(Number(value?.ttl ?? 0)) ||
				Math.floor(Number(parsedTtl.option?.expirationTtl ?? 0));
			if (ttlSec > 0) {
				expiresAt = Date.now() + ttlSec * 1000;
			}
		} else if (parsedTtl.kind === 'abs') {
			const expS = Math.floor(Number(value?.expiration ?? parsedTtl.option?.expiration ?? 0));
			if (expS > 0) {
				expiresAt = expS * 1000;
			}
		}

		if (expiresAt) {
			// salva embrulhado
			const wrapped = { __v: value, __exp: expiresAt };
			await this.ctx.storage.put(key, wrapped);
			// cria marcador
			const markerKey = this._markerKey(expiresAt, key);
			await this.ctx.storage.put(markerKey, 1);
			// reprograma próximo alarm
			await this._setNextAlarmToEarliest();
			return { expiresAt };
		} else {
			// salva puro (sem TTL)
			await this.ctx.storage.put(key, value);
			// se tinha marcador antigo, já removemos no começo
			await this._setNextAlarmToEarliest();
			return { expiresAt: null };
		}
	}

	async _getMaybeExpire(key) {
		const val = await this.ctx.storage.get(key);
		if (typeof val === 'undefined') return { exists: false };

		if (val && typeof val === 'object' && val.__exp) {
			const exp = Number(val.__exp);
			if (Number.isFinite(exp) && Date.now() >= exp) {
				// expirado: apaga valor + marcador
				await this.ctx.storage.delete(key);
				const markerKey = this._markerKey(exp, key);
				await this.ctx.storage.delete(markerKey);
				// reprograma alarm
				await this._setNextAlarmToEarliest();
				return { exists: false };
			}
			// válido: retorna o payload
			return { exists: true, value: val.__v, expiresAt: exp };
		}

		// valor “puro” (sem TTL)
		return { exists: true, value: val, expiresAt: null };
	}

	// SUBSTITUA o final da sua alarm() por este bloco de agendamento
	async alarm() {
		const now = Date.now();
		const list = await this.ctx.storage.list({ prefix: EXP_PREFIX });
		let anyDeleted = false;

		for (const [markerKey] of list) {
			const parsed = this._parseMarker(markerKey);
			if (!parsed) continue;
			if (parsed.expMs > now) continue; // ainda não venceu

			await this.ctx.storage.delete(parsed.key);
			await this.ctx.storage.delete(markerKey);
			anyDeleted = true;
		}

		// reagenda para o próximo futuro (se houver) — NUNCA setAlarm(0)
		await this._setNextAlarmToEarliest();
	}

	// ===== HTTP =====
	async fetch(request) {
		const url = new URL(request.url);
		const { pathname, searchParams } = url;

		// Health
		if (pathname === '/health') {
			return json({ ok: true, service: 'ObjectStoreDO' });
		}

		// GET /scan?prefix=foo:
		if (pathname === '/scan' && request.method === 'GET') {
			const prefix = searchParams.get('prefix') ?? '';
			const list = await this.ctx.storage.list({ prefix });
			const items = [];
			for (const [key, raw] of list) {
				if (key.startsWith(EXP_PREFIX)) continue; // não mostra marcadores
				let value = raw;
				if (raw && typeof raw === 'object' && raw.__exp) {
					// filtra expirados e “desembrulha” válidos
					if (Date.now() >= Number(raw.__exp)) {
						// expirado — limpa e pula
						await this.ctx.storage.delete(key);
						const markerKey = this._markerKey(raw.__exp, key);
						await this.ctx.storage.delete(markerKey);
						continue;
					} else {
						value = raw.__v;
					}
				}
				items.push({ key, value });
			}
			return json({ prefix, count: items.length, items });
		}

		// POST /kv  -> mset
		if (pathname === '/kv' && request.method === 'POST') {
			const body = await readJsonSafe(request);
			const arr = Array.isArray(body.items) ? body.items : [];
			let upserted = 0;

			// transação: aplica TTL “soft” em cada item
			await this.ctx.storage.transaction(async (tx) => {
				// Obs.: como usamos this.ctx.storage nos helpers, evita choque:
				// executa put/delete dentro de tx via tx.put/tx.delete quando possível
				for (const it of arr) {
					if (!it || typeof it.key !== 'string') continue;

					// Remover marcador antigo (se houver)
					const current = await tx.get(it.key);
					if (current && typeof current === 'object' && current.__exp) {
						await tx.delete(this._markerKey(current.__exp, it.key));
					}

					// Calcula expiração
					const parsed = parseTtlOption(it);
					let expiresAt = null;
					if (parsed.kind === 'ttl') {
						const ttlSec = Math.floor(Number(it.ttl));
						if (ttlSec > 0) expiresAt = Date.now() + ttlSec * 1000;
					} else if (parsed.kind === 'abs') {
						const expS = Math.floor(Number(it.expiration));
						if (expS > 0) expiresAt = expS * 1000;
					}

					if (expiresAt) {
						await tx.put(it.key, { __v: it.value, __exp: expiresAt });
						await tx.put(this._markerKey(expiresAt, it.key), 1);
					} else {
						await tx.put(it.key, it.value);
					}
					upserted++;
				}
			});

			// reagenda próximo alarm (fora da tx)
			await this._setNextAlarmToEarliest();

			return json({ ok: true, upserted });
		}

		// Rotas /kv/<key>
		if (pathname.startsWith('/kv/')) {
			const key = decodeURIComponent(pathname.slice('/kv/'.length));
			if (!key) return json({ error: 'missing key' }, 400);

			switch (request.method) {
				case 'GET': {
					const r = await this._getMaybeExpire(key);
					if (!r.exists) return json({ error: 'not found', key }, 404);
					return json({ key, value: r.value });
				}

				case 'PUT': {
					const body = await readJsonSafe(request);
					const value = Object.prototype.hasOwnProperty.call(body, 'value')
						? body.value
						: body;

					const parsed = parseTtlOption(body);
					const { expiresAt } = await this._putWithSoftTTL(key, value, parsed);

					return json({ ok: true, key, ...(expiresAt ? { expiresAt } : {}) });
				}

				case 'DELETE': {
					// apaga marcador antigo se houver
					const current = await this.ctx.storage.get(key);
					if (current && typeof current === 'object' && current.__exp) {
						await this.ctx.storage.delete(this._markerKey(current.__exp, key));
					}
					await this.ctx.storage.delete(key);
					await this._setNextAlarmToEarliest();
					return json({ ok: true, key });
				}
			}
		}

		return json({ error: 'not found' }, 404);
	}
}
