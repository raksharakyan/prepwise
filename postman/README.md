# Postman tests

`prepwise.postman_collection.json` tests the live Prepwise backend: the Supabase Edge
Function that holds the Gemini key, builds the prompts and calls Google. Each request
sends a task name and its inputs, the same way the app does, never a prompt.

## Run it

1. In Postman, **Import** and choose `prepwise.postman_collection.json`.
2. Open the collection, click **Run**, and run the requests **in order**.

The URL and the publishable key are already set as collection variables. The Gemini key
is not in this collection and never needs to be. It lives only as a Supabase secret.

## What each request checks

| Request | What it proves |
| --- | --- |
| 0. Security | Calls without a key are refused with 401 before any Gemini call is made. Free to run. |
| 1. Job description analysis | The round type is one of the three tracks, reasoning is present, and there are 4 to 7 topics. |
| 2. Question batch generation | Exactly 5 questions, exactly one spoken, every multiple choice question has 4 options and a valid answer, and no "All of the above" style options. |
| 3. Spoken answer grading | The score is a whole number from 0 to 100 and feedback is present. |
| 4. Session debrief | All four fields are present, 2 to 3 strengths and focus areas, and no em dashes. |

Every AI request also checks the reply parses as JSON after stripping stray code fences,
which is the same parsing the app does.

## The requests chain, like the app

Request 1 saves the round type and topics, and request 2 uses them. Request 2 saves the
spoken question it generated, and request 3 grades an answer to it. Values are JSON
escaped when saved, so a question containing quotes or line breaks cannot break the next
request body.

## Cost

A full run is 4 Gemini requests, on a free tier of roughly 20 a day. Do not run the
collection in a loop or with multiple iterations. Request 0 costs nothing.

## If a request fails

| Status | Meaning |
| --- | --- |
| 401 | The publishable key variable is missing or wrong |
| 404 | The Supabase function is not named `gemini` |
| 429 | The daily Gemini quota is used up, try tomorrow |
| 503 | Gemini is overloaded, wait a minute and rerun that request |
