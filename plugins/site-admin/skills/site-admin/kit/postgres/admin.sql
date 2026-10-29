-- site-admin kit on Supabase / Postgres: the same tables as migrations/*.sql
-- (D1), plus one function that store-supabase.js calls for every query.
--
-- Table prefix: "{{p}}" (adminStore.prefix in the server modules.js), so
-- two sites can share one Supabase project. The kit's own copy holds a
-- placeholder there; a site prints its copy with the prefix filled in:
--   node scripts/pg-schema.mjs > docs/migrations/<date>_admin_kit.sql
--
-- Nothing here is reachable from the browser: RLS is on with no policies,
-- anon and authenticated have no grants, and the function runs only for
-- the service role, which only the site's Pages Functions hold.
--
-- Undo:
--   drop function if exists {{p}}admin(text, jsonb);
--   drop table if exists {{p}}site_events, {{p}}form_submissions, {{p}}admin_secrets,
--     {{p}}admin_settings, {{p}}admin_audit, {{p}}admin_reset_tokens,
--     {{p}}admin_login_attempts, {{p}}admin_users;

create table if not exists {{p}}admin_users (
  id            bigserial primary key,
  email         text not null,
  name          text not null default '',
  role          text not null default 'staff' check (role in ('owner', 'staff')),
  password_hash text not null,
  must_change   boolean not null default false,
  disabled      boolean not null default false,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index if not exists {{p}}admin_users_email on {{p}}admin_users (lower(email));

create table if not exists {{p}}admin_login_attempts (
  id bigserial primary key,
  ip text not null,
  ok boolean not null,
  ts bigint not null                          -- ms since epoch
);
create index if not exists {{p}}admin_login_attempts_ts on {{p}}admin_login_attempts (ts);

create table if not exists {{p}}admin_reset_tokens (
  token_hash text primary key,                -- sha256 of the emailed token
  admin_id   bigint not null references {{p}}admin_users(id) on delete cascade,
  expires    bigint not null,                 -- ms since epoch
  used       boolean not null default false
);

create table if not exists {{p}}admin_audit (
  id       bigserial primary key,
  ts       timestamptz not null default now(),
  admin_id bigint,
  email    text,
  action   text not null,
  target   text,
  detail   jsonb
);
create index if not exists {{p}}admin_audit_ts on {{p}}admin_audit (ts);

create table if not exists {{p}}admin_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists {{p}}admin_secrets (
  name       text primary key,
  ciphertext text not null,
  iv         text not null,
  hint       text not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists {{p}}form_submissions (
  id           bigserial primary key,
  form         text not null,
  email        text,
  name         text,
  message      text,
  fields       text,                          -- JSON text, as on D1: the page parses it
  page         text,
  visitor_id   text,
  ip_hash      text,
  status       text not null default 'new' check (status in ('new', 'responded', 'archived', 'spam')),
  responded_by text,
  responded_at timestamptz,
  note         text,
  emailed      boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists {{p}}form_submissions_status on {{p}}form_submissions (status, created_at);
create index if not exists {{p}}form_submissions_ip on {{p}}form_submissions (ip_hash, created_at);

create table if not exists {{p}}site_events (
  id           bigserial primary key,
  visitor_id   text not null,
  type         text not null,
  path         text,
  referrer     text,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  country      text,
  region       text,
  city         text,
  device       text,
  ts           bigint not null                -- ms since epoch
);
create index if not exists {{p}}site_events_ts on {{p}}site_events (ts);

alter table {{p}}admin_users enable row level security;
alter table {{p}}admin_login_attempts enable row level security;
alter table {{p}}admin_reset_tokens enable row level security;
alter table {{p}}admin_audit enable row level security;
alter table {{p}}admin_settings enable row level security;
alter table {{p}}admin_secrets enable row level security;
alter table {{p}}form_submissions enable row level security;
alter table {{p}}site_events enable row level security;
revoke all on {{p}}admin_users, {{p}}admin_login_attempts, {{p}}admin_reset_tokens, {{p}}admin_audit,
  {{p}}admin_settings, {{p}}admin_secrets, {{p}}form_submissions, {{p}}site_events from anon, authenticated;

-- Every store method in one place: store-supabase.js posts { op, args } to
-- /rest/v1/rpc/{{p}}admin and gets back the same shapes store-d1.js returns.
create or replace function {{p}}admin(op text, args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  since bigint := coalesce((args->>'since')::bigint, 0);
  since_ts timestamptz := to_timestamp(coalesce((args->>'since')::bigint, 0) / 1000.0);
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  case op
  -- ---------- admins ----------
  when 'adminById' then
    select to_jsonb(u) into r from {{p}}admin_users u where u.id = (args->>'id')::bigint;
  when 'adminByEmail' then
    select to_jsonb(u) into r from {{p}}admin_users u where lower(u.email) = lower(trim(args->>'email'));
  when 'listAdmins' then
    select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email, 'name', u.name, 'role', u.role,
      'must_change', u.must_change, 'disabled', u.disabled, 'created_at', u.created_at, 'last_login_at', u.last_login_at)
      order by u.role desc, u.email), '[]'::jsonb) into r from {{p}}admin_users u;
  when 'countOwners' then
    select to_jsonb(count(*)) into r from {{p}}admin_users where role = 'owner' and not disabled;
  when 'createAdmin' then
    insert into {{p}}admin_users (email, name, role, password_hash, must_change)
    values (trim(args->>'email'), coalesce(args->>'name', ''), args->>'role', args->>'password_hash',
      coalesce(args->>'must_change', 'false') in ('1', 'true'))
    returning to_jsonb(id) into r;
  when 'updateAdmin' then
    update {{p}}admin_users set
      name = case when args ? 'name' then args->>'name' else name end,
      role = case when args ? 'role' then args->>'role' else role end,
      password_hash = case when args ? 'password_hash' then args->>'password_hash' else password_hash end,
      must_change = case when args ? 'must_change' then args->>'must_change' in ('1', 'true') else must_change end,
      disabled = case when args ? 'disabled' then args->>'disabled' in ('1', 'true') else disabled end,
      last_login_at = case when args ? 'last_login_at' then (args->>'last_login_at')::timestamptz else last_login_at end
    where id = (args->>'id')::bigint;

  -- ---------- sign-in throttle and reset links ----------
  when 'failedLogins' then
    select jsonb_build_object('ip', count(*) filter (where ip = args->>'ip'), 'all', count(*)) into r
    from {{p}}admin_login_attempts where not ok and ts > since;
  when 'logLogin' then
    insert into {{p}}admin_login_attempts (ip, ok, ts) values (args->>'ip', (args->>'ok')::boolean, now_ms);
    delete from {{p}}admin_login_attempts where ts < now_ms - 7 * 86400000::bigint;
  when 'saveResetToken' then
    insert into {{p}}admin_reset_tokens (token_hash, admin_id, expires)
    values (args->>'token_hash', (args->>'admin_id')::bigint, (args->>'expires')::bigint);
  when 'takeResetToken' then
    update {{p}}admin_reset_tokens t set used = true
    where t.token_hash = args->>'token_hash' and not t.used and t.expires > now_ms
    returning to_jsonb(t) into r;

  -- ---------- activity, settings, saved keys ----------
  when 'audit' then
    insert into {{p}}admin_audit (admin_id, email, action, target, detail)
    values ((args->>'admin_id')::bigint, args->>'email', args->>'action', args->>'target', args->'detail');
  when 'listAudit' then
    select coalesce(jsonb_agg(to_jsonb(a) order by a.id desc), '[]'::jsonb) into r
    from (select * from {{p}}admin_audit order by id desc limit coalesce((args->>'limit')::int, 200)) a;
  when 'getSettings' then
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into r from {{p}}admin_settings;
  when 'setSetting' then
    insert into {{p}}admin_settings (key, value, updated_by) values (args->>'key', args->'value', args->>'by')
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  when 'listSecrets' then
    select coalesce(jsonb_agg(jsonb_build_object('name', name, 'ciphertext', ciphertext, 'iv', iv, 'hint', hint,
      'updated_at', updated_at, 'updated_by', updated_by)), '[]'::jsonb) into r from {{p}}admin_secrets;
  when 'putSecret' then
    insert into {{p}}admin_secrets (name, ciphertext, iv, hint, updated_by)
    values (args->>'name', args->>'ciphertext', args->>'iv', args->>'hint', args->>'by')
    on conflict (name) do update set ciphertext = excluded.ciphertext, iv = excluded.iv, hint = excluded.hint,
      updated_at = now(), updated_by = excluded.updated_by;
  when 'deleteSecret' then
    delete from {{p}}admin_secrets where name = args->>'name';

  -- ---------- inbox ----------
  when 'inboxList' then
    select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at desc, f.id desc), '[]'::jsonb) into r
    from (select * from {{p}}form_submissions
          where case args->>'status' when 'open' then status = 'new' when 'all' then true else status = args->>'status' end
          order by created_at desc, id desc limit coalesce((args->>'limit')::int, 500)) f;
  when 'inboxCounts' then
    select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into r
    from (select status, count(*) n from {{p}}form_submissions group by status) c;
  when 'inboxUpdate' then
    if args->>'status' is not null then
      update {{p}}form_submissions set status = args->>'status', responded_by = args->>'responded_by',
        responded_at = (args->>'responded_at')::timestamptz where id = (args->>'id')::bigint;
    end if;
    if args ? 'note' then
      update {{p}}form_submissions set note = args->>'note' where id = (args->>'id')::bigint;
    end if;
  when 'addForm' then
    insert into {{p}}form_submissions (form, email, name, message, fields, page, visitor_id, ip_hash, status, created_at)
    values (args->>'form', args->>'email', args->>'name', args->>'message', args->>'fields', args->>'page',
      args->>'visitor_id', args->>'ip_hash', coalesce(args->>'status', 'new'), coalesce((args->>'created_at')::timestamptz, now()))
    returning to_jsonb(id) into r;
  when 'formsFromIp' then
    select to_jsonb(count(*)) into r from {{p}}form_submissions where ip_hash = args->>'ip_hash' and created_at > since_ts;
  when 'markEmailed' then
    update {{p}}form_submissions set emailed = true where id = (args->>'id')::bigint;

  -- ---------- analytics ----------
  when 'addEvent' then
    insert into {{p}}site_events (visitor_id, type, path, referrer, utm_source, utm_medium, utm_campaign, country, region, city, device, ts)
    values (args->>'visitor_id', args->>'type', args->>'path', args->>'referrer', args->>'utm_source', args->>'utm_medium',
      args->>'utm_campaign', args->>'country', args->>'region', args->>'city', args->>'device', coalesce((args->>'ts')::bigint, now_ms));
  when 'lastEventTs' then
    select to_jsonb(max(ts)) into r from {{p}}site_events;
  when 'analytics' then
    with pv as (select * from {{p}}site_events where type = 'pageview' and ts > since)
    select jsonb_build_object(
      'daily', (select coalesce(jsonb_agg(d order by d.day), '[]'::jsonb) from (
        select to_char(to_timestamp(ts / 1000.0) at time zone 'UTC', 'YYYY-MM-DD') as day,
               count(distinct visitor_id) as visitors, count(*) as views from pv group by 1) d),
      'pages', (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from (
        select path as label, count(*) as n from pv group by path order by n desc limit 10) x),
      'refs', (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from (
        select coalesce(referrer, 'Direct') as label, count(distinct visitor_id) as n from pv group by 1 order by n desc limit 10) x),
      'devices', (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from (
        select coalesce(device, 'unknown') as label, count(distinct visitor_id) as n from pv group by 1 order by n desc) x),
      'countries', (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from (
        select coalesce(country, '?') as label, count(distinct visitor_id) as n from pv group by 1 order by n desc limit 10) x),
      'visitors', (select count(distinct visitor_id) from pv),
      'views', (select count(*) from pv),
      'forms', (select count(*) from {{p}}form_submissions where created_at > since_ts)
    ) into r;
  when 'overview' then
    select jsonb_build_object(
      'visitors7', (select count(distinct visitor_id) from {{p}}site_events where type = 'pageview' and ts > since),
      'openMessages', (select count(*) from {{p}}form_submissions where status = 'new'),
      'latest', (select coalesce(jsonb_agg(l order by l.created_at desc, l.id desc), '[]'::jsonb) from (
        select id, form, name, email, created_at, status from {{p}}form_submissions order by created_at desc, id desc limit 5) l)
    ) into r;
  else
    raise exception 'Unknown admin store op: %', op;
  end case;
  return r;
end
$$;

revoke all on function {{p}}admin(text, jsonb) from public, anon, authenticated;
grant execute on function {{p}}admin(text, jsonb) to service_role;
