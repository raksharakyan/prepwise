# Build in public posts

Tagged #IITPatnaCapstone. No em dashes. Never call Prepwise a game.

## Post 1, Week 1 (published)

Kicking off my Capstone Sprint at IIT Patna with Prepwise, a one-stop AI prep tool
for technical interview rounds.

Paste in a job description, and it figures out if you need to prep for DSA, system
design, or both. Then it builds a custom question set, mixes in questions you answer
out loud, and scores you in a boss battle format against "The Interviewer." You get a
full debrief at the end: strengths, weak spots, and one thing to work on next.

🧠 Tech stack to be used:
🤖 Google AI Studio (Gemini) for the AI brain
🎙️ Web Speech API for voice answers
🎨 Lovable for the frontend
🗄️ Supabase for storing sessions

Week 1 done, prototype coming next 🚀

#IITPatnaCapstone

## Post 2, Week 2 (final)

Image: `assets/prepwise-week2-infographic.png`

Week 2 of my IIT Patna Capstone Sprint: Prepwise works end to end. 🎯

Paste in a job description and it works out whether you are walking into a DSA round, a system design round, or both. It pulls out the exact topics worth studying, builds a 20 question set around them, and ramps from fundamentals up to senior level edge cases.

The part I am proudest of is answering out loud. A few questions drop the multiple choice options and open the mic instead. Gemini grades your spoken answer out of 100 against what a strong answer should cover, then tells you exactly what you missed. Nail it and you land a critical hit on The Interviewer.

🔧 What got built this week:
🤖 Google AI Studio (Gemini) powering all four AI steps
🎙️ Web Speech API for voice answers, with a typed fallback
⚔️ HP bars, damage per question, and a debrief that breaks down every topic
🔁 Automatic retries, because free tier APIs fail more often than you would think

Biggest lesson: the scariest bugs do not crash. At one point a single failed API call quietly turned a 20 question session into a 5 question one. No error, no warning, and everything looked fine. Now the app retries, and if it still comes up short, it tells you.

Next up is moving it to Lovable and adding Supabase so your sessions are saved. After that comes the feature I am most excited about: follow-up sessions that only target the topics you struggled with last time.

#IITPatnaCapstone #GenerativeAI #InterviewPrep #BuildInPublic

## Post 3, Week 3 (final, public version)

Framed as a GenAI engineering project for recruiters and developers. It deliberately carries
no course branding and no #IITPatnaCapstone tag, so it may not count toward the capstone's
tagged post requirement on its own.

I built an AI interview coach, and it's live. I'd love for you to try to break it. 🚀

👉 https://prepwise--raksharakyan.replit.app

Prepwise reads a job description, works out whether the round will lean DSA, system design or both, and builds a question set pitched at the role's level. Some questions you answer out loud, and an LLM grades what you said against what a strong answer should cover. You finish with a debrief on where you stand.

Try it in five minutes: pick an example job description, keep the 5 question demo, and answer at least one question out loud 🎙️

The interesting part was making an LLM behave inside a real product:
🧩 Four chained LLM calls (analysis, generation, grading, debrief), each returning strict JSON the app validates
📈 Difficulty calibrated to seniority, so an intern role gets intern questions
🎯 Grounded output: the debrief can only name weak areas your scores actually show
🎲 De-biasing: LLMs put the right answer in the first two options far too often, so the app places it itself
🔁 Retries and timeouts for a model that returns 503s under load
🔐 The API key lives in a Supabase Edge Function, never in the browser
🧪 A Postman suite that runs the whole pipeline end to end with structural checks

Favourite bug: I scored 100% in every category and my own app still told me I had three weak areas, two of which it had never even tested. 😅 The fix was to stop asking the model what's weak and compute it from the scores instead.

I'd really value feedback, especially from anyone who hires or interviews engineers:
❓ Did the questions feel like the right difficulty?
❓ Did the spoken answer grading feel fair?
❓ What would make you trust a tool like this before a real interview?

Voice works best in Chrome or Edge. It runs on a free AI tier, so if it says Gemini is busy, give it a minute 🙂

🛠️ Stack: Gemini API · Web Speech API · Supabase Edge Functions · Postman · Replit

#GenerativeAI #LLM #AIEngineering #PromptEngineering #BuildInPublic

## Post 4, Week 4 (outline)

Theme: shipping. Link the live app, embed the demo video, and write the honest
retrospective: what the AI got right, where it needed guardrails, what you would
build differently. Close the loop on the problem statement from Post 1.
