// Prepwise question bank collector.
//
// Make.com calls this to fill public.bank_questions, the table the gemini
// function searches when it builds a company specific question batch (RAG).
// It is never called by the page.
//
//   {action: "ingest", items: [{text, url, source, company, role}]}
//     Raw posts (Reddit, Apify runs). Gemini pulls out the interview
//     questions each post reports, without names or other personal details,
//     then they are deduplicated, embedded and stored.
//   {action: "harvest", company, role}
//     Gemini with Google Search finds publicly reported questions for that
//     company and role, with the page each came from, and stores them.
//
// Both need the header x-bank-secret, so the publishable key in the page is
// not enough to write to the bank. Make also sends that publishable key as
// the Authorization bearer, which the Supabase gateway requires.
//
// Secrets this function needs:
//   BANK_INGEST_SECRET          required, any long random string, shared with Make
//   GEMINI_INGEST_KEY           recommended, a key from a separate Google project, so
//                               collection never spends the app's daily requests;
//                               falls back to GEMINI_API_KEY
//   GEMINI_MODEL, EMBED_MODEL   optional, default gemini-3.6-flash and gemini-embedding-001
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   provided by Supabase automatically

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-bank-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.6-flash";
const EMBED_MODEL = Deno.env.get("EMBED_MODEL") ?? "gemini-embedding-001";
const DIMS = 768;
const SOURCES = ["search", "reddit", "apify_linkedin", "apify_glassdoor"];
const LEVELS = ["Entry", "Mid", "Senior"];
const MAX_ITEMS = 100;
const POSTS_PER_CALL = 20;

const str = (v: unknown, max = 500) => (typeof v === "string" ? v : "").slice(0, max);

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

class Upstream extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/* ---------------- text clean up ---------------- */

// A second line of defence after the prompt: anything that still looks like a
// contact detail or a handle is removed before it is stored.
function scrub(s: string) {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/(^|\s)\/?u\/[\w-]+/g, "$1")
    .replace(/(^|\s)@[\w.]+/g, "$1")
    // Phone numbers need separators, so a question about 1000000000 items keeps its number.
    .replace(/\+?\d{1,3}[\s.-]?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{3,4}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// "1. Q: How would you..." becomes "How would you...".
function tidyQuestion(s: string) {
  return scrub(s.replace(/^\s*((\d+[.)]|[-*•]|q(uestion)?\s*\d*\s*[:.-])\s*)+/i, "")).slice(0, 400);
}

async function hashOf(question: string, company: string) {
  const norm = question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + "|" + company.toLowerCase().trim();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function parseJsonArray(text: string): unknown[] {
  const cleaned = text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  try {
    const v = JSON.parse(cleaned);
    return Array.isArray(v) ? v : [];
  } catch {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try { const v = JSON.parse(m[0]); return Array.isArray(v) ? v : []; } catch { return []; }
  }
}

/* ---------------- Gemini ---------------- */

function geminiKey() {
  return Deno.env.get("GEMINI_INGEST_KEY") || Deno.env.get("GEMINI_API_KEY") || "";
}

// deno-lint-ignore no-explicit-any
async function generate(prompt: string, opts: { search?: boolean; maxTokens: number }): Promise<{ text: string; meta: any }> {
  const generationConfig: Record<string, unknown> = { temperature: 0.2, maxOutputTokens: opts.maxTokens };
  // JSON mode is not combined with the search tool: the reply is parsed
  // leniently instead, the same way the page parses replies.
  if (!opts.search) generationConfig.responseMimeType = "application/json";
  if (!MODEL.includes("lite")) generationConfig.thinkingConfig = { thinkingBudget: 0 };
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig,
  };
  if (opts.search) body.tools = [{ google_search: {} }];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(geminiKey())}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  const text = await res.text();
  if (!res.ok) throw new Upstream("Gemini returned " + res.status + ": " + text.slice(0, 300), res.status);
  const data = JSON.parse(text);
  const cand = data.candidates?.[0];
  // deno-lint-ignore no-explicit-any
  const out = (cand?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
  return { text: out, meta: cand?.groundingMetadata ?? null };
}

