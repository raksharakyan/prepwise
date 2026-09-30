# Prepwise

Your one-stop AI prep for technical interview rounds.

Built for the IIT Patna Generative AI for Professionals Capstone Sprint (4-week solo/team project).

## Problem

Candidates prepping for tech interviews rarely know exactly what to focus on. A job description might signal a DSA-heavy round, a system-design-heavy round, or both, but generic prep resources (LeetCode lists, YouTube playlists, static question banks) do not adapt to the specific role. Almost none of them let a candidate practice explaining an answer out loud, which is a core part of how real technical interviews are actually run and judged.

## Solution

Prepwise takes a pasted or uploaded job description and uses AI to:

1. Detect the right prep track: Technical/DSA, System Design, or Mixed, plus the key skills to focus on.
2. Generate a 20 to 30 question adaptive set mixing multiple-choice questions with a handful of open-ended questions answered by voice.
3. Grade spoken answers with AI and explain mistakes on wrong multiple-choice answers.
4. Structure the whole session as an interactive "boss battle" against The Interviewer (HP bars for user vs. boss, correct answers deal damage, wrong answers take damage, strong spoken answers land a critical hit) to keep it engaging.
5. Close with an AI-generated debrief: overall readiness, category-by-category performance breakdown, strengths, focus areas, and one concrete tip for the next session.

Currently scoped to technical interview rounds only (DSA and system design). Behavioral rounds and other domains (product, data) are a natural future expansion.

## Features to Build

- [x] JD input (paste text or upload a .txt file), with AI-driven round-type detection and topic extraction; user can override the suggested round type
- [x] Non tech job descriptions (sales, marketing, HR, finance and so on) get a friendly note that a proper helper for those roles is coming soon, with a choice to practise the role anyway or paste another job description. Practising it hides the DSA and System Design round types, uses the role title as the round, and defaults to multiple choice. The analysis prompt returns `is_tech_role` and `role_title`; only an explicit false triggers the note, so an older backend still works
- [x] Example job descriptions on the setup screen, three beginner roles (coding intern, junior web developer, IT support trainee), so anyone can try the app without finding one
- [x] Difficulty follows the role's level: the analysis detects Entry, Mid or Senior, the user can override it, and each level climbs its own difficulty ladder; grading and the debrief judge against the level
- [x] Batched adaptive question generation (20 or 30 total questions, or 5 as a quick demo), scaling up in difficulty across batches. The 5 question demo is a single batch, about 4 Gemini requests end to end instead of about 10, and always includes one spoken question
- [x] Two question types: multiple-choice (instant client-side scoring) and speech-answered (via browser voice input, with a manual typed fallback for unsupported browsers)
- [x] AI grading of spoken answers (0 to 100 score plus written feedback)
- [x] A wrong multiple choice answer is explained: the question prompt returns `option_notes`, one short note per option, so the feedback says why the pick was wrong before why the right answer is right. The prompt also requires exactly one correct option, and the page renders any stray markdown from the model (code in backticks, bold) instead of showing it raw
- [x] Redo and Show Correct Answer on spoken questions: the first attempt is the scored one and alone moves HP and the debrief; up to two redos are graded as practice only; the reference answer can be revealed any time and is revealed automatically once the last redo is graded
- [x] Boss-battle style UI: HP bars, category tags per question, live progress
- [x] A reload does not lose the round: the session (screen, question, HP, answers, a half typed answer, and the written debrief) is saved to the tab's sessionStorage and restored on load. A reload mid generation goes back to the analysis screen with the choices kept
- [x] AI-generated debrief screen with category breakdown and strengths/focus areas/tip
- [x] Swap AI provider from Claude API (only free inside Claude.ai artifacts) to Google AI Studio's Gemini API using a real free-tier API key, so the app works once deployed outside Claude.ai
- [ ] Passwordless accounts (built 2026-09-30, waiting on the Supabase dashboard setup in `docs/supabase-setup.md` section 7, then deploy): username plus email, a 6 digit code to sign in, no other personal data. Username is unique ignoring case, 3 to 20 letters, numbers or underscores, with a blocklist (system words also caught as lookalikes like `adm1n`, profanity as whole tokens) and a live availability check rate limited per hashed IP. Sign in and Create account send the same request and show the same message, so nobody can learn which emails are registered. Guests get one 5 question multiple choice round, enforced in the `gemini` function through Supabase anonymous sign in. Turnstile guards sending codes and starting a guest trial. Account page: change username (once a week, old name held 30 days), change email (codes to both addresses), sign out, sign out everywhere, delete account (needs a fresh code). Phone sign in is built behind `PHONE_AUTH` in `config.js`, off until an SMS provider is connected
- [ ] PDF parsing for JD uploads (currently only .txt/paste is supported)
- [x] Supabase Edge Function holding the Gemini key server side, so the app can be deployed without exposing it
- [ ] Supabase integration: persist session history, quiz results, and progress over time so users can track readiness across multiple sessions (schema and row level security are deployed, the app does not write to them yet)
- [ ] Rebuild the prototype in Lovable for a more polished app (deferred: course access never arrived, shipping on Replit instead; spec kept in `docs/lovable-build-prompt.md`)
- [ ] Adaptive follow-up sessions: use the debrief's category breakdown to generate the next question set against the user's weak areas only, skipping what they have already proven and raising difficulty as those areas improve (depends on Supabase session history)
- [ ] Optional: expand beyond technical/system-design rounds to behavioral prep

