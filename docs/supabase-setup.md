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

The function takes `{task, input}`, where task is one of `analyze`, `questions`,
`grade` or `debrief`. It builds that task's prompt from the input, adds the key, calls
Gemini, and returns Gemini's response body and status code untouched. That means the
client keeps its existing parsing, retries and error handling, and real Gemini errors
such as 429 and 503 still reach it.

The prompts live only in this function, never in the page, so nobody can read them
from View Source. It also means the function only runs Prepwise's own prompts: a
caller cannot send an arbitrary prompt or choose its own token budget.

Whenever `index.ts` changes, paste the new version into the dashboard and deploy it
before redeploying the site, since the page and the function must agree on the
request format.

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
| 401 | Not signed in (no guest or account session), or the anon key is wrong or missing from `config.js` |
| 400 with "task must be one of" | The page and the function are out of step, redeploy both |
| 404 | The function is not named exactly `gemini` |
| 500 with "GEMINI_API_KEY is not set" | The secret was not saved, or the function needs redeploying after adding it |
| 429 | Gemini quota is gone. The daily one (about 20 requests on the free tier) shows a friendly "resets at midnight Pacific" message in the app; per minute limits are retried automatically |
| 503 | Gemini is busy, the client retries this automatically |

Function logs are under **Edge Functions**, then your function, then **Logs**.

## 7. Accounts and sign in

Prepwise accounts are passwordless: a username plus an email address, and a 6 digit
code each time you sign in. Anyone can try one round first as a guest (5 multiple
choice questions, no spoken answers). Everything below is done once.

### 7.1 Create the tables

**SQL Editor**, **New query**, paste the whole of `supabase/migrations/0002_auth.sql`
and run it. It creates:

| Object | What it holds |
| --- | --- |
| `profiles` | One row per account: the username, and when it last changed. Nothing else |
| `reserved_usernames` | Blocked names: system words (also caught as lookalikes like `adm1n`) and a profanity list |
| `username_holds` | Names released by a rename or a deleted account, kept from everyone else for 30 days |
| `rate_limits` | Counters for the username check and the guest trial, keyed by hashed IP, never a raw one |
| `guest_usage` | How much of the free trial each guest session has used |

It also switches on `pg_cron` and schedules an hourly cleanup: guest sessions after 7
days, sign ups that never picked a username after 24 hours, and any sign in unused for
30 days (that device then needs a new code).

Quick check, in the same editor:

```sql
select n, public.username_status(n) from unnest(array['Raksha_1','ab','ADMIN','adm1n_','shit_happens','Scunthorpe']) n;
```

Expected: ok, invalid, reserved, reserved, reserved, ok. Once your own account
exists, your username in different capitals should say taken.

### 7.2 Gmail as the email sender

Supabase's built in email only reaches your own team's addresses and a few per hour,
so real users would never get their codes.

1. On the Google account that will send the codes, turn on 2-Step Verification.
2. Go to myaccount.google.com/apppasswords, create an app password named Prepwise, and
   copy the 16 characters.
3. In Supabase: **Authentication**, **Emails**, **SMTP Settings**, enable custom SMTP:

| Field | Value |
| --- | --- |
| Sender email | the Gmail address |
| Sender name | Prepwise |
| Host | `smtp.gmail.com` |
| Port | `587` |
| Username | the Gmail address |
| Password | the app password |

Gmail sends about 500 emails a day. Codes can land in spam at first.

### 7.3 Codes, not links

**Authentication**, **Emails**, **Templates**. Replace the body of **Magic Link** with:

```html
<h2>Your Prepwise code</h2>
<p>Enter this code to sign in. It works for 10 minutes.</p>
<p style="font-size:28px;letter-spacing:6px"><strong>{{ .Token }}</strong></p>
<p>If you did not ask for this, ignore this email.</p>
```

Do the same for **Confirm signup** and **Change Email Address** (for the change
template, say "to confirm your new email address"). No template may contain
`{{ .ConfirmationURL }}`: a link can be opened by mail scanners and breaks when the
email is read on a different device.

### 7.4 Auth settings

**Authentication**, **Sign In / Providers**:

- **Email**: on. Confirm email: on. Secure email change: on (a code goes to both the
  old and new address). Email OTP expiration: `600` seconds. Email OTP length: `6`.
- **Allow anonymous sign-ins**: on (this is the guest trial).
- **Phone**: leave off until an SMS provider (Twilio, Vonage, MessageBird or
  Textlocal) is connected. Then turn it on, set `PHONE_AUTH: true` in `config.js`,
  and redeploy the page.

**Authentication**, **Rate Limits**: set emails per hour to what Gmail can take (for
example 100), and anonymous sign-ins per IP to `5` per hour.

**Authentication**, **URL Configuration**: Site URL
`https://prepwise--raksharakyan.replit.app`.

### 7.5 Turnstile bot check

1. In Cloudflare, **Turnstile**, add a widget: mode **Managed**, hostnames
   `prepwise--raksharakyan.replit.app` and `localhost`.
2. Copy the site key into `config.js` as `TURNSTILE_SITE_KEY`.
3. In Supabase, **Authentication**, **Attack Protection**, enable captcha protection,
   choose Turnstile, and paste the **secret** key.

From then on Supabase refuses to send a code or start a guest trial without a passed
check. Most people never see it; Cloudflare only asks for a click when unsure.

### 7.6 Secrets and functions

**Edge Functions**, **Secrets**, add:

| Name | Value |
| --- | --- |
| `RATE_LIMIT_SALT` | A long random string, for example from `openssl rand -hex 32`. Used to hash IPs |
| `ALLOWED_ORIGINS` | `https://prepwise--raksharakyan.replit.app` (optional, this is the default) |

Redeploy `gemini` with the new `supabase/functions/gemini/index.ts`, then create a
second function named exactly `account` from `supabase/functions/account/index.ts`.
For both, keep **Enforce JWT verification** off: each checks the caller itself, and
the platform check would refuse the `sb_publishable_` key the username check needs.

Deploy the functions before the new page, since the new page expects them.

## What this does and does not fix

It fixes key exposure. The key is server side and no browser sees it.

It closes the open quota. The `gemini` function now needs a signed in user: the
publishable key alone gets a 401. Guests get one 5 question multiple choice round,
enforced in the function (the page cannot ask for more), plus a limit of 2 guest
rounds per IP per day. Signed in users get up to 150 AI calls a day.

Known limits, accepted at this scale:

- A known and an unknown email take slightly different times to answer. The message
  is identical, but timing is not masked.
- A 6 digit code could in principle be guessed, but only within Supabase's limit on
  attempts per IP and the 10 minute expiry.
- Changing your email to an address that already has an account is refused, which
  tells the signed in user that address is registered.
- The IP used for the guest and username limits comes from `x-forwarded-for`, which
  can be forged. That is why those limits sit on top of Turnstile and the per guest
  counter, and the username check also has a total limit across everyone.
