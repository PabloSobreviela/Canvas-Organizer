# CanvasSync — Georgia Tech Canvas OAuth Development Review Draft

**Prepared:** June 20, 2026
**Contact:** `pablo3@gatech.edu`
**Request type:** Process confirmation and non-production Canvas API Developer Key

## 1. Request

CanvasSync is an independent **Georgia Tech student-developed** web application
for individual academic planning. It is not an official, sponsored, or endorsed
Georgia Tech or Instructure service.

The immediate request is:

1. confirm which Georgia Tech review path applies to an external, non-LTI,
   student-developed Canvas OAuth REST application;
2. identify any sponsor, data-owner, security, privacy, accessibility, or support
   requirements;
3. if this model is permitted, issue a separate non-production Developer Key
   restricted to Georgia Tech's test/beta Canvas environment.

This draft does **not** request a production key and does not represent the app
as production-approved.

This is a request to Georgia Tech as the **local Canvas customer/root-account
administrator**. Instructure's administrator documentation places creation,
scoping, enablement, and revocation of Developer API Keys in the local Canvas
root account. CanvasSync is not seeking global Instructure partner
certification, marketplace listing, or vendor-wide approval.

Georgia Tech's published 2026 LTI vetting process addresses tools integrated
through LTI. CanvasSync is currently an external OAuth REST client, so this
submission asks Digital Learning to confirm whether that process, another
process, or a streamlined student-development review applies.

## 2. Application

CanvasSync reads the signed-in student's authorized Canvas data and presents:

- courses and course metadata;
- assignments and current-user completion/submission state;
- due dates found in structured Canvas fields;
- dates parsed from authorized syllabi, pages, modules, files, and
  announcements;
- a unified weekly/calendar view and private planning preferences.

The app does not write to Canvas and does not request grades, submitted work,
submission comments, or quiz answers.

## 3. Current architecture

```text
Vercel React SPA
    |
    | Secure HttpOnly app session + CSRF-protected mutations
    v
Google Cloud Run Flask API
    |-- Canvas OAuth2 / read-only Canvas REST API
    |-- Supabase Postgres + private Storage
    `-- Direct DeepInfra inference, only when separately enabled
```

- Frontend: `https://canvas-organizer.vercel.app`
- Backend: Google Cloud Run
- Database/storage: Supabase
- Canvas instance: `https://gatech.instructure.com`
- AI provider: direct DeepInfra, model
  `Qwen/Qwen3-235B-A22B-Instruct-2507`
- Contact/operator mailbox: `pablo3@gatech.edu`

OpenRouter is not part of the current runtime.

## 4. OAuth design

- Confidential OAuth authorization-code client.
- Signed, expiring state cookie.
- PKCE parameters are implemented as defense in depth but have not yet been
  verified against Georgia Tech Canvas; current public Canvas endpoint
  documentation does not list PKCE parameters.
- Access and refresh tokens remain server-side and are encrypted with Fernet.
- Tokens are never returned in the frontend redirect URL or browser storage.
- Expiring access tokens are refreshed before Canvas API calls.
- Logout, disconnect, and deletion remove locally stored credentials and attempt
  Canvas revocation. Remote revocation success is checked and reported.
- Production cookie-authenticated mutations require an allowlisted Origin and
  `X-CanvasSync-CSRF: 1`.
- No production personal-access-token UI or body-token override exists.

## 5. Development-key configuration requested

Please confirm and, if approved, configure:

- separate Developer Key for development;
- `test_cluster_only=true`;
- `require_scopes=true`;
- `allow_includes=true`;
- `auto_expire_tokens=true`;
- exact staging HTTPS redirect URI;
- monitored owner email `pablo3@gatech.edu`;
- only the read-only scopes below.

Proposed scopes:

```text
url:GET|/api/v1/users/self
url:GET|/api/v1/courses
url:GET|/api/v1/courses/:id
url:GET|/api/v1/courses/:course_id/assignments
url:GET|/api/v1/courses/:course_id/files
url:GET|/api/v1/files/:id
url:GET|/api/v1/courses/:course_id/modules
url:GET|/api/v1/courses/:course_id/front_page
url:GET|/api/v1/courses/:course_id/pages
url:GET|/api/v1/courses/:course_id/pages/:url_or_id
url:GET|/api/v1/announcements
```

`allow_includes=true` is needed because the implementation uses documented
includes such as current-user submission state, syllabus body, module items, and
course state/date metadata.

Capabilities do not all work with an arbitrary subset of scopes. If Georgia
Tech requires narrower access, CanvasSync will disable the corresponding feature
and document the resulting behavior.

## 6. Stored data

Per user, CanvasSync may store:

- email address or Canvas login identifier, display name, Canvas user ID, and
  Canvas instance;
