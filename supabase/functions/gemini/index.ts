// Prepwise Gemini backend.
//
// Holds the API key as a server side secret, and also owns the four prompts.
// The page sends only a task name and its inputs; the prompt text is built
// here, so it never ships to a browser and cannot be read from View Source.
// It also means the function only runs Prepwise's own prompts, not whatever a
// caller sends, and the caller cannot pick its own output token budget.
//
// Gemini's response body and status code are returned verbatim, so the client
// keeps its own parsing, retry and error handling unchanged.
//
// Secrets this function needs:
//   GEMINI_API_KEY   required
//   GEMINI_MODEL     optional, defaults to gemini-3.6-flash

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.6-flash";

const LEVEL_GUIDANCE: Record<string, string> = {
  Entry:  "The candidate is entry level: a student, recent graduate or career changer. Every question must be answerable by someone who has studied the basics. Use plain language, prefer everyday examples, and avoid advanced algorithms, formal complexity analysis and specialist jargon.",
  Mid:    "The candidate has a few years of experience. Expect solid working knowledge and practical judgment, not specialist depth.",
  Senior: "The candidate is senior. Expect depth, trade offs and edge cases.",
};

const WEAK_BELOW = 70;
const NEXT_LEVEL: Record<string, string> = { Entry: "Mid", Mid: "Senior" };

// Inputs come from the browser, so everything is coerced and length capped
// before it goes near a prompt. The caps are well above anything the app sends.
const str = (v: unknown, max = 500) => (typeof v === "string" ? v : "").slice(0, max);
const int = (v: unknown, lo: number, hi: number) => Math.min(Math.max(Math.trunc(Number(v)) || lo, lo), hi);
const strList = (v: unknown, maxItems = 30, max = 100) =>
  (Array.isArray(v) ? v : []).slice(0, maxItems).map(x => str(x, max)).filter(Boolean);
const level = (v: unknown) => (typeof v === "string" && v in LEVEL_GUIDANCE ? v : "Mid");

type Built = { prompt: string; maxOutputTokens: number };

function analyzePrompt(i: Record<string, unknown>): Built | string {
  const jd = str(i.jd, 20000).trim();
  if (jd.length < 60) return "A job description of at least 60 characters is required.";
  return {
    maxOutputTokens: 1024,
    prompt:
      'You are an expert technical interview coach. Read this job description and decide which interview round the candidate should prepare for.\n\n' +
      'Return ONLY a raw JSON object, no markdown fences, no commentary, with exactly these keys:\n' +
      '{"is_tech_role": true if this role\'s interviews would include a technical round (software, web, data, cloud, IT, QA, DevOps, security and similar), false for non technical roles such as sales, marketing, HR, finance, design, operations, teaching or healthcare, "role_title": the job title in at most five words, "round_type": one of "Technical/DSA" or "System Design" or "Mixed", "level": one of "Entry" or "Mid" or "Senior", judged from the experience and responsibilities asked for, "reasoning": one or two sentences explaining the call, "topics": an array of 4 to 7 specific technical topics to focus on}\n\n' +
      'JOB DESCRIPTION:\n' + jd,
  };
}

function questionsPrompt(i: Record<string, unknown>): Built {
  const total = int(i.total, 1, 10);
  const batch = int(i.batch, 0, total - 1);
  const want = int(i.want, 1, 5);
  const topics = strList(i.topics);
  // Questions already asked, in this session and recent ones on the same job
  // description. "Do not repeat questions from earlier batches" alone never
  // worked, since the model could not see them, so every set opened with
  // near identical questions.
  const avoid = strList(i.avoid, 60, 200);
  const avoidBlock = avoid.length
    ? 'These questions were already asked. Do not repeat them, reword them, or test the same fact in a different way:\n' +
      avoid.map(q => '- ' + q).join("\n") + '\n\n'
    : '';
  const speechLine = i.speech
    ? 'Exactly ONE question in this batch must have "type": "speech". The rest are "mcq".'
    : 'Every question must have "type": "mcq".';
  return {
    maxOutputTokens: 4096,
    prompt:
      'You are an expert technical interviewer writing questions for a ' + str(i.roundType, 50) + ' interview round.\n\n' +
      'Focus topics: ' + (topics.join(", ") || "core fundamentals") + '\n' +
      'This is batch ' + (batch + 1) + ' of ' + total + '. Difficulty for this batch: ' + str(i.hint, 200) + '.\n' +
      LEVEL_GUIDANCE[level(i.level)] + '\n' +
      'Write ' + want + ' questions.\n\n' +
      avoidBlock +
      speechLine + '\n\n' +
      // Candidates found the wrong options easy to rule out, so the right one
      // could be guessed without knowing the answer.
      'Make every multiple choice question hard to guess. Each wrong option must be something a candidate at this level could genuinely believe: a common misconception, an off by one or boundary mistake, a closely related concept that does not apply here, or a correct idea used in the wrong situation. ' +
      'The right option must not stand out: match the wrong options to it in length, detail, tone and grammar, and do not make it the only precise or the only fully qualified one. ' +
      'No joke, absurd or off topic options, and no absolute words such as "always" or "never" that give a wrong option away.\n\n' +
      // A candidate picked git switch for "switch to an existing branch" and
      // was marked wrong: it was a second right answer.
      'Exactly one option may be correct. Every wrong option must be definitely wrong for the question as asked, never another valid way to do the same thing. For example, git switch and git checkout can both change branches, so never offer both.\n\n' +
      'Write code, commands and keywords such as def or git commit as plain text inside the sentence, with spaces around them. No markdown anywhere: no backticks, no asterisks.\n\n' +
      'Never write options such as "All of the above", "None of the above" or "Both A and B", and never refer to an option by its letter or position anywhere, including in the explanation. The options will be shown in a different order.\n\n' +
      'Return ONLY a raw JSON array, no markdown fences, no commentary. Each element:\n' +
      '{"question": the question text, "type": "mcq" or "speech", "options": array of exactly 4 short answer strings (empty array when type is speech), "correct_index": 0-based index of the right option (use -1 when type is speech), "explanation": for mcq why the right answer is right, for speech the key points a strong spoken answer must cover, "option_notes": for mcq an array of exactly 4 short strings in the same order as options, each one sentence of at most 20 words saying why that option is right or wrong without referring to other options by position (empty array when type is speech), "category": a short topic label such as "Arrays" or "Caching"}',
  };
}

