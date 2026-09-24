"use strict";

/* ---------------- state ---------------- */
const S = {
  key: "",
  jd: "",
  analysis: null,
  roundType: "",
  count: 20,
  speech: true,
  questions: [],
  idx: 0,
  youHp: 100,
  bossHp: 100,
  results: [],
  answered: false,
  recognizer: null,
  listening: false
};

const MODEL = "gemini-3.6-flash";
const ROUNDS = ["Technical/DSA", "System Design", "Mixed"];

// Difficulty follows the level of the role. Before this, every session climbed
// the same ladder up to "trade offs and depth", so even a coding intern job
// ended on amortized complexity and scoping rules. Each batch takes the next
// rung of its level's ladder.
const LEVELS = ["Entry", "Mid", "Senior"];
const LADDERS = {
  Entry:  ["the very basics, like a first lesson", "simple everyday usage", "small practical examples",
           "slightly trickier beginner questions", "beginner questions that combine two ideas",
           "the hardest questions a beginner should still be able to answer"],
  Mid:    ["fundamentals and warm up", "core working knowledge", "applied problem solving",
           "trade offs and depth", "trickier practical cases", "harder edge cases"],
  Senior: ["fundamentals and warm up", "core working knowledge", "applied problem solving",
           "trade offs and depth", "hard edge cases", "senior level depth"]
};
const LEVEL_GUIDANCE = {
  Entry:  "The candidate is entry level: a student, recent graduate or career changer. Every question must be answerable by someone who has studied the basics. Use plain language, prefer everyday examples, and avoid advanced algorithms, formal complexity analysis and specialist jargon.",
  Mid:    "The candidate has a few years of experience. Expect solid working knowledge and practical judgment, not specialist depth.",
  Senior: "The candidate is senior. Expect depth, trade offs and edge cases."
};

const $ = id => document.getElementById(id);
const show = id => {
  ["s-setup","s-analysis","s-gen","s-battle","s-debrief"].forEach(s => $(s).classList.add("hidden"));
  $(id).classList.remove("hidden");
  window.scrollTo(0, 0);
};
const setErr = (id, msg) => { $(id).textContent = msg || ""; };

/* ---------------- gemini ---------------- */
// Gemini's free tier returns 503 "high demand" often, sometimes for a minute
// or more at a time. Retry patiently, and say so, because a silent spinner
// looks identical to a hang.
let onRetry = null;

async function gemini(prompt, maxTokens, attempt) {
  attempt = attempt || 1;
  const MAX_ATTEMPTS = 6;
  try {
    const out = await geminiOnce(prompt, maxTokens);
    if (onRetry) onRetry("");
    return out;
  } catch (e) {
    if (e.transient && attempt < MAX_ATTEMPTS) {
      const wait = Math.min(1000 * Math.pow(2, attempt - 1), 15000);
      if (onRetry) {
        onRetry("Gemini is busy. Retrying, attempt " + (attempt + 1) + " of " + MAX_ATTEMPTS + ".");
      }
      await new Promise(r => setTimeout(r, wait));
      return gemini(prompt, maxTokens, attempt + 1);
    }
    if (onRetry) onRetry("");
    throw e;
  }
}

// Two ways to reach Gemini. Through the Supabase Edge Function when one is
// configured, which is the only arrangement where the API key never reaches a
// browser, or straight to Google with a local key for development. The function
// returns Gemini's response body verbatim, so everything below this is identical
// either way.
function useProxy() {
  return !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
}

