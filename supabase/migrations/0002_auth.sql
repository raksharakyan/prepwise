-- Prepwise accounts.
--
-- Sign in is passwordless: a 6 digit code sent to an email address (phone
-- later). Supabase Auth owns the email or phone in auth.users. The only thing
-- Prepwise keeps about a person is a username, so this file adds no other
-- personal field anywhere.
--
-- Also here: the server side guest trial counter, a rate limiter the Edge
-- Functions share, and hourly cleanup jobs.
--
-- Run after 0001_sessions.sql. Safe to run again.

/* ---------------- profiles ---------------- */

create table if not exists public.profiles (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  -- Kept as typed for display. Uniqueness ignores case, see the index below.
  username             text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  username_changed_at  timestamptz,
  created_at           timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_idx on public.profiles (lower(username));

alter table public.profiles enable row level security;

drop policy if exists "own profile, read" on public.profiles;
create policy "own profile, read" on public.profiles for select using (auth.uid() = user_id);

-- Read only through the Data API. Every write goes through the functions
-- below, which apply the username rules. Supabase may grant everything on new
-- tables by default, so take that back first.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

/* ---------------- reserved names ----------------
   kind 'system' words are also caught as lookalikes (adm1n, _admin_, admin123).
   kind 'profanity' words are matched only as a whole name or a whole token
   between underscores and digits, so an ordinary name that happens to contain
   one inside it is not rejected. */

create table if not exists public.reserved_usernames (
  word  text primary key check (word = lower(word)),
  kind  text not null check (kind in ('system', 'profanity'))
);

alter table public.reserved_usernames enable row level security;

insert into public.reserved_usernames (word, kind)
select w, 'system' from unnest(array[
  'admin','administrator','root','superuser','sysadmin','support','help','helpdesk',
  'contact','info','security','abuse','postmaster','webmaster','hostmaster','noreply',
  'system','api','auth','login','signin','signup','logout','register','account',
  'accounts','settings','billing','payment','official','staff','team','mod','moderator',
  'owner','prepwise','prepround','interviewer','theinterviewer','boss','guest',
  'anonymous','user','username','null','undefined','nan','true','false','test','demo',
  'bot','everyone','here','me','you','supabase','gemini','google','claude','anthropic'
]) as w
on conflict (word) do nothing;

insert into public.reserved_usernames (word, kind)
select w, 'profanity' from unnest(array[
  'fuck','fucker','fucking','motherfucker','shit','bullshit','bitch','bastard','asshole',
  'arse','arsehole','dick','dickhead','cock','cunt','pussy','twat','wanker','prick',
  'slut','whore','porn','porno','sex','nude','nudes','rape','rapist','nazi','hitler',
  'nigger','nigga','faggot','fag','retard','spastic','tranny','chink','paki','kike',
  'chutiya','madarchod','behenchod','bhenchod','bhosdike','bhosdi','gandu','randi',
  'lund','lauda','harami','kutta','kamina','saala','chod'
]) as w
on conflict (word) do nothing;

/* ---------------- held names ----------------
   A name that is renamed away from, or whose account is deleted, stays
   unavailable to everyone else for 30 days, so nobody can take it straight
   away and pass as its old owner. */

create table if not exists public.username_holds (
  username_lower  text primary key,
  released_by     uuid,
  held_until      timestamptz not null
);

alter table public.username_holds enable row level security;

create or replace function public.hold_released_username()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or lower(old.username) <> lower(new.username) then
    insert into public.username_holds (username_lower, released_by, held_until)
    values (lower(old.username), old.user_id, now() + interval '30 days')
    on conflict (username_lower) do update
      set released_by = excluded.released_by, held_until = excluded.held_until;
  end if;
  return null;
end;
$$;

drop trigger if exists profiles_hold_released_username on public.profiles;
create trigger profiles_hold_released_username
  after update of username or delete on public.profiles
  for each row execute function public.hold_released_username();

/* ---------------- username rules ---------------- */

-- 'ok', 'invalid', 'reserved' or 'taken'. for_user lets someone reclaim a name
-- they themselves released, and ignores their own current name.
create or replace function public.username_status(name text, for_user uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n        text := lower(coalesce(name, ''));
  stripped text;
  leet     text;
begin
  if coalesce(name, '') !~ '^[A-Za-z0-9_]{3,20}$' then
    return 'invalid';
  end if;

  -- Lookalikes of system words: once with digits and underscores removed
  -- (admin123, _admin_), once with digits read as letters (adm1n, r00t).
  stripped := regexp_replace(n, '[0-9_]', '', 'g');
  leet     := regexp_replace(translate(n, '013457', 'oieast'), '[0-9_]', '', 'g');
  if exists (
    select 1 from public.reserved_usernames r
    where r.kind = 'system' and r.word in (n, stripped, leet)
  ) then
    return 'reserved';
  end if;

  -- Profanity: the whole name, or any whole token, read both ways.
  if exists (
    select 1 from public.reserved_usernames r
    where r.kind = 'profanity' and (
      r.word in (n, stripped, leet)
      or r.word in (select t from regexp_split_to_table(n, '[0-9_]+') t where t <> '')
      or r.word in (select t from regexp_split_to_table(translate(n, '013457', 'oieast'), '[_0-9]+') t where t <> '')
    )
  ) then
    return 'reserved';
  end if;

  if exists (
    select 1 from public.profiles p
    where lower(p.username) = n and p.user_id is distinct from for_user
  ) then
    return 'taken';
  end if;

  if exists (
    select 1 from public.username_holds h
    where h.username_lower = n and h.held_until > now()
      and h.released_by is distinct from for_user
  ) then
    return 'taken';
  end if;

  return 'ok';
end;
$$;

-- Caller must be signed in with a real (non guest) account and have no
-- username yet. Returns the same status words as username_status.
create or replace function public.claim_username(name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid    uuid := auth.uid();
  status text;
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where user_id = uid) then
    raise exception 'This account already has a username.' using errcode = '23505';
  end if;

  status := public.username_status(name, uid);
  if status <> 'ok' then
    return status;
  end if;

  begin
    insert into public.profiles (user_id, username) values (uid, name);
  exception when unique_violation then
    -- Someone claimed it between the check and the insert.
    return 'taken';
  end;
  delete from public.username_holds where username_lower = lower(name);
  return 'ok';
end;
$$;

-- At most once every 7 days. The old name is held by the trigger above.
create or replace function public.change_username(name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid    uuid := auth.uid();
  last_change  timestamptz;
  status text;
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  select username_changed_at into last_change from public.profiles where user_id = uid for update;
  if not found then
    raise exception 'This account has no username yet.' using errcode = 'P0002';
  end if;
  if last_change is not null and last_change > now() - interval '7 days' then
    return 'too_soon';
  end if;

  status := public.username_status(name, uid);
  if status <> 'ok' then
    return status;
  end if;

  begin
    update public.profiles set username = name, username_changed_at = now() where user_id = uid;
  exception when unique_violation then
    return 'taken';
  end;
  delete from public.username_holds where username_lower = lower(name);
  return 'ok';
end;
$$;

/* ---------------- rate limits ----------------
   Fixed windows. key is an HMAC of the caller's IP or a user id, never a raw
   IP: the Edge Functions hash it before it gets here. */

create table if not exists public.rate_limits (
  bucket        text not null,
  key           text not null,
  window_start  timestamptz not null,
  hits          int not null default 0,
  primary key (bucket, key, window_start)
);

alter table public.rate_limits enable row level security;

-- Counts one hit and says whether it is within max.
create or replace function public.hit_rate_limit(p_bucket text, p_key text, p_window_seconds int, p_max int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  w     timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  total int;
begin
  insert into public.rate_limits (bucket, key, window_start, hits)
  values (p_bucket, p_key, w, 1)
  on conflict (bucket, key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into total;
  return total <= p_max;
end;
$$;

-- Gives back a hit, for a call that failed upstream and should not count.
create or replace function public.refund_rate_limit(p_bucket text, p_key text, p_window_seconds int)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.rate_limits
  set hits = greatest(hits - 1, 0)
  where bucket = p_bucket and key = p_key
    and window_start = to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
$$;

/* ---------------- guest trial ----------------
   A guest is a Supabase anonymous user. The trial is one 5 question multiple
   choice round: a few analyses (so a non tech job description can be swapped),
   one question batch and one debrief. No spoken answers, so no grading. */

create table if not exists public.guest_usage (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  analyses       int not null default 0,
  question_sets  int not null default 0,
  debriefs       int not null default 0
);

alter table public.guest_usage enable row level security;

create or replace function public.consume_guest_call(p_user uuid, p_task text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  used public.guest_usage;
begin
  insert into public.guest_usage (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into used from public.guest_usage where user_id = p_user for update;

  if p_task = 'analyze' and used.analyses < 3 then
    update public.guest_usage set analyses = analyses + 1 where user_id = p_user;
  elsif p_task = 'questions' and used.question_sets < 1 then
    update public.guest_usage set question_sets = question_sets + 1 where user_id = p_user;
  elsif p_task = 'debrief' and used.debriefs < 1 then
    update public.guest_usage set debriefs = debriefs + 1 where user_id = p_user;
  else
    return false;
  end if;
  return true;
end;
$$;

create or replace function public.refund_guest_call(p_user uuid, p_task text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.guest_usage set
    analyses      = case when p_task = 'analyze'   then greatest(analyses - 1, 0)      else analyses end,
    question_sets = case when p_task = 'questions' then greatest(question_sets - 1, 0) else question_sets end,
    debriefs      = case when p_task = 'debrief'   then greatest(debriefs - 1, 0)      else debriefs end
  where user_id = p_user;
$$;

/* ---------------- who may call what ----------------
   Postgres lets everyone execute a new function by default, and Supabase also
   grants anon and authenticated. Take all of that back, then grant only what
   the page needs. Everything else is called by the Edge Functions with the
   service role. */

revoke all on function public.username_status(text, uuid)                 from public, anon, authenticated;
revoke all on function public.claim_username(text)                        from public, anon, authenticated;
revoke all on function public.change_username(text)                       from public, anon, authenticated;
revoke all on function public.hit_rate_limit(text, text, int, int)        from public, anon, authenticated;
revoke all on function public.refund_rate_limit(text, text, int)          from public, anon, authenticated;
revoke all on function public.consume_guest_call(uuid, text)              from public, anon, authenticated;
revoke all on function public.refund_guest_call(uuid, text)               from public, anon, authenticated;
revoke all on function public.hold_released_username()                    from public, anon, authenticated;

grant execute on function public.claim_username(text)  to authenticated;
grant execute on function public.change_username(text) to authenticated;

grant execute on function public.username_status(text, uuid)          to service_role;
grant execute on function public.hit_rate_limit(text, text, int, int) to service_role;
grant execute on function public.refund_rate_limit(text, text, int)   to service_role;
grant execute on function public.consume_guest_call(uuid, text)       to service_role;
grant execute on function public.refund_guest_call(uuid, text)        to service_role;

revoke all on public.reserved_usernames, public.username_holds, public.rate_limits, public.guest_usage
  from anon, authenticated;

/* ---------------- cleanup, hourly ----------------
   pg_cron ships with Supabase; this switches it on. */

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule('prepwise-cleanup', '7 * * * *', $job$
  -- Guest accounts, a week after they were made.
  delete from auth.users where is_anonymous and created_at < now() - interval '7 days';

  -- Sign ups that got a code but never picked a username.
  delete from auth.users u
  where not u.is_anonymous
    and u.created_at < now() - interval '24 hours'
    and not exists (select 1 from public.profiles p where p.user_id = u.id);

  -- The 30 day idle limit. Deleting a session also deletes its refresh
  -- tokens, so that device has to sign in again with a fresh code.
  delete from auth.sessions
  where coalesce(refreshed_at, updated_at, created_at) < now() - interval '30 days';

  delete from public.username_holds where held_until < now();
  delete from public.rate_limits where window_start < now() - interval '2 days';
$job$);
