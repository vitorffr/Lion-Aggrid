import { IttyRouter } from 'itty-router';

const router = IttyRouter();

/* =================== ASSETS (público) =================== */
router.get('/public/*', async (request, env) => {
	try {
		const url = new URL(request.url);
		const assetPath = url.pathname.replace(/^\/public/, '') || '/index.html';
		const assetRequest = new Request(new URL(assetPath, request.url), request);
		return await env.ASSETS.fetch(assetRequest);
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
import backend from './controllers/api/back.js';
router.post('/api/ssrm/', backend.ssrm);

/* =================== AUTH GUARD ===================
   - Roda para todas as rotas na sequência.
   - Deixa passar as públicas.
   - Se não tiver cookie `user`, redireciona para /login/.
*/
router.all('*', (request) => {
	const { pathname } = new URL(request.url);

	// rotas públicas liberadas
	const isPublic =
		pathname.startsWith('/public/') || pathname === '/login/' || pathname === '/api/auth/login/'; // webhook deve ser público

	if (isPublic) return; // deixa continuar

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

/* =================== PÁGINA PHONE NUMBERS (protegida) =================== */
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
