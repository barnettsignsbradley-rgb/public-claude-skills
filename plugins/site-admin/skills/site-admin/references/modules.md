# Modules

The names below are the names on every site. A module that isn't needed is
left out entirely: no empty tabs, no "coming soon".

Core (in the kit, every site): **Overview, Analytics, Inbox, Setup,
Admins, Settings, Activity, Account**. Every view, core or module, has an
(i) next to its heading (`heading(title, id)` + `HELP[id]`), and so does
any action whose consequences aren't obvious. Everything else below is added per site:
routes in `functions/admin/_lib/modules.js`, a view in `MODULE_VIEWS` in
`admin/admin.js`, tables in a new numbered migration, and a check in
`test/run.mjs`.

Order in the sidebar: Overview, Analytics, Inbox, People, Products (one
entry per product), Courses, Calendar, Affiliates, Codes & links, Send,
Email lists, then site-specific modules, then the Settings group.

---

## Core

### Overview
The first screen. A stat strip of the numbers that matter for this site
(visitors this week, messages waiting, plus one per module: sales this
month, new signups, next event), then "Latest messages" and, when present,
"Latest sales" and "Next events". Modules add their numbers to the
`overview` route; keep it to six stats.

### Analytics
From `site_events` (the site's own tracker). Range 7/30/90/365 days;
visitors, page views, form messages, visitors who sent a form; visitors per
day; top pages, referrers, devices, countries. Add a row per module event
when it matters (e.g. `checkout_started`, `signup`) using the same
`type` column: `HubTrack.event('signup')` on the site.

### Inbox
Left out (`withoutCore`) only when the site has no forms at all; a signup
or waitlist field is People, not the Inbox. Every `POST /api/form`, newest first. Tabs: Waiting, Responded, Archived,
Spam, All. Each message: name, email (mailto), form, time, the message, any
extra fields, a **Responded** checkbox that records who and when, an
admin-only note, Archive and Spam. "Not emailed" pill when the notification
failed. CSV download. Badge in the sidebar = Waiting count.

### Settings
Owner only. "Who gets form messages": a list of emails per form and one
for every form. Modules add their own owner settings here, each declared in
`moduleSettings` (e.g. `signup_open`, `sales_open`), each a labelled switch
or field with one line saying what it does.

### Setup
Owner only. One card per service in `integrations` (modules.js): status
pill, the check's one-line result and facts, fields to paste keys, Save,
Check again, and the service's actions. The (i) on each card is the full
how-to with menu paths. Adding a service: a new entry in
`integrations.js` with `what`, `needs`, `steps`, `fields`, `check` and any
`actions` the API allows (e.g. MailerLite could get "Create the groups
this site needs"), plus a check in `test/run.mjs` with the service faked.
Mark a service `optional: true` when the site works without it (Turnstile),
so Overview doesn't flag it.

### Admins, Activity, Account
As in the kit. Don't restyle or rename them per site.

---

## People
**When:** the site collects emails in more than one way (signups, leads,
buyers, accounts, affiliates).

One row per email, across every source: name, how they came in (each
source as a pill: Newsletter, Free guide, Purchase, Account, Affiliate,
Form), first seen, last activity, MailerLite status, visits (via
`visitor_id`). Search, filter by source, CSV.

Detail drawer: everything about that person on this site: forms they sent
(linked to the Inbox), purchases, access codes, course progress, events,
affiliate record, visits.

Actions, each behind `confirmAction`: **Resend access** (the site's existing
access/code email), **Reset password** (only if the site has customer
accounts: send the site's reset email, never show or set a password), **Add
to email list**, **Remove** (deletes their personal rows after a typed
confirmation; owner only).

**Data:** build it as a query over the site's existing tables (a SQL view
or a union in the route), keyed on lower-cased email. Don't copy people
into a new table. KV sites: list by prefix and merge in the route; cache
for a minute if it's slow.

## Products (one tab per product)
**When:** the site sells or gives away something people sign up for.

Declare the products once in `modules.js`:
```js
export const PRODUCTS = [
  { id: 'course', label: 'Companion Course', kind: 'one-time', stripe: { product: 'prod_...' }, usage: 'course' },
  { id: 'seeker', label: 'Seeker plan', kind: 'subscription', stripe: { price: 'price_...' } },
  { id: 'guide', label: 'Free guide', kind: 'free' },
];
```
Each becomes its own sidebar entry under "Products". The tab shows: stats
(people, revenue, active subscriptions or uses, this month vs last), the
people who have it (with purchase date, amount, code used, usage/progress),
and the product's codes. CSV.

Actions: **Send payment link**, **Give access** (comp, with a reason, owner
only), **Resend access**, **Create a code for this product** (opens Codes &
links prefilled). Revenue comes from the site's own purchase records
(written by its Stripe webhook); only fall back to the Stripe API for
things the site never stored, and cache it.

## Courses
**When:** the site has gated lessons or a multi-step program.

Needs progress to be recorded first: a `course_progress` table
(`email`, `course`, `lesson`, `completed_at`) written by the lesson page
(`POST /api/progress`, from the signed-in or access-code session).
Without it there is nothing to show, so say so in the plan.

View: per course, a funnel (how many reached each lesson) and a table of
people with their furthest lesson, % complete and last activity; click a
person for the lesson-by-lesson list. Action: **Send a nudge** (email
template, confirm).

## Calendar
**When:** the site runs events, workshops, sessions or cohorts with dates.

Month and list view.
**New event**: title, date and time with time zone, place or link,
capacity, price (or free), registration open/closed, linked email list
group. Edit, cancel (with an optional email to registrants, confirm),
duplicate. Each event: registrations with CSV, seats left, check-in tick.

**Each event gets its own email list group** when the site uses
MailerLite: saving an event makes a group named for its title and date
("WORKSHOP: <title> · Nov 5, 2026"), keeps its id on the event, renames it
when the title or date changes, and offers "Make its MailerLite group" on
any event without one. People join when they are booked (at once for a
free event, on approval for an application, on payment for a paid one),
alongside any standing topic group.

**Data:** an `events` table and an `event_registrations` table, or the
site's existing ones (e.g. `workshop:*` and `reg:*` keys in KV;
use them, don't migrate). The public site reads events from the same
store, so a new event appears on the site without a deploy.

## Affiliates
**When:** the site pays partners.

List with status, code(s), signups and revenue this month, owed. Invite
(sends the agreement link), agreement signed or not, issue codes, monthly
breakdown, payouts CSV, enable/disable, **Reset password** for the
affiliate portal (temp password emailed). Reuse the site's
existing affiliate helpers if it has them.

## Codes & links
**When:** the site takes payments through Stripe. Needs Setup → Payments
working; until it is, the tab shows the Setup card's status and a link to
it instead of an error.

Owner only for anything that creates. **New code**: code text, % or $ off,
which products, once/forever/repeating months, max uses, expiry, first-time
customers only. Creates a coupon + promotion code with
`metadata.site = <site>`. List: code, discount, products, uses, expiry,
active; deactivate. **New payment link**: product/price, optional code,
quantity; copy and send. Lists only show objects whose metadata names this
site: the Stripe account may be shared
with other sites. Reuse the site's own Stripe helpers if it has them.

## Send
**When:** the owner sends people documents or links: agreements, intake
forms, assessment links, carry-over billing links.

Templates (name, subject, body with `{{name}}`, `{{link}}`) stored in an
`admin_templates` table, editable by owners. **Send**: pick a person (or
type an email), a template, fill the link; preview; send through Resend;
logged in a `sent_items` table with status (sent, opened link, completed).
"Completed" is set by the page the link opens (the agreement sign page,
the intake form) when the person finishes. Resend and void. Intake links,
agreement links and billing links all become templates here.

## Email lists (MailerLite)
**When:** the site adds people to MailerLite. Needs Setup → Email lists
working, as above.

Replaces hard-coded group ids (`_mailerlite.js`, `mailerlite.js`,
`PLAN_GROUP_ENV`). A `list_links` table: `source_type` (form, product,
event, signup, plan), `source_id`, `group_id`, `group_name`. The site's
subscribe helper reads it (code fallback for the old ids during the move).

View: the account's groups with subscriber counts (MailerLite API);
**New group**; the links table ("Contact form → LEAD: Contact Form") with
add/change/remove; people whose sync failed, with Retry. New products and
events ask "which group?" when they're created. Upsert only adds groups,
never sets status, so unsubscribes stick.

## Content
**When:** the site has a CMS or editable lists.

Link to the CMS (e.g. Sveltia at `/admin/cms`) and show counts. Small
hard-coded lists (locations, team members, map regions) become JSON
in the store with a simple list editor; the site reads them at runtime.

## Site-specific modules
Keep them, under their own names, after the shared ones (e.g. Shops,
Plans, Reports, Usage & cost), using the route wrapper, owner-only money
routes, badges and Setup cards described in SKILL.md. They use the
same helpers (`table`, `stats`, `confirmAction`) so they look like the rest.
