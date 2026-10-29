/* site-admin kit: helpers shared by the shell (admin.js) and a site's own
 * modules (modules.js). No side effects: importing this draws nothing. */
// ---------- helpers ----------
export const $ = (sel, el = document) => el.querySelector(sel);
const RAW = Symbol('raw');
export const raw = (s) => ({ [RAW]: String(s) });
const escape = (v) => (v && v[RAW] !== undefined ? v[RAW] : Array.isArray(v) ? v.map(escape).join('')
  : String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
/* Escape one value for HTML, for the rare string built by hand. */
export const esc = (v) => escape(String(v ?? ''));
/* Tagged template that escapes every value unless wrapped in raw(). */
export const html = (strings, ...vals) => raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? escape(vals[i]) : ''), ''));
export const put = (el, h) => { el.innerHTML = h[RAW]; return el; };
/* The markup of an html`` value, for insertAdjacentHTML (a row added to a table). */
export const toHtml = (h) => h[RAW];

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/admin/api/' + path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json', 'X-Admin': '1' } : { 'X-Admin': '1' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { location.href = '/admin/login'; throw new Error('Signed out'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600);
}

/* Every action that emails someone, charges money or can't be undone goes through this. */
export function confirmAction(text, okLabel = 'Confirm', danger = false) {
  const d = $('#confirm');
  $('#confirm-text').textContent = text;
  const ok = $('#confirm-ok'); ok.textContent = okLabel; ok.className = danger ? 'danger' : '';
  d.showModal();
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true }));
}

export const when = (s) => {
  if (!s) return '';
  const d = new Date(/^\d+$/.test(s) ? Number(s) : String(s).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'));
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' });
};
export const money = (cents, cur = 'USD') => (cents / 100).toLocaleString(undefined, { style: 'currency', currency: cur });
export const n = (x) => Number(x || 0).toLocaleString();

/* [{ value, label, href? }]: with href the stat links to the tab behind it. */
export const stats = (items) => html`<div class="stats">${items.map((s) => (s.href
  ? html`<a class="stat" href="${s.href}"><b>${s.value}</b><span>${s.label}</span></a>`
  : html`<div class="stat"><b>${s.value}</b><span>${s.label}</span></div>`))}</div>`;

/* table({ rows, cols: [{ key, label, num, render }], empty }) */
export function table({ rows, cols, empty = 'Nothing here yet.' }) {
  if (!rows.length) return html`<div class="empty">${empty}</div>`;
  return html`<div class="table-wrap"><table><thead><tr>${cols.map((c) => html`<th class="${c.num ? 'num' : ''}">${c.label}</th>`)}</tr></thead>
  <tbody>${rows.map((r) => html`<tr>${cols.map((c) => html`<td class="${c.num ? 'num' : ''}">${c.render ? c.render(r) : r[c.key]}</td>`)}</tr>`)}</tbody></table></div>`;
}

/* Vertical bars for a daily series: [{ label, value }]. No libraries. */
export function barChart(series, title) {
  if (!series.length) return html`<div class="empty">No visits in this range yet.</div>`;
  const W = 720, H = 180, pad = 22, max = Math.max(...series.map((s) => s.value), 1);
  const bw = (W - pad) / series.length;
  const every = Math.ceil(series.length / 8);
  return html`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">
    ${series.map((s, i) => { const h = ((H - pad - 6) * s.value) / max; return html`<rect x="${pad + i * bw + 1}" y="${H - pad - h}" width="${Math.max(bw - 2, 1)}" height="${h}" rx="2"><title>${s.label}: ${s.value}</title></rect>`; })}
    ${series.map((s, i) => (i % every ? '' : html`<text x="${pad + i * bw}" y="${H - 6}">${s.label.slice(5)}</text>`))}
    <text x="0" y="12">${max}</text></svg>`;
}

/* Horizontal bars for a top-10 list: [{ label, n }]. */
export function hbars(list, empty = 'No data yet.') {
  if (!list.length) return html`<p class="muted">${empty}</p>`;
  const max = Math.max(...list.map((x) => x.n), 1);
  return html`<div class="hbars">${list.map((x) => html`<div class="hbar"><div class="bar"><i style="width:${(100 * x.n) / max}%"></i><span>${x.label}</span></div><span class="num">${n(x.n)}</span></div>`)}</div>`;
}

/* The (i) next to a heading, a field or a button: what it does, how to use it, what it needs.
   help = { what, how: [steps], needs: [things] }. Every view and every setup card has one. */
export function info(help, label = 'How this works') {
  if (!help) return '';
  return html`<details class="info"><summary aria-label="${label}" title="${label}">i</summary><div class="info-body">
    ${label !== 'How this works' ? html`<p class="info-t">${label}</p>` : ''}
    ${help.what ? html`<p>${help.what}</p>` : ''}
    ${help.how?.length ? html`<p class="info-h">How to</p><ol>${help.how.map((x) => html`<li>${x}</li>`)}</ol>` : ''}
    ${help.needs?.length ? html`<p class="info-h">Needs</p><ul>${help.needs.map((x) => html`<li>${x}</li>`)}</ul>` : ''}
  </div></details>`;
}
export const heading = (title, key) => html`<div class="head"><h1>${title}</h1>${info(HELP[key])}</div>`;

/* Help for the core views. Modules add theirs: HELP.people = { what, how, needs }. */
export const HELP = {
  overview: {
    what: 'The week at a glance: visitors, messages waiting, and anything not set up yet.',
    how: ['Open a tab in the menu for the detail behind a number.', 'A “Not set up yet” bar means a service this site uses has no key yet: press Open Setup and follow that card’s steps.'],
  },
  analytics: {
    what: 'How many people visit, which pages they read, and where they came from. Counted by the site itself, with no cookies.',
    how: ['Pick a range at the top.', '“Visitors” counts each person once in the range; “Page views” counts every page they open.', '“Direct” means they typed the address, used a bookmark, or came from an app that hides where it sent them.', '“Visitors who sent a form” is form messages divided by visitors.'],
    needs: ['Visitor tracking on every page. Setup → Visitor tracking shows whether visits are arriving.'],
  },
  inbox: {
    what: 'Every form on the site lands here first, even when the email notification fails.',
    how: ['Reply by clicking their email address (it opens your email app).', 'Then tick “Responded”. It records who replied and when, and moves the message out of Waiting.', 'Archive hides a message without marking it answered; Spam keeps it out of the counts.', 'Notes are only seen by admins.', 'Change who gets emailed about new messages in Settings.'],
    needs: ['Email set up (Setup → Email) for the notifications. Without it, messages still arrive here.'],
  },
  admins: {
    what: 'Everyone who can sign in to this admin. Owners can do everything; staff can use every tab except Setup, Admins, Settings and Activity.',
    how: ['Add an admin with their email. They get a temporary password and choose their own the first time they sign in.', 'Reset password when someone is locked out. They get a new temporary one, and the old one stops working at once.', 'Disable someone to end their access immediately. There must always be one active owner.'],
    needs: ['Email set up to send invites and resets. Without it, the temporary password is shown to you once to pass on.'],
  },
  settings: {
    what: 'Choices an owner makes without touching code.',
    how: ['“Every form” gets every message unless that form has its own list.', 'Add a form by its name (as it shows in the Inbox, e.g. “speaking”) to send it to different people.', 'Separate several emails with commas.'],
  },
  activity: { what: 'Every change made from this admin, who made it and when: sign-ins, setup, settings, resets and inbox updates.' },
  account: { what: 'Your own sign-in.', how: ['Use at least 10 characters. A short phrase is easier to remember than symbols.', 'Saving a new password signs you out on your other devices.'] },
  setup: {
    what: 'The outside services this site uses (email, payments, lists, spam protection), whether each one works, and how to set it up.',
    how: ['Open the (i) on a card for step-by-step instructions.', 'Paste the key it asks for and press Save. It is stored encrypted; this page only ever shows its first and last few characters.', 'Press Check again after changing something in the service itself.', 'A value marked “Set in the Cloudflare dashboard” wins over anything saved here; change it there.'],
    needs: ['An owner account.'],
  },
};

export const statusPill = (s, label = s) => html`<span class="pill ${{ new: 'warn', responded: 'ok', spam: 'bad', disabled: 'bad', ok: 'ok', warn: 'warn', bad: 'bad' }[s] || ''}">${label}</span>`;

/* Copy to the clipboard and say so on the button. */
export function copyText(text, btn) {
  const done = () => { if (!btn) return toast('Copied'); const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = t), 1600); };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => window.prompt('Copy this:', text));
  else window.prompt('Copy this:', text);
}

