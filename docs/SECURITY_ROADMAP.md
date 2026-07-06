# CanvasSync Security Roadmap

**Updated:** June 20, 2026

## Completed in the current review branch

- Cookie sessions with server-side invalidation.
- Signed OAuth state and PKCE parameters.
- Encrypted Canvas tokens with refresh and checked revocation responses.
- Production PAT/body-token paths disabled.
- Origin plus custom-header CSRF protection.
- Strict CORS and frontend/backend security headers.
- Canvas/file SSRF and pagination-host checks.
- Raw-payload minimization.
- Supabase object-grant restrictions plus deny-direct RLS.
- Daily private retention job and retention indexes.
- Export, disconnect, storage-aware deletion, and current-device cache purge.
- Direct DeepInfra-only routing pinned to
  `Qwen/Qwen3-235B-A22B-Instruct-2507`.
- Obsolete public/debug endpoints removed.
- Legal consent version `2026-06-20`.

## Before a GT development-key test

- Apply and verify migration `010_compliance_state.sql`.
- Deploy and verify Vercel, Cloud Run service, and retention job from the same
  reviewed source.
- Confirm public Terms/Privacy and consent text match the deployed controls.
- Receive GT's process decision and exact staging/key requirements.
- Provision a separate staging callback if requested.

## Before a real-user pilot

- Complete GT Canvas OAuth, scope, refresh, revoke, error, and PKCE tests.
- Obtain GT's written decision on direct DeepInfra processing.
- Complete any accessibility, sponsor, data-owner, security, or brand review GT
  requires.
- Resolve whether process-local endpoint limits are acceptable for the pilot.
- Record an incident/escalation contact supplied by GT.

## Before multi-instance or broad launch

- Configure a shared Redis-compatible `RATELIMIT_STORAGE_URI`.
- Increase Cloud Run max instances only after distributed endpoint limits pass.
- Replace Create React App with a maintained build stack and clear relevant
  dependency audit findings.
- Complete broader accessibility and browser testing.
- Add outbound IP pinning or an equivalent DNS-rebinding control.
- Reconfirm scopes, provider/model, data categories, retention, and support
  expectations with GT.

## Canonical production values

```text
FRONTEND_URL=https://canvas-organizer.vercel.app
CANVAS_INSTANCE_URL=https://gatech.instructure.com
LLM_BASE_URL=https://api.deepinfra.com/v1/openai
MODEL_NAME=Qwen/Qwen3-235B-A22B-Instruct-2507
LEGAL_CONSENT_VERSION=2026-06-20
STORE_RAW_CANVAS_JSON=false
COURSE_FILE_TEXT_RETENTION_DAYS=180
ANNOUNCEMENT_RETENTION_DAYS=180
ASSIGNMENT_RETENTION_DAYS=180
COURSE_RETENTION_DAYS=180
SYLLABUS_RULES_RETENTION_DAYS=180
INACTIVE_USER_CONTENT_PURGE_DAYS=180
```