async function geminiOnce(prompt, maxTokens) {
  const viaProxy = useProxy();

  const url = viaProxy
    ? CFG.SUPABASE_URL.replace(/\/+$/, "") + "/functions/v1/gemini"
    : "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL +
      ":generateContent?key=" + encodeURIComponent(S.key);

  const headers = { "Content-Type": "application/json" };
  if (viaProxy) headers["Authorization"] = "Bearer " + CFG.SUPABASE_ANON_KEY;

  const payload = viaProxy
    ? { prompt: prompt, maxOutputTokens: maxTokens || 2048 }
    : {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: maxTokens || 2048,
          responseMimeType: "application/json",
          // Gemini 3.x models think by default and those tokens count against
          // maxOutputTokens, which truncates the reply before any JSON is written.
          thinkingConfig: { thinkingBudget: 0 }
        }
      };

  // Without this a stalled connection leaves the button saying "Analyzing"
  // with no error and no way back.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (e) {
    const err = new Error(e.name === "AbortError"
      ? "The request timed out after 45 seconds."
      : "Could not reach the AI backend: " + e.message);
    err.transient = true;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error.message; } catch (e) { detail = await res.text(); }
    if (res.status === 400 && /API key/i.test(detail)) throw new Error("That API key was rejected. Check it at aistudio.google.com/apikey.");
    if (res.status === 404) throw new Error("The model " + MODEL + " is not available to this key. Gemini retires older models, check aistudio.google.com for the current one.");
    const err = new Error(res.status === 429
      ? "Gemini rate limit hit. Waiting before retrying."
      : "Gemini returned " + res.status + ": " + detail);
    // 429 and 5xx are worth retrying, everything else is a real failure.
    err.transient = res.status === 429 || res.status >= 500;
    throw err;
  }

  const data = await res.json();
  const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  const raw = parts ? parts.map(p => p.text || "").join("") : "";
  if (!raw.trim()) {
    const e = new Error("Gemini returned an empty response.");
    e.transient = true;
    throw e;
  }

  const cleaned = raw.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const m = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (m) { try { return JSON.parse(m[0]); } catch (e2) {} }
    throw new Error("Could not read Gemini's reply as JSON. Try again.");
  }
}

/* ---------------- setup screen ---------------- */
// The key comes from config.js, which is gitignored and never committed.
// It is deliberately not entered through the interface and not persisted
// to localStorage. See the deployment note in README.md.
const CFG = window.PREPWISE_CONFIG || {};
S.key = (CFG.GEMINI_API_KEY || "").trim();
if (!useProxy() && !S.key) {
  setErr("err-setup",
    "No AI backend configured.\n\nEither set SUPABASE_URL and SUPABASE_ANON_KEY in config.js to call through the Edge Function, or set GEMINI_API_KEY for a direct local call. Copy config.example.js to config.js to start.");
  $("btn-analyze").disabled = true;
}

/* ---------------- example job descriptions ----------------
   So anyone can try Prepwise without hunting for a job description. One per
   track, so trying all three also shows the round detection choosing a
   different answer each time. Filling the box does not start an analysis:
   that still takes a click, since each one spends a Gemini request. */
const EXAMPLE_JDS = {
  intern: `Software Engineering Intern

A paid summer internship for students who are learning to code. You will fix small bugs and build simple features with a mentor.

What we look for:
- Basic programming in any language, such as Python, Java or JavaScript
- Understanding of variables, loops, conditions and functions
- Working with lists and strings, and simple searching and sorting
- Curiosity and a willingness to ask questions

No work experience needed. Our interview is a friendly coding round with beginner problems.`,

  web: `Junior Web Developer

Help build and update pages for our company website.

What we look for:
- The basics of HTML, CSS and JavaScript
- Making a page look right on both phones and laptops
- Handling simple things like buttons and forms
- Knowing what happens when you open a website in a browser
- Using browser tools to find simple mistakes

A great first job for bootcamp graduates and self taught developers.`,

  support: `IT Support Trainee, Cloud

Join our support team and learn how our apps run in the cloud.

What we look for:
- A basic idea of how the internet works: browsers, servers and websites
- What a database is and why apps use one
- What an API is, in simple terms
- Why websites slow down when many people use them at once, and simple ways to fix it
- Clear communication with customers

Training provided. No prior experience required.`
};

document.querySelectorAll("[data-example]").forEach(b => b.addEventListener("click", () => {
  const box = $("jd");
  const current = box.value.trim();
  const isExample = Object.values(EXAMPLE_JDS).some(t => t.trim() === current);
  // Never silently throw away something the user typed or pasted.
  if (current && !isExample && !confirm("Replace the job description you entered with this example?")) return;
  box.value = EXAMPLE_JDS[b.dataset.example];
  box.scrollTop = 0;
  // Clear a stale "paste a fuller job description" message, but keep the
  // "no AI backend configured" one, which explains why Analyze is disabled.
  if (useProxy() || S.key) setErr("err-setup", "");
  $("btn-analyze").focus();
}));

