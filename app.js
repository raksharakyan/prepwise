"use strict";

/* ---------------- state ---------------- */
const S = {
  jd: "",
  analysis: null,
  roundType: "",
  // Default to the quick demo: most visitors to the live link are trying it
  // out, and 5 questions cost about 4 Gemini requests instead of about 10.
  count: 5,
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

const ROUNDS = ["Technical/DSA", "System Design", "Mixed"];

// Difficulty follows the level of the role. Before this, every session climbed
// the same ladder up to "trade offs and depth", so even a coding intern job
// ended on amortized complexity and scoping rules. Each batch takes the next
// rung of its level's ladder. The rung is shown in the progress text, so the
// ladders live here; the rest of each prompt is built by the Edge Function.
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

const $ = id => document.getElementById(id);
let screen = "s-setup";
const show = id => {
  ["s-setup","s-analysis","s-gen","s-battle","s-debrief","s-auth","s-account"].forEach(s => $(s).classList.add("hidden"));
  $(id).classList.remove("hidden");
  window.scrollTo(0, 0);
  screen = id;
  save();
};
const setErr = (id, msg) => { $(id).textContent = msg || ""; };

/* ---------------- gemini ---------------- */
// Gemini's free tier returns 503 "high demand" often, sometimes for a minute
// or more at a time. Retry patiently, and say so, because a silent spinner
// looks identical to a hang.
let onRetry = null;

async function gemini(task, input, attempt) {
  attempt = attempt || 1;
  const MAX_ATTEMPTS = 6;
  try {
    const out = await geminiOnce(task, input);
    if (onRetry) onRetry("");
    return out;
  } catch (e) {
    if (e.transient && attempt < MAX_ATTEMPTS) {
      const wait = Math.min(1000 * Math.pow(2, attempt - 1), 15000);
      if (onRetry) {
        onRetry("Gemini is busy. Retrying, attempt " + (attempt + 1) + " of " + MAX_ATTEMPTS + ".");
      }
      await new Promise(r => setTimeout(r, wait));
      return gemini(task, input, attempt + 1);
    }
    if (onRetry) onRetry("");
    throw e;
  }
}

// Every call goes through the Supabase Edge Function, which holds the API key
// and builds the prompt from the task name and inputs sent here. The prompts
// live only on the server, so they are not readable from the page source. The
// function returns Gemini's response body verbatim. It needs a signed in
// user: a real account, or a guest on the free trial.
function hasBackend() {
  return !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
}

async function geminiOnce(task, input) {
  const url = CFG.SUPABASE_URL.replace(/\/+$/, "") + "/functions/v1/gemini";
  const token = await accessToken();
  if (!token) throw authError("Sign in, or start the free trial, first.", "auth_required");
  const headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + token,
    "apikey": CFG.SUPABASE_ANON_KEY
  };
  const payload = { task: task, input: input };

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
    const body = await res.text();
    let detail = body;
    let code = "";
    try { detail = JSON.parse(body).error.message; code = JSON.parse(body).error.code || ""; } catch (e) {}
    // Refusals from our own backend, not Gemini, and never worth retrying.
    if (code === "trial_used" || code === "auth_required" || code === "user_daily_limit") throw authError(detail, code);
    // The free tier allows about 20 requests a day. Once that is gone every
    // retry fails the same way until the quota resets, so say so plainly
    // instead of retrying. Short per minute limits are also 429s, but their
    // quota id has no "PerDay", so those still retry below.
    if (res.status === 429 && /PerDay/i.test(body)) {
      const err = new Error(dailyLimitMessage());
      err.daily = true;
      throw err;
    }
    if (res.status === 400 && /API key/i.test(detail)) throw new Error("The Gemini API key on the backend was rejected. Check the GEMINI_API_KEY secret in Supabase.");
    if (res.status === 404) throw new Error("The AI backend could not find the Gemini model. Gemini retires older models, check GEMINI_MODEL in Supabase.");
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

function authError(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// Gemini's daily quota resets at midnight Pacific time. Shown in the viewer's
// own time zone, since most viewers are not in California.
function dailyLimitMessage() {
  let when = "midnight Pacific time";
  try {
    const now = new Date();
    const p = {};
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23",
      hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(now).forEach(x => { p[x.type] = +x.value; });
    const sinceMidnight = (p.hour * 3600 + p.minute * 60 + p.second) * 1000;
    const reset = new Date(now.getTime() + 86400000 - sinceMidnight);
    when = reset.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + " your time (midnight Pacific)";
  } catch (e) {}
  return "Prepwise has used up today's free AI allowance. It resets at " + when + ". Please try again after that.";
}

/* ---------------- setup screen ---------------- */
// config.js holds the Supabase URL and publishable key. It is gitignored and
// never committed. The Gemini key is never in the browser at all.
const CFG = window.PREPWISE_CONFIG || {};
if (!hasBackend()) {
  setErr("err-setup",
    "No AI backend configured.\n\nSet SUPABASE_URL and SUPABASE_ANON_KEY in config.js. Copy config.example.js to config.js to start.");
  $("btn-analyze").disabled = true;
}

/* ---------------- accounts ----------------
   Passwordless: a 6 digit code to an email address (phone once an SMS
   provider is connected, see PHONE_AUTH in config.js). Supabase Auth owns the
   address and the session; Prepwise itself stores only a username.

   Sign in and Create account send the same request and show the same
   message, whether or not the address already has an account, so this page
   cannot be used to find out who uses Prepwise. A new account picks its
   username after the code is confirmed, and the name is only reserved then.

   Anyone can try one round first as a guest: a Supabase anonymous user,
   limited by the gemini function to 5 multiple choice questions. */
const sb = hasBackend() && window.supabase
  ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "prepwise.auth" }
    })
  : null;
if (hasBackend() && !sb) {
  setErr("err-setup", "The sign in library did not load. Check your connection and reload the page.");
  $("btn-analyze").disabled = true;
}

const AUTH = {
  user: null,
  profile: null,
  mode: "signin",      // or "signup"
  id: null,            // { kind: "email" | "phone", value }
  username: "",        // chosen on Create account, claimed after the code
  returnTo: "s-setup",
  resendAt: 0
};
const TRIAL_KEY = "prepwise.trialUsed";
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const isGuest = () => !AUTH.user || !!AUTH.user.is_anonymous;
const hasAccount = () => !!(AUTH.user && !AUTH.user.is_anonymous && AUTH.profile);

