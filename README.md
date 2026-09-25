# Prepwise

Your one-stop AI prep for technical interview rounds.

**Live app:** https://prepwise--raksharakyan.replit.app

Built for the IIT Patna Generative AI for Professionals Capstone Sprint.

## What it does

Paste in a job description and Prepwise works out whether the round leans DSA, system design, or both. It then builds a custom 20 to 30 question set, mixes in questions you answer out loud, scores the session as a boss battle against "The Interviewer," and closes with a debrief covering readiness, strengths, focus areas, and one thing to work on next.

## How it works

1. **JD analysis**: the job description goes to Gemini, which returns the round type, its reasoning, and the topics to focus on. You can override the suggested round type.
2. **Question generation**: questions are generated in batches of five, scaling from fundamentals to edge cases. Each question is either multiple choice or speech-answered.
3. **Answering**: multiple choice is scored instantly in the browser. Spoken answers use the Web Speech API, with a typed fallback where the browser does not support it.
4. **Grading**: spoken transcripts go to Gemini for a 0 to 100 score plus written feedback.
5. **Debrief**: a per-category breakdown plus an AI-written summary of readiness, strengths, focus areas, and a tip.

## Stack

| Layer | Tool |
| --- | --- |
| AI | Google AI Studio (Gemini) |
| Voice | Web Speech API |
| Frontend | Lovable |
| Data | Supabase |
| API testing | Postman |

## Where this goes next

The debrief already works out which categories a candidate is weakest in. The next
step is to feed that back in: a follow-up session that skips what they have already
proven and generates questions only against the areas they lost points on, getting
harder each time those areas improve. That turns Prepwise from a single assessment
into something a candidate returns to across a whole interview cycle. It depends on
session history, which is what the Supabase work enables.

## Status

Working single-file prototype exists. Current focus is swapping the AI provider to Gemini so the app runs outside the Claude.ai sandbox, then porting to Lovable and wiring up Supabase.

## Setup

Copy `config.example.js` to `config.js` and fill in your Supabase URL and publishable key,
then serve the folder with any static server and open `index.html`:

```bash
python3 -m http.server 8000
```

No build step. The app is four files that deploy together: `index.html`, `styles.css`,
`app.js`, and your `config.js`.

`config.js` is gitignored and must never be committed.

### On the API key and the prompts

The Gemini key never reaches the browser. It lives as a secret on the Supabase Edge
Function in `supabase/functions/gemini/`, and the page calls that function. The function
also owns the four AI prompts: the page sends only a task name and its inputs (the job
description, a transcript, the scores), so the prompts are not readable from the page
source. Setup is in `docs/supabase-setup.md`.

## Repo layout

```
index.html     page markup
styles.css     all styles
app.js         all app logic: AI calls, battle, speech input, debrief
config.js      Supabase URL and publishable key (gitignored, copy from config.example.js)
supabase/      Edge Function that holds the Gemini key, and the database schema
postman/       collection that tests the live backend
docs/          prompts, setup guides, learnings, post drafts
assets/        1-pager and infographics
```

## Copyright

© 2026 Raksha Rakyan. All rights reserved. Prepwise, including its code, prompts, design
and documentation, is not open source. See `LICENSE`.