$("file").addEventListener("change", e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = ev => { $("jd").value = ev.target.result; };
  r.readAsText(f);
});

$("btn-analyze").addEventListener("click", async () => {
  setErr("err-setup", "");
  S.jd = $("jd").value.trim();
  if (!useProxy() && !S.key) return setErr("err-setup", "No AI backend configured. Set SUPABASE_URL and SUPABASE_ANON_KEY, or GEMINI_API_KEY, in config.js and reload.");
  if (S.jd.length < 60) return setErr("err-setup", "Paste a fuller job description so the analysis has something to work with.");

  const btn = $("btn-analyze");
  btn.disabled = true;
  btn.textContent = "Analyzing";
  onRetry = msg => setErr("err-setup", msg);
  try {
    S.analysis = await gemini(
      'You are an expert technical interview coach. Read this job description and decide which interview round the candidate should prepare for.\n\n' +
      'Return ONLY a raw JSON object, no markdown fences, no commentary, with exactly these keys:\n' +
      '{"round_type": one of "Technical/DSA" or "System Design" or "Mixed", "level": one of "Entry" or "Mid" or "Senior", judged from the experience and responsibilities asked for, "reasoning": one or two sentences explaining the call, "topics": an array of 4 to 7 specific technical topics to focus on}\n\n' +
      'JOB DESCRIPTION:\n' + S.jd,
      1024
    );
    if (!ROUNDS.includes(S.analysis.round_type)) S.analysis.round_type = "Mixed";
    if (!Array.isArray(S.analysis.topics)) S.analysis.topics = [];
    S.roundType = S.analysis.round_type;
    if (!LEVELS.includes(S.analysis.level)) S.analysis.level = "Mid";
    S.level = S.analysis.level;
    renderAnalysis();
    show("s-analysis");
  } catch (e) {
    setErr("err-setup", e.message);
  } finally {
    onRetry = null;
    btn.disabled = false;
    btn.textContent = "Analyze this role";
  }
});

/* ---------------- analysis screen ---------------- */
function renderAnalysis() {
  $("a-round").textContent = S.analysis.round_type + " round";
  $("a-reason").textContent = S.analysis.reasoning || "";

  $("a-topics").innerHTML = S.analysis.topics
    .map(t => '<span class="pill">' + esc(t) + '</span>').join("");

  $("a-override").innerHTML = ROUNDS
    .map(r => '<button class="ghost' + (r === S.roundType ? ' on' : '') + '" data-round="' + esc(r) + '">' + esc(r) + '</button>').join("");
  $("a-override").querySelectorAll("button").forEach(b => b.onclick = () => {
    S.roundType = b.dataset.round; renderAnalysis();
  });

  $("a-level").innerHTML = LEVELS
    .map(l => '<button class="ghost' + (l === S.level ? ' on' : '') + '" data-level="' + l + '">' + l + ' level</button>').join("");
  $("a-level").querySelectorAll("button").forEach(b => b.onclick = () => {
    S.level = b.dataset.level; renderAnalysis();
  });

  $("a-count").innerHTML = [20, 30]
    .map(n => '<button class="ghost' + (n === S.count ? ' on' : '') + '" data-count="' + n + '">' + n + ' questions</button>').join("");
  $("a-count").querySelectorAll("button").forEach(b => b.onclick = () => {
    S.count = +b.dataset.count; renderAnalysis();
  });

  $("a-speech").innerHTML =
    '<button class="ghost' + (S.speech ? ' on' : '') + '" data-sp="1">Include spoken answers</button>' +
    '<button class="ghost' + (!S.speech ? ' on' : '') + '" data-sp="0">Multiple choice only</button>';
  $("a-speech").querySelectorAll("button").forEach(b => b.onclick = () => {
    S.speech = b.dataset.sp === "1"; renderAnalysis();
  });

  $("speech-note").textContent = S.speech
    ? (hasSpeechApi() ? "Your browser supports voice input. You can always type instead."
                      : "This browser does not support voice input, so spoken questions fall back to typing.")
    : "";
}