/* Download rows the page already has as a CSV (for lists built in the browser). */
export function downloadCsv(filename, header, rows) {
  const cell = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const body = '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' })), download: filename });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* Segmented filter: [['key','Label'], ...] → buttons with data-seg. */
export const seg = (items, current, label) => html`<div class="seg" role="group" aria-label="${label}">${items.map(([k, l]) =>
  html`<button type="button" aria-pressed="${k === current}" data-seg="${k}">${l}</button>`)}</div>`;

/* A month of days with events in them. events: [{ date: 'YYYY-MM-DD', title, color?, href? }].
   Used by the Calendar module on every site. */
export function monthGrid(year, month, events) {
  const first = new Date(year, month, 1);
  const start = (first.getDay() + 6) % 7;                 // weeks start Monday
  const days = new Date(year, month + 1, 0).getDate();
  const ymd = (d) => `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const today = new Date().toISOString().slice(0, 10);
  const cells = [];
  for (let i = 0; i < start; i++) cells.push(html`<div class="mg-cell mg-blank"></div>`);
  for (let d = 1; d <= days; d++) {
    const on = events.filter((e) => e.date === ymd(d));
    cells.push(html`<div class="mg-cell ${ymd(d) === today ? 'mg-today' : ''}"><span class="mg-d">${d}</span>
      ${on.map((e) => html`<a class="mg-ev" href="${e.href || '#'}" style="--c:${e.color || 'var(--accent)'}" title="${e.title}">${e.title}</a>`)}</div>`);
  }
  return html`<div class="mg"><div class="mg-head">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x) => html`<span>${x}</span>`)}</div>
    <div class="mg-grid">${cells}</div></div>`;
}
