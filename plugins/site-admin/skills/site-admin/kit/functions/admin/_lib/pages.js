/* The three pages shown before sign-in: sign in, forgot password, set a new password. */
import { SECURITY_HEADERS } from './http.js';
import { siteLogo } from './modules.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function page(title, site, body, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(title)} · ${esc(site)} admin</title><link rel="stylesheet" href="/admin/admin.css"><link rel="stylesheet" href="/admin/theme.css"></head>
<body class="auth"><main class="auth-card">${siteLogo ? `<img class="auth-logo" src="${esc(siteLogo)}" alt="">` : ''}<p class="auth-site">${esc(site)} admin</p><h1>${esc(title)}</h1>${body}</main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } });
}

const note = (msg, kind = 'error') => (msg ? `<p class="auth-note ${kind}" role="${kind === 'error' ? 'alert' : 'status'}">${esc(msg)}</p>` : '');

export const loginForm = (msg, email = '') => `${note(msg)}
<form method="post" action="/admin/login">
  <label>Email<input name="email" type="email" autocomplete="username" required value="${esc(email)}"></label>
  <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
  <button type="submit">Sign in</button>
</form><p class="auth-link"><a href="/admin/forgot">Forgot your password?</a></p>`;

export const forgotForm = (msg, kind) => `${note(msg, kind)}
<form method="post" action="/admin/forgot">
  <label>Email<input name="email" type="email" autocomplete="username" required></label>
  <button type="submit">Email me a reset link</button>
</form><p class="auth-link"><a href="/admin/login">Back to sign in</a></p>`;

export const resetForm = (token, msg) => `${note(msg)}
<form method="post" action="/admin/reset">
  <input type="hidden" name="t" value="${esc(token)}">
  <label>New password<input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
  <button type="submit">Save and sign in</button>
</form>`;
