/* Small response helpers shared by the admin functions. */

export const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS, ...headers } });
}

export const fail = (status, error) => json({ error }, status);

export async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

/* RFC 4180 CSV with a BOM for Excel; cells that start like a formula are quoted with a leading '. */
export function csv(rows, columns, filename) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [columns.map((c) => cell(c.label)).join(','), ...rows.map((r) => columns.map((c) => cell(r[c.key])).join(','))].join('\r\n');
  return new Response('﻿' + body, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, ...SECURITY_HEADERS },
  });
}

export const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
