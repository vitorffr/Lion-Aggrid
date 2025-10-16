// router.js
import { IttyRouter } from 'itty-router';
const router = IttyRouter();

/* =================== ASSETS (público) =================== */
router.get('/public/*', async (request, env) => {
	try {
		const url = new URL(request.url);
		const assetPath = url.pathname.replace(/^\/public/, '') || '/index.html';
		const assetReq = new Request(new URL(assetPath, request.url), request);
		return await env.ASSETS.fetch(assetReq);
	} catch (err) {
		console.log(err);
		return new Response('Not found', { status: 404 });
	}
});

/* =================== LOGIN (público) =================== */
import { index as login } from './controllers/pages/login.js';
import { auth } from './controllers/api/auth.js';

router.get('/login/', login);
router.post('/api/auth/login/', auth);

/* =================== LION ROWS (SSRM) =================== */
// IMPORTANTE: mapeie GET e POST, com e sem barra
import backend from './controllers/api/back.js';
router.post('/api/ssrm', backend.ssrm);
router.post('/api/ssrm/', backend.ssrm);
router.get('/api/ssrm', backend.ssrm); // fallback GET do dataSource
router.get('/api/ssrm/', backend.ssrm);

/* =================== AUTH GUARD =================== */
router.all('*', (request) => {
	const { pathname } = new URL(request.url);

	// rotas públicas liberadas (inclui SSRM!)
	const isPublic =
		pathname.startsWith('/public/') ||
		pathname === '/login/' ||
		pathname === '/api/auth/login/' ||
		pathname === '/api/ssrm' ||
		pathname === '/api/ssrm/';

	if (isPublic) return; // segue para a próxima rota

	// verifica cookie de sessão
	const cookies = request.headers.get('Cookie') || '';
	const match = cookies.match(/(?:^|;\s*)user=([^;]+)/);
	const currentUser = match ? match[1] : null;

	if (!currentUser) {
		return new Response(null, {
			status: 302,
			headers: { Location: '/login/' },
		});
	}
	// autenticado -> segue para as rotas protegidas
});

/* =================== HOME (protegida) =================== */
import homePage from './controllers/pages/homePage.js';
router.get('/', homePage.index);

/* =================== CATCH ALL =================== */
router.all(
	'*',
	() =>
		new Response('not found.', {
			status: 404,
			headers: { 'Content-Type': 'text/plain' },
		})
);

export default router;
