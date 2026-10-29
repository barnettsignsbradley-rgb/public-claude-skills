-- site-admin kit: Inbox and Analytics, the two modules every site gets.

-- Every form on the site lands here first, then gets emailed.
CREATE TABLE IF NOT EXISTS form_submissions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  form         TEXT NOT NULL,                 -- 'contact', 'speaking', 'waitlist' ...
  email        TEXT COLLATE NOCASE,
  name         TEXT,
  message      TEXT,
  fields       TEXT,                          -- JSON: everything else the form sent
  page         TEXT,
  visitor_id   TEXT,                          -- ties the message to Analytics
  ip_hash      TEXT,
  status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'responded', 'archived', 'spam')),
  responded_by TEXT,
  responded_at TEXT,
  note         TEXT,                          -- internal note from the admin
  emailed      INTEGER NOT NULL DEFAULT 0,    -- 1 once the notification went out
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS form_submissions_status ON form_submissions (status, created_at);
CREATE INDEX IF NOT EXISTS form_submissions_email ON form_submissions (email);

-- Same columns as a cross-site hub's site_events, so one tracker works for both.
CREATE TABLE IF NOT EXISTS site_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id   TEXT NOT NULL,
  type         TEXT NOT NULL,                 -- 'pageview', 'popup_shown', 'signup' ...
  path         TEXT,
  referrer     TEXT,                          -- host only
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  country      TEXT,
  region       TEXT,
  city         TEXT,
  device       TEXT,
  ts           INTEGER NOT NULL               -- ms since epoch
);
CREATE INDEX IF NOT EXISTS site_events_ts ON site_events (ts);
CREATE INDEX IF NOT EXISTS site_events_visitor ON site_events (visitor_id);
