# Institutional compliance pack (Georgia Tech / CanvasSync)

This document supports GT OIT and IRB-style review. It complements [CANVAS_TOS_COMPLIANCE.md](./CANVAS_TOS_COMPLIANCE.md) and [SECURITY_ROADMAP.md](./SECURITY_ROADMAP.md).

## Product summary

CanvasSync is a student calendar aggregator. Users sign in with **Canvas OAuth** on the registered GT Canvas instance (`gatech.instructure.com`). The backend stores encrypted OAuth tokens, syncs course metadata, syllabus-derived dates, modules, files, and announcements, and may use an LLM to resolve ambiguous due dates.

## Canvas developer key

- Register the OAuth2 developer key with GT OIT for the production redirect URI and scopes required for read-only course data.
- Production redirect: `{BACKEND_URL}/api/auth/canvas/callback`
- Post-login redirect: `{FRONTEND_URL}/?oauth=success` (no tokens in the URL; session is an HttpOnly cookie on the API domain).

## Data collected and retention

| Data | Purpose | Retention |
|------|---------|-----------|
| User profile (email, name from Canvas) | Account identity | Until user deletes data or account removal |
| Encrypted OAuth tokens | Canvas API access | Until logout, disconnect, or delete-data |
| Courses, assignments, file text extracts | Calendar display | Until delete-data; minimize `raw_canvas_json` over time |
| AI usage metadata (no prompts/responses) | Cost/ops monitoring | Admin-only; disable in prod unless needed |

Users may call `POST /api/user/delete-data` to revoke Canvas tokens and erase all stored rows.

## AI disclosure

- AI is used only to infer due dates from syllabus/module text when Canvas fields are missing.
- Prompts and responses are **not** stored in telemetry logs.
- Recommended in-app copy: *"CanvasSync may send course text to a third-party AI provider to estimate due dates. No grades or submissions are sent."*

## Security controls (production)

- `ENABLE_DEMO_SESSION=false`
- No AI usage-log or cloud-cost endpoint is present in the production application
- `REACT_APP_ENABLE_MANUAL_TOKEN_CONNECT` unset (no manual PAT)
- Strong `SESSION_SECRET_KEY` (≥32 chars) and `CANVAS_TOKEN_ENCRYPTION_KEY`
- Supabase RLS denies direct client access; backend uses service role only
- Optional `RATELIMIT_STORAGE_URI=redis://...` for distributed rate limits

## Privacy policy checklist

- [x] Publish privacy policy URL linked from app footer (`/privacy`)
- [x] Publish terms of service (`/terms`)
- [x] Describe Canvas OAuth, data categories, direct DeepInfra AI, retention, and deletion
- [ ] Contact email for data requests (set `REACT_APP_LEGAL_CONTACT_EMAIL` in prod)
- [ ] GT-specific: confirm alignment with student code of conduct and acceptable use
- [ ] DeepInfra account-level logging, retention, training, and data-use settings documented for OIT

## Acceptance tests (manual)

1. OAuth login → no `#token=` in browser URL; `canvassync_session` cookie set on API host.
2. Sync after 1h — Canvas token refresh succeeds (no 401 from Canvas).
3. `POST /api/demo/session` returns 404 when `ENABLE_DEMO_SESSION=false` on Cloud Run.
4. Supabase anon key cannot `SELECT` from `users` (RLS deny policies).
5. Logout → `DELETE` Canvas token + cleared DB credentials.
6. `POST /api/user/delete-data` → user row and cascaded data removed.
