# Question bank setup

The question bank holds interview questions candidates have reported for a company and role.
When someone fills in the Company or Role field on the analysis screen, each question batch
retrieves the closest reports (RAG) and bases one or two questions on them. Those questions
show a "Reported at Stripe · Reddit" tag that links to the report.

```
Make.com (weekly) ──> bank function ──> Gemini extracts questions, strips personal details
                                    └─> Gemini embeddings ──> Supabase bank_questions (pgvector)
Prepwise page ──> gemini function ──> embeds the batch, match_bank_questions ──> prompt (RAG)
                                  └─> stores the generated batch as source "prepwise"
```

Generated questions are stored too, so the bank grows with use, but they are never handed to the
prompt as reports: the "Reported at" tag only ever comes from a real source.

## 1. Create the table

Supabase dashboard, **SQL Editor**, **New query**: paste the whole of
`supabase/migrations/0002_question_bank.sql` and run it. It turns on the `vector` extension and
creates `bank_questions` and the `match_bank_questions` search function. Row level security is
on with no policies, so the page's publishable key can neither read nor write the bank.

## 2. A second Gemini key for collection

Collection makes a Gemini call per 20 posts. To keep that off the app's free daily requests,
create a key in a **separate Google Cloud project** at aistudio.google.com/apikey (each project
has its own quota). If you skip this, collection falls back to the app's key.

## 3. Secrets

**Edge Functions**, **Secrets**, add:

| Name | Value |
| --- | --- |
| `BANK_INGEST_SECRET` | A long random string. Make sends it; anyone without it is refused. |
| `GEMINI_INGEST_KEY` | The key from step 2 |

Optional: `EMBED_MODEL` (default `gemini-embedding-001`) and `BANK_MIN_SIMILARITY` (default
`0.6`, how close a report must be to count). `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are
provided to functions automatically.

## 4. Deploy the functions

1. **Create a new function** named exactly `bank`, paste `supabase/functions/bank/index.ts`,
   deploy.
2. Open `gemini`, paste the new `supabase/functions/gemini/index.ts`, deploy. The new inputs are
   optional, so the live page keeps working before it is updated.

## 5. Reddit API access

Reddit's official API, used with attribution: every stored report keeps its post link.

1. Signed in to Reddit, open reddit.com/prefs/apps and **create another app**.
2. Type **script**, any name, redirect URI `http://localhost`.
3. Note the client ID (under the app name) and the secret.

## 6. Make.com scenario (free plan)

The free plan allows about 1,000 operations a month. A weekly run over 5 company and role pairs
uses roughly 150 to 200 operations per run, which fits.

**Data store** `prepwise_targets`, one record per pair to collect:
`company` (text), `role` (text), `apify` (yes or no).

**Scenario** "Prepwise question bank", scheduled weekly:

1. **Data store, Search records** in `prepwise_targets`: one bundle per pair.
2. **Router** with three routes.

Every call to the bank uses **HTTP, Make a request**:
- URL `https://<project>.supabase.co/functions/v1/bank`, method POST, body type Raw, JSON
- Headers `Authorization: Bearer <publishable key>` and `x-bank-secret: <BANK_INGEST_SECRET>`

**Route A, web search** (1 operation per pair). Body:
`{"action": "harvest", "company": "{{company}}", "role": "{{role}}"}`.
Gemini searches public interview write-ups and stores what it finds, each with its page link.

**Route B, Reddit**:
1. HTTP POST `https://www.reddit.com/api/v1/access_token`, basic auth with the client ID and
   secret, form body `grant_type=client_credentials`, header
   `User-Agent: prepwise-bank/1.0 by <your reddit username>`.
2. HTTP GET `https://oauth.reddit.com/search?q={{company}} {{role}} interview&sort=new&t=year&limit=25`,
   headers `Authorization: Bearer {{access_token}}` and the same User-Agent. Parse response on.
3. **Iterator** over `data.children`, then **Array aggregator** building items shaped
   `{"text": "{{data.title}}\n\n{{data.selftext}}", "url": "https://www.reddit.com{{data.permalink}}", "source": "reddit", "company": "{{company}}", "role": "{{role}}"}`.
4. Bank call with body `{"action": "ingest", "items": {{array}}}`.

**Route C, Apify** (filter: `apify` equals yes). Off unless a pair opts in.
1. **Apify, Run an Actor** with the actor you chose for LinkedIn posts or Glassdoor interview
   questions, waiting for it to finish.
2. **Apify, Get Dataset Items**, then **Iterator** and **Array aggregator** as in route B, mapping
   only the post or question text and its URL, with `source` set to `apify_linkedin` or
   `apify_glassdoor`. Map no names, profile links or other personal fields.
3. Bank call with `{"action": "ingest", "items": {{array}}}`.

> **Risk note.** LinkedIn's and Glassdoor's terms forbid scraping, LinkedIn has taken scrapers to
> court, and Apify is not on the capstone's approved tool list. Route C is kept separate so it can
> stay off; the bank works on routes A and B alone. The Apify token lives only in Make's
> connection, never in this repo.

## 7. Check it

1. Run the scenario once with one pair.
2. Supabase, **Table Editor**, `bank_questions`: rows with `source`, `source_url`, and no names
   or contact details in `question`.
3. In Prepwise, analyse a job description, fill in that company, and build a 5 question demo.
   At least one question should carry the "Reported at" tag.

| Response | Meaning |
| --- | --- |
| 401 "x-bank-secret" | The header is missing or does not match the secret |
| 401 from the gateway | The Authorization bearer is missing |
| 500 "BANK_INGEST_SECRET is not set" | Add the secret, at least 16 characters |
| 429 | The collection key's daily quota is used up, run again tomorrow |
| `inserted: 0, skipped: n` | Everything collected was already in the bank |