- encrypted Canvas access and refresh tokens;
- consent timestamp and policy version;
- course names, codes, metadata, and sync timestamps;
- assignment titles, descriptions, due dates, category/status, and current-user
  completion/submission state;
- full announcement messages used for date extraction;
- extracted text from relevant syllabi, pages, modules, and files;
- AI-derived dates and private app preferences.

Raw Canvas JSON is disabled in production. The app does not maintain an AI
prompt, completion, token-usage, or cost telemetry table.

## 7. Data lifecycle and user controls

- Versioned affirmative consent is required before Canvas ingestion.
- Users represent that they are at least 18; the current service does not offer
  an under-18 AI mode.
- Material data-practice changes require a new consent version.
- Active synced course content has a 180-day retention window.
- A private Cloud Run Job runs daily retention cleanup.
- Users can export active app records, excluding secrets and provider logs.
- Disconnect removes stored Canvas credentials while retaining app content.
- Account deletion first verifies private-storage cleanup, then removes the user
  row and cascaded content; an incomplete storage purge causes a retryable
  failure rather than an inaccurate success response.
- Provider operational, security, abuse-prevention, and backup logs may follow
  provider-specific retention and are disclosed separately.

## 8. AI status

AI is a separately controlled feature. The implementation routes directly to:

```text
https://api.deepinfra.com/v1/openai
Qwen/Qwen3-235B-A22B-Instruct-2507
```

No gateway or provider/model fallback exists. Prompt text is minimized, clipped,
and redacted for common email, phone, token, and ID-like patterns. It is not
guaranteed anonymous.

DeepInfra describes ordinary synchronous inference as zero-data-retention by
default: content is processed in memory, not stored to disk after inference, and
not used for training. CanvasSync uses that synchronous OpenAI-compatible
endpoint, not the bulk API. DeepInfra reserves the right to log a small portion
for debugging or security, and the public disclosure preserves that exception.

The backend capability may be enabled for synthetic demo and operator testing.
It cannot receive Georgia Tech Canvas-derived content until Georgia Tech issues
and enables a local Developer Key. Any GT condition that disallows or limits AI
processing will be enforced before a development or pilot user can sync data.

## 9. Security controls

- Fernet encryption for Canvas credentials.
- Secure, HttpOnly, SameSite=None session cookie.
- Strict production CORS allowlist.
- Origin plus custom-header CSRF protection for cookie-authenticated mutations.
- Signed OAuth state and server-side session-version invalidation.
- SSRF and pagination-host validation for Canvas/file requests.
- Raw payload persistence disabled.
- Deny-direct-access RLS policies for browser database roles.
- Per-user database-backed sync spacing/hourly controls.
- Flask endpoint limits are currently process-local; the deployment is not
  represented as having distributed Redis limits until a shared store is
  configured.
- Security headers and private storage bucket.
- Scheduled retention and self-service export/deletion.

## 10. Development verification plan

In a separate staging environment:

1. test authorize, deny, state mismatch, and expired state;
2. verify PKCE behavior rather than assuming Canvas support;
3. verify exact scopes and include parameters;
4. test one-hour token expiry, refresh, and revocation;
5. verify no token appears in URLs, browser storage, logs, or exports;
6. test consent/re-consent;
7. test CSRF rejection from an untrusted origin;
8. test scope-denied and Canvas 401/403/429 behavior;
9. test export, disconnect, deletion, storage cleanup, and session invalidation;
10. verify RLS with anon/authenticated credentials;
11. test retention against staging records;
12. keep AI disabled unless separately approved for that test.

## 11. Questions for Georgia Tech

1. Is an external OAuth REST Developer Key available for this independent
   student-developed app?
2. Is there a streamlined student-development or limited-pilot path?
3. Does the LTI review process or three-month timing apply even though this is
   not an LTI tool?
4. Is a faculty/staff sponsor or institutional data owner required?
5. Can GT issue a `test_cluster_only` key, and what host/accounts may be used?
6. Does GT Canvas accept and enforce PKCE for Developer Key OAuth?
7. Are the proposed scopes and includes acceptable?
8. What security, privacy, accessibility, brand, continuity, and support
   evidence is required before a production-key request?
9. May direct DeepInfra processing be tested, and under what data restrictions?
10. Should production use a separate Developer Key and limited pilot cohort?

## 12. Current limitations

- Georgia Tech's local Canvas administrators have not issued development or
  production OAuth credentials.
- A real GT OAuth round trip has not yet been completed.
- AI-provider use remains subject to Georgia Tech's answer and applicable review.
- A shared Redis-compatible Flask-Limiter backend is not yet configured.
- This package is a development-review draft, not a production approval claim.