$("btn-back").onclick = () => show("s-setup");

function hasSpeechApi() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

/* ---------------- generation ---------------- */
$("btn-generate").addEventListener("click", async () => {
  setErr("err-gen", "");
  S.questions = [];
  resetPositionBags();
  show("s-gen");

  const perBatch = 5;
  const batches = Math.ceil(S.count / perBatch);
  let shortfall = "";
  onRetry = msg => setErr("err-gen", msg);
  const hints = LADDERS[S.level] || LADDERS.Mid;

  for (let i = 0; i < batches; i++) {
    $("gen-status").textContent = "Batch " + (i + 1) + " of " + batches + ", " + hints[Math.min(i, hints.length - 1)];
    const want = Math.min(perBatch, S.count - S.questions.length);
    try {
      const batch = await gemini(buildBatchPrompt(i, batches, want, hints[Math.min(i, hints.length - 1)]), 4096);
      const clean = (Array.isArray(batch) ? batch : []).filter(validQ).slice(0, want).map(placeCorrectAnswer);
      if (!clean.length) throw new Error("Batch " + (i + 1) + " came back empty.");
      S.questions = S.questions.concat(clean);
    } catch (e) {
      // Short of a usable set, stop and surface the real reason.
      if (S.questions.length < 5) {
        setErr("err-gen", e.message + "\n\nGo back and try again.");
        return;
      }
      // Otherwise carry on with what we have, but say so rather than
      // silently starting a shorter session than the user asked for.
      shortfall = e.message;
      break;
    }
    const pct = Math.round(S.questions.length / S.count * 100);
    $("gen-bar").style.width = pct + "%";
    $("gen-count").textContent = S.questions.length + " questions ready";
  }

  S.idx = 0; S.youHp = 100; S.bossHp = 100; S.results = [];

  if (S.questions.length < S.count) {
    $("gen-status").textContent = "Built " + S.questions.length + " of " + S.count + " questions";
    setErr("err-gen", "Gemini stopped early: " + shortfall +
      "\n\nYou can start this " + S.questions.length + " question session, or go back and try for the full set.");
    $("gen-count").innerHTML = '<button id="btn-go-short">Start with ' + S.questions.length + ' questions</button>' +
      ' <button class="ghost" id="btn-regen">Back</button>';
    $("btn-go-short").onclick = () => { renderQuestion(); show("s-battle"); };
    $("btn-regen").onclick = () => show("s-analysis");
    return;
  }

  renderQuestion();
  show("s-battle");
});

function buildBatchPrompt(i, total, want, hint) {
  const speechLine = S.speech
    ? 'Exactly ONE question in this batch must have "type": "speech". The rest are "mcq".'
    : 'Every question must have "type": "mcq".';
  return 'You are an expert technical interviewer writing questions for a ' + S.roundType + ' interview round.\n\n' +
    'Focus topics: ' + (S.analysis.topics.join(", ") || "core fundamentals") + '\n' +
    'This is batch ' + (i + 1) + ' of ' + total + '. Difficulty for this batch: ' + hint + '.\n' +
    (LEVEL_GUIDANCE[S.level] || LEVEL_GUIDANCE.Mid) + '\n' +
    'Write ' + want + ' questions. Do not repeat questions from earlier batches.\n\n' +
    speechLine + '\n\n' +
    'Never write options such as "All of the above", "None of the above" or "Both A and B", and never refer to an option by its letter or position anywhere, including in the explanation. The options will be shown in a different order.\n\n' +
    'Return ONLY a raw JSON array, no markdown fences, no commentary. Each element:\n' +
    '{"question": the question text, "type": "mcq" or "speech", "options": array of exactly 4 short answer strings (empty array when type is speech), "correct_index": 0-based index of the right option (use -1 when type is speech), "explanation": for mcq why the right answer is right, for speech the key points a strong spoken answer must cover, "category": a short topic label such as "Arrays" or "Caching"}';
}

/* ---------------- answer placement ----------------
   Language models put the right answer in the first couple of slots far more
   often than chance, and tend to reuse one slot across a whole batch, which
   produced long runs like 1 1 1 1 then 2 2 2 2. So the model's ordering is
   discarded: the correct option's slot is dealt from a shuffled bag, so each
   slot comes up equally often and long runs cannot form, and the wrong options
   are shuffled into the remaining slots. */
