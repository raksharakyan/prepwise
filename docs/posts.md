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

## Post 3, Week 3 (outline)

Theme: integration and UI. Cover the Lovable rebuild, connecting Supabase, moving the
Gemini key into an Edge Function so it is not sitting in the browser, and session
history with progress over time. Include a screen recording of a live session.

## Post 4, Week 4 (outline)

Theme: shipping. Link the live app, embed the demo video, and write the honest
retrospective: what the AI got right, where it needed guardrails, what you would
build differently. Close the loop on the problem statement from Post 1.
