# CanvasSync Institutional Review Facts

**Updated:** June 20, 2026
**Contact:** `pablo3@gatech.edu`

CanvasSync is an independent Georgia Tech student-developed application. It is
not an official, sponsored, or endorsed Georgia Tech service. This document is a
factual review aid, not a claim that institutional approval has been granted.

## Integration

- External web app; not currently LTI.
- Canvas OAuth authorization-code client with signed state.
- Production personal-token entry is disabled.
- Tokens remain server-side and are encrypted at rest.
- Production redirect: `{BACKEND_URL}/api/auth/canvas/callback`.
- Georgia Tech has not yet issued the development or production Developer Key.

## Data

| Data | Purpose | Active retention |
| --- | --- | --- |
| Email or Canvas login identifier, name, Canvas ID | Account identity | Until account deletion |
| Encrypted OAuth credentials | Canvas access | Until logout, disconnect, deletion, or invalidation |
| Courses, assignments, descriptions, submission/completion state | Calendar | 180-day stale-content window |
| Announcement title and full message | Date extraction | 180-day stale-content window |
| Syllabus/page/module/file extracted text | Date extraction | 180-day stale-content window |
| Preferences and manual completion state | User planning | Until account deletion |
| Operational/security logs | Security and operations | Provider/configuration-specific |

Raw Canvas payload persistence is disabled in production. CanvasSync does not
maintain an AI prompt, completion, cost, or token-usage telemetry table.

The current service is limited by its Terms and consent flow to users who
represent that they are at least 18; it does not offer an under-18 AI mode.

## AI

- Direct DeepInfra only; no OpenRouter or automatic provider fallback.
- Fixed model: `Qwen/Qwen3-235B-A22B-Instruct-2507`.
- AI is independently enable/disable controlled.
- The backend capability may be active for synthetic demo/operator testing, but
  no Georgia Tech Canvas-derived content is available until GT issues a local
  Developer Key and any AI conditions are applied.
- Prompts are minimized, clipped, and redacted for common obvious identifiers,
  but course text is not guaranteed anonymous.
- DeepInfra describes ordinary synchronous inference as ZDR by default:
  in-memory processing, no training, and no disk storage after inference.
  CanvasSync does not use the bulk API. DeepInfra's limited
  debugging/security-logging reservation remains disclosed.

## Security

- Fernet token encryption.
- Secure HttpOnly cookie sessions.
- Signed OAuth state; PKCE implemented but pending GT Canvas verification.
- Trusted-Origin plus custom-header CSRF protection for unsafe cookie requests.
- Strict CORS.
- Deny-direct-access RLS for browser roles; service role is backend-only.
- Database-backed sync throttling.
- Process-local Flask endpoint limits unless a shared Redis-compatible
  `RATELIMIT_STORAGE_URI` is configured.
- SSRF and Canvas pagination-host validation.
- Daily retention job.
- Export, disconnect, and retry-safe deletion.

## Open decisions

- Which review path applies to a student-developed external OAuth app?
- Is a sponsor or data owner required?
- May a test-only Developer Key be issued?
- What review applies to DeepInfra and course-material processing?
- What accessibility, brand, support, and continuity evidence is required?
