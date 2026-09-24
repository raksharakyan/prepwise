// Prepwise Gemini proxy.
//
// Exists so the API key lives here as a server side secret instead of in the
// browser. The page sends a prompt, this function adds the key and forwards it
// to Google, then returns Gemini's response body verbatim with the same status
// code. Keeping it a thin proxy means the client keeps its own parsing, retry
// and error handling unchanged.
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

  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!prompt.trim()) return json({ error: { message: "A prompt is required." } }, 400);

  const maxOutputTokens = Math.min(Math.max(Number(body.maxOutputTokens) || 2048, 1), 8192);
  const temperature = typeof body.temperature === "number" ? body.temperature : 0.7;

  const generationConfig: Record<string, unknown> = {
    temperature,
    maxOutputTokens,
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
        contents: [{ role: "user", parts: [{ text: prompt }] }],
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
