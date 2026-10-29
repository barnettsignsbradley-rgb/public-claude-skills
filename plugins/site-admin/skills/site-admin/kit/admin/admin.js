/* site-admin kit: the admin page shell and the core views. Vanilla JS, no
 * build step. Helpers live in kit.js; this site's own tabs live in
 * modules.js (MODULE_VIEWS), so this file is the same on every site. */
import { $, put, raw, html, api, toast, confirmAction, when, n, stats, table, barChart, hbars, info, heading, statusPill } from './kit.js';
import { MODULE_VIEWS } from './modules.js';
// ---------- views ----------
const CORE = {
  overview: { label: 'Overview', async render(main) {
    const o = await api('overview');
    const inbox = !hidden('inbox');
    put(main, html`${heading('Overview', 'overview')}<p class="lede">This week on ${state.me.site}.</p>
      ${o.setupMissing?.length && state.me.admin.role === 'owner' ? html`<div class="setup-note"><span><strong>Not set up yet:</strong> ${o.setupMissing.join(', ')}.</span> <a class="button ghost" href="#setup">Open Setup</a></div>` : ''}
      ${stats([{ value: n(o.visitors7), label: 'Visitors, last 7 days' }, ...(inbox ? [{ value: n(o.openMessages), label: 'Messages waiting' }] : []),
        ...(o.extra || [])])}
      ${inbox ? html`<h2>Latest messages</h2>
      ${table({ rows: o.latest, empty: 'No form messages yet.', cols: [
        { label: 'When', render: (r) => when(r.created_at) }, { key: 'form', label: 'Form' },
        { label: 'From', render: (r) => r.name || r.email }, { label: 'Status', render: (r) => statusPill(r.status) }] })}` : ''}`);
  } },

  analytics: { label: 'Analytics', async render(main, q) {
    const days = Number(q.get('days')) || 30;
    const a = await api('analytics?days=' + days);
    const byDay = new Map(a.daily.map((d) => [d.day, d.visitors]));
    const series = Array.from({ length: days }, (_, i) => {
      const day = new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().slice(0, 10);
      return { label: day, value: byDay.get(day) || 0 };
    });
    put(main, html`${heading('Analytics', 'analytics')}<p class="lede">Visits counted by this site’s own tracker. No cookies.</p>
      <div class="toolbar"><div class="seg" role="group" aria-label="Range">${[7, 30, 90, 365].map((d) =>
        html`<button type="button" aria-pressed="${d === days}" data-days="${d}">${d === 365 ? '1 year' : d + ' days'}</button>`)}</div></div>
      ${stats([{ value: n(a.visitors), label: 'Visitors' }, { value: n(a.views), label: 'Page views' },
        { value: n(a.forms), label: 'Form messages' }, { value: (a.conversion * 100).toFixed(1) + '%', label: 'Visitors who sent a form' }])}
      <div class="panel">${barChart(series, 'Visitors per day')}</div>
      <div class="grid2"><div><h2>Top pages</h2>${hbars(a.pages)}</div><div><h2>Where they came from</h2>${hbars(a.refs)}</div>
      <div><h2>Devices</h2>${hbars(a.devices)}</div><div><h2>Countries</h2>${hbars(a.countries)}</div></div>`);
    main.querySelectorAll('[data-days]').forEach((b) => (b.onclick = () => (location.hash = 'analytics?days=' + b.dataset.days)));
  } },

  inbox: { label: 'Inbox', badge: 'openMessages', async render(main, q) {
    const status = q.get('status') || 'open';
    const d = await api('inbox?status=' + status);
    const tabs = [['open', 'Waiting'], ['responded', 'Responded'], ['archived', 'Archived'], ['spam', 'Spam'], ['all', 'All']];
    put(main, html`${heading('Inbox', 'inbox')}<p class="lede">Every form on the site. Tick “Responded” once someone has replied.</p>
      <div class="toolbar"><div class="seg" role="group" aria-label="Show">${tabs.map(([k, l]) =>
        html`<button type="button" aria-pressed="${k === status}" data-status="${k}">${l}${k === 'open' && d.counts.new ? ` (${d.counts.new})` : ''}</button>`)}</div>
        <span class="grow"></span><a class="button ghost" href="/admin/api/inbox?status=${status}&format=csv">Download CSV</a></div>
      ${d.rows.length ? d.rows.map(message) : html`<div class="empty">Nothing ${status === 'open' ? 'waiting' : 'here'}.</div>`}`);
    main.querySelectorAll('[data-status]').forEach((b) => (b.onclick = () => (location.hash = 'inbox?status=' + b.dataset.status)));
    main.querySelectorAll('[data-responded]').forEach((c) => (c.onchange = async () => {
      await api('inbox/' + c.dataset.responded, { method: 'POST', body: { status: c.checked ? 'responded' : 'new' } });
      toast(c.checked ? 'Marked responded' : 'Moved back to waiting'); refreshBadges(); route();
    }));
    main.querySelectorAll('[data-move]').forEach((b) => (b.onclick = async () => {
      await api('inbox/' + b.dataset.id, { method: 'POST', body: { status: b.dataset.move } }); toast('Moved'); refreshBadges(); route();
    }));
    main.querySelectorAll('[data-note]').forEach((t) => (t.onchange = async () => {
      await api('inbox/' + t.dataset.note, { method: 'POST', body: { note: t.value } }); toast('Note saved');
    }));
  } },

  admins: { label: 'Admins', owner: true, group: 'Settings', async render(main) {
    const { admins } = await api('admins');
    put(main, html`${heading('Admins', 'admins')}<p class="lede">Who can sign in here. Owners can do everything; staff can’t change admins or settings.</p>
      ${table({ rows: admins, cols: [
        { label: 'Name', render: (a) => (a.name ? html`${a.name}<br><span class="muted">${a.email}</span>` : a.email) },
        { label: 'Role', render: (a) => html`<select data-role="${a.id}" aria-label="Role for ${a.email}">${['owner', 'staff'].map((r) => html`<option ${r === a.role ? 'selected' : ''}>${r}</option>`)}</select>` },
        { label: 'Status', render: (a) => (a.disabled ? statusPill('disabled') : a.must_change ? html`<span class="pill warn">temp password</span>` : html`<span class="pill ok">active</span>`) },
        { label: 'Last sign-in', render: (a) => when(a.last_login_at) || 'never' },
        { label: '', render: (a) => html`<div class="row"><button class="ghost" data-reset="${a.id}" data-email="${a.email}">Reset password</button>
          <button class="ghost" data-disable="${a.id}" data-on="${a.disabled ? 0 : 1}">${a.disabled ? 'Enable' : 'Disable'}</button></div>` }] })}
      <h2>Add an admin</h2>
      <form class="panel row" id="add"><label>Email<input name="email" type="email" required></label><label>Name<input name="name"></label>
        <label>Role<select name="role"><option>staff</option><option>owner</option></select></label><button>Add</button></form>
      <div id="secret"></div>`);
    const showTemp = (r, email) => put($('#secret'), r.emailed ? html`<p class="muted">Emailed ${email} a temporary password.</p>`
      : html`<div class="panel"><p>Email isn’t set up, so pass this to ${email} yourself. It’s shown once.</p><p class="secret">${r.temp}</p></div>`);
    $('#add').onsubmit = async (e) => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
      if (!(await confirmAction(`Add ${f.email} as ${f.role}? They’ll get a temporary password.`, 'Add admin'))) return;
      try { const r = await api('admins', { method: 'POST', body: f }); await CORE.admins.render(main); showTemp(r, f.email); } catch (err) { toast(err.message); }
    };
    main.querySelectorAll('[data-reset]').forEach((b) => (b.onclick = async () => {
      if (!(await confirmAction(`Reset the password for ${b.dataset.email}? Their current one stops working now.`, 'Reset password', true))) return;
      try { const r = await api(`admins/${b.dataset.reset}/reset`, { method: 'POST', body: {} }); showTemp(r, b.dataset.email); } catch (err) { toast(err.message); }
    }));
    main.querySelectorAll('[data-disable]').forEach((b) => (b.onclick = async () => {
      try { await api('admins/' + b.dataset.disable, { method: 'POST', body: { disabled: b.dataset.on === '1' } }); toast('Saved'); CORE.admins.render(main); } catch (err) { toast(err.message); }
    }));
    main.querySelectorAll('[data-role]').forEach((s) => (s.onchange = async () => {
      try { await api('admins/' + s.dataset.role, { method: 'POST', body: { role: s.value } }); toast('Role saved'); } catch (err) { toast(err.message); CORE.admins.render(main); }
    }));
  } },

  settings: { label: 'Settings', owner: true, group: 'Settings', async render(main) {
    const { settings, fallbackRecipients } = await api('settings');
    const rec = settings.form_recipients || {};
    const forms = Object.keys(rec).filter((k) => k !== '*');
    put(main, html`${heading('Settings', 'settings')}
      <h2>Who gets form messages</h2>
      <p class="lede">Comma-separated emails. “Every form” is used when a form has no list of its own.${fallbackRecipients ? html` Until you save one, messages go to ${fallbackRecipients}.` : ''}</p>
      <form class="panel" id="rec"><div class="grid2">
        <label>Every form<input name="*" value="${(rec['*'] || []).join(', ')}" placeholder="you@site.com"></label>
        ${forms.map((f) => html`<label>${f}<input name="${f}" value="${rec[f].join(', ')}"></label>`)}
        <label>Add a form by name<input name="__new" placeholder="e.g. speaking"></label></div>
        <div class="row end"><button>Save</button></div></form>`);
    $('#rec').onsubmit = async (e) => {
      e.preventDefault();
      const value = {};
      for (const [k, v] of new FormData(e.target)) {
        if (k === '__new') { if (v.trim()) value[v.trim().toLowerCase()] = []; continue; }
        const list = v.split(',').map((x) => x.trim()).filter(Boolean);
        if (list.length || k !== '*') value[k] = list;
      }
      try { await api('settings', { method: 'POST', body: { key: 'form_recipients', value } }); toast('Saved'); CORE.settings.render(main); } catch (err) { toast(err.message); }
    };
  } },

  setup: { label: 'Setup', owner: true, group: 'Settings', async render(main) {
    const { cards, broken } = await api('setup');
    const field = (f) => {
      if (f.dashboardOnly || f.source === 'dashboard') return html`<div class="fld"><span class="fld-l">${f.label}</span><span class="muted">${f.source ? 'Set in the Cloudflare dashboard' : html`Not set. Add it in the Cloudflare dashboard as <code>${f.name}</code>: Workers &amp; Pages → this project → Settings → Variables and Secrets.`}</span></div>`;
      if (f.auto) return html`<div class="fld"><span class="fld-l">${f.label}</span><span class="${f.hint ? 'mono' : 'muted'}">${f.hint || 'Made by the button below'}</span></div>`;
      if (f.toggle) return html`<label class="check"><input type="checkbox" name="${f.name}" value="yes" ${f.hint === 'yes' ? 'checked' : ''}> ${f.label}</label>`;
      return html`<label>${f.label}${f.hint ? html` <span class="muted mono">now ${f.hint}</span>` : ''}
        <input name="${f.name}" type="${f.secret ? 'password' : 'text'}" autocomplete="off" spellcheck="false" placeholder="${f.hint ? 'Paste a new value to replace it' : f.placeholder}"></label>`;
    };
    const editable = (c) => c.fields.some((f) => !f.auto && !f.dashboardOnly && f.source !== 'dashboard');
    put(main, html`${heading('Setup', 'setup')}<p class="lede">The services this site uses. Green means it works.</p>
      ${broken.length ? html`<div class="setup-note bad">These saved keys can’t be read any more because the admin’s secret changed: ${broken.join(', ')}. Paste them again.</div>` : ''}
      ${cards.map((c) => html`<section class="card" id="setup-${c.id}">
        <header class="card-h"><h2>${c.label}</h2>${info({ what: c.what, how: c.steps, needs: c.needs }, 'How to set up ' + c.label)}
          <span class="pill ${c.status === 'missing' && c.optional ? '' : { ok: 'ok', missing: 'warn', problem: 'bad' }[c.status]}">${c.status === 'missing' && c.optional ? 'Off (optional)' : { ok: 'Working', missing: 'Not set up', problem: 'Needs attention' }[c.status]}</span></header>
        <p>${c.detail}</p>
        ${c.facts ? html`<ul class="facts">${c.facts.map((x) => html`<li>${x}</li>`)}</ul>` : ''}
        <form class="setup-form" data-id="${c.id}">${c.fields.map(field)}
          <div class="row">${editable(c) ? html`<button>Save</button>` : ''}
            <button type="button" class="ghost" data-check="${c.id}">Check again</button>
            ${c.actions.map((a) => html`<button type="button" class="ghost" data-action="${c.id}/${a.name}" data-confirm="${a.confirm}">${a.label}</button>`)}</div></form>
      </section>`)}`);
    main.querySelectorAll('.setup-form').forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault();
      const values = {};
      f.querySelectorAll('input[name]').forEach((i) => (values[i.name] = i.type === 'checkbox' ? (i.checked ? 'yes' : '') : i.value));
      const clear = [...f.querySelectorAll('input[type=checkbox]')].some((i) => !i.checked);
      try {
        const r = await api(`setup/${f.dataset.id}/save`, { method: 'POST', body: { values, clear } });
        toast(r.changed.length ? 'Saved and checked' : 'Nothing new to save');
        await CORE.setup.render(main);
        $('#setup-' + f.dataset.id)?.scrollIntoView({ block: 'nearest' });
      } catch (err) { toast(err.message); }
    }));
    main.querySelectorAll('[data-check]').forEach((b) => (b.onclick = async () => { b.disabled = true; await CORE.setup.render(main); toast('Checked'); }));
    main.querySelectorAll('[data-action]').forEach((b) => (b.onclick = async () => {
      if (b.dataset.confirm && !(await confirmAction(b.dataset.confirm, b.textContent))) return;
      b.disabled = true;
      try { const r = await api(`setup/${b.dataset.action.replace('/', '/action/')}`, { method: 'POST', body: {} }); toast(r.message); await CORE.setup.render(main); }
      catch (err) { toast(err.message); b.disabled = false; }
    }));
  } },

  activity: { label: 'Activity', owner: true, group: 'Settings', async render(main) {
    const { rows } = await api('audit');
    put(main, html`${heading('Activity', 'activity')}<p class="lede">Every change made from this admin.</p>
      ${table({ rows, cols: [{ label: 'When', render: (r) => when(r.ts) }, { key: 'email', label: 'Who' }, { key: 'action', label: 'What' }, { key: 'target', label: 'To' }] })}`);
  } },

  account: { label: 'Account', hidden: true, async render(main) {
    const forced = state.me.admin.must_change;
    put(main, html`${heading(forced ? 'Choose your password' : 'Your account', 'account')}
      <p class="lede">${forced ? 'You signed in with a temporary password. Pick your own to continue.' : state.me.admin.email}</p>
      <form class="panel" id="pw" style="max-width:420px;display:flex;flex-direction:column;gap:12px">
        ${forced ? '' : html`<label>Current password<input name="current" type="password" autocomplete="current-password" required></label>`}
        <label>New password<input name="next" type="password" autocomplete="new-password" minlength="10" required></label>
        <button>Save password</button></form>`);
    $('#pw').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Password saved'); await boot(); location.hash = 'overview'; } catch (err) { toast(err.message); }
    };
  } },
};

