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

router.post('/api/dev/test-toggle/', backend.testToggle);
router.put('/api/campaigns/:id/status/', backend.updateCampaignStatus);
router.put('/api/campaigns/:id/bid/', backend.updateCampaignBid);
router.put('/api/campaigns/:id/budget/', backend.updateCampaignBudget);
router.put('/api/adsets/:id/status/', backend.updateAdsetStatus);
router.put('/api/ads/:id/status/', backend.updateAdStatus);
router.put('/api/campaigns/:id/bid_type/', backend.updateCampaignBidType);

router.post('/api/ssrm/', backend.ssrm);
router.post('/api/adsets/', backend.adsets);
router.post('/api/ads/', backend.ads);

// (opcional GET fallback)
router.get('/api/ssrm/', backend.ssrm);
router.get('/api/adsets/', backend.adsets);
router.get('/api/ads/', backend.ads);

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

/* =================== MASTERDETAIL (protegida) =================== */
import masterdetailPage from './controllers/pages/masterdetail.js';
router.get('/masterdetail/', masterdetailPage.index);

import infinitePage from './controllers/pages/infinitetable.js';
router.get('/infinite/', infinitePage.index);

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
