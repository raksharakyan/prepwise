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

## Post 2, Week 2 (draft)

Week 2 of my IIT Patna Capstone Sprint: Prepwise now runs end to end.

Paste a job description and it calls Gemini to work out whether the role leans DSA,
system design, or both, then pulls out the specific topics worth studying. From there
it generates a full question set in batches of five, ramping from fundamentals up to
senior level edge cases.

The part I did not expect to be the fun bit: answering out loud. A handful of
questions drop the multiple choice options entirely and open the mic instead. Your
spoken answer goes to Gemini, which scores it out of 100 against the key points a
strong answer should hit, and tells you what you missed. Score above 80 and it lands
as a critical hit on The Interviewer.

🔧 What actually got built this week:
🤖 Swapped the AI layer to Google AI Studio (Gemini) so it runs anywhere
📦 Batched question generation, so no single response gets truncated
🎙️ Web Speech API for voice answers, with a typed fallback
⚔️ HP bars, damage per question, and an AI written debrief at the end

Hardest lesson: getting an LLM to return clean JSON, every time, with no commentary
wrapped around it. The fix was asking for raw JSON explicitly, setting the response
type on the API call, and still stripping stray code fences before parsing. Belt and
braces.

Next up: rebuilding it in Lovable and wiring in Supabase so your sessions persist and
you can watch your readiness climb over time.

#IITPatnaCapstone

## Post 3, Week 3 (outline)

Theme: integration and UI. Cover the Lovable rebuild, connecting Supabase, moving the
Gemini key into an Edge Function so it is not sitting in the browser, and session
history with progress over time. Include a screen recording of a live session.

## Post 4, Week 4 (outline)

Theme: shipping. Link the live app, embed the demo video, and write the honest
retrospective: what the AI got right, where it needed guardrails, what you would
build differently. Close the loop on the problem statement from Post 1.
