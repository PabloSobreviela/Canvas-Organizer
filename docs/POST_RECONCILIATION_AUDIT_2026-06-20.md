# CanvasSync Post-Reconciliation Compliance Audit

**Audit completed:** June 20, 2026 at 12:29 EDT
**Project contact:** `pablo3@gatech.edu`
**Scope:** Local checkout, GitHub, Vercel, Google Cloud Run, Cloud Scheduler,
Supabase, public legal pages, and direct DeepInfra configuration
**Application:** Independent Georgia Tech student-developed external web app

> This is a technical and policy-alignment assessment, not legal advice or a
> claim of Georgia Tech, Instructure, or DeepInfra approval.

## 1. Decision

CanvasSync is **ready to send the first process inquiry** to Georgia Tech
Digital Learning and is technically credible as a **development-key review
draft**.

It is **not ready for a real-user OAuth pilot or production approval** because:

- Georgia Tech has not identified the local student-app review path;
- no GT development or production Developer Key exists;
- no real GT OAuth, scope, refresh, revoke, or PKCE test has occurred;
- no exact separate staging callback/environment has been approved;
- GT has not decided whether Canvas-derived course text may be sent to
  DeepInfra;
- shared Redis endpoint limits and dependency modernization remain open before
  multi-instance or broad launch.

## 2. Reconciled canonical facts

| Topic | Canonical fact |
| --- | --- |
| Frontend | `https://canvas-organizer.vercel.app` |
| Backend | `https://canvas-organizer-backend-93870731079.us-central1.run.app` |
| Backend revision | `canvas-organizer-backend-00115-lcz`, 100% traffic |
| Database/storage | Supabase project `ixmznhpkelysbplgcrge`, private Storage bucket `course-files` |
| Canvas | `https://gatech.instructure.com`; local GT Developer Key pending |
| OAuth state | Fails closed with `CANVAS_OAUTH_PENDING` |
| AI provider | Direct DeepInfra; no gateway or alternate-provider fallback |
| AI endpoint | `https://api.deepinfra.com/v1/openai` |
| AI model | `Qwen/Qwen3-235B-A22B-Instruct-2507` |
| Legal version | `2026-06-20` |
| Contact | `pablo3@gatech.edu` |
| Custom domain | `canvassync.app` is future/inactive and is not used for runtime, callback, CORS, or public policy links |
| Product status | Independent GT student-developed; not official, sponsored, or endorsed |

## 3. Source and deployment reconciliation

### Local and GitHub

- Reviewed application source was committed and pushed to branch
  `codex/mobile-open-design-feedback`.
- Runtime reconciliation commit: `093e61ef73341ad2610a4eddf3aa05e607c94f73`.
- Draft PR: `https://github.com/PabloSobreviela/Canvas-Organizer/pull/1`.
- Local ignored `backend/.env` is a non-secret development configuration with
  AI disabled and the direct DeepInfra endpoint/model. Its former legacy
  contents are preserved only as an ignored inactive backup.
- Local skill-install and benchmark artifacts were not committed.

### Vercel

- Production deployment: `dpl_Cktx8B6BAfn9vqhAVKYeqMEEae1j`.
- Canonical alias points to the new Ready deployment.
- Public bundle: `/static/js/main.84a81c1b.js`.
- `/terms` and `/privacy` return HTTP 200.
- Bundle checks confirmed:
  - `pablo3@gatech.edu` present;
  - old contact absent;
  - legal version `2026-06-20` present;
  - `X-CanvasSync-CSRF` behavior present;
  - independent/non-endorsed and 18+ wording present;
  - browser-storage disclosure present;
  - DeepInfra present;
  - OpenRouter and `canvassync.app` absent.

### Google Cloud Run

- Revision `canvas-organizer-backend-00115-lcz` serves 100% traffic.
- Maximum instances: 1.
- `FRONTEND_URL=https://canvas-organizer.vercel.app`.
- `LEGAL_CONSENT_VERSION=2026-06-20`.
- `ENABLE_AI_RESOLVE=true`.
- Exact DeepInfra base/model configured.
- Dedicated `deepinfra-api-key` Secret Manager reference attached.
- `STORE_RAW_CANVAS_JSON=false`.
- `RATELIMIT_STORAGE_URI=memory://` is truthfully treated as process-local; the
  one-instance cap prevents scale-out bypass during this pre-launch state.
- Canvas credentials remain placeholders and `/api/auth/canvas/login` returns
  HTTP 503 with `CANVAS_OAUTH_PENDING`.

### Retention

- Private Cloud Run Job `canvassync-retention` uses the exact backend image
  digest deployed to the service.
- Manual post-deploy execution `canvassync-retention-66w7v` succeeded.
- Cloud Scheduler job `canvassync-retention-daily` is enabled for `0 3 * * *`
  in `America/New_York` and authenticates with its scheduler service account.

## 4. Supabase production verification

Migration `010_compliance_state.sql` was applied successfully. Database-owner
verification returned:

| Control | Verified result |
| --- | --- |
| User consent/session columns | 3 |
| Application tables with RLS enabled | 7 |
| Canonical deny-direct policies | 7 |
| `anon`/`authenticated` application-table grants | 0 |
| `service_role` CRUD grants | 28 |
| Retention indexes | 6 |
| `public.ai_usage_logs` | Removed |

