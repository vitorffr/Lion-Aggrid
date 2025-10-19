import login from './files/auth/login.html';
import header from './files/header.html';
import footer from './files/footer.html';
import homePage from './files/home/index.html';
import masterdetailPage from './files/masterdetail/index.html';

const cache = Object.freeze({
	header,
	footer,
	login,
	homePage,
	masterdetailPage,
});

/**
 * Retrieve a template and apply replacements.
 *
 * @param {keyof typeof cache} file
 *   The cache key for the HTML to render (e.g. 'header', 'homeIndex').
 * @param {{search:string,replace:string}[]} [replaces=[]]
 *   An array of { search, replace } rules to apply via `.split().join()`.
 * @returns {string}
 *   The final HTML string after substitutions.
 */
function get(file, replaces = []) {
	// console.log(`[Template] rendering "${file}" with`, replaces);

	let tpl = cache[file];
	for (const { search, replace } of replaces) {
		tpl = tpl.split(search).join(replace);
	}
	return tpl;
}

export { get };
