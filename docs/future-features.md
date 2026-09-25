# Prepwise: Future Features

Ideas for after the capstone. New ones are added whenever Raksha says **FFD**, newest at the bottom of the list.

Each entry has what it is, why it matters, and anything it depends on. Once a feature ships, it moves to the Features checklist in `CLAUDE.md` and its entry here is marked done.

| Status | Meaning |
| --- | --- |
| 💡 Idea | Captured, not planned yet |
| 🛠️ Planned | Decided on, design in progress |
| ✅ Done | Shipped, see `CLAUDE.md` |

---

## 1. PDF upload for job descriptions
**Status:** 💡 Idea · **Added:** 2026-09-25

- **What:** Accept a .pdf job description as well as .txt and pasted text, and extract the text in the browser.
- **Why:** Most job descriptions are saved or shared as PDFs, so needing a .txt adds friction.
- **Depends on:** Nothing.

## 2. Session history
**Status:** 💡 Idea · **Added:** 2026-09-25

- **What:** Save each session's results to Supabase so a user can see their readiness change over time.
- **Why:** One session gives a snapshot. A history shows progress.
- **Depends on:** Sign in (the `sessions` and `answers` tables, row level security and `category_performance` view are already deployed).

## 3. Adaptive follow-up sessions on weak areas
**Status:** 💡 Idea · **Added:** 2026-09-25

- **What:** Build the next question set from the debrief's weak categories only. Skip what the user has already proven, and raise the difficulty as those areas improve.
- **Why:** This is practice aimed at the actual gaps, and nothing else.
- **Depends on:** Session history (#2).

## 4. Sign in, and lock the Gemini function to signed in users
**Status:** 💡 Idea · **Added:** 2026-09-25

- **What:** Add Supabase Auth, and have the `gemini` Edge Function check for a signed in user before calling Gemini.
- **Why:** At the moment, anyone who reads the publishable key in the page can call the function and use up the Gemini quota.
- **Depends on:** Nothing. It also unblocks #2.

## 5. Behavioral rounds
**Status:** 💡 Idea · **Added:** 2026-09-25

- **What:** A third track alongside Technical/DSA and System Design, with STAR style spoken questions graded on structure and impact.
- **Why:** Most interview loops include a behavioral round.
- **Depends on:** Nothing.

## 6. Rebuild in Lovable
**Status:** 💡 Idea · **Added:** 2026-09-25

- **What:** Rebuild the frontend in Lovable for a more polished UI.
- **Why:** This was the original plan. It was deferred because course access never arrived.
- **Depends on:** Lovable access. The spec is in `docs/lovable-build-prompt.md`.

## 7. Baseline level from current company and role
**Status:** 💡 Idea · **Added:** 2026-09-25

- **What:** Ask for the user's current company and role, and use them to set a baseline difficulty that the job description then adjusts.
- **Why:** The job description tells us about the role, but not where the candidate is starting from. A mid-level engineer applying for a senior role needs a different ladder from a new grad applying for the same role.
- **Depends on:** Nothing. Both fields are optional, and nothing is stored without sign in (#4).

## 8. Company specific questions from real interview reports
**Status:** 💡 Idea · **Added:** 2026-09-25

- **What:** Ask which company the user is interviewing with. Pull interview questions that past candidates reported for that company and role through an Apify connector (sources like Glassdoor and LinkedIn), and mix them into the question set.
- **Why:** Real questions from a company's own loop are the most targeted prep possible.
- **Depends on:** An Apify account and a server side function to run the scrapes and cache the results, because the Apify token must stay out of the browser, the same way the Gemini key does. Check each site's terms of service first: Glassdoor and LinkedIn both restrict scraping. A permitted source or an official API may be needed instead.

## 9. Coding editor for coding rounds
**Status:** 💡 Idea · **Added:** 2026-09-25

- **What:** Add a third question type: a coding problem with an in-browser editor (for example Monaco), language selection, and hidden test cases. Gemini reviews the code for correctness, complexity and style.
- **Why:** DSA rounds are usually about writing code, not picking an answer from a list.
- **Depends on:** A safe way to run the code, either a sandboxed runner such as Judge0 or in-browser runtimes like Pyodide for Python. Gemini-only review works as a first step.