function gradePrompt(i: Record<string, unknown>): Built | string {
  const transcript = str(i.transcript, 5000).trim();
  if (!transcript) return "A transcript is required.";
  return {
    maxOutputTokens: 1024,
    prompt:
      'You are grading a candidate\'s spoken answer in a technical interview. Be fair but rigorous, and judge it against what is expected at ' + level(i.level) + ' level.\n\n' +
      'QUESTION: ' + str(i.question, 2000) + '\n\n' +
      'KEY POINTS A STRONG ANSWER COVERS: ' + str(i.keyPoints, 3000) + '\n\n' +
      'CANDIDATE TRANSCRIPT: ' + transcript + '\n\n' +
      'The transcript came from speech to text, so ignore grammar, filler words, and transcription noise. Judge the substance.\n\n' +
      'Return ONLY a raw JSON object, no markdown fences, no commentary:\n' +
      '{"score": integer 0 to 100, "feedback": two or three sentences on what landed and what was missing}',
  };
}

// The client works out the weak categories from its own scores and sends them.
// Asked for "2 to 3 focus areas" with nothing to go on, the model invented
// weaknesses for a perfect score, including topics the session never tested.
function debriefPrompt(i: Record<string, unknown>): Built {
  const lvl = level(i.level);
  const topics = strList(i.topics);
  const n = int(i.answered, 0, 100);
  const weak = (Array.isArray(i.weak) ? i.weak : []).slice(0, 30)
    .map((w: Record<string, unknown>) => str(w?.category, 100) + ' (' + int(w?.pct, 0, 100) + '%)');
  const nextLevel = NEXT_LEVEL[lvl];
  return {
    maxOutputTokens: 1024,
    prompt:
      'You are a technical interview coach writing a short debrief for a candidate who just finished a ' + str(i.roundType, 50) + ' practice session at ' + lvl + ' level.\n\n' +
      'Focus topics for the role: ' + (topics.join(", ") || "general") + '\n' +
      'Per question results, formatted as category/type/outcome: ' + str(i.summary, 6000) + '\n' +
      'This was a ' + n + ' question session' + (n < 10 ? ', which is only an early read, so do not overstate conclusions' : '') + '.\n' +
      'Categories scored under ' + WEAK_BELOW + ' percent: ' + (weak.length ? weak.join(", ") : "none") + '\n\n' +
      'Rules. "focus_areas" may only contain categories from that under ' + WEAK_BELOW + ' percent list, and must be an empty array when the list is none. Never name a topic the session did not test. ' +
      '"strengths" are categories they did well in, or an empty array if there are none. ' +
      (weak.length
        ? '"tip" is one concrete step for the weakest category.'
        : '"tip" should stretch them, since nothing was weak' + (nextLevel
            ? ', for example trying ' + nextLevel + ' level next.'
            : ', for example a longer 20 question session or a different round type.')) + '\n\n' +
      'Do not use em dashes anywhere. Return ONLY a raw JSON object, no markdown fences, no commentary:\n' +
      '{"overall_readiness": two or three sentences on how ready they are for this round, "strengths": array of short strings, "focus_areas": array of 0 to 3 short strings, "tip": one concrete thing to do before the next session}',
  };
}

const TASKS: Record<string, (i: Record<string, unknown>) => Built | string> = {
  analyze: analyzePrompt,
  questions: questionsPrompt,
  grade: gradePrompt,
  debrief: debriefPrompt,
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: { message: "Use POST." } }, 405);

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) {
    return json({ error: { message: "GEMINI_API_KEY is not set on this function." } }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: { message: "Request body must be JSON." } }, 400);
  }

  const build = TASKS[str(body.task, 20)];
  if (!build) {
    return json({ error: { message: "task must be one of: " + Object.keys(TASKS).join(", ") + "." } }, 400);
  }
  const input = body.input && typeof body.input === "object" ? body.input as Record<string, unknown> : {};
  const built = build(input);
  if (typeof built === "string") return json({ error: { message: built } }, 400);

  const generationConfig: Record<string, unknown> = {
    temperature: 0.7,
    maxOutputTokens: built.maxOutputTokens,
    responseMimeType: "application/json",
  };

  // Gemini 3.x models think before answering and those tokens count against
  // maxOutputTokens, which returns an empty response. The lite models reject
  // this parameter outright with a 400, so only send it when it applies.
  if (!MODEL.includes("lite")) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: built.prompt }] }],
        generationConfig,
      }),
    },
  );

  // Pass the body and status straight through so the client sees real Gemini
  // errors, including the 429 and 503 it already knows how to retry.
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
