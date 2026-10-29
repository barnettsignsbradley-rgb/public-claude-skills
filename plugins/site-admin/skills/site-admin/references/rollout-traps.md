# Rollout traps: getting a site's admin switched on

Things that cost real time while switching an admin on, mostly in the
hosting dashboard rather than the code. Read this before handing the user
dashboard steps, and again when "it's set but it doesn't work".

## Cloudflare Pages

- **The project's name and its web address can differ.** A Pages project
  that was renamed keeps its old `<sub>.pages.dev` subdomain. Dashboard
  links built from the subdomain land on "Not found". Find the project in
  Workers & Pages by its domain or its GitHub repo, and give the user the
  project's **name** in steps.
- **Production and Preview have separate variable lists.** The Settings page
  opens on Production; a switch at the top right changes to Preview.
  Branch deployments like `staging` read **Preview** only. A key that is
  "definitely there" is often there on the other list.
- **A variable reaches a deployment only if it was saved before that
  deployment started.** Saving one changes nothing that's already running.
  After adding a key, start a new deployment of the branch you'll test on.
- **"Retry deployment" works on the row you click, not on the branch.** The
  branch address (`staging.<sub>.pages.dev`) follows the newest deployment
  *of that branch*. Retrying an older row, or a row from another branch,
  leaves the address on the old build. When Claude's token can't reach the
  project, pushing a commit to the branch is a redeploy Claude can do itself.
- **Never hand anyone a deployment's own address** (`<hash>.<sub>.pages.dev`).
  It is frozen: the code and the variables as they were when it was built.
  Hand out the branch address (`staging.<sub>.pages.dev`) or the
  production domain. A test run on a frozen link can never see a newly
  added key.
- **Setup shows the keys of the deployment you're looking at.** On staging,
  a card can say "Off" for a key that is set on Production only. Say so
  when the user asks why something "shows off".
- **Text variables show their value to anyone in the dashboard.** A
  password stored as Text is readable in a screenshot. Point it out, and
  have the old admin's password variable deleted once the kit admin is live.
- **An empty secret still exists.** The name shows in the list whether or
  not a value was pasted.

## Seeing what happened without signing in

Claude doesn't get an admin account on the user's sites. To debug without one:

- **Activity** is in the store. Setup saves and actions are logged with
  what they answered (`setup_action` → `detail.message`, since 1.4.1), so
  `select * from <prefix>admin_audit order by id desc` (Supabase MCP, or
  `wrangler d1 execute` on D1) shows what the user saw when they pressed a
  button. If a row has no `message`, the button ran on a build older than
  1.4.1: a frozen link or a stale deployment.
- **The hosting dashboard through the user's browser** (Claude in Chrome):
  read-only checks of the variable lists and the deployments page, when
  Claude's API token can't see the project. Look, don't change anything.
- **Outside services must say why they failed.** "Resend refused it" with no
  reason sends the user to check things that are all fine. Every Setup
  action returns the service's own message (`trySend` in `mail.js` is the
  pattern), so a new action does the same.
