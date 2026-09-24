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
