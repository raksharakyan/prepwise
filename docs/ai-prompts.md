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
{"round_type": one of "Technical/DSA" or "System Design" or "Mixed", "reasoning": one
or two sentences explaining the call, "topics": an array of 4 to 7 specific technical
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
Write {COUNT} questions. Do not repeat questions from earlier batches.

Exactly ONE question in this batch must have "type": "speech". The rest are "mcq".

Return ONLY a raw JSON array, no markdown fences, no commentary. Each element:
{"question": the question text, "type": "mcq" or "speech", "options": array of
exactly 4 short answer strings (empty array when type is speech), "correct_index":
0-based index of the right option (use -1 when type is speech), "explanation": for
mcq why the right answer is right, for speech the key points a strong spoken answer
must cover, "category": a short topic label such as "Arrays" or "Caching"}
```

When spoken answers are switched off, replace the speech line with: `Every question
must have "type": "mcq".`

Difficulty hints, in order: fundamentals and warm up, core working knowledge, applied
problem solving, trade offs and depth, hard edge cases, senior level depth.

## 3. Spoken answer grading

Max output tokens: 1024

```
You are grading a candidate's spoken answer in a technical interview. Be fair but
rigorous.

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
finished a {ROUND_TYPE} practice session.

Focus topics for the role: {TOPICS}
Per question results, formatted as category/type/outcome: {SUMMARY}

Do not use em dashes anywhere. Return ONLY a raw JSON object, no markdown fences, no
commentary:
{"overall_readiness": two or three sentences on how ready they are for this round,
"strengths": array of 2 to 3 short strings, "focus_areas": array of 2 to 3 short
strings, "tip": one concrete thing to do before the next session}
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
