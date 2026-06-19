# CanvasSync Post-Deployment Compliance Remainder

**Date:** June 19, 2026
**Production release reviewed:** Git commit `a88dc2be01d243aa968bab09457b8563cf845d6a`
**Overall status:** Critical containment fixes deployed; **not yet compliance-ready for general Georgia Tech student use**.

> This is a technical compliance and deployment reconciliation, not legal advice or a Georgia Tech approval.

## 1. Current source-of-truth reconciliation

### GitHub

- Repository: `PabloSobreviela/Canvas-Organizer`
- Default branch: `main`
- `main` remains at `4d773310035da005650bfbf62d72b8c7d8c4049b`.
- Deployed release branch: `codex/mobile-open-design-feedback`
- Deployed release commit: `a88dc2be01d243aa968bab09457b8563cf845d6a`
- Pull request: [#1 — Harden production auth, privacy, and deployment controls](https://github.com/PabloSobreviela/Canvas-Organizer/pull/1)
- PR status: open draft
- GitHub security workflow: passing

Production therefore matches a pushed GitHub commit, but not the default branch. The PR should receive human review before it is marked ready or merged.

Local-only logs, database journals, editor state, and AI benchmark outputs were deliberately not committed.

### Vercel frontend

- Production deployment: `dpl_CKPcFpoCfiDpwgXxckJG3GSwrASx`
- Production alias: `https://canvas-organizer.vercel.app`
- Deployed bundle: `static/js/main.3f371119.js`
- Deployment status: Ready
- Source used: clean detached worktree at Git commit `a88dc2b`

### Cloud Run backend

- Service: `canvas-organizer-backend`
- Active revision: `canvas-organizer-backend-00113-pwx`
- Traffic: 100%
- Service URL: `https://canvas-organizer-backend-93870731079.us-central1.run.app`
- Container digest begins `sha256:2993348...`
- Source used: clean detached worktree at Git commit `a88dc2b`

### Custom domain

`canvassync.app` still resolves to Firebase Hosting (`199.36.158.100`) and redirects to:

`https://canvas-organizer-4437b.web.app/`

It does not serve the Vercel production deployment.

## 2. What was deployed and verified

### Public AI-log exposure

**Fixed in production.**

- `/api/ai/usage-logs/dashboard` now requires authentication.
- The feature is disabled by default in production.
- If later enabled, production requires an explicit email allowlist.
- New AI telemetry no longer includes full prompt or response text.
- The live unauthenticated request now returns `401`, rather than exposing records.

Historical records that already contain prompt/response text remain a separate incident and deletion decision.

### OAuth/session implementation

**Code deployed; institutional credentials still block real use.**

The deployed backend now includes:

- signed OAuth state stored in an HttpOnly cookie;
- PKCE;
- explicit Canvas scope requests;
- encrypted persistence of Canvas access and refresh tokens;
- token refresh;
- Canvas token revocation;
- HttpOnly, Secure, SameSite=None session cookies;
- no session JWT in the callback URL;
- no production session token in browser `localStorage`; and
- server-side session-version support once its database migration is applied.

The live Developer Key values are still placeholders, so end-to-end Georgia Tech OAuth cannot succeed.

### Consent and user controls

**Routes deployed and protected; database migrations are incomplete.**

The following live routes now exist and reject anonymous requests with `401`:

- `POST /api/user/legal-consent`
- `GET /api/user/export`
- `POST /api/user/delete-data`
- `POST /api/user/disconnect-canvas`

Canvas ingestion and AI routes now contain server-side consent gates. Manual Canvas personal-access-token storage is disabled in cloud mode.

The production `users` table is missing the legal-consent and session-version columns, so authenticated consent and session invalidation cannot yet work end to end.

### Data minimization and retention code

**Code deployed; operations not complete.**

- Production defaults disable storage of raw Canvas API JSON.
- New AI telemetry excludes prompt/response text.
- User deletion includes token revocation, storage deletion, child-row deletion, and user deletion.
- Export sanitizes credential and raw/debug fields.
- Retention functions and a protected retention endpoint exist.
- Default retention windows exist in code.

No production retention schedule or Cloud Run Job was verified.

### Secrets

**Improved in production.**

The following are now injected from Google Secret Manager:

- session signing secret;
- Canvas token encryption key;
- Supabase URL;
- Supabase service key;
- Canvas OAuth client ID;
- Canvas OAuth client secret; and
- AI API key.

The existing Canvas encryption key value was preserved to avoid making previously encrypted tokens unreadable.

### AI routing restrictions

**Improved, but still not the intended direct-DeepInfra architecture.**

The deployed OpenRouter request now:

- pins the upstream provider to DeepInfra;
- requests Zero Data Retention;
- denies provider data collection;
- disables provider fallback; and
- fails rather than silently switching provider/model.

OpenRouter remains the API gateway. There is no direct DeepInfra API key or direct DeepInfra endpoint configured.

### Frontend and deployment security

**Fixed in the Vercel deployment.**

The Vercel response now includes:

- Content-Security-Policy;
- `X-Frame-Options: DENY`;
- `X-Content-Type-Options: nosniff`;
- Referrer-Policy; and
- HSTS.

The legal pages and demo route load without browser console errors. The demo uses a temporary synthetic session and clearly identifies itself as a demo.

### Production verification

The backend verification suite passed all 13 checks:

- health;
- security headers;
- protected user endpoints;
- protected Canvas/sync endpoints;
- configured-origin CORS; and
- rejection of an unknown origin.

GitHub's security workflow also passes after correcting its shallow checkout, which had prevented gitleaks from resolving the requested commit range.

## 3. Remaining launch blockers

### R1 — Georgia Tech Canvas OAuth approval and credentials

**Severity:** P0 launch blocker

The live authorization redirect still contains a placeholder Canvas client ID. No Georgia Tech-issued Developer Key or written approval was found.

Required:

1. Obtain the Georgia Tech Canvas Developer Key.
2. Confirm the app owner, approved users, scopes, redirect URI, data categories, rate limits, and expiration/review date.
3. Store the issued client ID and secret as new Secret Manager versions.
4. Perform a real OAuth login, refresh, logout/revocation, disconnect, and re-login test.
5. Retain written OIT/Digital Learning approval.

### R2 — Direct DeepInfra is not implemented

**Severity:** P0 architecture/disclosure blocker

Production and the repository still use:

`CanvasSync -> OpenRouter -> DeepInfra`

They do not use:

`CanvasSync -> DeepInfra`

No DeepInfra API secret is available in the current environment.

Required decision:

- If direct DeepInfra is required, provide/configure a DeepInfra key, change the base URL and model identifier, remove OpenRouter-specific request fields and documentation, update the subprocessor list, deploy, and verify provider telemetry.
- If OpenRouter remains approved, correct the statement that OpenRouter is no longer used and retain evidence of account-level logging/ZDR settings.

### R3 — Production database migrations are incomplete

**Severity:** P0 functional compliance blocker

Read-only schema verification found:

- `users.legal_consent_at`: missing;
- `users.legal_consent_version`: missing; and
- `users.session_version`: missing.

The rate-limit table's current application columns are readable, but the deletion trigger and retention indexes were not verified.

Required:

1. Apply `backend/migrations/004_user_legal_consent.sql`.
2. Apply `backend/migrations/006_retention_indexes.sql`.
3. Apply `backend/migrations/007_rate_limits_cascade.sql`.
4. Apply `backend/migrations/008_session_version.sql`.
5. Review and run the account-key repair migration with a dry run first.
6. Verify RLS policies directly in Supabase.
7. Test consent, export, deletion, disconnect, logout invalidation, and cascade behavior with an approved test account.

The current session did not have Supabase management access or a database password, so DDL could not be applied safely.

### R4 — Custom domain still serves the legacy Firebase application

**Severity:** P0 user-transparency blocker

`canvassync.app` still redirects to the older Firebase application. Its authentication and legal-page behavior differ from the Vercel release.

Required:

1. Decide whether Vercel is the canonical production host.
2. Move `canvassync.app` and optionally `www.canvassync.app` to Vercel.
3. Retire or access-restrict the Firebase frontend.
4. Update OAuth redirect registrations, CORS, support links, cookies, and documentation.
5. Verify `/`, `/privacy`, `/terms`, and `/demo` on the custom domain.

### R5 — Historical AI-log exposure requires incident disposition

**Severity:** P1

The endpoint is contained, but historical database rows may still contain:

- full prompts;
- full AI responses;
- user IDs; and
- Canvas course IDs.

Required:

1. Review Cloud Run/request logs for access to the old public endpoint.
2. Determine whether Georgia Tech privacy/security reporting is required.
3. Decide what evidence must be preserved.
4. Remove prompt/response content and unnecessary identifiers from historical records.
5. Record the incident owner, timeline, scope, and closure decision.

### R6 — Consent and data-rights behavior is not end-to-end verified

**Severity:** P1

The code and routes now exist, but R3 and the placeholder Developer Key prevent a complete production test.

Required tests after R1/R3:

- no ingestion or AI before current-version consent;
- consent survives a new session;
- export contains all expected user data and no secrets;
- disconnect revokes Canvas tokens and clears stored credentials;
- deletion removes database rows and storage objects;
- logout invalidates the old session; and
- re-consent is required after a legal-version change.

### R7 — No scheduled retention enforcement

**Severity:** P1

Retention code alone does not delete data. No scheduler, Cloud Run Job, or monitored cron invocation was found.

Required:

- approve exact retention periods;
- configure a scheduled job;
- test storage and database deletion;
- document backup/vendor residual retention;
- decide whether inactivity triggers deletion; and
- align the Privacy Policy with actual periods.

### R8 — Distributed rate limiting is not provisioned

**Severity:** P1 operational blocker

The containment release uses the existing in-memory limiter under the explicit:

`ALLOW_IN_MEMORY_RATE_LIMITS=true`

This is per-instance and not sufficient for general autoscaled production use.

Required:

- provision a Redis-compatible shared limiter;
- store its URI securely;
- remove the temporary override; and
- verify limits across multiple Cloud Run instances.

### R9 — Instructure generative-AI labeling remains incomplete

**Severity:** P1 policy blocker

The UI labels inferred dates as “From materials,” “Review date,” or “Date updated.” It does not consistently say that the result is AI-generated or AI-assisted.

Required:

- display an explicit AI-assisted/generated label;
- explain uncertainty and user review;
- distinguish Canvas dates from inferred dates; and
- disclose output ownership/treatment as approved.

### R10 — Provider, FERPA, and institutional approvals remain unverified

**Severity:** P1 institutional blocker

No final approval evidence was found for:

- Georgia Tech OIT/Digital Learning;
- FERPA/privacy classification;
- DeepInfra;
- OpenRouter, if retained;
- Supabase;
- Vercel;
- Google Cloud;
- data regions;
- DPAs/contracts;
- subprocessors;
- breach terms;
- accessibility; or
- records retention.

Planning and outreach documents are not approval evidence.

### R11 — OAuth scope inventory requires reconciliation

**Severity:** P1

The code uses Canvas endpoints for files, file download, front pages, syllabus body, modules/items, pages, announcements, assignments, courses, and submission status.

The requested scopes must be mapped endpoint by endpoint and matched to the issued Georgia Tech Developer Key. Submission status should be removed if it is not necessary, or disclosed precisely if it is.

### R12 — Cross-site cookie behavior needs real-OAuth validation

**Severity:** P1

The Vercel frontend and `run.app` backend are on different sites. The session cookie uses `SameSite=None; Secure`, but browser third-party-cookie restrictions may still affect the login/session flow.

Preferred long-term configuration:

- `canvassync.app` for the frontend; and
- an API subdomain such as `api.canvassync.app`.

This must be tested after a real Developer Key exists.

### R13 — Policy version and factual alignment

**Severity:** P1

The live Privacy Policy is still version `2026-05-20`. It describes OpenRouter-to-DeepInfra, not direct DeepInfra, and promises behaviors that cannot yet be fully exercised because migrations/OAuth are incomplete.

Required:

- finalize the provider architecture;
- approve retention periods;
- name the actual operator;
- correct submission-status language;
- remove unsupported pilot/OIT statements;
- update vendor and incident disclosures;
- increment the legal version; and
- force re-consent.

### R14 — Production dependency vulnerabilities

**Severity:** P2

The Vercel build still reports:

- one critical;
- 20 high;
- 35 moderate; and
- five low npm vulnerabilities.

The direct and transitive dependency tree needs triage, upgrade testing, and a documented risk decision.

### R15 — RLS state is not independently verified

**Severity:** P1

The repository now contains restrictive schema definitions, but the actual production Supabase policies were not available through the current credentials.

Required:

- inspect every table policy in the Supabase dashboard or via database admin access;
- confirm browser roles cannot read/write application tables;
- confirm only the backend service role can access them; and
- save the resulting policy export as evidence.

### R16 — Local retained Canvas data

**Severity:** P2

The local ignored storage directory still contains approximately 806 MB of Canvas-derived files. It was not pushed or deployed.

Required:

- determine ownership and purpose;
- confirm whether any content is real student/instructor data;
- delete it if no longer required;
- verify backups/copies; and
- document the retention decision.

### R17 — Operator/contact and pilot assertions

**Severity:** P1 documentation blocker

The policies do not establish a complete operator identity/address. The validity, monitoring, and authorization of `canvassync@gatech.edu` remain unverified. Terms referring to an OIT pilot cannot be supported without written evidence.

### R18 — Production is ahead of `main`

**Severity:** P2 governance issue

Production runs commit `a88dc2b`, while `main` remains at `4d77331`.

Required:

- review PR #1;
- decide whether to merge it;
- establish whether production deployments must come only from the default branch or a protected release branch; and
- add commit/revision metadata to future deployments.

## 4. Required user/institutional answers

The following decisions cannot be made from code:

1. Is direct DeepInfra mandatory, or is OpenRouter pinned to DeepInfra acceptable?
2. Who can provide the DeepInfra credential if direct access is mandatory?
3. Who can apply the Supabase DDL migrations and verify RLS?
4. Has Georgia Tech issued or approved the Canvas Developer Key? If not, who owns the OIT request?
5. Should `canvassync.app` be moved from Firebase to Vercel now?
6. Is there an actual approved OIT pilot?
7. Who is the legal operator and monitored privacy/security contact?
8. What retention periods are approved?
9. Which vendors are approved for Georgia Tech Protected/FERPA-related data?
10. Should the historical AI-log exposure be reported to a Georgia Tech security/privacy contact?
11. Is user-specific submission status required?
12. Should the draft PR be merged to `main` after review?

## 5. Readiness determination

The release materially improves the live security and privacy posture and contains the active public AI-log exposure. It should be treated as a **containment and remediation deployment**, not as evidence of full compliance.

General student launch remains blocked until at least R1 through R5, R7 through R10, R13, and R15 are resolved with verifiable evidence.
