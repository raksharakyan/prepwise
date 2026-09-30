# Postman tests

`prepwise.postman_collection.json` tests the live Prepwise backend: the `gemini` Edge
Function that holds the Gemini key, builds the prompts and calls Google, and the
`account` function that checks usernames. Each AI request sends a task name and its
inputs, the same way the app does, never a prompt.

## Run it

1. In Postman, **Import** and choose `prepwise.postman_collection.json`. It appears as **Prepwise AI backend v3**. Delete any older "Prepwise AI backend" collection: those send the publishable key as the login, which is now refused.
2. Fill in three collection variables (below).
3. Open the collection, click **Run**, and run the requests **in order**.

The URL and the publishable key are already set as collection variables. The Gemini key
is not in this collection and never needs to be. It lives only as a Supabase secret.

### The three variables

The AI calls need a signed in user, and sign in needs an emailed code and a Turnstile
check, so Postman cannot sign in by itself. Copy tokens from the app instead. Each
lasts an hour.

- `userAccessToken`: sign in to the live app with a test account, open the browser
  console and run `JSON.parse(localStorage["prepwise.auth"]).access_token`.
- `guestAccessToken`: in a private window, start a guest trial (Analyze an example job
  description), then run the same line there.
- `existingUsername`: your test account's username with its capitals changed, for
  example `rAKSHA_1` for `Raksha_1`.

## What each request checks

| Request | What it proves |
| --- | --- |
| 0a. Security | Calls without a key are refused with 401 before any Gemini call is made. Free. |
| 0b. Security | The publishable key alone, which ships in the page, is refused with 401. Free. |
| 1. Job description analysis | The round type is one of the three tracks, reasoning is present, and there are 4 to 7 topics. |
| 2. Question batch generation | Exactly 5 questions, exactly one spoken, every multiple choice question has 4 options and a valid answer, and no "All of the above" style options. |
| 3. Spoken answer grading | The score is a whole number from 0 to 100 and feedback is present. |
| 4. Session debrief | All four fields are present, 2 to 3 strengths and focus areas, and no em dashes. |
| 5a to 5c. Username check | A too short name is invalid, `adm1n_` is reserved as a lookalike of admin, and an existing name in other capitals is taken. Free. |
| 5d. Username check | The reply is only a status, nothing about the account behind it. Free. |
| 6. Guest trial | A guest cannot have a spoken answer graded (403, trial used). Free. |

Every AI request also checks the reply parses as JSON after stripping stray code fences,
which is the same parsing the app does.

## The requests chain, like the app

Request 1 saves the round type and topics, and request 2 uses them. Request 2 saves the
spoken question it generated, and request 3 grades an answer to it. Values are JSON
escaped when saved, so a question containing quotes or line breaks cannot break the next
request body.

## Cost

A full run is 4 Gemini requests, on a free tier of roughly 20 a day, and 4 of the test
account's 150 daily calls. Do not run the collection in a loop or with multiple
iterations: the username check also allows only 20 checks a minute per IP. Every
request other than 1 to 4 costs nothing.

Not covered here, since each would cost Gemini calls or be destructive: a guest's
second question batch being refused, and account deletion. Test those in the app.

## If a request fails

| Status | Meaning |
| --- | --- |
| 401 | The access token is missing or has expired (they last an hour), copy a fresh one |
| 404 | The Supabase function is not named `gemini` |
| 429 | The daily Gemini quota is used up, try tomorrow |
| 503 | Gemini is overloaded, wait a minute and rerun that request |