async function accessToken() {
  if (!sb) return "";
  const { data } = await sb.auth.getSession();
  return data.session ? data.session.access_token : "";
}

function trialUsedHere() {
  try { return localStorage.getItem(TRIAL_KEY) === "1"; } catch (e) { return false; }
}
function markTrialUsed() {
  try { localStorage.setItem(TRIAL_KEY, "1"); } catch (e) {}
}

// A guest session for the free trial, made only when a guest first clicks
// Analyze, so visitors who only look around never create one.
async function ensureSession() {
  const { data } = await sb.auth.getSession();
  if (data.session) return;
  const captchaToken = await captcha();
  const { error } = await sb.auth.signInAnonymously({ options: { captchaToken } });
  if (error) throw new Error("Could not start the free trial: " + error.message);
}

/* Cloudflare Turnstile. A fresh widget per token, since each token works
   once. Most people never see it; Cloudflare shows a checkbox only when it
   is unsure. Without a site key in config.js (local development) it is
   skipped, and Supabase refuses the request if the project requires it. */
let captchaWidget = null;
function captcha() {
  if (!CFG.TURNSTILE_SITE_KEY) return Promise.resolve(undefined);
  if (!window.turnstile) return Promise.reject(new Error("The security check did not load. Reload the page and try again."));
  return new Promise((resolve, reject) => {
    if (captchaWidget !== null) { try { window.turnstile.remove(captchaWidget); } catch (e) {} }
    captchaWidget = window.turnstile.render("#captcha", {
      sitekey: CFG.TURNSTILE_SITE_KEY,
      appearance: "interaction-only",
      callback: token => resolve(token),
      "error-callback": () => reject(new Error("The security check failed. Reload the page and try again.")),
      "timeout-callback": () => reject(new Error("The security check timed out. Try again."))
    });
  });
}

/* Email, or phone in international format. Phone is recognised even while
   switched off, so someone who types a number is told why it does not work. */
function parseIdentifier(raw) {
  const v = raw.trim();
  if (/^\+?[\d\s\-().]{7,}$/.test(v)) {
    if (!CFG.PHONE_AUTH) return { error: "Phone sign in is coming soon. Use your email address for now." };
    const digits = v.replace(/\D/g, "");
    if (!v.startsWith("+") || digits.length < 8 || digits.length > 15) {
      return { error: "Enter the number with its country code, for example +91 98765 43210." };
    }
    return { kind: "phone", value: "+" + digits };
  }
  const email = v.toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  return { kind: "email", value: email };
}

function otpPayload(id, extra) {
  return Object.assign(id.kind === "phone" ? { phone: id.value } : { email: id.value }, extra || {});
}

/* ---- the account backend (username check, account deletion) ---- */
async function accountCall(body) {
  const url = CFG.SUPABASE_URL.replace(/\/+$/, "") + "/functions/v1/account";
  const headers = { "Content-Type": "application/json", "apikey": CFG.SUPABASE_ANON_KEY };
  const token = await accessToken();
  if (token) headers.Authorization = "Bearer " + token;
  let res;
  try {
    res = await fetch(url, { method: "POST", headers: headers, body: JSON.stringify(body) });
  } catch (e) {
    throw new Error("Could not reach Prepwise. Check your connection and try again.");
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw authError((j.error && j.error.message) || "Something went wrong (" + res.status + ").", j.error && j.error.code);
  return j;
}

const USERNAME_WORDS = {
  ok: ["good", "Available."],
  taken: ["bad", "That username is taken."],
  reserved: ["bad", "That username is not allowed. Try another."],
  invalid: ["bad", "Use 3 to 20 letters, numbers or underscores."],
  too_soon: ["bad", "You can change your username once every 7 days."]
};

// Checked in the page first, so malformed names never reach the server, then
// debounced, so typing a name spends one check rather than one per key.
function wireUsernameField(input, note, defaultNote) {
  let timer = null;
  let seq = 0;
  const paint = (kind, text) => {
    note.className = "field-note" + (kind ? " " + kind : "");
    note.textContent = text;
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const name = input.value.trim();
    input.dataset.status = "";
    if (!name) return paint("", defaultNote);
    if (!USERNAME_RE.test(name)) return paint("bad", USERNAME_WORDS.invalid[1]);
    paint("", "Checking");
    const mine = ++seq;
    timer = setTimeout(async () => {
      try {
        const r = await accountCall({ action: "check_username", username: name });
        if (mine !== seq) return;
        input.dataset.status = r.status;
        const w = USERNAME_WORDS[r.status] || USERNAME_WORDS.invalid;
        paint(w[0], w[1]);
      } catch (e) {
        if (mine === seq) paint("bad", e.message);
      }
    }, 400);
  });
}

wireUsernameField($("auth-username"), $("auth-username-note"),
  "3 to 20 letters, numbers or underscores. Shown in the app, never used to sign in.");
wireUsernameField($("claim-username"), $("claim-username-note"), "3 to 20 letters, numbers or underscores.");
wireUsernameField($("acc-new-username"), $("acc-new-username-note"), "3 to 20 letters, numbers or underscores.");

/* ---- header ---- */
function renderAcct() {
  const box = $("acct");
  if (!sb) { box.innerHTML = ""; return; }
  if (hasAccount()) {
    box.innerHTML = '<button class="ghost chip" id="btn-account">' + esc(AUTH.profile.username) + '</button>';
    $("btn-account").onclick = openAccount;
  } else {
    box.innerHTML = (AUTH.user && AUTH.user.is_anonymous ? '<span class="guest-tag">Guest trial</span>' : "") +
      '<button class="ghost chip" id="btn-signin">Sign in</button>';
    $("btn-signin").onclick = () => openAuth("signin");
  }
}

async function loadProfile() {
  AUTH.profile = null;
  if (AUTH.user && !AUTH.user.is_anonymous) {
    const { data } = await sb.from("profiles").select("username").maybeSingle();
    AUTH.profile = data || null;
  }
  renderAcct();
}

