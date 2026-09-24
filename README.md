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

Copy `config.example.js` to `config.js` and add a Gemini API key from
[Google AI Studio](https://aistudio.google.com/apikey), then open `index.html`.

`config.js` is gitignored and must never be committed.

### On the API key

The key is read from `config.js` rather than typed into the interface, and it is not
written to localStorage. That keeps it out of the UI and out of version control, but
it does not keep it out of the browser: anyone who can load a deployed copy of the
page can read `config.js`.

So this arrangement is for local runs and demo recordings. To deploy publicly, the
Gemini call moves into a Supabase Edge Function that holds the key as a server side
secret, and the page calls that function instead of calling Google directly. Prompt 2
in `docs/lovable-build-prompt.md` covers it.

## Repo layout

```
assets/    1-pager, infographic, and other build-in-public material
docs/      system flow notes and learnings
```
