# Direct DeepInfra AI processing

CanvasSync sends date-extraction requests directly to DeepInfra's
OpenAI-compatible API. The configured model is:

`Qwen/Qwen3-235B-A22B-Instruct-2507`

There is no OpenRouter gateway and no alternate-provider fallback. Requests do
not intentionally include the requesting student's name, email address, Canvas
user ID, session identifier, or Canvas OAuth token. Course text is sanitized
for common email, phone, token, and ID-like patterns before transmission, but
course materials are not guaranteed anonymous and may still contain incidental
identifying information.

CanvasSync does not maintain a database of AI prompts, completions, or token
usage. The former AI telemetry table and its historical records have been
removed. Normal infrastructure security and request logs may still be retained
by CanvasSync's hosting providers according to their policies.

DeepInfra's current data-privacy documentation says ordinary inference inputs
and outputs are processed in memory, are not stored to disk, are not used for
training, and are not shared with third parties for this non-Google,
non-Anthropic model. It also says DeepInfra generally logs request metadata and
reserves the right to log a small portion of requests for debugging or security.
CanvasSync therefore does not describe the provider path as an unconditional
zero-data-retention guarantee.

Before production AI is enabled, the project owner must:

- provide a dedicated DeepInfra API key through Google Secret Manager;
- review and retain the then-current DeepInfra Terms of Use and Privacy Policy;
- verify any account-level logging, retention, training, and data-use controls;
- confirm that direct DeepInfra processing is acceptable to Georgia Tech; and
- update this document and the public Privacy Policy if provider behavior or
  the selected model changes.

Provider references:

- https://deepinfra.com/Qwen/Qwen3-235B-A22B-Instruct-2507/api
- https://docs.deepinfra.com/account/data-privacy
- https://deepinfra.com/privacy
- https://deepinfra.com/terms
