import { renderPage } from '../../services/render';
import moment from 'moment-timezone';

/**
 * Render the home page with organization-specific content.
 *
 * @param {Request} request - The incoming HTTP request
 * @param {Object} env - Cloudflare Workers environment variables
 * @param {Object} ctx - Cloudflare Workers execution context
 * @returns {Promise<Response>} HTML response containing the rendered home page
 */
async function index(request, env, ctx) {
	// Render the home page
	const context = {
		content: [
			{
				search: '{seo.title}',
				replace: 'Login - High Stakes Lion Table ',
			},
			{
				search: '{{YEAR}}',
				replace: moment().format('YYYY'),
			},
		],
	};

	const response = renderPage('login', context);

	return new Response(response, {
		headers: { 'Content-Type': 'text/html' },
	});
}

export { index };
