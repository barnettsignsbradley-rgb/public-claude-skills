# Claude skills: site-admin and media-gen

Two Claude Code skills, packaged as plugins.

| Plugin | What it does |
|---|---|
| `site-admin` | Builds or upgrades a website's `/admin`: per-person sign-in with roles, password resets and an activity log; analytics; an inbox for every form; a Setup tab that connects Stripe, Resend, MailerLite and Turnstile from inside the admin. Ships a tested kit for Cloudflare Pages Functions on D1 or Supabase (`node plugins/site-admin/skills/site-admin/kit/test/run.mjs`). |
| `media-gen` | Generates AI images and image-to-video, and upscales, through Fal.ai. Pay per use; video is blocked until you approve the quoted price. |

## Install

In Claude Code:

```
/plugin marketplace add barnettsignsbradley-rgb/public-claude-skills
/plugin install site-admin@public-claude-skills
/plugin install media-gen@public-claude-skills
```

Or copy a folder from `plugins/<name>/skills/` into `~/.claude/skills/`.

## Requirements

- **media-gen:** Python 3, `pip install fal-client==1.0.3`, and your own Fal API key in `FAL_KEY` or `~/.fal_key` (https://fal.ai/dashboard/keys). Output goes to `~/Documents/Media Gen` by default; change it in `config.json`.
- **site-admin:** Node 22+ for the kit's checks. Your site needs a Cloudflare Pages project (D1) or a Supabase project, and one secret, `ADMIN_COOKIE_SECRET`. Every other key is pasted on the admin's Setup tab.

No keys or credentials are included in this repo.
