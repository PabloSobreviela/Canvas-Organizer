# Direct DeepInfra AI processing

When the AI feature is enabled, CanvasSync sends date-extraction requests directly to DeepInfra's
OpenAI-compatible API. The configured model is:

`Qwen/Qwen3-235B-A22B-Instruct-2507`

There is no OpenRouter gateway and no alternate-provider fallback. Requests do
not intentionally include the requesting student's name, email address, Canvas
user ID, session identifier, or Canvas OAuth token. Course text is sanitized
for common email, phone, token, and ID-like patterns before transmission, but
course materials are not guaranteed anonymous and may still contain incidental
identifying information.

CanvasSync does not maintain a database of AI prompts, completions, costs, or
token usage. The obsolete AI telemetry table is removed by
`backend/migrations/010_compliance_state.sql`. Normal infrastructure security
and request logs may still be retained by hosting and inference providers
according to their configured policies.

DeepInfra's current data-privacy documentation says ordinary inference inputs
and outputs are processed in memory, are not stored to disk, are not used for
training, and are not shared with third parties for this non-Google,
non-Anthropic model. It also says DeepInfra generally logs request metadata and
reserves the right to log a small portion of requests for debugging or security.
DeepInfra also markets ordinary inference as **zero data retention by default**.
CanvasSync uses the ordinary synchronous OpenAI-compatible endpoint for this
model, not the bulk API that may temporarily store encrypted data. The reserved
debugging/security exception remains disclosed and is not hidden by the ZDR
label.

Before AI is used with Georgia Tech Canvas-derived content, the project owner
must:

- keep the dedicated DeepInfra API key in Google Secret Manager;
- review and retain the then-current DeepInfra Terms of Use and Privacy Policy;
- retain evidence of DeepInfra's current ZDR-by-default data policy and its
  debugging/security exception;
- obtain and follow Georgia Tech's conditions for direct DeepInfra processing
  under the applicable independent student-development or pilot path; and
- update this document and the public Privacy Policy if provider behavior or
  the selected model changes.

Provider references:

- https://deepinfra.com/Qwen/Qwen3-235B-A22B-Instruct-2507/api
- https://docs.deepinfra.com/account/data-privacy
- https://deepinfra.com/privacy
- https://deepinfra.com/terms