/* ---- sign in screen ---- */
function openAuth(mode, reason) {
  if (screen !== "s-auth" && screen !== "s-account") AUTH.returnTo = screen;
  setAuthMode(mode || "signin");
  authStep("id");
  $("auth-title").textContent = reason === "trial" ? "Keep practising with a free account" : "Sign in to Prepwise";
  $("auth-sub").textContent = reason === "trial"
    ? "You have used your free trial. A free account unlocks spoken answers and rounds of up to 30 questions."
    : "No password needed. We send a 6 digit code instead.";
  $("auth-tabs").classList.remove("hidden");
  $("btn-auth-back").classList.remove("hidden");
  show("s-auth");
  (mode === "signup" ? $("auth-username") : $("auth-id")).focus();
}

function setAuthMode(mode) {
  AUTH.mode = mode;
  $("auth-tabs").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.tab === mode));
  $("auth-username-wrap").classList.toggle("hidden", mode !== "signup");
  $("auth-id-label").textContent = CFG.PHONE_AUTH ? "Email or phone number" : "Email";
  $("btn-send-code").textContent = mode === "signup" ? "Create account" : "Send me a code";
  setErr("err-auth", "");
}

function authStep(step) {
  ["id", "code", "username"].forEach(s => $("auth-step-" + s).classList.toggle("hidden", s !== step));
  setErr("err-auth", "");
}

$("auth-tabs").querySelectorAll("button").forEach(b => b.onclick = () => setAuthMode(b.dataset.tab));
$("btn-auth-back").onclick = () => show(AUTH.returnTo === "s-auth" ? "s-setup" : AUTH.returnTo);
$("auth-id").addEventListener("input", () => { $("auth-id-note").textContent = ""; });

// Codes are sent with shouldCreateUser on for both tabs. With it off,
// Supabase answers differently for addresses that have no account, which
// would tell anyone who asks whether an address is registered.
async function sendCode(id) {
  const captchaToken = await captcha();
  const { error } = await sb.auth.signInWithOtp(otpPayload(id, { options: { shouldCreateUser: true, captchaToken: captchaToken } }));
  if (error) {
    throw new Error(error.status === 429
      ? "Too many codes asked for. Wait a minute, then try again."
      : "Could not send a code right now. Wait a minute, then try again.");
  }
  AUTH.resendAt = Date.now() + 60000;
  tickResend();
}

function tickResend() {
  const left = Math.ceil((AUTH.resendAt - Date.now()) / 1000);
  const btn = $("btn-resend");
  btn.disabled = left > 0;
  btn.textContent = left > 0 ? "Send a new code (" + left + "s)" : "Send a new code";
  if (left > 0) setTimeout(tickResend, 1000);
}

$("btn-send-code").onclick = async () => {
  setErr("err-auth", "");
  const id = parseIdentifier($("auth-id").value);
  if (id.error) return setErr("err-auth", id.error);
  let name = "";
  if (AUTH.mode === "signup") {
    name = $("auth-username").value.trim();
    if (!USERNAME_RE.test(name)) return setErr("err-auth", USERNAME_WORDS.invalid[1]);
    // The field's live check may still be waiting; ask once more to be sure.
    try {
      const r = await accountCall({ action: "check_username", username: name });
      if (r.status !== "ok") return setErr("err-auth", (USERNAME_WORDS[r.status] || USERNAME_WORDS.invalid)[1]);
    } catch (e) { return setErr("err-auth", e.message); }
  }
  const btn = $("btn-send-code");
  btn.disabled = true;
  try {
    await sendCode(id);
    AUTH.id = id;
    AUTH.username = name;
    const where = id.kind === "phone" ? "that number can receive texts" : "that address can receive email";
    $("auth-code-msg").textContent = "If " + where + ", a 6 digit code is on its way to " + id.value +
      ". It works for 10 minutes. Check your spam folder if it does not arrive.";
    $("btn-change-id").textContent = id.kind === "phone" ? "Use a different number" : "Use a different email";
    $("auth-code").value = "";
    authStep("code");
    $("auth-code").focus();
  } catch (e) {
    setErr("err-auth", e.message);
  } finally {
    btn.disabled = false;
  }
};

$("btn-resend").onclick = async () => {
  setErr("err-auth", "");
  try { await sendCode(AUTH.id); $("auth-code").focus(); } catch (e) { setErr("err-auth", e.message); }
};

$("btn-change-id").onclick = () => { authStep("id"); $("auth-id").focus(); };

$("auth-code").addEventListener("input", e => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
  if (e.target.value.length === 6) $("btn-verify").click();
});

$("btn-verify").onclick = async () => {
  const code = $("auth-code").value;
  if (!/^\d{6}$/.test(code)) return setErr("err-auth", "Enter the 6 digit code.");
  const btn = $("btn-verify");
  if (btn.disabled) return;
  btn.disabled = true;
  setErr("err-auth", "");
  try {
    const captchaToken = await captcha();
    const { data, error } = await sb.auth.verifyOtp(otpPayload(AUTH.id,
      { token: code, type: AUTH.id.kind === "phone" ? "sms" : "email", options: { captchaToken: captchaToken } }));
    if (error || !data.user) throw new Error("That code is wrong or has expired. Check it, or send a new one.");
    AUTH.user = data.user;
    await loadProfile();
    await afterSignIn();
  } catch (e) {
    setErr("err-auth", e.message);
  } finally {
    btn.disabled = false;
  }
};

async function afterSignIn() {
  // Someone who already had an account lands signed in, whichever tab they
  // used: they have just proved they own the address, so that is safe.
  if (AUTH.profile) return finishSignIn();
  if (AUTH.username) {
    const status = await claimUsername(AUTH.username);
    if (status === "ok") return finishSignIn();
    $("auth-claim-msg").textContent = (USERNAME_WORDS[status] || USERNAME_WORDS.invalid)[1] + " Pick another one.";
  } else {
    $("auth-claim-msg").textContent = "Welcome to Prepwise. One last thing: pick a username.";
  }
  $("auth-tabs").classList.add("hidden");
  $("btn-auth-back").classList.add("hidden");
  authStep("username");
  $("claim-username").value = "";
  $("claim-username").focus();
}

async function claimUsername(name) {
  const { data, error } = await sb.rpc("claim_username", { name: name });
  if (error) throw new Error("Could not save your username: " + error.message);
  if (data === "ok") await loadProfile();
  return data;
}