## Existing Prototype

The app is plain HTML, CSS and JavaScript with no build step, implementing the full flow above and verified end to end against the live Gemini API. It is three files plus a config: `index.html` holds the markup, `styles.css` the styles, and `app.js` all the logic. `config.js` (gitignored) holds the Supabase URL, publishable key, Turnstile site key and the `PHONE_AUTH` switch, and must load before `app.js`. All four are deployed together as a Replit static site. The page also loads supabase-js and Turnstile from their CDNs:

- JD paste/upload screen, then an AI-analysis screen showing detected round type + topics with override buttons and question-count/speech toggles
- Batched quiz generation: calls the LLM in batches of 5 questions at a time (to fit small max-token responses), building up to the full 20 or 30 question set with a live progress bar
- Battle screen: HP bars for "YOU" vs "THE INTERVIEWER," MCQ options or a mic-based speech input box depending on question type, instant feedback panel, "Next question" flow. Each hit is exactly 100 divided by the question count (a strong spoken answer deals double), and a knockout does not end the round: every question the user chose is asked, with a note under the progress once either side is at 0
- Speech input uses the browser's native `SpeechRecognition` / `webkitSpeechRecognition` API, with a textarea fallback for typing when unsupported or when the transcript needs editing
- Debrief screen: category breakdown bars plus an AI-written readiness summary, strengths, focus areas, and a tip. A guest's debrief ends with a prompt to create an account
- Sign in screen (Sign in and Create account tabs, a 6 digit code step, and a username step for new accounts) and an account screen, opened from the username button in the header. Signing out clears the round saved in sessionStorage

**Provider swap is done.** The prototype originally called `https://api.anthropic.com/v1/messages`
with no API key, which only worked inside Claude.ai's artifact sandbox. It now calls Google AI
Studio's Gemini API with a real free-tier key and runs anywhere.

Three things that broke during the swap, documented in `docs/ai-prompts.md`:

- `gemini-2.5-flash` is retired and returns 404 for newly issued keys. Use `gemini-3.6-flash`.
- Gemini 3.x models think before answering, and thinking tokens count against `maxOutputTokens`.
  A small budget gets consumed entirely by thinking and the reply comes back empty. All four
  prompts set `thinkingConfig.thinkingBudget` to 0.
