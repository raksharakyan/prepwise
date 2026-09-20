// Copy this file to config.js and add your key.
// config.js is gitignored and must never be committed.
//
// Get a free key at https://aistudio.google.com/apikey
//
// NOTE: this keeps the key out of the interface, not out of the browser.
// Anyone who can load the deployed page can still read config.js. Use this
// for local runs and demo recordings only. To deploy publicly, move the
// Gemini call into a Supabase Edge Function so the key stays server side.
// See docs/lovable-build-prompt.md, prompt 2.
window.PREPWISE_CONFIG = {
  GEMINI_API_KEY: ""
};
