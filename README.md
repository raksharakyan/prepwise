# Prepwise

Your one-stop AI prep for technical interview rounds.

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

## Status

Working single-file prototype exists. Current focus is swapping the AI provider to Gemini so the app runs outside the Claude.ai sandbox, then porting to Lovable and wiring up Supabase.

## Setup

Copy `.env.example` to `.env` and add a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).

## Repo layout

```
assets/    1-pager, infographic, and other build-in-public material
docs/      system flow notes and learnings
```