- Transient 503s from Gemini are common enough that an unretried batch failure silently cut a
  20 question session down to 5. Retry 429 and 5xx with exponential backoff.

**The key is now server side.** As of 2026-09-24 the app calls a Supabase Edge Function named
`gemini`, which holds `GEMINI_API_KEY` as a project secret and calls Google. No browser ever
sees the key. Verified end to end: the function reaches Gemini, the page calls it cross origin,
and the response parses. Setup steps are in `docs/supabase-setup.md`.

**Remaining limitation, closed by accounts once deployed:** the live function still accepts the
publishable key alone, so anyone who reads it can spend the Gemini quota. The accounts change
makes `gemini` require a signed in user (a real account or a guest on the free trial), caps
guests at one 5 question round and signed in users at 150 calls a day, and restricts CORS to the
Replit site and localhost. A second function, `account`, checks usernames and deletes accounts.
Both keep `verify_jwt = false` and check the caller with Supabase Auth in code, since the platform
check refuses `sb_publishable_` keys. The page loads supabase-js 2.117.2 from jsDelivr with an SRI
hash and sets a Content-Security-Policy, so it has no inline scripts or handlers.

**The prompts are server side too.** As of 2026-09-25 the four prompts are built inside the
`gemini` function, not in `app.js`, so they cannot be read from the live page's source. The page
sends `{task, input}` where task is `analyze`, `questions`, `grade` or `debrief`, and the function
only runs those four prompts with fixed token budgets. The old direct to Google mode with a key in
`config.js` is gone. The difficulty ladders stay in `app.js` because the progress text shows them.
The page footer reads "Raksha Rakyan 🎀" and the repo has a proprietary `LICENSE`.

**The deployed `app.js` is minified.** GitHub keeps the readable `app.js`; Replit gets a copy
minified with Terser (top level names included), built into `dist/` (gitignored) by
`tools/minify.html` served from `tools/minify-server.py`. Every deploy ships `dist/app.js`, not
the root `app.js`. The build also stamps `index.html`, replacing `?v=dev` on `styles.css` and `app.js` with a hash of the build, so each deploy forces browsers past their cache, and a round saved in sessionStorage by an older deploy is dropped rather than restored. The Replit editor does not reliably save pasted code to disk, so files are
written from Replit's Shell with a base64 paste, checked with `md5sum`, then republished.

Prompt patterns in use, reproduced in full in `docs/ai-prompts.md`:

- **JD analysis prompt**: returns strict JSON `{round_type, level, reasoning, topics}` given the JD text, where level is Entry, Mid or Senior and sets how hard the questions get
- **Batch question generation prompt**: given round type, focus topics, batch index/total, and a difficulty hint, returns a strict JSON array of question objects `{question, type: "mcq"|"speech", options, correct_index, explanation, option_notes, category}`. Exactly one item per batch is `type: "speech"` when speech mode is enabled.
- **Speech grading prompt**: given the question, the ideal answer/key points (from `explanation`), and the candidate's transcript, returns strict JSON `{score, feedback}`
- **Debrief prompt**: given a compact summary string of per-question category/type/correct-or-score, plus the weak categories (under 70 percent) computed by the app, returns strict JSON `{overall_readiness, strengths, focus_areas, tip}`. Focus areas may only name weak categories; with none, the section is hidden and the tip suggests the next level up

All prompts request "ONLY a raw JSON object/array, no markdown fences, no commentary" and the client strips any stray code fences before `JSON.parse`.

## Tech Stack

