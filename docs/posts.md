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

## Post 3, Week 3 (final)

Prepwise is live, and I'd love for you to try to break it. 🚀

👉 Try it here: https://prepwise--raksharakyan.replit.app

Prepwise is my one-stop AI prep tool for technical interview rounds, built for the IIT Patna Capstone Sprint. Paste a job description and it works out what the round will focus on, builds a question set around it, lets you answer some questions out loud, and scores you in a boss battle against The Interviewer. Then it tells you where you stand.

You can try it in about five minutes:
1️⃣ Pick an example job description, no need to find your own
2️⃣ Keep the 5 question quick demo
3️⃣ Answer at least one question out loud 🎙️
4️⃣ Read your debrief

What changed since last week:
🔐 The AI key now lives on a Supabase server, never in your browser
📈 Questions match the role's level, so an intern role gets intern questions
🔁 You can redo spoken answers to practise, and only your first try counts
🎯 The debrief is grounded in your actual scores

Favourite bug this week: I scored 100% in every category, and my own app still told me I had three weak areas, two of which it had never even tested. 😅 Now the app decides what counts as weak, and if nothing is, it tells you to level up instead.

I'd really value your feedback:
❓ Did the questions feel like the right difficulty?
❓ Did answering out loud work, and did the grading feel fair?
❓ What would make you use this before a real interview?

Drop a comment or DM me. Voice works best in Chrome or Edge. If it says Gemini is busy, give it a minute, it runs on a free tier 🙂

🧠 Built with:
🤖 Google AI Studio (Gemini)
🎙️ Web Speech API
🗄️ Supabase
🧪 Postman
🚀 Replit

#IITPatnaCapstone #GenerativeAI #InterviewPrep #BuildInPublic

## Post 4, Week 4 (outline)

Theme: shipping. Link the live app, embed the demo video, and write the honest
retrospective: what the AI got right, where it needed guardrails, what you would
build differently. Close the loop on the problem statement from Post 1.
