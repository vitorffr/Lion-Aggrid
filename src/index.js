// src/index.js
import { ObjectStoreDO } from './models/DurableObjects.js';
import router from './router.js';

/** helper pra garantir JSON quando for objeto */
function toResponse(r) {
	if (r instanceof Response) return r;
	if (r === undefined || r === null) return new Response('Not found', { status: 404 });
	// se router retornar objeto, serialize
	return new Response(JSON.stringify(r), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		const p = url.pathname;

		// 1) Rotas do DO (KV) — bypass direto pro Durable Object "default"
		if (p === '/health' || p === '/scan' || p === '/kv' || p.startsWith('/kv/')) {
			const stub = env.ObjectStore.getByName('default');
			return stub.fetch(request);
		}

		// 2) Router (suas APIs e páginas dinâmicas)
		//    Se router não tratar (ou responder 404), caímos no fallback de assets
		try {
			const r = await router.fetch(request, env, ctx);
			if (r && r instanceof Response) {
				// se o router respondeu 404, deixa o assets tentar servir arquivo
				if (r.status !== 404) return r;
			} else if (r) {
				// router retornou um objeto simples
				return toResponse(r);
			}
		} catch (e) {
			// se o router estourar erro, retorna 500 legível
			return new Response(JSON.stringify({ error: e?.message || 'Router error' }), {
				status: 500,
				headers: { 'content-type': 'application/json' },
			});
		}

		// 3) Fallback: Assets estáticos (index.html, js, css…)
		return env.ASSETS.fetch(request);
	},
};

// Exporta a classe do DO para o runtime do Workers
export { ObjectStoreDO };