let positionBags = {};

function resetPositionBags() { positionBags = {}; }

function shuffleInPlace(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function dealPosition(n) {
  const bag = positionBags[n] || (positionBags[n] = []);
  if (!bag.length) {
    for (let i = 0; i < n; i++) bag.push(i);
    shuffleInPlace(bag);
  }
  return bag.pop();
}

// Options whose meaning depends on where they sit. Moving these would make a
// question wrong, so any question containing one keeps the model's order.
const POSITIONAL_OPTION = /\b(all|none|both|neither)\s+of\s+(the\s+)?(above|these|them)\b|\bboth\s+[a-d]\b|\b[a-d]\s+(and|&)\s+[a-d]\b/i;

function placeCorrectAnswer(q) {
  if (q.type !== "mcq") return q;
  if (q.options.some(o => POSITIONAL_OPTION.test(String(o)))) return q;
  const right = q.options[q.correct_index];
  const options = shuffleInPlace(q.options.filter((_, i) => i !== q.correct_index));
  const pos = dealPosition(q.options.length);
  options.splice(pos, 0, right);
  return Object.assign({}, q, { options: options, correct_index: pos });
}

function validQ(q) {
  if (!q || typeof q.question !== "string" || !q.question.trim()) return false;
  if (q.type === "speech") return typeof q.explanation === "string";
  return Array.isArray(q.options) && q.options.length >= 2 &&
         Number.isInteger(q.correct_index) && q.correct_index >= 0 && q.correct_index < q.options.length;
}

/* ---------------- battle ---------------- */
function damage() { return Math.ceil(100 / S.questions.length); }

function renderQuestion() {
  const q = S.questions[S.idx];
  S.answered = false;
  stopMic();

  $("q-progress").textContent = "Question " + (S.idx + 1) + " of " + S.questions.length;
  $("q-cat").textContent = q.category || S.roundType;
  $("q-text").textContent = q.question;
  $("q-feedback").classList.add("hidden");
  $("q-feedback").innerHTML = "";
  setErr("err-battle", "");

  if (q.type === "speech") {
    $("q-mcq").innerHTML = "";
    $("q-speech").classList.remove("hidden");
    $("transcript").value = "";
    $("btn-submit-speech").disabled = false;
    S.redosLeft = MAX_REDOS;
    S.revealed = false;
    S.scored = null;
    S.lastPanel = null;
    lockSpeechInput(false);
    $("btn-mic").disabled = !hasSpeechApi();
    $("mic-status").textContent = hasSpeechApi() ? "Answer out loud, or type it below." : "Voice input is not available in this browser. Type your answer.";
  } else {
    $("q-speech").classList.add("hidden");
    $("q-mcq").innerHTML = q.options
      .map((o, i) => '<button class="opt" data-i="' + i + '">' + esc(o) + '</button>').join("");
    $("q-mcq").querySelectorAll(".opt").forEach(b => b.onclick = () => answerMcq(+b.dataset.i));
  }
  paintHp();
}

function paintHp() {
  $("hp-you-fill").style.width = Math.max(0, S.youHp) + "%";
  $("hp-boss-fill").style.width = Math.max(0, S.bossHp) + "%";
  $("hp-you-num").textContent = Math.max(0, S.youHp) + " / 100";
  $("hp-boss-num").textContent = Math.max(0, S.bossHp) + " / 100";
}

function answerMcq(picked) {
  if (S.answered) return;
  S.answered = true;
  const q = S.questions[S.idx];
  const right = picked === q.correct_index;

  $("q-mcq").querySelectorAll(".opt").forEach((b, i) => {
    b.disabled = true;
    if (i === q.correct_index) b.classList.add("right");
    else if (i === picked) b.classList.add("wrong");
  });

  if (right) {
    S.bossHp -= damage();
    $("boss-box").classList.add("shake");
    setTimeout(() => $("boss-box").classList.remove("shake"), 340);
  } else {
    S.youHp -= damage();
  }
  paintHp();

  S.results.push({ category: q.category || "General", type: "mcq", correct: right });
  showFeedback(
    right ? "Direct hit" : "You take damage",
    right ? "Correct. " + (q.explanation || "") : "Not quite. " + (q.explanation || "")
  );
}

/* ---------------- spoken answers ----------------
   The first attempt is the scored one: it moves HP and feeds the debrief,
   because that is what the candidate would have said in a real interview.
   After it, up to MAX_REDOS practice attempts are graded for feedback only.
   The reference answer can be revealed at any point, and is revealed
   automatically once the last redo has been graded. */
const MAX_REDOS = 2;

function lockSpeechInput(locked) {
  $("transcript").readOnly = locked;
  $("btn-mic").disabled = locked || !hasSpeechApi();
}

async function gradeSpeech(q, text) {
  const g = await gemini(
    'You are grading a candidate\'s spoken answer in a technical interview. Be fair but rigorous, and judge it against what is expected at ' + (S.level || "Mid") + ' level.\n\n' +
    'QUESTION: ' + q.question + '\n\n' +
    'KEY POINTS A STRONG ANSWER COVERS: ' + q.explanation + '\n\n' +
    'CANDIDATE TRANSCRIPT: ' + text + '\n\n' +
    'The transcript came from speech to text, so ignore grammar, filler words, and transcription noise. Judge the substance.\n\n' +
    'Return ONLY a raw JSON object, no markdown fences, no commentary:\n' +
    '{"score": integer 0 to 100, "feedback": two or three sentences on what landed and what was missing}',
    1024
  );
  return {
    score: Math.max(0, Math.min(100, parseInt(g.score, 10) || 0)),
    feedback: g.feedback || ""
  };
}

// Applies the scored attempt to the battle and the debrief. Called once per question.
function applySpeechScore(q, score) {
  const d = damage();
  let title;
  if (score >= 80) { S.bossHp -= d * 2; title = "Critical hit"; }
  else if (score >= 50) { S.bossHp -= d; title = "Solid hit"; }
  else { S.youHp -= d; title = "You take damage"; }
  $("boss-box").classList.add("shake");
  setTimeout(() => $("boss-box").classList.remove("shake"), 340);
  paintHp();
  S.results.push({ category: q.category || "General", type: "speech", score: score });
  return title;
}

async function submitSpeech() {
  if (S.answered) return;
  const text = $("transcript").value.trim();
  if (text.length < 15) return setErr("err-battle", "Give a fuller answer before submitting.");
  S.answered = true;
  stopMic();
  setErr("err-battle", "");
  lockSpeechInput(true);

  const btn = $("btn-submit-speech");
  btn.disabled = true;
  btn.textContent = "Grading";
  const q = S.questions[S.idx];
  const practice = S.scored !== null;

  let result;
  try {
    result = await gradeSpeech(q, text);
  } catch (e) {
    btn.textContent = "Submit answer";
    if (practice) {
      // A Gemini outage should not cost the user a practice attempt.
      setErr("err-battle", "Grading failed: " + e.message + " Your answer is still here, submit again when ready.");
      S.answered = false;
      lockSpeechInput(false);
      btn.disabled = false;
      return;
    }
    setErr("err-battle", "Grading failed: " + e.message + " Scoring this one as a miss.");
    result = { score: 0, feedback: "" };
  }
  btn.textContent = "Submit answer";

  let title;
  if (!practice) {
    title = applySpeechScore(q, result.score) + ", scored " + result.score + " out of 100";
    S.scored = result.score;
  } else {
    title = (S.revealed ? "Practice after seeing the answer" : "Practice attempt") +
            ", scored " + result.score + " out of 100";
    // Reveal only after the final attempt is graded, never before it.
    if (S.redosLeft === 0) S.revealed = true;
  }

  $("mic-status").textContent = S.redosLeft > 0
    ? "Graded. Use Redo below to practise this one again."
    : "Graded. No redos left for this question.";
  S.lastPanel = { title: title, body: result.feedback };
  renderSpeechPanel();
}

function renderSpeechPanel() {
  const q = S.questions[S.idx];
  const p = S.lastPanel;
  let html = "";

  if (p) {
    html += '<div class="fb"><h3>' + esc(p.title) + '</h3><p class="muted" style="margin:0">' + esc(p.body) + '</p></div>';
    html += '<p class="note">Your scored answer: ' + S.scored + ' out of 100. Redos are practice and do not change your HP or your debrief.</p>';
  }

  html += '<div class="row" style="margin-top:16px">';
  if (p && S.redosLeft > 0) html += '<button class="ghost" id="btn-redo">Redo (' + S.redosLeft + ')</button>';
  if (p && !S.revealed)     html += '<button class="ghost" id="btn-reveal">Show correct answer</button>';
  html += nextButtonHtml() + '</div>';

  if (S.revealed) {
    html += '<div class="reveal"><h3>What a strong answer covers</h3><p>' + esc(q.explanation || "") + '</p></div>';
  }

  $("q-feedback").innerHTML = html;
  $("q-feedback").classList.remove("hidden");
  wireNext();
  if ($("btn-redo"))   $("btn-redo").onclick = startRedo;
  if ($("btn-reveal")) $("btn-reveal").onclick = () => { S.revealed = true; renderSpeechPanel(); };
}

function startRedo() {
  if (S.redosLeft <= 0) return;
  S.redosLeft--;
  S.answered = false;
  S.lastPanel = null;
  setErr("err-battle", "");
  $("transcript").value = "";
  lockSpeechInput(false);
  $("btn-submit-speech").disabled = false;
  const n = MAX_REDOS - S.redosLeft;
  $("mic-status").textContent = S.revealed
    ? "Practice attempt " + n + " of " + MAX_REDOS + ". The answer is below for reference."
    : "Practice attempt " + n + " of " + MAX_REDOS + ". Answer again.";
  // Keep the revealed answer on screen during the attempt, and keep Next
  // available so a redo can be abandoned.
  renderSpeechPanel();
  $("transcript").focus();
}

$("btn-submit-speech").addEventListener("click", submitSpeech);

function sessionEnding() {
  return S.idx === S.questions.length - 1 || S.youHp <= 0 || S.bossHp <= 0;
}

function nextButtonHtml() {
  return '<button id="btn-next">' + (sessionEnding() ? "See my debrief" : "Next question") + '</button>';
}

function wireNext() {
  $("btn-next").onclick = () => {
    stopMic();
    if (sessionEnding()) return runDebrief();
    S.idx++;
    renderQuestion();
  };
}

function showFeedback(title, body) {
  $("q-feedback").innerHTML =
    '<div class="fb"><h3>' + esc(title) + '</h3><p class="muted" style="margin:0">' + esc(body) + '</p></div>' +
    '<div class="row" style="margin-top:16px">' + nextButtonHtml() + '</div>';
  wireNext();
  $("q-feedback").classList.remove("hidden");
}

/* ---------------- speech input ---------------- */
$("btn-mic").addEventListener("click", () => S.listening ? stopMic() : startMic());

function startMic() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) return;
  setErr("err-battle", "");
  S.listening = true;
  $("btn-mic").textContent = "Stop";
  $("btn-mic").classList.add("mic-on");
  $("mic-status").textContent = "Listening";
  beginRecognition(Ctor);
}