Service-role REST/storage checks also confirmed:

- zero rows in `users`, `courses`, `assignments`, `course_file_texts`,
  `announcements`, `syllabus_rules`, and `rate_limits`;
- zero private objects at the root of `course-files`;
- `ai_usage_logs` returns PostgREST `PGRST205`/HTTP 404 because the table no
  longer exists.

## 5. Live security verification

`backend/tools/verify_deploy.py` passed **19 of 19** checks:

- health and security headers;
- anonymous rejection for authenticated and ingestion endpoints;
- configured-origin CORS and unknown-origin rejection;
- cookie CSRF rejection;
- absence of retired AI logs, cost audit, public retention, Canvas credential,
  and Canvas test endpoints.

Additional live CSRF matrix:

| Request | Result |
| --- | --- |
| Untrusted Origin + ambient cookie | HTTP 403 `csrf_failed` |
| Trusted Origin without custom header | HTTP 403 `csrf_failed` |
| Trusted Origin + `X-CanvasSync-CSRF: 1` | HTTP 200 |

The machine-readable result is
`docs/verification/verify_deploy_results.json`.

## 6. Terms, Privacy Policy, and consent alignment

The public Terms, Privacy Policy, and consent modal now consistently disclose:

- independent GT student-developed status and no GT/Instructure endorsement;
- operator/contact email;
- 18+ eligibility;
- exact Canvas data categories, including descriptions, full announcement
  messages, submission/completion state, and extracted course text;
- browser caches and the absence of production OAuth tokens from browser
  storage;
- current-device cache deletion and the limitation for other-device caches;
- 180-day active-content retention;
- provider/security/backup-log deletion limitations;
- Supabase, Google Cloud, Vercel, Canvas, and conditional DeepInfra processing;
- direct DeepInfra synchronous ZDR-by-default wording with the reserved
  debugging/security exception;
- no gateway, provider fallback, model fallback, or application AI telemetry
  table;
- course-text anonymity is not guaranteed;
- material data-practice changes require actual notice and affirmative
  re-consent;
- AI-derived dates may be wrong and must be verified in Canvas;
- Georgia Tech may independently restrict the data flow or revoke the key.

The Terms avoid claiming ownership for Georgia Tech or other rightsholders and
do not imply that GT is the operator.

## 7. DeepInfra verification

- Secret stored in Google Secret Manager and attached only as a secret
  reference.
- A live synthetic synchronous request returned HTTP 200 from the exact model
  `Qwen/Qwen3-235B-A22B-Instruct-2507`.
- Application startup and call-time checks reject any different endpoint or
  model.
- No Georgia Tech Canvas-derived content can currently reach DeepInfra because
  GT OAuth fails closed.

Remaining institutional question: GT must state whether this provider/data flow
is permitted for development or pilot use and whether an agreement, data-owner
approval, or additional security/privacy review is required.

## 8. Instructure and Georgia Tech approval posture

Current architecture is an external OAuth REST client, not an LTI launch or
Canvas placement. The credential is therefore a local Georgia Tech Canvas
root-account decision. No global Instructure marketplace or 1EdTech
certification is identified for this architecture.

Student-developed status supports asking for a narrower development or
limited-pilot path, but no public GT source establishes a blanket exemption.
The first inquiry must ask GT to decide:

- whether this integration model is permitted;
- whether the LTI process applies despite the non-LTI architecture;
- whether a faculty/staff sponsor, department, or data owner is required;
- what staging, accessibility, security, privacy, brand, support, continuity,
  and AI evidence is required;
- whether and when a test-only Developer Key may be issued.

## 9. Remaining technical and policy work

### Before key issuance/testing

- Receive GT's written process answer.
- Provision the exact separate staging callback/environment GT requests.
- Apply migration 010 and the same configuration in staging.
- Keep AI disabled for GT Canvas-derived content unless GT permits it.

### Before a real-user pilot

- Complete OAuth authorize/deny/state/expiry tests.
- Verify exact scopes and Canvas `include` behavior.
- Verify access-token expiry, refresh, revoke, disconnect, and key disable.
- Verify whether GT Canvas accepts/enforces PKCE.
- Test consent/re-consent, user isolation, export, deletion, storage cleanup,
  and retention with approved staging data.
- Complete any GT-required accessibility, security, privacy, sponsor, brand,
  data-owner, or provider review.

### Before multi-instance or broad launch

- Configure shared Redis-compatible endpoint rate limiting.
- Migrate off Create React App and address the current npm dependency audit
  result: 43 advisories, including 11 high and no critical findings.
- Complete broader accessibility/browser testing.
- Add outbound IP pinning or equivalent DNS-rebinding protection.
- Establish the GT incident/escalation and continuity contacts.

## 10. Final readiness conclusion

| Milestone | Readiness |
| --- | --- |
| Send concise GT process inquiry | Ready |
| Share current technical draft and public policies | Ready |
| Request immediate key provisioning without a staging callback | Not ready |
| Test-only key after GT supplies conditions/staging requirements | Conditionally ready |
| Real-user OAuth pilot | Not ready |
| Production key/general launch | Not ready |

The repository, Vercel frontend, Cloud Run service/job, Supabase schema/data,
and active compliance documents now tell the same material story. Remaining
barriers are explicit institutional decisions and tests that cannot be
completed before Georgia Tech issues a development credential.