$("btn-claim").onclick = async () => {
  const name = $("claim-username").value.trim();
  if (!USERNAME_RE.test(name)) return setErr("err-auth", USERNAME_WORDS.invalid[1]);
  const btn = $("btn-claim");
  btn.disabled = true;
  setErr("err-auth", "");
  try {
    const status = await claimUsername(name);
    if (status !== "ok") return setErr("err-auth", (USERNAME_WORDS[status] || USERNAME_WORDS.invalid)[1]);
    finishSignIn();
  } catch (e) {
    setErr("err-auth", e.message);
  } finally {
    btn.disabled = false;
  }
};

function finishSignIn() {
  AUTH.username = "";
  $("auth-tabs").classList.remove("hidden");
  $("btn-auth-back").classList.remove("hidden");
  const back = AUTH.returnTo;
  // A signed in user is past the trial, so the analysis screen shows every option again.
  if (back === "s-analysis" && S.analysis) { renderAnalysis(); return show("s-analysis"); }
  if (back === "s-setup" || back === "s-debrief") return show("s-setup");
  show(back || "s-setup");
}

/* ---- account screen ---- */
function openAccount() {
  if (!hasAccount()) return openAuth("signin");
  if (screen !== "s-account" && screen !== "s-auth") AUTH.returnTo = screen;
  $("acc-username").textContent = AUTH.profile.username;
  const phone = !AUTH.user.email && AUTH.user.phone;
  $("acc-contact-title").textContent = phone ? "Phone number" : "Email";
  $("acc-contact").textContent = phone ? "+" + AUTH.user.phone : AUTH.user.email;
  $("acc-email-start").classList.toggle("hidden", !!phone);
  $("acc-email-codes").classList.add("hidden");
  ["acc-new-username", "acc-new-email", "acc-delete-confirm", "acc-delete-code", "acc-code-new", "acc-code-old"]
    .forEach(id => { $(id).value = ""; });
  $("acc-delete-code-wrap").classList.add("hidden");
  ["err-rename", "err-email", "err-signout", "err-delete"].forEach(id => setErr(id, ""));
  show("s-account");
}

$("btn-acc-back").onclick = () => show(["s-auth", "s-account"].includes(AUTH.returnTo) ? "s-setup" : AUTH.returnTo);

$("btn-rename").onclick = async () => {
  const name = $("acc-new-username").value.trim();
  if (!USERNAME_RE.test(name)) return setErr("err-rename", USERNAME_WORDS.invalid[1]);
  setErr("err-rename", "");
  const { data, error } = await sb.rpc("change_username", { name: name });
  if (error) return setErr("err-rename", "Could not change your username: " + error.message);
  if (data !== "ok") return setErr("err-rename", (USERNAME_WORDS[data] || USERNAME_WORDS.invalid)[1]);
  await loadProfile();
  $("acc-username").textContent = AUTH.profile.username;
  $("acc-new-username").value = "";
  $("acc-new-username-note").className = "field-note good";
  $("acc-new-username-note").textContent = "Done. Your old username stays reserved for 30 days.";
};

// Supabase's secure email change: a code goes to the new address and one to
// the current one, and the change happens only once both are entered.
let pendingEmail = "";
$("btn-email-start").onclick = async () => {
  setErr("err-email", "");
  const id = parseIdentifier($("acc-new-email").value);
  if (id.error || id.kind !== "email") return setErr("err-email", "Enter a valid email address.");
  if (id.value === AUTH.user.email) return setErr("err-email", "That is already your email.");
  const { error } = await sb.auth.updateUser({ email: id.value });
  if (error) {
    return setErr("err-email", error.status === 429
      ? "Too many codes asked for. Wait a minute, then try again."
      : "That address cannot be used. Check it, or try a different one.");
  }
  pendingEmail = id.value;
  $("acc-email-start").classList.add("hidden");
  $("acc-email-codes").classList.remove("hidden");
  $("acc-code-new").focus();
};

$("btn-email-cancel").onclick = () => {
  $("acc-email-codes").classList.add("hidden");
  $("acc-email-start").classList.remove("hidden");
  setErr("err-email", "");
};

$("btn-email-confirm").onclick = async () => {
  const codeNew = $("acc-code-new").value.trim();
  const codeOld = $("acc-code-old").value.trim();
  if (!/^\d{6}$/.test(codeNew) || !/^\d{6}$/.test(codeOld)) return setErr("err-email", "Enter both 6 digit codes.");
  setErr("err-email", "");
  const r1 = await sb.auth.verifyOtp({ email: pendingEmail, token: codeNew, type: "email_change" });
  if (r1.error) return setErr("err-email", "The code for the new address is wrong or has expired.");
  const r2 = await sb.auth.verifyOtp({ email: AUTH.user.email, token: codeOld, type: "email_change" });
  if (r2.error) return setErr("err-email", "The code for your current address is wrong or has expired.");
  const { data } = await sb.auth.getUser();
  if (data.user) AUTH.user = data.user;
  openAccount();
  setErr("err-email", "");
  $("acc-contact").textContent = AUTH.user.email;
};

$("btn-signout").onclick = () => signOut("local");
$("btn-signout-all").onclick = () => signOut("global");

async function signOut(scope) {
  setErr("err-signout", "");
  const { error } = await sb.auth.signOut({ scope: scope });
  if (error && scope === "global") return setErr("err-signout", "Could not sign out everywhere: " + error.message);
  resetAfterSignOut();
}

// The saved round belongs to whoever was signed in, so it goes too.
function resetAfterSignOut() {
  AUTH.user = null;
  AUTH.profile = null;
  try { sessionStorage.removeItem(SAVE_KEY); } catch (e) {}
  S.questions = []; S.results = []; S.idx = 0; S.youHp = 100; S.bossHp = 100; S.debrief = null; S.analysis = null;
  renderAcct();
  show("s-setup");
}

