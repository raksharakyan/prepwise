// Copy this file to config.js and fill in both values.
// config.js is gitignored and must never be committed.
//
// The app calls Gemini only through the Supabase Edge Function, which holds the
// API key as a server side secret and builds the prompts. Nothing secret appears
// here: the publishable key is a public client key, safe to ship in a browser,
// and row level security is what actually protects data.
window.PREPWISE_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: ""
};