async function embed(texts: string[]): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const chunk = texts.slice(i, i + 100);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${encodeURIComponent(geminiKey())}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: chunk.map(t => ({
            model: "models/" + EMBED_MODEL,
            content: { parts: [{ text: t }] },
            taskType: "RETRIEVAL_DOCUMENT",
            outputDimensionality: DIMS,
          })),
        }),
      },
    );
    const text = await res.text();
    if (!res.ok) throw new Upstream("Embedding returned " + res.status + ": " + text.slice(0, 300), res.status);
    // deno-lint-ignore no-explicit-any
    JSON.parse(text).embeddings.forEach((e: any) => vectors.push(e.values));
  }
  return vectors;
}

/* ---------------- database ---------------- */

function db(path: string, init: RequestInit = {}) {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return fetch(Deno.env.get("SUPABASE_URL") + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

type Row = { question: string; company: string; role: string; topic: string; level: string; source: string; source_url: string };

// Deduplicates, embeds only what is new, and stores it. Returns how many rows
// were actually added.
async function store(rows: Row[]): Promise<{ skipped: number; inserted: number }> {
  const byHash = new Map<string, Row>();
  for (const r of rows) {
    if (r.question.length < 10) continue;
    byHash.set(await hashOf(r.question, r.company), r);
  }
  if (!byHash.size) return { skipped: 0, inserted: 0 };

  // Skip what is already stored before embedding, to save embedding requests.
  const hashes = [...byHash.keys()];
  const existing = new Set<string>();
  for (let i = 0; i < hashes.length; i += 100) {
    const res = await db("bank_questions?select=content_hash&content_hash=in.(" + hashes.slice(i, i + 100).join(",") + ")");
    if (!res.ok) throw new Upstream("Reading the bank failed: " + (await res.text()).slice(0, 300), 500);
    // deno-lint-ignore no-explicit-any
    (await res.json()).forEach((r: any) => existing.add(r.content_hash));
  }
  const fresh = hashes.filter(h => !existing.has(h));
  if (!fresh.length) return { skipped: hashes.length, inserted: 0 };

  const vectors = await embed(fresh.map(h => byHash.get(h)!.question));
  const payload = fresh.map((h, i) => {
    const r = byHash.get(h)!;
    return {
      question: r.question,
      company: r.company || null,
      role: r.role || null,
      topic: r.topic || null,
      level: LEVELS.includes(r.level) ? r.level : null,
      source: r.source,
      source_url: r.source_url || null,
      content_hash: h,
      embedding: "[" + vectors[i].join(",") + "]",
    };
  });
  const res = await db("bank_questions?on_conflict=content_hash", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Upstream("Saving to the bank failed: " + (await res.text()).slice(0, 300), 500);
  return { skipped: hashes.length - fresh.length, inserted: fresh.length };
}

/* ---------------- actions ---------------- */

const NO_PERSONAL =
  'Rewrite each one as a standalone question in plain words. Leave out names, usernames, emails, phone numbers, ' +
  'links and anything else that identifies a person. Write code and commands as plain text, no markdown.';

async function ingest(body: Record<string, unknown>) {
  // deno-lint-ignore no-explicit-any
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, MAX_ITEMS).map((it: any) => ({
    text: str(it?.text, 3000).trim(),
    url: str(it?.url, 500).trim(),
    source: SOURCES.includes(it?.source) ? it.source : "",
    company: str(it?.company, 80).trim(),
    role: str(it?.role, 80).trim(),
  })).filter(it => it.text.length >= 20 && it.source);
  if (!items.length) {
    return json({ error: { message: "items must hold at least one {text, url, source} with source one of: " + SOURCES.join(", ") + "." } }, 400);
  }

  const rows: Row[] = [];
  for (let i = 0; i < items.length; i += POSTS_PER_CALL) {
    const chunk = items.slice(i, i + POSTS_PER_CALL);
    const prompt =
      'Below are posts where people describe job interviews. Extract the technical interview questions each post says the candidate was actually asked. ' +
      'Only take questions a post really reports; skip posts with none, and never invent or generalise questions. ' + NO_PERSONAL + '\n\n' +
      chunk.map((it, k) => 'POST ' + (k + 1) + (it.company ? ' (company: ' + it.company + ')' : '') + ':\n' + it.text).join('\n\n') + '\n\n' +
      'Return ONLY a raw JSON array, no markdown fences, no commentary. Each element:\n' +
      '{"post": the post number, "question": the question, "topic": a short label such as "Arrays" or "Caching", "level": "Entry", "Mid", "Senior" or "" when unclear}';
    const { text } = await generate(prompt, { maxTokens: 4096 });
    // deno-lint-ignore no-explicit-any
    for (const q of parseJsonArray(text) as any[]) {
      const src = chunk[Math.trunc(Number(q?.post)) - 1];
      if (!src) continue;
      rows.push({
        question: tidyQuestion(str(q?.question, 600)),
        company: src.company, role: src.role,
        topic: str(q?.topic, 60), level: str(q?.level, 10),
        source: src.source, source_url: src.url,
      });
    }
  }
  const saved = await store(rows);
  return json({ received: items.length, extracted: rows.length, ...saved }, 200);
}

async function harvest(body: Record<string, unknown>) {
  const company = str(body.company, 80).trim();
  const role = str(body.role, 80).trim() || "Software Engineer";
  if (company.length < 2) return json({ error: { message: "company is required." } }, 400);

  const prompt =
    'Use Google Search to find technical interview questions that candidates have publicly reported being asked for the role "' + role + '" at ' + company + '. ' +
    'Look at interview experience write-ups, forum threads and blog posts. Only include questions a source actually reports; never invent or generalise. ' + NO_PERSONAL + '\n\n' +
    'Return ONLY a raw JSON array of up to 15 items, no markdown fences, no commentary. Each element:\n' +
    '{"question": the question, "topic": a short label, "level": "Entry", "Mid", "Senior" or "" when unclear}\n' +
    'Return [] if you find none.';
  const { text, meta } = await generate(prompt, { search: true, maxTokens: 4096 });

  // Each question takes the page Google grounded it on, matched through the
  // reply's grounding supports. Links come from Google's metadata, never from
  // text the model wrote.
  // deno-lint-ignore no-explicit-any
  const chunks: any[] = meta?.groundingChunks ?? [];
  // deno-lint-ignore no-explicit-any
  const supports: any[] = meta?.groundingSupports ?? [];
  const urlFor = (q: string) => {
    const probe = q.slice(0, 40).toLowerCase();
    const hit = supports.find(s => String(s?.segment?.text ?? "").toLowerCase().includes(probe));
    const idx = hit?.groundingChunkIndices?.[0];
    return typeof idx === "number" ? str(chunks[idx]?.web?.uri, 500) : "";
  };

  // deno-lint-ignore no-explicit-any
  const rows: Row[] = (parseJsonArray(text) as any[]).map(q => {
    const question = tidyQuestion(str(q?.question, 600));
    return {
      question, company, role,
      topic: str(q?.topic, 60), level: str(q?.level, 10),
      source: "search", source_url: urlFor(str(q?.question, 600)),
    };
  });
  const saved = await store(rows);
  return json({ company, role, found: rows.length, sources: chunks.length, ...saved }, 200);
}

/* ---------------- entry ---------------- */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: { message: "Use POST." } }, 405);

  const secret = Deno.env.get("BANK_INGEST_SECRET") ?? "";
  if (secret.length < 16) return json({ error: { message: "BANK_INGEST_SECRET is not set on this function." } }, 500);
  if (req.headers.get("x-bank-secret") !== secret) return json({ error: { message: "Missing or wrong x-bank-secret." } }, 401);
  if (!geminiKey()) return json({ error: { message: "Set GEMINI_INGEST_KEY or GEMINI_API_KEY on this function." } }, 500);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: { message: "Request body must be JSON." } }, 400);
  }

  try {
    if (body.action === "ingest") return await ingest(body);
    if (body.action === "harvest") return await harvest(body);
    return json({ error: { message: 'action must be "ingest" or "harvest".' } }, 400);
  } catch (e) {
    const status = e instanceof Upstream ? e.status : 500;
    return json({ error: { message: e instanceof Error ? e.message : String(e) } }, status);
  }
});
