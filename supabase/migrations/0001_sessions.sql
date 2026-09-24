-- Prepwise session history.
--
-- Two tables: one row per completed session, one row per answered question.
-- The answers table is what makes adaptive follow-up sessions possible later:
-- it holds the per category record needed to work out where a candidate is weak.

create table if not exists public.sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  created_at      timestamptz not null default now(),
  round_type      text not null,
  topics          text[] not null default '{}',
  question_count  int  not null,
  you_hp          int  not null,
  boss_hp         int  not null,
  readiness       text
);

create table if not exists public.answers (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions (id) on delete cascade,
  created_at  timestamptz not null default now(),
  question    text not null,
  category    text not null,
  -- 'mcq' or 'speech'
  type        text not null check (type in ('mcq', 'speech')),
  -- set for mcq answers, null for speech
  correct     boolean,
  -- set for speech answers (0 to 100), null for mcq
  score       int check (score between 0 and 100),
  constraint answers_outcome_matches_type check (
    (type = 'mcq'    and correct is not null and score   is null) or
    (type = 'speech' and score   is not null and correct is null)
  )
);

create index if not exists sessions_user_created_idx on public.sessions (user_id, created_at desc);
create index if not exists answers_session_idx       on public.answers  (session_id);
create index if not exists answers_category_idx      on public.answers  (category);

-- Row level security: a signed in user only ever sees their own rows.
alter table public.sessions enable row level security;
alter table public.answers  enable row level security;

create policy "own sessions, read"   on public.sessions for select using (auth.uid() = user_id);
create policy "own sessions, insert" on public.sessions for insert with check (auth.uid() = user_id);
create policy "own sessions, delete" on public.sessions for delete using (auth.uid() = user_id);

-- Answers are reached through their session, so the policy follows the session's owner.
create policy "own answers, read" on public.answers for select
  using (exists (select 1 from public.sessions s where s.id = answers.session_id and s.user_id = auth.uid()));

create policy "own answers, insert" on public.answers for insert
  with check (exists (select 1 from public.sessions s where s.id = answers.session_id and s.user_id = auth.uid()));

-- Weak areas per user, newest sessions first. This is the query the adaptive
-- follow-up feature will read to decide what to ask next.
create or replace view public.category_performance
with (security_invoker = true) as
select
  s.user_id,
  a.category,
  count(*)                                                          as answered,
  round(avg(case when a.type = 'speech' then a.score
                 when a.correct then 100 else 0 end))               as avg_score,
  max(s.created_at)                                                 as last_seen
from public.answers a
join public.sessions s on s.id = a.session_id
group by s.user_id, a.category;

-- Explicit Data API grants.
--
-- These make the migration work the same whether or not the project has
-- "Automatically expose new tables" switched on. With it off, which is the
-- safer setting Supabase itself recommends, nothing reaches the Data API
-- unless it is granted here deliberately.
--
-- Only the authenticated role is granted. Anonymous visitors get nothing, and
-- row level security still limits every authenticated user to their own rows.
-- Nothing is granted on update: a finished session is a record of what
-- happened and should not be edited afterwards.
grant usage on schema public to authenticated;

grant select, insert, delete on public.sessions to authenticated;
grant select, insert            on public.answers  to authenticated;
grant select                    on public.category_performance to authenticated;
