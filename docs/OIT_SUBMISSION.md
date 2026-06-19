# CanvasSync — GT OIT Submission Package

Prepared for Georgia Tech OIT review for a Canvas Developer Key (OAuth2). This
document summarizes the application, its integration model, the Canvas scopes
requested, data handling, security controls, and operational practices.

> **Integration model (read first).** CanvasSync's proposed initial integration
> model is a **GT App feature backed by a Canvas OAuth2 REST API client using a
> Canvas Developer Key**. It is **not** initially designed as a Canvas-embedded
> LTI tool. The OAuth2 model is appropriate because CanvasSync operates *outside*
> Canvas and each user authorizes access to their own Canvas data. **LTI 1.3
> should only become the primary path if GT requires CanvasSync to launch from
> within Canvas or appear in Canvas course/module/assignment placements** — in
> which case it is a separate integration path, not the default architecture.
>
> Before requesting key provisioning, confirm with GT OIT / Digital Learning
> whether a GT App OAuth2 REST integration is permitted, or whether all new
> Canvas-connected student tools must use the LTI 1.3 vetting path. The public GT
> LTI vetting process and 3-month course-start timing appear to apply to new
> Canvas **LTI** integrations; we have **not** confirmed whether the same process
> applies to standalone OAuth2 REST developer-key apps. (Tracked as S-0.1 / R12
> in `OIT_READINESS_AUDIT.md`.)

---

## 1. Application overview

- **What it is:** A **GT App student-productivity feature** — a student-facing web
  experience that consolidates Canvas assignment due dates with deadlines
  extracted (via AI) from syllabi and course documents into one weekly/calendar
  view, plus calendar/planning metadata.
- **Where it runs:** *Outside* Canvas (its own web app, surfaced through the GT
  App experience). It is not embedded in Canvas and does not use a Canvas launch
  placement.
- **Who uses it:** Individual GT students, each authorizing access to their own
  Canvas account via OAuth2. The app acts strictly on behalf of the signed-in
  user.
- **Access pattern:** Read-only consumption of the signed-in user's own Canvas
  data (courses, assignments, deadlines, calendar/planning metadata). The app
  does not write to Canvas and does not access other users' data.

## 2. Architecture

```
React SPA (Vercel)  --session JWT-->  Flask API (Google Cloud Run)
       |                                   |
  Sign in with Canvas (OAuth2)             |-- Supabase (Postgres + RLS, Storage)
       |                                   |-- OpenRouter (AI date extraction, ZDR)
       +------------------ Canvas LMS REST API <--+
```

- **Frontend:** React SPA hosted on Vercel.
- **Backend:** Python/Flask on Google Cloud Run (autoscaled, containerized).
- **Database:** Supabase (managed Postgres) with Row-Level Security; the backend
  uses a service role and is the only path to data.
- **AI:** OpenRouter API gateway with input/output logging disabled and
  zero-data-retention routing requested.
- See `README.md` and `docs/OIT_READINESS_AUDIT.md` for detail.

## 3. Authentication & token handling

- **Canvas OAuth2 Authorization Code flow** (with PKCE). Users click "Sign in
  with Canvas" and authorize on Canvas; we never see Canvas passwords.
- **Token storage:** Access and refresh tokens are encrypted at rest with Fernet
  (`CANVAS_TOKEN_ENCRYPTION_KEY`) in Supabase. Tokens are never logged, never
  returned to the browser, and never included in data exports.
- **Token lifecycle:** Access tokens are refreshed automatically before expiry;
  tokens are revoked at Canvas on user disconnect or account deletion
  (`canvas_token_service.py`).
- **App sessions:** The backend issues its own short-lived, httpOnly, Secure
  session JWT (`SESSION_SECRET_KEY`); the Canvas token stays server-side.

## 4. Canvas API scopes requested

All scopes are **read-only (GET)**. CanvasSync requests the minimum needed to
build a student's deadline view:

| Capability | Canvas API (read-only) |
| --- | --- |
| List the user's courses | `GET /api/v1/courses` |
| Course assignments + submission state | `GET /api/v1/courses/:id/assignments`, `/students/submissions` |
| Announcements | `GET /api/v1/announcements` |
| Files (syllabus/schedule documents) | `GET /api/v1/courses/:id/files`, file download |
| Modules & pages | `GET /api/v1/courses/:id/modules`, `/pages` |
| Syllabus body | `GET /api/v1/courses/:id` (syllabus_body) |

No write scopes are requested. If GT prefers a narrower enforced scope set on the
Developer Key, the app functions with any subset and degrades gracefully.

OAuth `scope` parameter sent at authorize time (configurable via
`CANVAS_OAUTH_SCOPES`):

```
url:GET|/api/v1/users/self
url:GET|/api/v1/courses
url:GET|/api/v1/courses/:course_id/assignments
url:GET|/api/v1/courses/:course_id/files
url:GET|/api/v1/courses/:course_id/modules
url:GET|/api/v1/courses/:course_id/pages
url:GET|/api/v1/announcements
```