// Deleting needs a code entered in the last 10 minutes. The first click
// asks the server; if the sign in is older than that, a code is sent and the
// second click, with the code, confirms and deletes.
$("btn-delete").onclick = async () => {
  setErr("err-delete", "");
  if ($("acc-delete-confirm").value.trim().toLowerCase() !== AUTH.profile.username.toLowerCase()) {
    return setErr("err-delete", "Type your username exactly to confirm.");
  }
  const btn = $("btn-delete");
  btn.disabled = true;
  try {
    const waiting = !$("acc-delete-code-wrap").classList.contains("hidden");
    if (waiting) {
      const code = $("acc-delete-code").value.trim();
      if (!/^\d{6}$/.test(code)) throw new Error("Enter the 6 digit code.");
      const captchaToken = await captcha();
      const { error } = await sb.auth.verifyOtp(otpPayload(AUTH.id,
        { token: code, type: AUTH.id.kind === "phone" ? "sms" : "email", options: { captchaToken: captchaToken } }));
      if (error) throw new Error("That code is wrong or has expired.");
    }
    await deleteAccount();
  } catch (e) {
    setErr("err-delete", e.message);
  } finally {
    btn.disabled = false;
  }
};

async function deleteAccount() {
  try {
    await accountCall({ action: "delete_account" });
  } catch (e) {
    if (e.code !== "reauth_required") throw e;
    AUTH.id = AUTH.user.email ? { kind: "email", value: AUTH.user.email } : { kind: "phone", value: "+" + AUTH.user.phone };
    await sendCode(AUTH.id);
    $("acc-delete-contact").textContent = AUTH.id.value;
    $("acc-delete-code-wrap").classList.remove("hidden");
    $("acc-delete-code").focus();
    return;
  }
  // The user no longer exists, so only this browser's copy of the session is cleared.
  await sb.auth.signOut({ scope: "local" }).catch(() => {});
  try { localStorage.removeItem(SEEN_KEY); } catch (e) {}
  resetAfterSignOut();
  setErr("err-setup", "");
  $("err-setup").innerHTML = '<span class="toast">Your account has been deleted.</span>';
}

/* ---- start up ---- */
async function initAuth() {
  if (!sb) return renderAcct();
  const { data } = await sb.auth.getSession();
  AUTH.user = data.session ? data.session.user : null;
  await loadProfile();
  // Confirmed a code earlier but never picked a username, for example by
  // closing the tab. Finish that before anything else.
  if (AUTH.user && !AUTH.user.is_anonymous && !AUTH.profile) {
    AUTH.returnTo = "s-setup";
    AUTH.username = "";
    await afterSignIn();
    show("s-auth");
  } else if (screen === "s-analysis" && S.analysis) {
    renderAnalysis();
  } else if (screen === "s-debrief") {
    $("d-trial").classList.toggle("hidden", !isGuest());
  }
  sb.auth.onAuthStateChange((event, session) => {
    // Signed out here, in another tab, or everywhere from another device.
    if (event === "SIGNED_OUT") return setTimeout(resetAfterSignOut, 0);
    if (!session) return;
    AUTH.user = session.user;
    // A new guest session shows "Guest trial" in the header. A real sign in
    // redraws the header itself once its username has loaded.
    if (event === "SIGNED_IN" && session.user.is_anonymous) setTimeout(renderAcct, 0);
  });
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
  hideNonTech();
  save();
  // Clear a stale "paste a fuller job description" message, but keep the
  // "no AI backend configured" one, which explains why Analyze is disabled.
  if (hasBackend()) setErr("err-setup", "");
  $("btn-analyze").focus();
}));

$("btn-upload").onclick = () => $("file").click();

$("file").addEventListener("change", e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = ev => { $("jd").value = ev.target.result; save(); };
  r.readAsText(f);
});

$("jd").addEventListener("input", save);

$("btn-analyze").addEventListener("click", async () => {
  setErr("err-setup", "");
  hideNonTech();
  S.jd = $("jd").value.trim();
  if (!hasBackend()) return setErr("err-setup", "No AI backend configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in config.js and reload.");
  if (S.jd.length < 60) return setErr("err-setup", "Paste a fuller job description so the analysis has something to work with.");
  S.nonTech = false;
  // Only a hint for a friendlier path: the gemini function enforces the trial.
  if (isGuest() && trialUsedHere()) return openAuth("signup", "trial");

  const btn = $("btn-analyze");
  btn.disabled = true;
  btn.textContent = "Analyzing";
  onRetry = msg => setErr("err-setup", msg);
  try {
    if (isGuest()) await ensureSession();
    S.analysis = await gemini("analyze", { jd: S.jd });
    if (!ROUNDS.includes(S.analysis.round_type)) S.analysis.round_type = "Mixed";
    if (!Array.isArray(S.analysis.topics)) S.analysis.topics = [];
    S.roundType = S.analysis.round_type;
    if (!LEVELS.includes(S.analysis.level)) S.analysis.level = "Mid";
    S.level = S.analysis.level;
    // Only an explicit false stops here, so a backend that predates the
    // is_tech_role field still goes straight through.
    if (S.analysis.is_tech_role === false) return showNonTech();
    renderAnalysis();
    show("s-analysis");
  } catch (e) {
    if (e.code === "trial_used") { markTrialUsed(); return openAuth("signup", "trial"); }
    setErr("err-setup", e.message);
  } finally {
    onRetry = null;
    btn.disabled = false;
    btn.textContent = "Analyze this role";
  }
});

/* ---------------- non tech roles ----------------
   Prepwise is built for technical rounds, so a sales or HR job description
   first gets a friendly note. The user can still practise it: the round
   type becomes the role itself, since DSA and System Design mean nothing
   for a mutual fund advisor, and the set defaults to multiple choice. */
function showNonTech() {
  const role = S.analysis.role_title ? esc(S.analysis.role_title) : "";
  $("nontech-title").innerHTML = role
    ? "Ooh, <em>" + role + "</em> looks like a non tech role 🎀"
    : "Ooh, this looks like a non tech role 🎀";
  $("nontech").classList.remove("hidden");
}

function hideNonTech() { $("nontech").classList.add("hidden"); }

$("btn-paste-again").onclick = () => {
  hideNonTech();
  $("jd").value = "";
  save();
  $("jd").focus();
  window.scrollTo(0, 0);
};

$("btn-nontech-anyway").onclick = () => {
  hideNonTech();
  S.nonTech = true;
  // The backend caps the round type at 50 characters.
  S.roundType = (S.analysis.role_title || "Role knowledge").slice(0, 50);
  S.speech = false;
  renderAnalysis();
  show("s-analysis");
};

