# Admin security: the rules and why

The kit implements all of this. This file is for when a site can't take the
kit as is (Next.js, Supabase) and the rules have to be rebuilt by hand, and
for reviewing an old admin before replacing it.

## What every site's admin does

| Rule | Why |
|---|---|
| One account per person, email + password | Shared passwords can't be revoked for one person, and the activity log can't say who did what. |
| PBKDF2-SHA256, 100,000 iterations, 16-byte salt, `pbkdf2$iter$salt$hash` | Workers' Web Crypto refuses more than 100,000 iterations (it throws, it doesn't cap). The format names its own iteration count so it can rise later. |
| Constant-time compare (`same()`) | Plain `!==` leaks how many characters matched. |
| Signed cookie, not a JWT library, not sessionStorage | A password kept in sessionStorage and sent on every call is stolen by any XSS on the page. A signed HttpOnly cookie can't be read by script. No dependency, runs on Workers and Node. |
| `SameSite=Strict`, `Path=/admin`, plus the `X-Admin: 1` header on writes | Strict stops other sites riding the session; the header stops a plain HTML form on another site posting into the API. |
| Password fingerprint in the cookie | A changed or reset password signs that person out on every device, without a sessions table. |
| Re-read the admin row on every request | Disabling someone ends their access at once, not when the cookie expires. |
| Fail closed | No `ADMIN_COOKIE_SECRET`: 503. A missing secret must never mean "no password". |
| Throttle: 5 per IP, 20 overall, 15 minutes, counted in the store | A sleep per wrong guess is not a throttle. Forgot-password requests count too, so the form can't be used to spam inboxes. |
| Forgot = one-time link, 30 minutes, only its sha256 stored | A leaked database row can't be replayed. Same answer whether or not the email exists. |
| Owner reset = temp password + must change | The owner never learns the new password. Until it's changed, the session can only reach the password screen. |
| At least one active owner, can't disable yourself | Nobody locks the site out of its own admin. Recovery is `scripts/admin-user.mjs`. |
| Activity log on every write | "Who refunded this?" has an answer. |
| `no-store`, `noindex`, `X-Frame-Options: DENY`, `nosniff` | Admin pages never sit in a cache, a search index or someone else's iframe. |
| One secret in the dashboard; the rest saved encrypted from Setup | Owners can connect Stripe or Resend without dashboard access. Keys are AES-GCM encrypted with a key derived from `ADMIN_SECRETS_KEY` (or `ADMIN_COOKIE_SECRET`), so a database leak alone doesn't expose them. The page only ever gets a hint (`sk_live_…4f2a`). Only owners can save or run setup actions, and every save is in the activity log. A dashboard value always wins. Never put keys in git, the skill or chat. |
| Rotating `ADMIN_COOKIE_SECRET` | Signs everyone out and makes saved keys unreadable; Setup lists them to paste again. Set a separate `ADMIN_SECRETS_KEY` if the cookie secret may need rotating often. |
| Restricted Stripe keys | Prefer a restricted key with only what the admin uses (listed in the Stripe card's (i)). Test mode first; the card says which mode a key is in. |

## Cloudflare Access

Optional extra layer for a site with nothing to sign in to yet, or on top of the kit for a high-value admin. Never a
replacement: Access can't do roles, resets or the activity log, and it's
configured outside the repo where the next person won't see it. If a site already uses Access, it can stay on in front of the kit.

## Traps already hit

- **An empty secret still "exists".** A secret saved empty still shows; `wrangler pages secret list` showed the name. Check the
  admin actually signs in after setting secrets.
- **A customer's "admin" role is not this admin.** A site whose customers
  have an `admin` role (e.g. in a profiles table) gives that to its customers' admins. It must never
  open the site's /admin. The kit's `admin_users` is separate on purpose.
- **Preview deployments share secrets unless told not to.** On Pages,
  preview and production variables are set separately. Give previews their
  own `ADMIN_COOKIE_SECRET` and their own database, or untested preview
  code signs in to, and writes to, production data.
- **One database for preview and production.** A site whose previews use
  the live database (e.g. one Supabase project) can't follow the
  rule above for the database. Its preview admin is the live admin: same
  accounts, same saved keys, same Activity. Set the same
  `ADMIN_COOKIE_SECRET` on both (cookies are per hostname, so that doesn't
  let one sign in to the other) and treat the preview admin as production.
- **`Secure` cookies on plain http.** Browsers accept them on `localhost`
  only. `test/serve.mjs` strips `Secure` for its preview; nothing else should.
