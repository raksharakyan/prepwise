# Supabase setup

Goal: the Gemini API key stops living in the browser and becomes a server side
secret. The page calls a Supabase Edge Function, the function adds the key, and no
visitor can ever read it.

Everything here is done in the Supabase dashboard. No CLI needed.

## 1. Create the project

New project, any name, any region close to you. Set a database password and keep it
somewhere safe. The free tier is enough.

Wait for it to finish provisioning, which takes a couple of minutes.

## 2. Create the tables

Left sidebar, **SQL Editor**, then **New query**. Paste the whole of
`supabase/migrations/0001_sessions.sql` from this repo and run it.

That creates two tables and a view:

| Object | What it holds |
| --- | --- |
| `sessions` | One row per completed session: round type, topics, final HP, readiness |
| `answers` | One row per answered question: category, type, and either correct or score |
| `category_performance` | A view averaging scores per category per user |

Row level security is switched on, so a signed in user can only ever read and write
their own rows. The view is the query the adaptive follow-up feature will read to
decide which topics to ask about next.

## 3. Add the Gemini key as a secret

Left sidebar, **Edge Functions**, then **Secrets** (called Manage secrets in some
versions of the dashboard). Add:

| Name | Value |
| --- | --- |
| `GEMINI_API_KEY` | Your key from aistudio.google.com/apikey |
| `GEMINI_MODEL` | `gemini-3.6-flash` (optional, this is the default) |

This is the only place the key is stored. Do not put it anywhere else.

## 4. Deploy the function

Left sidebar, **Edge Functions**, then **Create a new function**. Name it exactly
`gemini`, because the client builds the URL from that name. Paste the whole of
`supabase/functions/gemini/index.ts` and deploy.

The function is a thin proxy. It takes `{prompt, maxOutputTokens}`, adds the key,
calls Gemini, and returns Gemini's response body and status code untouched. That
means the client keeps its existing parsing, retries and error handling, and real
Gemini errors such as 429 and 503 still reach it.

## 5. Point the app at it

Left sidebar, **Project Settings**, then **API**. Copy the **Project URL** and the
**anon public** key.

Put them in `config.js`:

```js
window.PREPWISE_CONFIG = {
  SUPABASE_URL: "https://yourproject.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGci..."
};
```

Delete `GEMINI_API_KEY` from `config.js` once this works. Its presence is what keeps
the old direct-to-Google path alive.

The anon key is safe in the browser. It is a public client key, it is meant to ship
in frontend code, and row level security is what actually protects the data. The
**service_role** key is the opposite: it bypasses row level security entirely. Never
put that one in `config.js`, in the repo, or in any page.

## 6. Check it works

Reload the app and run a job description through it. If the analysis screen appears,
the whole chain worked.

If it fails, open the browser console and look at the network request to
`/functions/v1/gemini`:

| Status | Meaning |
| --- | --- |
| 401 | The anon key is wrong or missing from `config.js` |
| 404 | The function is not named exactly `gemini` |
| 500 with "GEMINI_API_KEY is not set" | The secret was not saved, or the function needs redeploying after adding it |
| 429 | Gemini daily quota is gone, about 20 requests a day on the free tier |
| 503 | Gemini is busy, the client retries this automatically |

Function logs are under **Edge Functions**, then your function, then **Logs**.

## What this does and does not fix

It fixes key exposure. The key is server side and no browser sees it.

It does not add authentication. Right now anyone who knows the function URL and the
anon key can call it and spend your Gemini quota. That is acceptable for a demo. To
close it, require a signed in user in the function by verifying the JWT, which
arrives on the `Authorization` header, and turn on email sign in. That is the same
work as session history, since `sessions.user_id` needs a real user anyway.
