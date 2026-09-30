// Prepwise account backend.
//
// Two actions, both POST {action, ...}:
//
//   check_username  {username}  Live availability for the sign up and rename
//                               forms. Open to anyone, so it is rate limited
//                               per IP to stop it being used to list who has
//                               an account. Answers only ok, invalid,
//                               reserved or taken.
//   delete_account  {}          Deletes the caller's account and, by cascade,
//                               everything stored for it. Needs a code
//                               entered in the last 10 minutes.
//
// Everything else about accounts (codes, sessions, email change, sign out
// everywhere) is Supabase Auth, called straight from the page.
//
// Secrets this function needs:
//   RATE_LIMIT_SALT   required, the same value the gemini function uses
//   ALLOWED_ORIGINS   optional, comma separated; defaults to the Replit site
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient, type User } from "npm:@supabase/supabase-js@2.117.2";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://prepwise--raksharakyan.replit.app")
  .split(",").map(o => o.trim()).filter(Boolean);
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function bearer(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  return token.startsWith("sb_") ? "" : token;
}

async function userFrom(token: string): Promise<User | null> {
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error || !data.user ? null : data.user;
}

// Only read after Supabase Auth has confirmed the token, so the claims are trusted.
function claims(token: string): Record<string, unknown> {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64 + "=".repeat((4 - b64.length % 4) % 4)));
  } catch {
    return {};
  }
}

async function ipKey(req: Request): Promise<string> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const salt = new TextEncoder().encode(Deno.env.get("RATE_LIMIT_SALT")!);
  const k = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(ip));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(fn + " failed: " + error.message);
  return data as T;
}

// Per IP limits, plus a total across everyone as a backstop, since the IP
// header can be forged to spread checks over many fake addresses.
const CHECK_LIMITS: [bucket: string, windowSeconds: number, max: number, perIp: boolean][] = [
  ["username_check_min", 60, 20, true],
  ["username_check_day", 86400, 200, true],
  ["username_check_all", 86400, 5000, false],
];

const REAUTH_SECONDS = 600;

Deno.serve(async (req: Request) => {
  const CORS = corsFor(req);
  const json = (body: unknown, status: number) => new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: { message: "Use POST." } }, 405);
  if (!Deno.env.get("RATE_LIMIT_SALT")) {
    return json({ error: { message: "RATE_LIMIT_SALT is not set on this function." } }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: { message: "Request body must be JSON." } }, 400);
  }

  try {
    if (body.action === "check_username") {
      const username = typeof body.username === "string" ? body.username.slice(0, 40) : "";
      const ip = await ipKey(req);
      for (const [bucket, windowSeconds, max, perIp] of CHECK_LIMITS) {
        const ok = await rpc<boolean>("hit_rate_limit",
          { p_bucket: bucket, p_key: perIp ? ip : "all", p_window_seconds: windowSeconds, p_max: max });
        if (!ok) {
          return json({ error: { code: "rate_limited", message: "Too many checks. Wait a minute and try again." } }, 429);
        }
      }
      // A signed in user renaming can take back a name they released themselves.
      const user = await userFrom(bearer(req));
      const forUser = user && !user.is_anonymous ? user.id : null;
      const status = await rpc<string>("username_status", { name: username, for_user: forUser });
      return json({ status }, 200);
    }

    if (body.action === "delete_account") {
      const token = bearer(req);
      const user = await userFrom(token);
      if (!user || user.is_anonymous) {
        return json({ error: { code: "auth_required", message: "Sign in first." } }, 401);
      }
      // amr lists how and when this session proved who it is. A code entered
      // in the last 10 minutes is required, so a device left signed in cannot
      // be used to delete the account.
      const amr = Array.isArray(claims(token).amr) ? claims(token).amr as { timestamp?: number }[] : [];
      const newest = Math.max(0, ...amr.map(a => Number(a.timestamp) || 0));
      if (Date.now() / 1000 - newest > REAUTH_SECONDS) {
        return json({ error: { code: "reauth_required", message: "Confirm with a fresh code first." } }, 403);
      }
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) throw new Error("deleteUser failed: " + error.message);
      return json({ deleted: true }, 200);
    }

    return json({ error: { message: "action must be check_username or delete_account." } }, 400);
  } catch (e) {
    return json({ error: { message: (e as Error).message } }, 500);
  }
});
