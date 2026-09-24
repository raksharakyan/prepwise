# Prepwise AI prompts

The four prompts the app sends to Gemini. Every one asks for raw JSON only, and the
client strips stray markdown fences before parsing. Keep these stable when porting,
they are the part of the prototype that took the most tuning.

## 1. Job description analysis

Max output tokens: 1024

```
You are an expert technical interview coach. Read this job description and decide
which interview round the candidate should prepare for.

Return ONLY a raw JSON object, no markdown fences, no commentary, with exactly these
keys:
{"round_type": one of "Technical/DSA" or "System Design" or "Mixed", "level": one of
"Entry" or "Mid" or "Senior", judged from the experience and responsibilities asked for,
"reasoning": one or two sentences explaining the call, "topics": an array of 4 to 7 specific technical
topics to focus on}

JOB DESCRIPTION:
{JD_TEXT}
```

## 2. Batch question generation

Max output tokens: 4096. Called once per batch of five.

```
You are an expert technical interviewer writing questions for a {ROUND_TYPE}
interview round.

Focus topics: {TOPICS}
This is batch {N} of {TOTAL}. Difficulty for this batch: {HINT}.
{LEVEL_GUIDANCE}
Write {COUNT} questions. Do not repeat questions from earlier batches.

Exactly ONE question in this batch must have "type": "speech". The rest are "mcq".

Never write options such as "All of the above", "None of the above" or "Both A and B",
and never refer to an option by its letter or position anywhere, including in the
explanation. The options will be shown in a different order.

Return ONLY a raw JSON array, no markdown fences, no commentary. Each element:
{"question": the question text, "type": "mcq" or "speech", "options": array of
exactly 4 short answer strings (empty array when type is speech), "correct_index":
0-based index of the right option (use -1 when type is speech), "explanation": for
mcq why the right answer is right, for speech the key points a strong spoken answer
must cover, "category": a short topic label such as "Arrays" or "Caching"}
```

When spoken answers are switched off, replace the speech line with: `Every question
must have "type": "mcq".`

Difficulty depends on the level, which the analysis detects and the user can override.
Each batch takes the next rung of that level's ladder:

| Level | Rungs, batch 1 upward |
| --- | --- |
| Entry | the very basics, like a first lesson; simple everyday usage; small practical examples; slightly trickier beginner questions; beginner questions that combine two ideas; the hardest questions a beginner should still be able to answer |
| Mid | fundamentals and warm up; core working knowledge; applied problem solving; trade offs and depth; trickier practical cases; harder edge cases |
| Senior | fundamentals and warm up; core working knowledge; applied problem solving; trade offs and depth; hard edge cases; senior level depth |

{LEVEL_GUIDANCE} is one sentence per level. Entry: answerable by someone who has studied
the basics, plain language, everyday examples, no advanced algorithms, formal complexity
analysis or specialist jargon. Mid: solid working knowledge, not specialist depth.
Senior: depth, trade offs and edge cases.

Before this, every role climbed the same ladder to "trade offs and depth", so even a coding
intern job ended on amortized complexity and scoping rules.

## 3. Spoken answer grading

Max output tokens: 1024

```
You are grading a candidate's spoken answer in a technical interview. Be fair but
rigorous, and judge it against what is expected at {LEVEL} level.

QUESTION: {QUESTION}

KEY POINTS A STRONG ANSWER COVERS: {EXPLANATION}

CANDIDATE TRANSCRIPT: {TRANSCRIPT}

The transcript came from speech to text, so ignore grammar, filler words, and
transcription noise. Judge the substance.

Return ONLY a raw JSON object, no markdown fences, no commentary:
{"score": integer 0 to 100, "feedback": two or three sentences on what landed and
what was missing}
```

## 4. Debrief

Max output tokens: 1024. The results summary is a compact `category/type/outcome`
string joined by semicolons, for example `Arrays/mcq/correct; Caching/speech/72 of 100`.

```
You are a technical interview coach writing a short debrief for a candidate who just
finished a {ROUND_TYPE} practice session at {LEVEL} level.

Focus topics for the role: {TOPICS}
Per question results, formatted as category/type/outcome: {SUMMARY}
This was a {N} question session{EARLY_READ}.
Categories scored under 70 percent: {WEAK_CATEGORIES or "none"}

Rules. "focus_areas" may only contain categories from that under 70 percent list, and must
be an empty array when the list is none. Never name a topic the session did not test.
"strengths" are categories they did well in, or an empty array if there are none.
{TIP_RULE}

Do not use em dashes anywhere. Return ONLY a raw JSON object, no markdown fences, no
commentary:
{"overall_readiness": two or three sentences on how ready they are for this round,
"strengths": array of short strings, "focus_areas": array of 0 to 3 short strings, "tip": one concrete thing to do before the next session}
```


## Model and request notes

Use `gemini-3.6-flash`. The older `gemini-2.5-flash` is retired and returns a 404 for
keys issued after its cutoff.

Gemini 3.x models think before answering, and those thinking tokens count against
`maxOutputTokens`. A small budget gets fully consumed by thinking and the response
comes back empty with `finishReason: MAX_TOKENS`. Set `thinkingConfig.thinkingBudget`
to 0 for all four prompts, since each one asks for structured JSON rather than
reasoning.

```json
{
  "contents": [{ "role": "user", "parts": [{ "text": "PROMPT" }] }],
  "generationConfig": {
    "temperature": 0.7,
    "maxOutputTokens": 4096,
    "responseMimeType": "application/json",
    "thinkingConfig": { "thinkingBudget": 0 }
  }
}
```

Retry 429 and 5xx responses with exponential backoff, up to four attempts. Gemini
returns transient 503s often enough that a single unretried batch failure will
otherwise cut a 20 question session down to 5.

## Answer placement

The model's ordering of multiple choice options is thrown away. Left alone, it put the
correct answer in the first or second slot far more often than chance, and reused one
slot across a whole batch, giving runs like `1 1 1 1 1 1 1` then `2 2 2 2 2 2`.

After generation, the client deals the correct option's slot from a shuffled bag of
positions, so each slot is used equally often and the same slot never comes up more than
twice in a row. The wrong options are shuffled into the remaining slots. Questions
containing a position-dependent option such as "All of the above" keep the model's
order, since moving those would make the question wrong. The prompt now forbids them,
and forbids referring to options by letter, so explanations stay true after shuffling.

## Grounding the debrief

The app works out the weak categories itself, from the scores, and passes them in. Asked for
"2 to 3 focus areas" with nothing to go on, the model invented weaknesses for a perfect score,
including topics the session never tested.

- A category is weak below 70 percent.
- `{EARLY_READ}` is ", which is only an early read, so do not overstate conclusions" when the
  session had fewer than 10 questions, and empty otherwise.
- `{TIP_RULE}` asks for one concrete step for the weakest category when something was weak.
  When nothing was, it asks for a stretch instead, naming the next level up (Entry to Mid,
  Mid to Senior), or a longer session or different round type at Senior.
- The app enforces this too. With no weak categories the Focus areas section is never shown,
  whatever the model returns, and the last heading reads "Ready for more" instead of
  "Do this next". With weak categories and an empty reply, the app lists them itself.
