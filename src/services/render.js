import * as template from '../templates/index.js';

/**
 * Render engine that knows how to stitch together:
 *   • header
 *   • a content template (by name)
 *   • footer
 *
 * Controllers pass in a “context” object that defines
 * replacement rules for each segment.
 *
 * @param {keyof typeof Template.cache} viewName
 *   The content template key (e.g. 'homeIndex').
 * @param {{
 *   header?: {search:string,replace:string}[],
 *   content?: {search:string,replace:string}[],
 *   footer?: {search:string,replace:string}[]
 * }} context
 *   Replacement rules for each section.
 * @returns {string}
 *   Complete HTML page ready for sending in a Response.
 */
export function renderPage(viewName, context = {}, env = {}) {
	const AG_GRID_LICENSE_KEY =
		'Using_this_{AG_Charts_and_AG_Grid}_Enterprise_key_{AG-094000}_in_excess_of_the_licence_granted_is_not_permitted___Please_report_misuse_to_legal@ag-grid.com___For_help_with_changing_this_key_please_contact_info@ag-grid.com___{high_stakes}_is_granted_a_{Multiple_Applications}_Developer_License_for_{1}_Front-End_JavaScript_developer___All_Front-End_JavaScript_developers_need_to_be_licensed_in_addition_to_the_ones_working_with_{AG_Charts_and_AG_Grid}_Enterprise___This_key_has_not_been_granted_a_Deployment_License_Add-on___This_key_works_with_{AG_Charts_and_AG_Grid}_Enterprise_versions_released_before_{2_September_2026}____[v3]_[0102]_MTc4ODMwMzYwMDAwMA==c816051ee78329dd14c853be95023812';

	if (context.header) {
		context.header.push({ search: '{AG_GRID_LICENSE_KEY}', replace: AG_GRID_LICENSE_KEY });
	}

	const headerHtml = context.header ? template.get('header', context.header || []) : '';
	const contentHtml = template.get(viewName, context.content || []);
	const footerHtml = context.footer ? template.get('footer', context.footer || []) : '';
	return `${headerHtml}\n${contentHtml}\n${footerHtml}`;
}
