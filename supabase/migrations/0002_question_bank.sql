-- Prepwise question bank.
--
-- Interview questions candidates have reported for a company and role, plus
-- the questions Prepwise itself generates, each stored with an embedding so a
-- question batch can retrieve the closest real reports (RAG). Rows arrive
-- through the bank and gemini Edge Functions only: row level security is on
-- with no policies, so the publishable key in the page can neither read nor
-- write this table. The functions use the service role.

create extension if not exists vector with schema extensions;

create table if not exists public.bank_questions (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  question      text not null check (char_length(question) between 10 and 400),
  company       text,
  role          text,
  topic         text,
  level         text check (level in ('Entry', 'Mid', 'Senior')),
  -- Where it came from. Only prepwise rows are AI generated; the rest are
  -- reports by real candidates, which is what the "real report" label means.
  source        text not null check (source in
                  ('search', 'reddit', 'prepwise', 'apify_linkedin', 'apify_glassdoor')),
  source_url    text,
  -- sha256 of the normalised question and company, so the same report
  -- collected twice is stored once.
  content_hash  text not null unique,
  -- gemini-embedding-001 cut to 768 dimensions.
  embedding     extensions.vector(768) not null
);

create index if not exists bank_questions_company_idx on public.bank_questions (lower(company));
create index if not exists bank_questions_source_idx  on public.bank_questions (source);

alter table public.bank_questions enable row level security;

-- Closest questions to a query embedding. A row from the named company gets a
-- head start of 0.15 in distance, so company reports win over close generic
-- ones. Generated rows are left out unless asked for, so anything this
-- returns by default really was reported by a candidate.
create or replace function public.match_bank_questions(
  query_embedding   extensions.vector(768),
  company_name      text    default null,
  match_count       int     default 8,
  include_generated boolean default false
)
returns table (
  id          bigint,
  question    text,
  company     text,
  role        text,
  source      text,
  source_url  text,
  similarity  float
)
language sql stable
set search_path = public, extensions
as $$
  select b.id, b.question, b.company, b.role, b.source, b.source_url,
         1 - (b.embedding <=> query_embedding) as similarity
  from public.bank_questions b
  where include_generated or b.source <> 'prepwise'
  order by (b.embedding <=> query_embedding)
         - case when company_name is not null and company_name <> ''
                     and lower(b.company) = lower(company_name) then 0.15 else 0 end
  limit least(greatest(match_count, 1), 20);
$$;

-- Only the Edge Functions (service role) may search the bank.
revoke execute on function public.match_bank_questions(extensions.vector, text, int, boolean) from public, anon, authenticated;
grant  execute on function public.match_bank_questions(extensions.vector, text, int, boolean) to service_role;
