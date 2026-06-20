# CanvasSync compliance remediation and remaining work

**Audit date:** June 20, 2026
**Canonical app:** `https://canvas-organizer.vercel.app`
**Repository branch:** `codex/mobile-open-design-feedback`
**Pull request:** `PabloSobreviela/Canvas-Organizer#1`

This is a technical compliance status report, not a legal opinion. It records
what the repository and deployed services demonstrably do, what was changed,
and what still requires credentials, institutional approval, or an owner
decision.

## Current deployment

| Component | Verified state |
| --- | --- |
| Frontend | Vercel production alias `https://canvas-organizer.vercel.app` |
| Backend | Cloud Run revision `canvas-organizer-backend-00114-jxx`, 100% traffic |
| Database/storage | Supabase project `ixmznhpkelysbplgcrge` |
| AI route in code | Direct `https://api.deepinfra.com/v1/openai`, model `Qwen/Qwen3-235B-A22B-Instruct-2507` |
| AI route in production | Disabled until a dedicated DeepInfra key is supplied |
| Canvas OAuth | Compliance-ready code deployed; GT client ID/secret remain intentional placeholders pending approval |
| Retention | Cloud Run Job `canvassync-retention`; daily Cloud Scheduler trigger at 3:00 AM America/New_York |

`canvassync.app` is not treated as an active service domain. It is absent from
the backend CORS allowlist and from the canonical public/legal URLs.

## Remediations completed

### Removed dangerous and legacy surfaces

The following production paths were removed and return HTTP 404:

- `/api/ai/usage-logs`
- `/api/ai/usage-logs/dashboard`
- `/api/cloud/cost-audit`
- `/api/admin/retention/run`
- `/api/user/canvas-credentials`
- `/api/canvas/test`

The private-testing logs page, AI telemetry implementation, cloud-cost audit
implementation, OpenRouter setup/test scripts, manual Canvas token UI, and a
1,300-line legacy backend copy were deleted. Vercel deployment archives now
exclude backend code, local databases, logs, compliance working papers, and
editor state.

Historical AI telemetry was purged: 21 records were deleted and zero remained
after the purge. Migration `009_remove_ai_usage_logs.sql` will drop the now-empty
table once database-owner access is available.

Cloud Run logs no longer intentionally include course IDs, document names,
assignment names, AI summaries, storage paths, email addresses, or user IDs.
Canvas upstream response bodies and URLs are no longer echoed to clients or
included in pagination errors.

### Credentials and secrets

- The retired OpenRouter secret was detached from Cloud Run and deleted from
  Google Secret Manager.
- A locally stored Google service-account JSON key was deleted and its matching
  cloud key was revoked.
- No DeepInfra key was found locally or in Google Secret Manager. Production AI
  therefore fails closed instead of falling back to OpenRouter or another model.

### Canvas OAuth and Instructure alignment

- Personal/manual access-token entry and storage endpoints were removed.
- OAuth uses authorization code flow, PKCE, signed state, an HttpOnly state
  cookie, server-side token exchange, encrypted token storage, refresh, revoke,
  and server-side session cookies.
- The default scope list now covers every Canvas REST endpoint the application
  actually calls:
  - current user;
  - course list and course details/syllabus;
  - assignments with the current user's `submission` include;
  - course files and file metadata;
  - modules;
  - front page, page list, and page content; and
  - announcements.
- All requested scopes are GET-only. The OIT request now specifies
  `require_scopes=true` and `allow_includes=true`.
- Canvas API requests identify CanvasSync with a non-user-specific User-Agent
  and request string-safe Canvas IDs.
- The app and Terms state that CanvasSync is independent, not an official
  Georgia Tech or Instructure product.
- AI-discovered and AI-modified dates are labeled at the point of use as
  `AI-generated from materials`, `AI-assisted date`, or `Review AI date`.
- Terms state that users and Georgia Tech retain ownership of Canvas materials
  and derived information.

These changes address the current Instructure API Policy principles concerning
independent-app identification, purpose transparency, private-data handling,
generative-AI notice, AI-output labeling, ownership, and rate-conscious use.
Final permission to use Georgia Tech Canvas still depends on GT issuing and
governing the Developer Key.

### Consent, privacy, and user controls

The public Terms, Privacy Policy, and consent modal now use version
`2026-06-19` and consistently disclose:

- the real Vercel, Cloud Run, Supabase, and direct DeepInfra architecture;
- the exact Qwen model;
- that no AI gateway or alternate-provider fallback is used;
- assignment completion/submission status, but not grades or submitted work;
- best-effort redaction and the fact that course text is not guaranteed
  anonymous;
- DeepInfra's stated in-memory/no-training behavior and its reserved right to
  log a small portion of requests for debugging or security;
- 180-day synced-content retention;
- export, Canvas disconnect, logout/token revoke, and full deletion controls;
  and
- AI accuracy limitations.

Backend endpoints for consent, export, disconnect, and deletion are deployed.
Deletion now clears the current session cookie, and deleted user rows invalidate
old session JWTs instead of allowing an `sv=0` token to survive.

### Retention enforcement

A non-public Cloud Run Job runs `retention_service.py`. It was executed
successfully and returned zero stale rows for every category. Cloud Scheduler is
enabled and invokes the job daily at 3:00 AM America/New_York using a dedicated
service account. There is no public retention endpoint.

