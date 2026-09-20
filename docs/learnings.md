# What went wrong, and what it taught me

Notes for the Week 4 documentation deliverable. These came out of actually building
and testing Prepwise, not from reading about it.

## Getting an LLM to return clean JSON every time

The whole app depends on parsing structured output. Asking for raw JSON is not enough
on its own. The reliable combination was asking explicitly for no markdown fences,
setting the response type on the API call, and still stripping stray fences on the
client before parsing, with a fallback that extracts the outermost JSON block when
parsing fails.

## Thinking tokens silently ate the response

Current Gemini models reason before answering, and those thinking tokens count against
the output limit. The first test spent its entire budget thinking and returned nothing
at all, with no error, just an empty response and a finish reason of MAX_TOKENS. The
fix was switching thinking off for all four calls, since each one wants structured
output rather than visible reasoning.

Worth knowing: the lite models reject the thinking budget parameter outright with a
400, so switching models is not a one line change.

## A single transient failure quietly shrank the session

Gemini returns temporary 503s often. Early on, one failed batch caused a twenty
question session to start with five questions and no warning shown to the user.

This was the most valuable bug of the project, because it was not a crash. It was a
silent downgrade, and the app looked like it was working. Retry with backoff fixed the
cause, and the app now tells the user when it has come up short instead of pretending
otherwise.

## Reading the page is not the same as looking at it

The category bars in the debrief never rendered. Every check run against that screen
read the text of the page, where the percentages were perfectly correct, so nothing
flagged it. An inline element was ignoring its height. The bug survived until a
screenshot was taken and something actually looked at the output.

Some classes of bug are only visible to an eye.

## The free tier is a real design constraint

The free Gemini tier allows twenty requests per day for the model in use. A single
twenty question session costs about ten: one analysis, four generation batches, up to
four gradings, and one debrief. That is two sessions per day.

This shapes the architecture rather than just the budget. It argues for fewer and
larger requests instead of many small ones, and it means the model gets chosen partly
on quota rather than purely on quality.

## Removing a key from the interface is not the same as securing it

Taking the API key field out of the UI and moving it to a gitignored config file keeps
the key out of version control and out of screenshots. It does not keep it out of the
browser, because anyone who loads the deployed page can still read that file.

The only real fix is a server side secret, which is why the Gemini call belongs in a
Supabase Edge Function. It is easy to mistake a tidier arrangement for a safer one.