Request `require_scopes=true` and `allow_includes=false` on the developer key.

## 5. Data handling

### 5.1 What we store (per user, in Supabase)
- Profile: Canvas user id, email, name, instance URL, consent timestamp/version.
- Synced content: courses, assignments (name, dates, status), announcements,
  extracted text from course documents, AI-derived due dates.
- Encrypted Canvas tokens (see §3).

### 5.2 Minimization
- Raw Canvas API payloads are **not persisted in production** by default
  (`STORE_RAW_CANVAS_JSON=false`); only the fields needed for the deadline view
  are stored.
- Data is scoped by a **stable account key** derived from (instance URL + Canvas
  user id), never from the rotating token.

### 5.3 Retention
- Time-based retention purges extracted file text and announcements (default 180
  days) and AI usage logs (default 365 days) via a scheduled job
  (`retention_service.py`). Windows are configurable.

### 5.4 User rights
- **Export:** In-app JSON export of all stored data (excludes secrets).
- **Disconnect:** Revokes Canvas tokens and clears stored credentials.
- **Delete:** Permanent erasure of all stored data + Canvas token revocation.
- Endpoints: `/api/user/export`, `/api/user/disconnect-canvas`,
  `/api/user/delete-data`.

### 5.5 Consent
- Before any Canvas data is ingested, the user must accept a combined ToS /
  Privacy / AI-processing disclosure. Consent is enforced at every ingestion
  endpoint, not merely at the AI step.

## 6. AI processing & subprocessors

- **Purpose:** Extract due dates from course text the Canvas API does not surface.
- **Provider:** OpenRouter gateway routing to **DeepInfra** with per-request ZDR
  required, provider data collection denied, and provider fallback disabled.
  Data routing is bound to a disclosed allowlist (`DISCLOSED_AI_PROVIDERS`);
  the app refuses to send data to an undisclosed provider.
- **PII reduction:** Best-effort redaction (emails, phone numbers, ID/SSN-like
  patterns, tokens) runs before sending; we disclose to users that anonymity is
  not guaranteed for free-text documents.
- **Provider data retention:** OpenRouter input/output logging is disabled on our
  account. Each request requires a DeepInfra ZDR endpoint; if the route cannot
  satisfy the ZDR/data-policy constraints, the AI request should fail rather
  than silently route to another provider.

**Subprocessors:** Supabase (database/storage), Google Cloud (compute), Vercel
(frontend hosting), OpenRouter (API gateway), DeepInfra (ZDR LLM inference).

## 7. Security controls

- Canvas token encryption at rest (Fernet).
- httpOnly/Secure session cookies; CSRF-safe bearer/session handling.
- Strict CORS allowlist; security headers (HSTS, CSP, X-Frame-Options, etc.).
- SSRF protection: Canvas hostnames validated against an allowlist; pagination
  URLs validated; outbound requests time-boxed.
- Distributed rate limiting (per-user sync spacing + hourly caps in a shared
  store) and platform DDoS protection.
- Row-Level Security denies direct anon/authenticated DB access.
- Fail-closed configuration: the backend refuses to boot in production without
  all required secrets (`validate_production_secrets`).
- CI secret scanning (gitleaks) + dependency audits.

## 8. Operations

- Secret rotation, incident response, and retention procedures:
  `docs/OPS_RUNBOOK.md`.
- Post-deploy verification (automated + manual): `docs/PROD_VERIFICATION.md`.
- Data subject requests (export/delete) handled self-service or by operators.

## 9. The decision we need from GT

> "CanvasSync's proposed initial integration model is a GT App feature backed by
> a Canvas OAuth2 REST API client using a Canvas Developer Key. It is not
> initially designed as a Canvas-embedded LTI tool. The OAuth2 model is
> appropriate if CanvasSync operates outside Canvas and each user authorizes
> access to their own Canvas data. LTI 1.3 should only become the primary path if
> GT requires CanvasSync to launch from within Canvas or appear in Canvas
> course/module/assignment placements. Before requesting key provisioning,
> confirm with GT OIT/Digital Learning whether a GT App OAuth2 REST integration is
> permitted, or whether all new Canvas-connected student tools must use the LTI
> 1.3 vetting path."

## 10. Contacts & artifacts

- Source layout and request flow: `README.md`.
- Full readiness audit and remediation log: `docs/OIT_READINESS_AUDIT.md`.
- Re-audit (2026-06-06): `docs/OIT_FULL_AUDIT_2026-06-06.md`.
- GT outreach template and response log: `docs/GT_OIT_OUTREACH.md`.
- Canvas ToS / API policy compliance notes: `docs/CANVAS_TOS_COMPLIANCE.md`.
- Privacy policy / ToS (canonical): `frontend/src/pages/PrivacyPage.js`,
  `frontend/src/pages/TermsPage.js`.

## 11. GT path decision log

See `docs/GT_OIT_OUTREACH.md` for the outreach email, attachments checklist, and
the table where GT's written response will be recorded once received from
`canvas@gatech.edu`.