### Verification completed

- Python compilation: passed.
- Backend import and route enumeration: passed.
- Frontend production build: passed.
- Frontend legal-disclosure test: passed.
- Python dependency consistency (`pip check`): passed.
- GitHub security-hygiene check: passed.
- Vercel `/privacy` and `/terms`: HTTP 200.
- Production bundle contains the direct DeepInfra model/disclosures and does
  not contain OpenRouter, `/api/canvas/test`, or
  `/api/user/canvas-credentials`.
- CORS permits `https://canvas-organizer.vercel.app` and rejects
  `https://canvassync.app` and an unrelated origin.

## Remaining blockers and risks

### P0 — Supabase migrations require database-owner access

The deployed database still lacks:

- `users.legal_consent_at`;
- `users.legal_consent_version`; and
- `users.session_version`.

The empty `ai_usage_logs` table also still exists. Service-role REST access
cannot execute DDL, and no Supabase owner login, database password, CLI access
token, or SQL-execution RPC is available in this workspace.

Apply the following idempotent migrations in numeric order:

1. `002_fix_rls.sql`
2. `004_user_legal_consent.sql`
3. `006_retention_indexes.sql`
4. `007_rate_limits_cascade.sql`
5. `008_session_version.sql`
6. `009_remove_ai_usage_logs.sql`

Until these are applied, real-user consent persistence and server-side session
revocation are not operational. This is the highest-priority remaining
technical blocker.

### P0 — Georgia Tech OAuth credentials and approval are not available

The stored client ID and client secret are placeholders. The login endpoint
returns HTTP 503 with `CANVAS_OAUTH_PENDING` instead of sending users through a
broken or misleading authorization flow.

GT must confirm:

- whether this external GT App OAuth2 REST integration is approved rather than
  requiring an LTI 1.3 path;
- the exact permitted GET scopes;
- `require_scopes=true` and `allow_includes=true`;
- approved redirect URI and canonical app URL;
- approved subprocessors and data classification; and
- pilot population, support, incident, and deletion obligations.

### P0 — DeepInfra production credential and institutional acceptance

No `deepinfra-api-key` secret exists. AI is intentionally disabled in
production. To enable it:

1. create a dedicated DeepInfra account/key under an authorized account owner;
2. review/retain the current DeepInfra Terms, Privacy Policy, data-privacy
   documentation, and account settings;
3. obtain Georgia Tech approval for direct DeepInfra processing;
4. add `deepinfra-api-key` to Secret Manager; and
5. redeploy with `-EnableAiResolve`.

DeepInfra states ordinary inference content is processed in memory and not used
for training, but reserves limited debugging/security logging. CanvasSync must
not describe this as an unconditional contractual zero-retention guarantee
unless a separate agreement establishes one.

### P1 — Distributed web rate limiting

Cloud Run still uses the explicitly temporary `memory://` Flask rate-limit
backend. Supabase-backed per-user sync throttles remain active, but general
endpoint limits are per Cloud Run instance. Provision a shared Redis-compatible
store and remove `ALLOW_IN_MEMORY_RATE_LIMITS=true` before a general launch.

### P1 — Frontend build-tool dependency debt

`npm audit fix` removed the critical advisory and updated the directly used
Axios dependency. Forty-three advisories remain, including eleven high-severity
findings inherited primarily through the retired Create React App build/test
toolchain. The production app is a static bundle and does not run the dev server
or Jest toolchain, but this remains supply-chain risk. Migrate the frontend to a
maintained build system (for example Vite), then require clean production
dependency auditing in CI.

### P1 — Local legacy data

Approximately 769 MB of ignored local `backend/data` material remains on this
workstation. It is excluded from Git and Vercel and is not copied into the Cloud
Run image, but it may contain legacy Canvas course content. It was not deleted
because ownership/retention authorization cannot be inferred safely.

## Questions requiring the owner

1. Can you provide Supabase owner access or apply the six SQL migrations above?
2. Can you provide a dedicated DeepInfra key after confirming the account owner
   is authorized to accept DeepInfra's terms?
3. Is `canvassync@gatech.edu` a real, monitored mailbox authorized for privacy,
   security, and deletion requests?
4. Has Georgia Tech approved Supabase, Google Cloud, Vercel, and DeepInfra for
   this data and pilot?
5. Is the 180-day retention window institutionally approved?
6. Should the public demo remain enabled before OAuth approval?
7. May the 769 MB local legacy Canvas cache be permanently deleted?
8. Who is the legal/service operator that should be identified in the Terms and
   privacy contact materials?

## Primary policy references

- Instructure API Policy: https://www.instructure.com/policies/canvas-api-policy
- Canvas OAuth2: https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth
- Canvas developer keys: https://developerdocs.instructure.com/services/canvas/oauth2/file.developer_keys
- DeepInfra model API: https://deepinfra.com/Qwen/Qwen3-235B-A22B-Instruct-2507/api
- DeepInfra data privacy: https://docs.deepinfra.com/account/data-privacy
- DeepInfra Privacy Policy: https://deepinfra.com/privacy
- DeepInfra Terms: https://deepinfra.com/terms
