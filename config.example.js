// Copy this file to config.js and fill in ONE of the two options below.
// config.js is gitignored and must never be committed.

window.PREPWISE_CONFIG = {

  // OPTION A, preferred. Call Gemini through the Supabase Edge Function, which
  // holds the API key as a server side secret. Nothing secret appears here: the
  // anon key is a public client key, safe to ship in a browser, and is limited
  // by row level security. This is the only setup safe to deploy.
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",

  // OPTION B, local development only. Call Google directly with your own key.
  // Anyone who can load the page can read this value, so never deploy it.
  // Get a free key at https://aistudio.google.com/apikey
  GEMINI_API_KEY: ""
};