// Chrome ends a recognition session by itself after a stretch of silence,
// even with continuous set, so pausing to think used to switch the mic off.
// While the user has not pressed Stop, a session ending just starts another,
// and each new session builds on whatever is already in the box.
function beginRecognition(Ctor) {
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";

  const base = $("transcript").value.trim();

  rec.onresult = ev => {
    // Rebuild from every result in this session. Starting at ev.resultIndex,
    // which only marks what changed, dropped every sentence finalized before
    // the most recent pause and wiped the answer.
    let spoken = "";
    for (let i = 0; i < ev.results.length; i++) spoken += ev.results[i][0].transcript;
    spoken = spoken.trim();
    $("transcript").value = base && spoken ? base + " " + spoken : (base || spoken);
  };

  rec.onerror = ev => {
    // Silence, and the abort from our own Stop, are not failures.
    if (ev.error === "no-speech" || ev.error === "aborted") return;
    stopMic();
    setErr("err-battle", ev.error === "not-allowed"
      ? "Microphone access was blocked. Allow it in your browser, or type your answer."
      : "Voice input error: " + ev.error + ". You can type your answer instead.");
  };

  rec.onend = () => {
    // Only restart if this is still the live session and the user never pressed Stop.
    if (S.listening && S.recognizer === rec) beginRecognition(Ctor);
  };

  S.recognizer = rec;
  try {
    rec.start();
  } catch (e) {
    stopMic();
    setErr("err-battle", "Could not start voice input: " + e.message + ". You can type your answer instead.");
  }
}

