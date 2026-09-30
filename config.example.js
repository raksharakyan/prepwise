// Copy this file to config.js and fill in the values.
// config.js is gitignored and must never be committed.
//
// The app calls Gemini only through the Supabase Edge Function, which holds the
// API key as a server side secret and builds the prompts. Nothing secret appears
// here: the publishable key is a public client key, safe to ship in a browser,
// and row level security is what actually protects data.
//
// TURNSTILE_SITE_KEY is Cloudflare Turnstile's public site key (the secret key
// goes in Supabase, never here). Leave it empty for local development only if
// the Supabase project does not require a captcha.
//
// PHONE_AUTH stays false until an SMS provider is connected in Supabase.
window.PREPWISE_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  TURNSTILE_SITE_KEY: "",
  PHONE_AUTH: false
};
