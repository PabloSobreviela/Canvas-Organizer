# CanvasSync — Send-Ready GT Digital Learning Request

**Prepared:** July 5, 2026  
**Submit through:** Georgia Tech Digital Learning's Canvas "Request Help" form  
**Fallback route:** Georgia Tech OIT ticket or `support@oit.gatech.edu`, asking routing to Digital Learning / Canvas administration  
**From:** `pablo3@gatech.edu`  
**Request:** Process guidance and, if permitted, a non-production Canvas OAuth Developer Key.

## Ticket text to send

**Subject:** Process guidance for GT student-developed external Canvas OAuth app

Hello Digital Learning Team,

I am a Georgia Tech student developing CanvasSync, an independent student-developed web app for personal academic planning. It consolidates a student’s own authorized Canvas deadlines and course-material dates into a unified calendar view.

CanvasSync is not an official, sponsored, or endorsed Georgia Tech or Instructure service. It is also not an LTI launch or Canvas course placement. The proposed integration is a confidential OAuth2 authorization-code client using a Developer Key issued in Georgia Tech’s local Canvas root account.

I am writing first for process guidance, not production approval. Specifically:

1. Does Georgia Tech permit an independent student-developed external OAuth REST app to receive a local Canvas Developer Key?
2. Is there a streamlined student-development or limited-development path?
3. Does the 2026 LTI vetting process apply to this non-LTI OAuth REST app?
4. Is a faculty/staff sponsor, department, or data owner required?
5. What security, privacy, accessibility, support, brand, and continuity materials should I provide?
6. If the model is permitted, may I request a separate test-only Developer Key after providing the exact staging callback and scope list?
7. May the optional AI date-extraction flow be reviewed separately, with AI disabled for GT Canvas-derived data during initial OAuth testing?

The current implementation uses read-only Canvas OAuth scopes, encrypted server-side Canvas tokens, versioned consent, export/disconnect/deletion controls, CSRF protection, private Supabase storage, Google Cloud Run for the backend, Vercel for the frontend, and direct DeepInfra inference only when AI is enabled. OpenRouter is not part of the current runtime.

Public policy links:

- Terms: https://canvas-organizer.vercel.app/terms
- Privacy: https://canvas-organizer.vercel.app/privacy

I can provide architecture, data inventory, scope matrix, security controls, and test evidence in the format your team prefers.

Thank you,

Pablo Sobreviela  
Georgia Tech student developer  
`pablo3@gatech.edu`

## One-page compliance summary

### App identity

CanvasSync is an independent Georgia Tech student-developed external web app. It is not official, sponsored, or endorsed by Georgia Tech or Instructure.

### Requested decision

Confirm the local review path and whether a non-production/test Canvas Developer Key may be requested.

### Not requested

- Production key.
- Real-user pilot approval.
- Global Instructure approval.
- Marketplace listing.
- LTI/1EdTech certification.
- GT endorsement.

### Current URLs

| Item | Value |
| --- | --- |
| Frontend | `https://canvas-organizer.vercel.app` |
| Backend | `https://canvas-organizer-backend-93870731079.us-central1.run.app` |
| Canvas instance | `https://gatech.instructure.com` |
| Contact | `pablo3@gatech.edu` |
| Future domain | `canvassync.app` is inactive and not used |

### Current verification

- Vercel production deployment `dpl_39Tr1EEwzoCkKsCTB59SkSd8o5An`, aliased to `https://canvas-organizer.vercel.app`.
- Public bundle contains the student-preview/non-endorsed wording, `pablo3@gatech.edu`, direct DeepInfra disclosure, legal version `2026-06-20`, and no OpenRouter or inactive-domain reference.
- Backend deployment verifier passed 19/19 read-only checks, including auth-required endpoints, CORS, CSRF, and absence of retired diagnostic endpoints.
- `/api/auth/canvas/login` intentionally fails closed until GT issues a Developer Key.

### Data requested from Canvas

Read-only access for the authorizing student’s own:

- Canvas profile identifier/email/login/display name;
- courses and course metadata;
- assignment titles, descriptions, due dates, and completion/submission state;
- syllabus, page, module, file text, and announcement content needed to find dates.

CanvasSync does not request grades, submitted work, quiz answers, submission comments, or write access.

### Proposed scopes

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

`allow_includes=true` is requested for current-user submission state, syllabus body, module items, and course/date metadata.

### Security and privacy controls

- OAuth authorization code flow with signed state and implemented PKCE parameters pending GT Canvas test.
- Canvas tokens encrypted server-side; no Canvas OAuth tokens in browser storage.
- Secure HttpOnly app session cookie.
- CSRF protection for state-changing cookie requests.
- Strict CORS allowlist.
- Supabase tables protected by RLS and revoked browser-role table grants.
- Private Supabase Storage bucket.
- Raw Canvas JSON disabled in production.
- Versioned Terms/Privacy consent before sync.
- User export, disconnect, deletion, session invalidation, and Canvas revocation attempt.
- 180-day active content retention job.
- Retired diagnostic/log endpoints removed from production.

### AI processing

AI is optional and can remain disabled for GT Canvas data during initial OAuth testing.

When enabled, CanvasSync sends minimized course text directly to:

```text
https://api.deepinfra.com/v1/openai
Qwen/Qwen3-235B-A22B-Instruct-2507
```

No OpenRouter, gateway, provider fallback, or model fallback is used. The public Privacy Policy discloses DeepInfra’s no-store/no-training statement and its debugging/security logging exception. Course text is not represented as anonymous.

### Current limitations

- No GT Developer Key has been issued.
- No real GT OAuth, refresh, revoke, scope, or PKCE test has occurred.
- GT has not approved or rejected DeepInfra processing.
- A separate staging callback/environment should be confirmed before key issuance.
- Shared Redis rate limiting and CRA dependency modernization remain before broad launch.

### Proposed next step

If GT permits this app model, I will provide the exact staging callback, scope matrix, and test plan and request a test-only Developer Key. AI will remain disabled for GT Canvas-derived content unless GT permits it.

## Source basis

- GT Digital Learning contact page, which lists both `canvas@gatech.edu` and the Canvas "Request Help" ServiceNow route: https://canvas.gatech.edu/contact-us/
- GT OIT contact page, which lists ticket submission and `support@oit.gatech.edu`: https://oit.gatech.edu/contact-us
- GT Digital Learning role: https://canvas.gatech.edu/about-us/
- GT LTI process: https://sites.gatech.edu/dlt-blog/2026/03/26/updated-lti-vetting-process/
- GT AI guidance: https://oit.gatech.edu/ai/guidance
- GT third-party/security checklist: https://security.gatech.edu/services-security-checklist/
- Instructure Developer Keys: https://developerdocs.instructure.com/services/canvas/oauth2/file.developer_keys
- Instructure OAuth2: https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth
- Instructure API Policy: https://www.instructure.com/policies/canvas-api-policy
- DeepInfra model/API: https://deepinfra.com/Qwen/Qwen3-235B-A22B-Instruct-2507/api
- DeepInfra Privacy Policy: https://deepinfra.com/privacy