function message(m) {
  const fields = (() => { try { return Object.entries(JSON.parse(m.fields || '{}')); } catch { return []; } })();
  return html`<article class="msg ${m.status}">
    <header><strong>${m.name || m.email || 'No name'}</strong>${m.email ? html` <a href="mailto:${m.email}">${m.email}</a>` : ''}
      <span class="pill">${m.form}</span><span class="muted">${when(m.created_at)}</span>${m.emailed ? '' : html`<span class="pill warn" title="The notification email did not go out">not emailed</span>`}</header>
    ${m.message ? html`<p>${m.message}</p>` : ''}
    ${fields.length ? html`<p class="muted">${fields.map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>` : ''}
    <div class="row"><label class="check"><input type="checkbox" data-responded="${m.id}" ${m.status === 'responded' ? 'checked' : ''}> Responded</label>
      ${m.responded_by ? html`<span class="muted">by ${m.responded_by}, ${when(m.responded_at)}</span>` : ''}<span class="grow"></span>
      ${m.status !== 'archived' ? html`<button class="ghost" data-move="archived" data-id="${m.id}">Archive</button>` : ''}
      ${m.status !== 'spam' ? html`<button class="ghost" data-move="spam" data-id="${m.id}">Spam</button>` : ''}</div>
    <label class="muted" style="margin-top:8px">Note (only admins see this)<textarea data-note="${m.id}">${m.note || ''}</textarea></label>
  </article>`;
}

// ---------- shell ----------
const state = { me: null };
const ORDER = ['overview', 'analytics', 'inbox'];
const hidden = (id) => (state.me.without || []).includes(id);
const SETTINGS = ['setup', 'admins', 'settings', 'activity'];

function views() {
  const mods = (state.me.nav || []).filter((m) => MODULE_VIEWS[m.id]).map((m) => [m.id, { ...MODULE_VIEWS[m.id], label: m.label || MODULE_VIEWS[m.id].label }]);
  return [...ORDER.map((id) => [id, CORE[id]]), ...mods, ...SETTINGS.map((id) => [id, CORE[id]]), ['account', CORE.account]]
    .filter(([id, v]) => !hidden(id) && (!v.owner || state.me.admin.role === 'owner'));
}

function drawNav(current) {
  let group = '';
  const out = views().filter(([, v]) => !v.hidden).map(([id, v]) => {
    const g = v.group && v.group !== group ? html`<div class="group">${(group = v.group)}</div>` : '';
    const b = v.badge && state.badges?.[v.badge] ? html`<span class="badge">${state.badges[v.badge]}</span>` : '';
    return html`${g}<a href="#${id}" ${id === current ? raw('aria-current="page"') : ''}><span>${v.label}</span>${b}</a>`;
  });
  put($('#nav'), html`${out}`);
}

async function refreshBadges() {
  // A module's Overview number with `badge: '<key>'` becomes the badge of any view declaring badge: '<key>'.
  try { const o = await api('overview'); state.badges = { openMessages: o.openMessages, ...Object.fromEntries((o.extra || []).filter((x) => x.badge).map((x) => [x.badge, x.count ?? x.value])) }; drawNav(location.hash.slice(1).split('?')[0] || 'overview'); } catch {}
}

async function route() {
  const [id, qs] = (location.hash.slice(1) || 'overview').split('?');
  const forced = state.me.admin.must_change;
  const all = Object.fromEntries(views());
  const key = forced ? 'account' : all[id] ? id : 'overview';
  drawNav(key);
  $('#nav').classList.remove('open');
  const main = $('#main');
  document.title = `${all[key].label} · ${state.me.site} admin`;
  try { await all[key].render(main, new URLSearchParams(qs || '')); } catch (err) { put(main, html`<h1>${all[key].label}</h1><div class="empty">Couldn’t load this: ${err.message}</div>`); }
  main.focus({ preventScroll: true });
}

async function boot() {
  state.me = await api('me');
  $('#site').textContent = state.me.site;
  if (state.me.logo) Object.assign($('#logo'), { src: state.me.logo, hidden: false });
  $('#me-name').textContent = state.me.admin.name || state.me.admin.email;
  document.body.dataset.role = state.me.admin.role;   // a module view hides owner-only buttons from staff: document.body.dataset.role === 'owner'
}

$('#signout').onclick = async () => { await api('logout', { method: 'POST', body: {} }).catch(() => {}); location.href = '/admin/login'; };
$('.nav-toggle').onclick = (e) => { const open = $('#nav').classList.toggle('open'); e.target.setAttribute('aria-expanded', open); };
window.addEventListener('hashchange', route);
// An open (i) closes on Escape or a click anywhere else.
const closeInfo = (except) => document.querySelectorAll('details.info[open]').forEach((d) => d !== except && d.removeAttribute('open'));
document.addEventListener('click', (e) => closeInfo(e.target.closest('details.info')));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInfo(); });
await boot();
await route();
refreshBadges();