| Category | Tool | Purpose |
| --- | --- | --- |
| LLM / AI | Google AI Studio, Gemini API | JD analysis, adaptive question generation, grading of spoken answers |
| Voice Input | Browser-native Web Speech API | Speech-to-text for spoken answers, with a manual typed fallback |
| Frontend | Replit (Lovable was intended, access never arrived) | Hosting the working HTML/JS prototype as a public web app |
| Backend / Data | Supabase | Accounts (passwordless email codes, guest trial via anonymous sign in), storing session history, quiz results, and progress over time |
| Security | Cloudflare Turnstile, Gmail SMTP | Turnstile is the bot check on sending codes and starting a guest trial; Gmail (app password) sends the sign in codes, since Supabase's built in email only reaches team addresses. Both sit outside the capstone's approved tool list, as supporting services only |
| Testing | Postman | Collection in `postman/` that tests the live backend: free security checks that calls without a key, or with only the publishable key, are refused; the four AI calls chained the way the app runs them, each with structural assertions; username check results; and a guest being refused a graded spoken answer. Access tokens are pasted in from the app, see `postman/README.md` |

## 4-Week Sprint Timeline

| Week | Theme | Objective | Deliverable | Date |
| --- | --- | --- | --- | --- |
| Week 1 | Ideation and Planning | Finalize project idea and submit 1-pager | 1-Page Idea Doc + Public Post #1 | Sept 5 |
| Week 2 | Core Build | Develop AI logic and data flow | Working prototype + Post #2 | Sept 12 |
| Week 3 | Integration and UI | Build frontend and connect to database | Functional web app + Post #3 | Sept 19 |
| Week 4 | Testing and Showcase | Finalize, polish, record demo | Demo Video + Documentation + Post #4 | Sun Sept 27 (extended from Sept 26) |

## Deliverables Checklist

- [x] Working web app, live at https://prepwise--raksharakyan.replit.app (Replit static deployment, verified 2026-09-24 against the live Supabase backend)
- [x] 1-Pager Idea Document (Problem, Solution, Features, Stack, Outcome)
- [ ] Demo video (3 to 5 minutes, screen recording with voiceover)
- [ ] Documentation / Notion page explaining system flow and learnings
- [ ] 4 build-in-public posts tagged #IITPatnaCapstone (one per week)

## Assets Already Created

- `prepwise-1pager.docx` / `prepwise-1pager.pdf`: the Week 1 1-Pager Idea Doc
- `prepwise-infographic.png`: a 1080x1350 infographic summarizing the problem, how it works (5 steps), tech stack, for use in build-in-public posts
- Draft caption for Post #1 (no em dashes, tech stack section uses emoji):

  ```
  Kicking off my Capstone Sprint at IIT Patna with Prepwise, a one-stop AI prep tool for technical interview rounds.

  Paste in a job description, and it figures out if you need to prep for DSA, system design, or both. Then it builds a custom question set, mixes in questions you answer out loud, and scores you in a boss battle format against "The Interviewer." You get a full debrief at the end: strengths, weak spots, and one thing to work on next.

  🧠 Tech stack to be used:
  🤖 Google AI Studio (Gemini) for the AI brain
  🎙️ Web Speech API for voice answers
  🎨 Lovable for the frontend
  🗄️ Supabase for storing sessions

  Week 1 done, prototype coming next 🚀

  #IITPatnaCapstone
  ```

## Working Rules

- **Do not read anything inside the `Ignore/` folder.** It is local scratch space, gitignored, and its contents are not part of the project. Do not open, search, summarize, or act on files there, even when a search would otherwise match them. If something in there is needed, the user will paste it directly.
- Commit and push to the `dev` branch. `main` is reached only through a pull request.
- **"FFD" means "add to the future feature doc."** When the user says FFD followed by an idea, add it as a new numbered entry at the bottom of `docs/future-features.md`. Use the same format as the other entries (status 💡 Idea, today's date, What, Why, Depends on), then commit and push to `dev`. Do not start building it.

## Style Notes

- No em dashes anywhere in copy (docs, posts, UI text). Use commas, colons, or parentheses instead.
- Do not refer to Prepwise as "a game." It is a one-stop AI prep tool for interview tech rounds; the boss-battle scoring is an interaction style within that tool, not its identity.
- Project name is "Prepwise" everywhere (not "Interview Arena," an earlier working name).