/* ---------------- analysis screen ---------------- */
function renderAnalysis() {
  // The free trial is one 5 question multiple choice round. The server forces
  // this too; hiding the choices just avoids offering what it would refuse.
  const guest = isGuest();
  if (guest) { S.count = 5; S.speech = false; }
  $("a-options").classList.toggle("hidden", guest);
  $("a-trial").classList.toggle("hidden", !guest);
  $("a-round").textContent = (S.nonTech ? S.roundType : S.analysis.round_type) + " round";
  $("a-override-wrap").classList.toggle("hidden", !!S.nonTech);
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

  // 5 is a one batch demo: about 4 Gemini requests end to end instead of
  // about 10 for 20 questions, which matters on a free tier of roughly 20 a day.
  $("a-count").innerHTML = [5, 20, 30]
    .map(n => '<button class="ghost' + (n === S.count ? ' on' : '') + '" data-count="' + n + '">' +
              n + ' questions' + (n === 5 ? ' (quick demo)' : '') + '</button>').join("");
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
  save();
}

$("btn-back").onclick = () => show("s-setup");
$("a-trial-signup").onclick = e => { e.preventDefault(); openAuth("signup"); };

function hasSpeechApi() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

// Escapes model text for display and renders the markdown it sometimes adds
// despite being asked not to. `def` becomes code and **word** loses its
// stars. A code span glued to a word, as in the`def`keyword, gets its
// spaces back: shown raw, that read as "thedef keyword".
function fmt(s) {
  return esc(s)
    .replace(/(\w)?`([^`\n]+)`(\w)?/g, (m, a, code, b) =>
      (a ? a + " " : "") + "<code>" + code + "</code>" + (b ? " " + b : ""))
    .replace(/\*\*([^*\n]+)\*\*/g, "$1");
}

/* ---------------- generation ---------------- */
// Questions this browser has already been asked for a job description, so a
// new session, or a longer one after the demo, does not open with the same
// questions. Kept in localStorage per job description: it is only a
// convenience, and everything works without it.
const SEEN_KEY = "prepwise.seen";
const SEEN_MAX = 40;

function jdKey() {
  let h = 0;
  for (let i = 0; i < S.jd.length; i++) h = (h * 31 + S.jd.charCodeAt(i)) | 0;
  return "jd" + h;
}

function loadSeen() {
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_KEY)) || {};
    return Array.isArray(all[jdKey()]) ? all[jdKey()] : [];
  } catch (e) { return []; }
}

function saveSeen(questions) {
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_KEY)) || {};
    const key = jdKey();
    all[key] = questions.concat(all[key] || []).filter((q, i, a) => a.indexOf(q) === i).slice(0, SEEN_MAX);
    // Keep the ten most recent job descriptions.
    const keys = Object.keys(all);
    if (keys.length > 10) keys.filter(k => k !== key).slice(0, keys.length - 10).forEach(k => delete all[k]);
    localStorage.setItem(SEEN_KEY, JSON.stringify(all));
  } catch (e) {}
}

$("btn-generate").addEventListener("click", async () => {
  if (isGuest()) { S.count = 5; S.speech = false; }
  setErr("err-gen", "");
  S.questions = [];
  S.debrief = null;
  resetPositionBags();
  show("s-gen");

  const perBatch = 5;
  const batches = Math.ceil(S.count / perBatch);
  let shortfall = "";
  onRetry = msg => setErr("err-gen", msg);
  const hints = LADDERS[S.level] || LADDERS.Mid;
  const seen = loadSeen();
  // A fresh topic order each session, since the order steers which questions
  // come first. Without it, everyone trying an example job description got
  // the same opening questions.
  const topics = shuffleInPlace(S.analysis.topics.slice());

  for (let i = 0; i < batches; i++) {
    $("gen-status").textContent = "Batch " + (i + 1) + " of " + batches + ", " + hints[Math.min(i, hints.length - 1)];
    const want = Math.min(perBatch, S.count - S.questions.length);
    try {
      const batch = await gemini("questions", {
        roundType: S.roundType,
        level: S.level,
        topics: topics,
        batch: i,
        total: batches,
        want: want,
        hint: hints[Math.min(i, hints.length - 1)],
        speech: S.speech,
        // This session's questions first, then earlier sessions', within the
        // backend's cap of 60.
        avoid: S.questions.map(q => q.question).concat(seen).slice(0, 60)
      });
      const clean = (Array.isArray(batch) ? batch : []).filter(validQ).slice(0, want).map(placeCorrectAnswer);
      if (!clean.length) throw new Error("Batch " + (i + 1) + " came back empty.");
      S.questions = S.questions.concat(clean);
      saveSeen(clean.map(q => q.question));
      if (isGuest()) markTrialUsed();
    } catch (e) {
      if (e.code === "trial_used") { markTrialUsed(); return openAuth("signup", "trial"); }
      // Short of a usable set, stop and surface the real reason.
      if (S.questions.length < 5) {
        setErr("err-gen", e.daily ? e.message : e.message + "\n\nGo back and try again.");
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
    setErr("err-gen", (shortfall
        ? "Gemini stopped early: " + shortfall
        : "Some generated questions were malformed and had to be dropped.") +
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

// option_notes says why each option is right or wrong, so a wrong pick can be
// explained. It moves with its option, and is dropped if it does not line up.
function placeCorrectAnswer(q) {
  if (q.type !== "mcq") return q;
  const notes = Array.isArray(q.option_notes) && q.option_notes.length === q.options.length ? q.option_notes : null;
  if (q.options.some(o => POSITIONAL_OPTION.test(String(o)))) return Object.assign({}, q, { option_notes: notes });
  const pairs = q.options.map((o, i) => ({ o: o, n: notes ? notes[i] : "" }));
  const right = pairs[q.correct_index];
  const rest = shuffleInPlace(pairs.filter((_, i) => i !== q.correct_index));
  const pos = dealPosition(q.options.length);
  rest.splice(pos, 0, right);
  return Object.assign({}, q, {
    options: rest.map(p => p.o),
    option_notes: notes ? rest.map(p => p.n) : null,
    correct_index: pos
  });
}

function validQ(q) {
  if (!q || typeof q.question !== "string" || !q.question.trim()) return false;
  if (q.type === "speech") return typeof q.explanation === "string";
  return Array.isArray(q.options) && q.options.length >= 2 &&
         Number.isInteger(q.correct_index) && q.correct_index >= 0 && q.correct_index < q.options.length;
}

/* ---------------- battle ---------------- */
// Exact, not rounded up: ceil(100 / 30) is 4, so 25 correct answers used to
// knock The Interviewer out with five questions still to go. HP is kept as a
// fraction, clamped at 0, and rounded only for display.
function damage() { return 100 / S.questions.length; }
// 30 hits of 100 / 30 can leave 1e-14 behind in floating point, which would
// miss the knockout, so anything that small counts as 0.
const lowerHp = (hp, n) => (hp - n < 1e-6 ? 0 : hp - n);
function hitBoss(n) { S.bossHp = lowerHp(S.bossHp, n); }
function hitYou(n)  { S.youHp  = lowerHp(S.youHp, n); }

// With restoring set, redraws the current question from saved state after a
// reload, including an answer already given, instead of starting it fresh.
function renderQuestion(restoring) {
  const q = S.questions[S.idx];
  if (!restoring) S.answered = false;
  stopMic();

  // A knockout no longer ends the round: the user chose how many questions to
  // practise, and every answer feeds the debrief. Say so, or a 0 HP bar with
  // questions still coming looks like a bug.
  const down = S.bossHp <= 0 ? " · The Interviewer is down, finish the round"
             : S.youHp <= 0 ? " · You are out of HP, finish the round" : "";
  $("q-progress").textContent = "Question " + (S.idx + 1) + " of " + S.questions.length + down;
  $("q-cat").textContent = q.category || S.roundType;
  $("q-text").innerHTML = fmt(q.question);
  $("q-feedback").classList.add("hidden");
  $("q-feedback").innerHTML = "";
  setErr("err-battle", "");

  if (q.type === "speech") {
    $("q-mcq").innerHTML = "";
    $("q-speech").classList.remove("hidden");
    $("btn-submit-speech").disabled = false;
    lockSpeechInput(false);
    $("btn-mic").disabled = !hasSpeechApi();
    $("mic-status").textContent = hasSpeechApi() ? "Answer out loud, or type it below." : "Voice input is not available in this browser. Type your answer.";
    if (restoring) {
      restoreSpeech();
    } else {
      $("transcript").value = "";
      S.redosLeft = MAX_REDOS;
      S.revealed = false;
      S.scored = null;
      S.lastPanel = null;
    }
  } else {
    $("q-speech").classList.add("hidden");
    $("q-mcq").innerHTML = q.options
      .map((o, i) => '<button class="opt" data-i="' + i + '">' + fmt(o) + '</button>').join("");
    $("q-mcq").querySelectorAll(".opt").forEach(b => b.onclick = () => answerMcq(+b.dataset.i));
    if (restoring && S.answered) paintMcqAnswer(q, S.picked);
  }
  paintHp();
  save();
}

function paintHp() {
  $("hp-you-fill").style.width = S.youHp + "%";
  $("hp-boss-fill").style.width = S.bossHp + "%";
  $("hp-you-num").textContent = Math.round(S.youHp) + " / 100";
  $("hp-boss-num").textContent = Math.round(S.bossHp) + " / 100";
}

function answerMcq(picked) {
  if (S.answered) return;
  S.answered = true;
  S.picked = picked;
  const q = S.questions[S.idx];
  const right = picked === q.correct_index;

  if (right) {
    hitBoss(damage());
    $("boss-box").classList.add("shake");
    setTimeout(() => $("boss-box").classList.remove("shake"), 340);
  } else {
    hitYou(damage());
  }
  paintHp();

  S.results.push({ category: q.category || "General", type: "mcq", correct: right });
  paintMcqAnswer(q, picked);
  save();
}

// Marks the options and shows the explanation. Separate from answerMcq so a
// reload can redraw an answered question without scoring it twice.
function paintMcqAnswer(q, picked) {
  const right = picked === q.correct_index;
  $("q-mcq").querySelectorAll(".opt").forEach((b, i) => {
    b.disabled = true;
    if (i === q.correct_index) b.classList.add("right");
    else if (i === picked) b.classList.add("wrong");
  });
  const notes = q.option_notes || [];
  let body;
  if (right) {
    body = "<p>Correct. " + fmt(q.explanation || "") + "</p>";
  } else {
    // Say why the pick was wrong, not only why the right answer is right.
    // The options are already marked red and green above, so name them by
    // colour instead of repeating long option text.
    body = (notes[picked]
        ? "<p><strong>Why yours is wrong:</strong> " + fmt(notes[picked]) + "</p>"
        : "") +
      "<p><strong>The right answer:</strong> " + fmt(q.explanation || "") + "</p>";
  }
  showFeedback(right ? "Direct hit" : "You take damage", body);
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
  const g = await gemini("grade", {
    level: S.level,
    question: q.question,
    keyPoints: q.explanation,
    transcript: text
  });
  return {
    score: Math.max(0, Math.min(100, parseInt(g.score, 10) || 0)),
    feedback: g.feedback || ""
  };
}

// Applies the scored attempt to the battle and the debrief. Called once per question.
function applySpeechScore(q, score) {
  const d = damage();
  let title;
  if (score >= 80) { hitBoss(d * 2); title = "Critical hit"; }
  else if (score >= 50) { hitBoss(d); title = "Solid hit"; }
  else { hitYou(d); title = "You take damage"; }
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
    html += '<div class="fb"><h3>' + esc(p.title) + '</h3><p class="muted" style="margin:0">' + fmt(p.body) + '</p></div>';
    html += '<p class="note">Your scored answer: ' + S.scored + ' out of 100. Redos are practice and do not change your HP or your debrief.</p>';
  }

  html += '<div class="row" style="margin-top:16px">';
  if (p && S.redosLeft > 0) html += '<button class="ghost" id="btn-redo">Redo (' + S.redosLeft + ')</button>';
  if (p && !S.revealed)     html += '<button class="ghost" id="btn-reveal">Show correct answer</button>';
  html += nextButtonHtml() + '</div>';

  if (S.revealed) {
    html += '<div class="reveal"><h3>What a strong answer covers</h3><p>' + fmt(q.explanation || "") + '</p></div>';
  }

  $("q-feedback").innerHTML = html;
  $("q-feedback").classList.remove("hidden");
  wireNext();
  if ($("btn-redo"))   $("btn-redo").onclick = startRedo;
  if ($("btn-reveal")) $("btn-reveal").onclick = () => { S.revealed = true; renderSpeechPanel(); };
  save();
}

// Redraws a spoken question after a reload. An answer counts as graded only
// once its feedback panel exists: a reload during grading loses that request,
// so the attempt reopens with the answer still in the box, to submit again.
function restoreSpeech() {
  S.answered = !!S.lastPanel;
  if (S.lastPanel) {
    lockSpeechInput(true);
    $("btn-submit-speech").disabled = true;
    $("mic-status").textContent = S.redosLeft > 0
      ? "Graded. Use Redo below to practise this one again."
      : "Graded. No redos left for this question.";
    renderSpeechPanel();
  } else if (S.scored !== null) {
    // A redo in progress: keep the panel with Next and any revealed answer.
    const n = MAX_REDOS - S.redosLeft;
    $("mic-status").textContent = "Practice attempt " + n + " of " + MAX_REDOS + ". Answer again.";
    renderSpeechPanel();
  }
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
$("transcript").addEventListener("input", save);

function sessionEnding() {
  return S.idx === S.questions.length - 1;
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

// body is HTML, already escaped by fmt.
function showFeedback(title, body) {
  $("q-feedback").innerHTML =
    '<div class="fb"><h3>' + esc(title) + '</h3><div class="muted fb-body">' + body + '</div></div>' +
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
    save();
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
  $("d-trial").classList.toggle("hidden", !isGuest());
  const won = S.bossHp <= 0;
  const lost = S.youHp <= 0;
  $("d-title").textContent = won ? "You beat The Interviewer" : lost ? "The Interviewer got the better of you" : "Session complete";
  $("d-line").textContent = "You answered " + S.results.length + " of " + S.questions.length +
    " questions. Your HP " + Math.round(S.youHp) + ", The Interviewer " + Math.round(S.bossHp) + ".";

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

  // Weak categories are worked out here, from the scores, and handed to the
  // backend. Asked for "2 to 3 focus areas" with nothing to go on, the model
  // invented weaknesses for a perfect score, including topics never tested.
  const WEAK_BELOW = 70;
  const pctOf = name => Math.round(cats[name].got / cats[name].total * 100);
  const weak = Object.keys(cats).filter(n => pctOf(n) < WEAK_BELOW).sort((x, y) => pctOf(x) - pctOf(y));

  try {
    // Kept once written, so reloading the debrief does not spend another
    // Gemini request or come back with different wording.
    const d = S.debrief || await gemini("debrief", {
      roundType: S.roundType,
      level: S.level,
      topics: S.analysis.topics,
      summary: summary,
      answered: S.results.length,
      weak: weak.map(c => ({ category: c, pct: pctOf(c) }))
    });
    S.debrief = d;
    save();
    // The scores decide whether there are focus areas, not the model. With
    // nothing weak the section is never shown, whatever came back; with weak
    // categories and an empty reply, fall back to naming them directly.
    const focus = weak.length
      ? (Array.isArray(d.focus_areas) && d.focus_areas.length ? d.focus_areas : weak)
      : [];
    $("d-readiness").textContent = d.overall_readiness || "";
    $("d-lists").innerHTML =
      listBlock("Strengths", d.strengths) +
      listBlock("Focus areas", focus) +
      (d.tip ? '<h2 style="margin-top:20px">' + (weak.length ? "Do this next" : "Ready for more") + '</h2><p class="muted">' + esc(d.tip) + '</p>' : "");
  } catch (e) {
    $("d-readiness").textContent = "The AI debrief could not be generated: " + e.message + " Your category breakdown above is still accurate.";
  }
}

function listBlock(title, arr) {
  if (!Array.isArray(arr) || !arr.length) return "";
  return '<h2 style="margin-top:20px">' + title + '</h2><ul>' +
    arr.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>";
}

$("btn-trial-signup").onclick = () => openAuth("signup");

$("btn-restart").onclick = () => {
  S.questions = []; S.results = []; S.idx = 0; S.youHp = 100; S.bossHp = 100; S.debrief = null;
  show("s-setup");
};

/* ---------------- surviving a reload ----------------
   The session is saved to sessionStorage as it goes, so reloading the page
   picks up on the same screen and question with the same HP, answers, and
   any half typed answer. sessionStorage belongs to the tab: a new tab or a
   closed one starts fresh. Storage can be unavailable (private windows,
   blocked site data), so every access is guarded and the app runs without it. */
const SAVE_KEY = "prepwise.session";
// The build stamp from app.js?v=..., so a round saved by an older deploy is
// dropped instead of restored into newer code.
const BUILD = (() => {
  try { return new URL(document.currentScript.src).searchParams.get("v") || ""; } catch (e) { return ""; }
})();
const SAVED_FIELDS = ["jd", "analysis", "nonTech", "roundType", "level", "count", "speech", "questions", "idx",
  "youHp", "bossHp", "results", "answered", "picked", "redosLeft", "revealed", "scored", "lastPanel", "debrief"];
let restored = false;

function save() {
  if (!restored) return;
  try {
    const state = {};
    SAVED_FIELDS.forEach(k => { state[k] = S[k]; });
    sessionStorage.setItem(SAVE_KEY, JSON.stringify({
      build: BUILD,
      screen: screen,
      jdDraft: $("jd").value,
      transcript: $("transcript").value,
      S: state
    }));
  } catch (e) {}
}

function restore() {
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(SAVE_KEY)); } catch (e) {}
  if (!saved || !saved.S || saved.build !== BUILD) return;
  $("jd").value = saved.jdDraft || "";
  SAVED_FIELDS.forEach(k => { if (k in saved.S) S[k] = saved.S[k]; });
  $("transcript").value = saved.transcript || "";

  if (saved.screen === "s-battle" && S.questions.length) {
    renderQuestion(true);
    show("s-battle");
  } else if (saved.screen === "s-debrief" && S.results.length) {
    runDebrief();
  } else if ((saved.screen === "s-analysis" || saved.screen === "s-gen") && S.analysis) {
    // A reload during generation loses the batches in flight, so go back one
    // step, where the choices are kept and one click builds the set again.
    renderAnalysis();
    show("s-analysis");
  }
}

try { restore(); } catch (e) { console.warn("Could not restore the saved session", e); }
restored = true;
save();
initAuth().catch(e => console.warn("Could not load the sign in state", e));
