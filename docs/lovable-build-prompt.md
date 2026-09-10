# Lovable build prompts

Feed these to Lovable in order. Prompt 1 builds the shell and the full flow with a
browser-side Gemini key. Prompt 2 moves the key into a Supabase Edge Function.
Prompt 3 adds session history. Working reference implementation: `../index.html`.

Do not paste all three at once. Lovable does better with one scoped step at a time.

---

## Prompt 1: the app

```
Build Prepwise, a one-stop AI prep tool for technical interview rounds. Single page
React app, no routing, dark theme.

Do not describe it as a game anywhere in the UI copy. The boss battle is a scoring
style inside a prep tool, not its identity. Never use em dashes in any UI text, use
commas, colons or parentheses instead.

VISUAL STYLE
Dark navy background (#0b0d17), raised panels (#141829) with subtle borders
(#2a3050), light text (#e8eaf6), muted grey-blue for secondary text (#8f97bd),
purple accent (#7c5cff), teal secondary (#00d4b8). Rounded corners around 12 to
14px. Clean and modern, not neon, not cartoonish.

FOUR SCREENS, shown one at a time in this order.

SCREEN 1, SETUP
- A password-type input for a Google Gemini API key, saved to localStorage.
- A large textarea for a job description, plus a button to upload a .txt file that
  reads into the textarea.
- An "Analyze this role" button. Disabled state and inline error messages, no alerts.

SCREEN 2, ANALYSIS
Shows the detected round type as a heading, the AI's one line reasoning, and the
focus topics as pill chips. Below that, three groups of toggle buttons:
- Round type override: "Technical/DSA", "System Design", "Mixed"
- Question count: 20 or 30
- Spoken answers: on or off
Then a "Build my question set" button and a "Back" button.

SCREEN 3, GENERATION
A progress bar with a status line naming the current batch, and a running count of
questions ready.

SCREEN 4, BATTLE
Two HP bars side by side at the top: "YOU" (teal to green gradient) and "THE
INTERVIEWER" (amber to red gradient), each showing a number out of 100 and animating
smoothly when they change.

Below, a card with the question number, a category chip, and the question text.
- For multiple choice questions: four option buttons. On click, disable all of them,
  outline the correct one green and a wrong pick red, then show a feedback panel.
- For spoken questions: a "Start speaking" button using the browser
  SpeechRecognition or webkitSpeechRecognition API (continuous, interim results,
  en-US), streaming into an editable textarea. If the browser lacks the API, disable
  the mic button and say so, the textarea still works for typing. A "Submit answer"
  button sends it for AI grading.

Feedback panel shows a title, the explanation or grading feedback, and a button that
reads "Next question", or "See my debrief" on the last question.

BATTLE MECHANICS
Both sides start at 100 HP. Damage per question is ceil(100 / total questions).
- Correct multiple choice: The Interviewer loses one unit of damage.
- Wrong multiple choice: the user loses one unit.
- Spoken answer scoring 80 or above: critical hit, The Interviewer loses double.
- Spoken answer scoring 50 to 79: The Interviewer loses one unit.
- Spoken answer below 50: the user loses one unit.
Shake the Interviewer's HP box briefly on a hit. If either side hits 0, jump straight
to the debrief.

SCREEN 5, DEBRIEF
A heading that reflects the outcome (beat The Interviewer, lost, or completed), a
line with the final HP on both sides, a per-category breakdown as horizontal bars
with percentages, then an AI written section: overall readiness, a strengths list, a
focus areas list, and one concrete tip. Finally a "Start another session" button.

GEMINI CALLS
Call the Gemini REST API directly from the browser for now:
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=KEY
Body: { contents: [{ role: "user", parts: [{ text: PROMPT }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: N,
                            responseMimeType: "application/json" } }
Read the text from candidates[0].content.parts, strip any stray markdown code fences,
then JSON.parse. On failure, retry parsing by extracting the outermost JSON block.
Surface a readable error for a rejected key (400) and for rate limits (429).

Questions are generated in batches of five so each response stays small. Show batch
progress. Difficulty rises across batches: fundamentals, core working knowledge,
applied problem solving, trade offs and depth, hard edge cases, senior level depth.
Validate every generated question and drop malformed ones.

Use the four prompts below verbatim.
```

Then paste the four prompts from `ai-prompts.md` into the same Lovable message,
or as an immediate follow-up.

---

## Prompt 2: move the key server side

```
Connect this project to my Supabase project. Then move the Gemini calls out of the
browser into a single Supabase Edge Function named "gemini".

The function reads GEMINI_API_KEY from Supabase secrets, accepts { prompt,
maxOutputTokens } in the request body, calls the Gemini API, and returns the parsed
JSON. The frontend calls the Edge Function instead of Google directly.

Remove the API key input from the setup screen and delete the localStorage key
handling. The setup screen should now open straight to the job description.
```

---

## Prompt 3: session history

```
Add session persistence in Supabase with two tables.

sessions: id uuid primary key, created_at timestamptz default now(), user_id uuid
references auth.users, round_type text, topics text[], question_count int,
you_hp int, boss_hp int, readiness text.

answers: id uuid primary key, session_id uuid references sessions on delete cascade,
question text, category text, type text, correct boolean, score int.

Enable row level security so a user reads and writes only their own rows. Add email
and password sign in. Insert a session row and its answer rows when the debrief
loads. Add a "Past sessions" view listing previous sessions with date, round type
and final HP, and a simple line chart of readiness over time.
```
