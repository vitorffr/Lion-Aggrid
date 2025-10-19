// /src/controllers/pages/phoneNumbers.js
import { renderPage } from '../../services/render';

/**
 * Render the phone numbers page.
 *
 * @param {Request} request - The incoming HTTP request
 * @param {Object} env - Cloudflare Workers environment variables
 * @param {Object} ctx - Cloudflare Workers execution context
 * @returns {Promise<Response>} HTML response containing the rendered phone numbers page
 */
async function index(request, env, ctx) {
	try {
		const context = {
			header: [
				{
					search: '{seo.title}',
					replace: 'Table (Master Detail) - High Stakes Lion Table',
				},
			],
			content: [],
			footer: [],
		};

		const response = renderPage('masterdetailPage', context);

		return new Response(response, {
			headers: { 'Content-Type': 'text/html' },
		});
	} catch (error) {
		console.error('Error rendering phone numbers page:', error);
		return new Response('Internal Server Error', { status: 500 });
	}
}

export default { index };
