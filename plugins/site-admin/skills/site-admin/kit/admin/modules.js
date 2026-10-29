/* This site's own admin tabs. The shell (admin.js) and the helpers (kit.js)
 * are the same on every site; only this file differs.
 *
 * One entry per nav id that functions/admin/_lib/modules.js returns from
 * moduleNav():  id: { label, group?, owner?, badge?, render(main, query) }
 * Give every view an (i): add HELP.<id> = { what, how: [...], needs: [...] }
 * and start its page with heading('Title', '<id>').
 *
 * Example:
 *   import { html, put, api, heading, table, HELP } from './kit.js';
 *   HELP.people = { what: 'Everyone on the site, one row per email.' };
 *   export const MODULE_VIEWS = {
 *     people: { label: 'People', async render(main) {
 *       const { rows } = await api('people');
 *       put(main, html`${heading('People', 'people')}${table({ rows, cols: [{ key: 'email', label: 'Email' }] })}`);
 *     } },
 *   };
 */
export const MODULE_VIEWS = {};