function stopMic() {
  const rec = S.recognizer;
  // Clear these first, so the onend that stop() triggers does not restart.
  S.recognizer = null;
  S.listening = false;
  if (rec) { try { rec.stop(); } catch (e) {} }
  $("btn-mic").textContent = "Start speaking";
  $("btn-mic").classList.remove("mic-on");
  if ($("mic-status").textContent === "Listening") $("mic-status").textContent = "Stopped. Edit your answer if you need to.";
}

/* ---------------- debrief ---------------- */
async function runDebrief() {
  show("s-debrief");
  const won = S.bossHp <= 0;
  const lost = S.youHp <= 0;
  $("d-title").textContent = won ? "You beat The Interviewer" : lost ? "The Interviewer got the better of you" : "Session complete";
  $("d-line").textContent = "You answered " + S.results.length + " of " + S.questions.length +
    " questions. Your HP " + Math.max(0, S.youHp) + ", The Interviewer " + Math.max(0, S.bossHp) + ".";

  // category breakdown
  const cats = {};
  S.results.forEach(r => {
    const c = cats[r.category] || (cats[r.category] = { got: 0, total: 0 });
    c.total += 100;
    c.got += r.type === "speech" ? r.score : (r.correct ? 100 : 0);
  });
  $("d-cats").innerHTML = Object.keys(cats).map(name => {
    const pct = Math.round(cats[name].got / cats[name].total * 100);
    return '<div class="cat-row"><span>' + esc(name) + '</span>' +
           '<span class="bar-track"><span class="bar-fill" style="width:' + pct + '%"></span></span>' +
           '<span class="muted" style="text-align:right">' + pct + '%</span></div>';
  }).join("") || '<p class="muted">No questions answered.</p>';

  // ai debrief
  $("d-readiness").textContent = "Writing your debrief";
  $("d-lists").innerHTML = "";
  const summary = S.results.map(r =>
    r.category + "/" + r.type + "/" + (r.type === "speech" ? r.score + " of 100" : (r.correct ? "correct" : "wrong"))
  ).join("; ");

  try {
    const d = await gemini(
      'You are a technical interview coach writing a short debrief for a candidate who just finished a ' + S.roundType + ' practice session at ' + (S.level || "Mid") + ' level.\n\n' +
      'Focus topics for the role: ' + (S.analysis.topics.join(", ") || "general") + '\n' +
      'Per question results, formatted as category/type/outcome: ' + summary + '\n\n' +
      'Do not use em dashes anywhere. Return ONLY a raw JSON object, no markdown fences, no commentary:\n' +
      '{"overall_readiness": two or three sentences on how ready they are for this round, "strengths": array of 2 to 3 short strings, "focus_areas": array of 2 to 3 short strings, "tip": one concrete thing to do before the next session}',
      1024
    );
    $("d-readiness").textContent = d.overall_readiness || "";
    $("d-lists").innerHTML =
      listBlock("Strengths", d.strengths) +
      listBlock("Focus areas", d.focus_areas) +
      (d.tip ? '<h2 style="margin-top:20px">Do this next</h2><p class="muted">' + esc(d.tip) + '</p>' : "");
  } catch (e) {
    $("d-readiness").textContent = "The AI debrief could not be generated: " + e.message + " Your category breakdown above is still accurate.";
  }
}

function listBlock(title, arr) {
  if (!Array.isArray(arr) || !arr.length) return "";
  return '<h2 style="margin-top:20px">' + title + '</h2><ul>' +
    arr.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>";
}

$("btn-restart").onclick = () => {
  S.questions = []; S.results = []; S.idx = 0; S.youHp = 100; S.bossHp = 100;
  show("s-setup");
};
