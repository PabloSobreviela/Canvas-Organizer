# CanvasSync Follow-Up OAuth and Terms Audit

> **Historical pre-remediation snapshot.** The findings below explain the work
> requested after this audit. They are not the post-remediation readiness
> conclusion. See `docs/README.md` and the latest dated audit.

**Audit date:** June 20, 2026
**Scope:** Pushed GitHub branch, live Vercel frontend, live Cloud Run backend,
Supabase schema, public Terms and Privacy Policy, Georgia Tech requirements,
Instructure API/OAuth policy, and DeepInfra terms.
**Nature of review:** Technical and policy-alignment review, not legal advice.

## Executive conclusion

CanvasSync is **not ready to be submitted as a production OAuth approval
package** and the current `docs/OIT_SUBMISSION.md` is **not ready to send
unchanged**, even as a draft. It contains several statements that are
demonstrably false in the current deployment, including that CSRF-safe handling,
distributed rate limiting, consent persistence, and verified Row-Level Security
are operational.

CanvasSync **is close to being suitable for a narrowly framed process-discovery
and development-key request**, provided the outreach is corrected to say:

- this is an independent student-built external web application, not an approved
  "GT App feature";
- the immediate request is for Georgia Tech to identify the applicable review
  path and, if allowed, issue a non-production Canvas API Developer Key;
- production OAuth is not yet being requested;
- AI is disabled and will remain disabled until Georgia Tech completes its AI,
  privacy, security, data-stewardship, and vendor review;
- the remaining code and database blockers in this report are disclosed rather
  than described as complete.

The public Georgia Tech material reviewed does not publish a standalone Canvas
OAuth Developer Key approval workflow. It publishes an LTI review process, but
that process expressly concerns tools integrated through LTI. Therefore the
correct first action is a written path decision from the Digital Learning Team
at `canvas@gatech.edu`; the LTI process and its three-month lead time must not be
presented as definitely applicable or definitely inapplicable to CanvasSync.

## Readiness decision

| Requested outcome | Decision | Reason |
| --- | --- | --- |
| Send the current full OIT packet unchanged | **No** | It overstates live controls and institutional status. |
| Send a short, candid process inquiry | **Yes, after editing** | The architecture, read-only scope request, live URLs, and known blockers can be presented honestly. |
| Request a development/test Canvas key | **Conditionally yes** | Ask for a separate `test_cluster_only` key and a separate staging environment; GT must first confirm this path exists for the app. |
| Request a production Canvas key | **No** | CSRF, missing DB migrations, inaccurate policies, vendor review, and operational controls remain unresolved. |
| Enable DeepInfra in production | **No** | Georgia Tech prohibits use of unreviewed AI tools with Institute data; course text may contain PII, protected data, organizational data, and third-party IP. |
| Invite real users into the current deployment | **No** | OAuth is intentionally unavailable, consent cannot persist, and production data controls have not been proven end to end. |

## What is actually pushed and deployed

### GitHub

- Repository: `PabloSobreviela/Canvas-Organizer`
- Branch: `codex/mobile-open-design-feedback`
- Branch and remote head: `c4014a34d580c8223c29e451bc15d0840d05ded3`
- Draft pull request: PR #1, `[codex] Harden production auth, privacy, and deployment controls`
- Untracked local benchmark files remain outside the pushed branch:
  `backend/tools/benchmark_results/` and `backend/tools/prompt_benchmark.py`.

### Vercel

- Canonical live URL: `https://canvas-organizer.vercel.app`
- Deployment: `dpl_7k9HfntSZnAGJFuHdix9heBV6tX9`
- Status: `READY`, production target
- Live bundle: `/static/js/main.1c266645.js`
- The live bundle points to:
  `https://canvas-organizer-backend-93870731079.us-central1.run.app`
- The live bundle contains the current direct-DeepInfra disclosures and exact
  Qwen model identifier.
- The live bundle does not contain `OpenRouter`.
- The live bundle still contains the policy and UI wording problems documented
  below, proving they are production-facing and not merely stale local source.

### Cloud Run and scheduled retention

- Service: `canvas-organizer-backend`
- Active revision: `canvas-organizer-backend-00114-jxx`
- Traffic: 100%
- Production callback currently configured as:
  `https://canvas-organizer-backend-93870731079.us-central1.run.app/api/auth/canvas/callback`
- Canvas instance: `https://gatech.instructure.com`
- AI endpoint in configuration: `https://api.deepinfra.com/v1/openai`
- Model: `Qwen/Qwen3-235B-A22B-Instruct-2507`
- AI is disabled: `ENABLE_AI_RESOLVE=false`
- OAuth uses placeholder credentials and fails closed with HTTP 503.
- Rate limiting is temporarily process-local:
  `RATELIMIT_STORAGE_URI=memory://` and
  `ALLOW_IN_MEMORY_RATE_LIMITS=true`.
- The public demo is enabled in production.
- Retention is configured for 180 days.
- Cloud Run Job `canvassync-retention` is ready and its latest recorded execution
  succeeded.
- Cloud Scheduler job `canvassync-retention-daily` is enabled for 3:00 AM
  America/New_York.

### Removed dangerous endpoints

The following live routes return HTTP 404:

- `/api/ai/usage-logs`
- `/api/cloud/cost-audit`
- `/api/admin/retention/run`
- `/api/user/canvas-credentials`
- `/api/canvas/test`

This is a meaningful improvement. The old `ai_usage_logs` database table still
exists but was empty when checked; migration
`009_remove_ai_usage_logs.sql` has not been applied.

### Supabase

The production `users` table still lacks:

- `legal_consent_at`;
- `legal_consent_version`; and
- `session_version`.

Each column produced PostgreSQL error `42703` when queried on June 20, 2026.
Consequences:

- legal consent cannot be recorded in production;
- every ingestion endpoint correctly fails closed for a normal user, but the
  advertised consent flow is not operational;
- server-side JWT invalidation cannot be performed;
- logout catches the failed session-version update and still tells the browser
  that logout succeeded;
- the public Privacy Policy and OIT packet overstate the current behavior.

The repository contains RLS migration files, but applied production RLS policy
state was not independently verified. The submission must not state RLS as a
verified production fact until the actual policies are inspected using database
owner access.

## Georgia Tech OAuth approval process

### What is confirmed by public sources

1. A student cannot self-issue the multi-user OAuth credential. Instructure's
   administrator guide says a Canvas root-account administrator creates
   Developer API Keys.
2. Multi-user applications must use OAuth rather than asking users to paste
   personal access tokens.
3. Canvas supports scoped API Developer Keys, exact OAuth redirect URI
   validation, required scopes, include parameters, one-hour token expiration,
   refresh tokens, and revocation.
4. Canvas supports `test_cluster_only=true`, which restricts a key to test/beta
   environments.
5. Georgia Tech's published 2026 process applies to new third-party **LTI**
   integrations. It requires LTI 1.3/1EdTech certification and submission at
   least three months before a course starts. The page does not say that the
   same process governs a standalone OAuth REST client.
6. Georgia Tech directs Canvas integration questions to
   `canvas@gatech.edu`.
7. Before third-party providers receive Institute data, Georgia Tech requires a
   HECVAT-based security review and a decision by the data/system owner.
8. Georgia Tech's service checklist calls for vendor terms that preserve
   Georgia Tech data ownership, breach notice, data-reclamation rights, audit
   rights, and appropriate security controls.
9. Georgia Tech says unapproved AI tools must not be used with sensitive,
   protected, regulated, confidential, PII, or Georgia Tech Organizational Data,
   and requires a Third-Party Security Assessment.

### What is not publicly answered

No public source found in this audit answers:

- the intake form or approval owner for a standalone Canvas OAuth REST app;
- whether a faculty/staff sponsor or institutional data owner is required;
- whether Georgia Tech will issue a `test_cluster_only` key to a student-built
  app;
- the approved Georgia Tech test/beta hostnames and how their data is populated;
- whether the LTI three-month timeline is reused for OAuth reviews;
- whether one key is promoted or separate development and production keys are
  issued;
- whether a limited-user pilot can be enforced at the Canvas key level;
- the exact accessibility, support, continuity, and student-application
  requirements for this OAuth path.

These are institutional decisions. The submission should ask them explicitly
instead of presenting an assumed workflow.

## Recommended development OAuth request

The first message to Digital Learning should be a process inquiry and request
for a non-production key, not a production approval claim.

Request:

- confirmation that a standalone external OAuth REST application is an allowed
  integration type;
- the required sponsor, data owner, security review, privacy review,
  accessibility review, support plan, and application form;
- a separate API Developer Key restricted with `test_cluster_only=true`;
- `require_scopes=true`;
- `allow_includes=true`, because the app uses `include[]=submission`,
  `include[]=syllabus_body`, `include[]=items`, and course include parameters;
- `auto_expire_tokens=true`;
- only the exact read-only scopes listed below;
- a staging-only HTTPS redirect URI;
- the approved test/beta Canvas hostname and test-account process;
- written confirmation whether Canvas in Georgia Tech's deployed version accepts
  PKCE parameters for this flow.

The development environment should be separate from production:

- separate Cloud Run service;
- separate Supabase project;
- separate session and token-encryption secrets;
- separate Vercel staging/preview URL;
- AI disabled;
- no real student pilot until the data owner approves the data classification
  and third parties.

The app should not ask any other user to create or paste a personal Canvas
token. A personal token may be used only by the developer for their own local
testing under Instructure's documented limitation.

### Requested read-only scopes

The source and current Instructure endpoint documentation align on:

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

The list is read-only and maps to observed runtime calls. The packet should not
say that the app works correctly with "any subset" of these scopes. Removing
some scopes disables advertised capabilities and can cause partial sync
failures. Instead, identify each optional feature and the behavior when its
scope is denied.

### PKCE qualification

The code sends `code_challenge`, `code_challenge_method`, and `code_verifier`,
but the current official Canvas authorization and token endpoint documentation
does not list those parameters. Canvas does require the confidential client's
`client_secret`.

The package may say that the app implements PKCE as defense in depth, but it
must not say PKCE has been verified against Georgia Tech Canvas until a real
development-key round trip proves that the parameters are accepted and checked.
Signed, expiring state validation remains required regardless.

## Recommended production OAuth process

Production OAuth should use a separate production key rather than reusing a
test-only credential.

Before requesting it:

1. Obtain the written Georgia Tech path decision and identify the accountable
   data/system owner.
2. Complete security and privacy review for Supabase, Google Cloud, Vercel, and
   DeepInfra, including HECVATs and contractual review where required.
3. Complete Georgia Tech AI review and keep DeepInfra disabled until approval
   is written.
4. Resolve every P0 finding in this report.
5. Verify RLS policies, database migrations, retention, deletion, export, token
   refresh/revocation, and incident procedures in staging.
6. Complete an accessibility review.
7. Obtain brand/use-of-name review before claiming GT App status or using
   Georgia Tech's name for more than factual identification.
8. Define operator identity, support ownership, incident ownership, funding,
   and continuity if the student maintainer graduates or leaves.

Request a production API Developer Key with:

- `test_cluster_only=false`;
- `require_scopes=true`;
- `allow_includes=true`;
- `auto_expire_tokens=true`;
- only the approved read-only scopes;
- the exact production callback URI;
- a monitored owner/contact email;
- an accurate display name, icon, vendor code, and notes;
- an initially disabled state until cutover;
- a documented rollback procedure in which GT can disable the key.

Production acceptance evidence should include:

- authorize, deny, invalid-state, and expired-state tests;
- token exchange, one-hour expiry, refresh, and revocation tests;
- proof that tokens never appear in URLs or browser storage;
- consent and re-consent tests;
- scope-denied and partial-feature behavior;
- Canvas 401, 403, 429, and network-failure behavior;
- export and deletion tests;
- CSRF tests for every state-changing route;
- multi-instance rate-limit tests;
- deletion verification for database rows and storage objects;
- log review showing no secrets or course-content payloads;
- AI-disabled and AI-approved modes tested separately.

## P0 findings: must be resolved before production OAuth

### P0-1 â€” CSRF protection is absent

The production session cookie is `SameSite=None; Secure; HttpOnly` because the
Vercel frontend and Cloud Run API are on different sites. State-changing routes
accept the cookie but do not require a CSRF token and do not validate the
`Origin` or `Referer` header.

A live cross-site POST to `/api/auth/logout` returned HTTP 200 and cleared the
session cookie. CORS did not return an allow-origin header, but that does not
prevent a cross-site HTML form from causing the request. The same authentication
pattern protects:

- `/api/user/delete-data`;
- `/api/user/disconnect-canvas`;
- `/api/user/legal-consent`;
- sync, preferences, and other POST/PUT routes.

The statement "CSRF-safe bearer/session handling" in `docs/OIT_SUBMISSION.md` is
false. Add a robust CSRF mechanism or strict trusted-origin enforcement for all
cookie-authenticated unsafe methods, then test it against the deployed
cross-site architecture.

### P0-2 â€” Consent and session revocation schemas are missing

The required production columns are absent. Until migrations are applied and
verified, do not claim:

- persistent clickwrap consent;
- versioned re-consent;
- server-side invalidation of all active sessions;
- a fully functioning logout or account-deletion flow.

The current behavior is safer than silently ingesting data because consent fails
closed, but it is not functional.

### P0-3 â€” Public Privacy Policy understates data collection

The policy says the app stores announcement "message excerpts." The code stores
the full Canvas announcement `message`.

The app also stores assignment descriptions, which the policy does not clearly
list, and sends assignment descriptions and full extracted course text into the
date-resolution context.

The data inventory and AI payload description must be updated to the actual
maximum content processed, not the smaller amount the UI may display.

### P0-4 â€” Public deletion and logout promises are too absolute

The Privacy Policy says deletion erases all stored account and course rows and
that logout revokes Canvas access and invalidates sessions.

Current gaps:

- session invalidation cannot succeed without `session_version`;
- Canvas token revocation does not check the HTTP response status;
- a failed storage purge is logged but account deletion continues and reports
  success;
- the policy does not distinguish active application data from cloud logs,
  provider debugging copies, backups, security records, or legally required
  retention;
- export excludes encrypted credentials and operational logs, so it is not
  literally an export of every stored record.

The code needs verifiable deletion/retry behavior, and the policy needs accurate
scope and retention exceptions.

### P0-5 â€” DeepInfra is not institutionally approved

Georgia Tech's public guidance says not to submit PII, protected data, regulated
data, confidential data, or Georgia Tech Organizational Data into AI tools and
not to use an AI tool before a Third-Party Security Assessment.

Course materials can contain instructor and student names, emails, locations,
course content, and other institutional data. Best-effort redaction does not
change the source data's classification and is not guaranteed to remove all
identifiers.

DeepInfra's standard Terms:

- require the customer to possess the rights needed to submit the material;
- permit limited debugging/internal use;
- permit limited storage for debugging;
- impose customer warranties and indemnification;
- use individual arbitration and Delaware law;
- allow unilateral term changes;
- do not, in the public click-through text, supply every Georgia Tech contract
  guarantee listed in the services checklist.

Sending instructor-authored course materials also raises a rights question:
individual student authorization to read Canvas does not automatically prove
that the app operator may grant DeepInfra the processing/debugging license its
Terms require.

AI is currently disabled, which is correct. It must remain disabled until GT
identifies the data owner, approves the use, accepts appropriate vendor terms,
and confirms the rights basis for processing course materials.

### P0-6 â€” No production OAuth approval or end-to-end proof exists

Production has placeholder OAuth credentials and `/api/auth/canvas/login`
returns HTTP 503 with `CANVAS_OAUTH_PENDING`. No evidence was found of:

- a Georgia Tech development or production Developer Key;
- approved redirect URIs;
- approved scopes;
- a completed authorize/callback exchange;
- refresh-token behavior against GT Canvas;
- GT-side revocation;
- a pilot population;
- the institutional owner for the integration.

The implementation is prepared for testing, but cannot be described as a
completed GT OAuth integration.

## P1 findings: material draft and launch corrections

### P1-1 â€” The Terms do not identify the contracting operator

The Terms refer to "we" and "the maintainers" without identifying the person or
legal entity operating the service, a mailing address, governing law, or a
verified support/privacy contact. The $100 liability cap therefore has an
undefined beneficiary/counterparty.

The operator identity, capacity, contact information, and legal terms need
review by someone authorized to provide legal guidance. Confirm that
`canvassync@gatech.edu` exists, is monitored, and is authorized for privacy,
security, and legal notices.

### P1-2 â€” The Terms' third-party clause is misleading

"Their terms apply to their respective services" suggests end users directly
contract with Supabase, Google Cloud, Vercel, and DeepInfra. In the observed
architecture the operator is normally the customer of those infrastructure
providers.

The Terms should instead explain that the Service uses providers whose
processing is governed by the operator's agreements and the disclosed privacy
terms. It should not shift undisclosed vendor obligations to students.

### P1-3 â€” Ownership wording is overbroad

"You and Georgia Tech retain ownership" attempts to allocate ownership between
the user and Georgia Tech even though instructors, publishers, students, and
other rightsholders may own different material.

Instructure's policy says the app should treat rights as belonging to the Canvas
Customer or User and specifically notify the Customer that it maintains
ownership of uploaded and GAI-derived material. Safer wording is that CanvasSync
claims no ownership and all rights remain with the applicable Customer, User,
or other rightsholder.

### P1-4 â€” The changes clause conflicts with Instructure's API Policy

The Terms say that updating the "Last updated" date and continued use constitute
acceptance. Instructure prohibits retroactive changes and requires actual notice
plus the ability to decline future service whenever data practices become more
permissive.

The code has a versioned re-consent design, but its database columns are absent.
The Terms should promise actual notice and affirmative re-acceptance for
material privacy/data-use changes, then the code must enforce it.

### P1-5 â€” AI wording does not describe the current service state

The public Privacy Policy says "When you sync a course, we send" course text to
DeepInfra. Production AI is disabled and current sync does not send that text.

Use conditional wording: when AI is enabled after approval and the user invokes
date resolution, specified content will be sent. Keep the current provider,
model, training, storage, debugging, redaction, and risk disclosures.

### P1-6 â€” The policy's profile inventory is not exact

OAuth code stores Canvas `email`, but falls back to `login_id` and places it in
the email field. The policy should say "email address or Canvas login
identifier," or the code should stop treating `login_id` as email.

### P1-7 â€” Security claims are unverified or false

The packet states:

- "CSRF-safe" handling â€” false;
- distributed rate limiting in a shared store â€” false in production;
- RLS denies all browser roles â€” not verified in the production database;
- the backend fails to boot without all required production controls â€” false as
  written because placeholder OAuth values and an explicit in-memory limiter
  override allow it to boot;
- consent is enforced and stored â€” designed but not operational.

Replace claims with current facts and label pending controls.

### P1-8 â€” Georgia Tech status and branding are overstated

The outreach and submission repeatedly call CanvasSync a "GT App feature" and
say it is intended to be surfaced through the GT App. No evidence of GT App
approval or coordination was found.

Georgia Tech's brand rules allow factual identification as a student but expect
prior review when a student uses Georgia Tech's name for another purpose and
prohibit implying endorsement of a product or service. Use "independent
student-built application for Georgia Tech students" and request written brand
guidance from `gtbrand@gatech.edu`.

The public disclaimer that CanvasSync is not an official GT or Instructure
product is good and should remain.

### P1-9 â€” DeepInfra age terms need a decision

CanvasSync's Privacy Policy addresses only children under 13. DeepInfra's public
Privacy Policy says its website/services are not for children under 18.
Georgia Tech students can be under 18.

The end user is not necessarily the DeepInfra account holder, so this is not a
simple copy-and-paste age restriction. GT Legal/privacy review must determine
whether DeepInfra may process course text relating to a minor and whether the
Service needs an age restriction, consent mechanism, or different contract.

### P1-10 â€” Operational-log retention is not specified

The Privacy Policy mentions security and request logs but does not state:

- which providers create them;
- whether URLs, user IDs, IP addresses, or request metadata are included;
- how long Cloud Run, Vercel, Supabase, and application logs are retained;
- who can access them;
- how deletion requests interact with security logs and backups.

Define and verify those settings before production approval.

### P1-11 â€” Rate limiting is not multi-instance safe

Flask-Limiter uses `memory://`, so limits reset per process and can be bypassed
across Cloud Run instances. README, OIT submission, and runbook language claiming
a shared store is inaccurate. Use an approved Redis-compatible shared store or
describe the temporary limitation accurately.

### P1-12 â€” Stale tracked documents contradict the deployed architecture

The current runtime and live bundle do not use OpenRouter. However, tracked
documents still describe OpenRouter as active or required, including:

- `DEPLOY.md`;
- `docs/OIT_APPROVAL_PLAN.md`;
- `docs/OIT_READINESS_AUDIT.md`;
- `docs/OIT_FULL_AUDIT_2026-06-06.md`;
- `docs/INSTITUTIONAL_COMPLIANCE.md`;
- historical audit/remainder files.

Historical audits may remain if prominently labeled superseded. Operational
guides and approval-package documents must be corrected or excluded. Do not send
reviewers a repository-wide documentation set without a clear current-document
index.

The ignored local `backend/.env` also contains legacy OpenRouter configuration.
It is not pushed or deployed, but it can cause accidental local use and should
be sanitized after preserving any needed secrets safely.

### P1-13 â€” Account deletion can report success after partial cleanup

`delete_all_user_data()` logs and ignores storage purge failure, then deletes the
database user. This can orphan storage objects and removes the account key needed
to enumerate them later. Canvas revocation also ignores non-success HTTP status.

Use a retryable deletion workflow, record completion without storing deleted
user content, and return an accurate pending/failure state.

## P2 findings and engineering maturity

- The production frontend dependency tree reports 43 advisories:
  11 high, 28 moderate, 4 low, and 0 critical. Most are in the legacy
  Create React App build/test toolchain, but the package is a production
  dependency and needs a documented migration/remediation decision.
- The repository has one frontend disclosure test and no backend pytest suite.
- The frontend test passed and Python `compileall` passed, but this is not enough
  evidence for OAuth, deletion, CSRF, retention, or multi-user isolation.
- The public demo is enabled. It uses a fixed demo identity and synthetic course
  material, but the approval packet should disclose it and GT should decide
  whether it remains public during review.
- The delete confirmation still says "AI usage metadata" is deleted even though
  the app no longer maintains that telemetry database.

## Required edits before sending even a development-key draft

1. Rewrite `docs/OIT_SUBMISSION.md` as a **development review request**, not a
   statement of production readiness.
2. Remove all unapproved "GT App feature" claims.
3. Replace CSRF, distributed-rate-limit, RLS, consent, and fail-closed
   overstatements with current facts.
4. State that AI is disabled pending review.
5. Add a "known open blockers" section referencing this report.
6. Use the current production and proposed staging redirect URIs, not
   placeholders.
7. Ask for a separate test-only key and a separate production review later.
8. State that official Canvas documentation does not establish PKCE support and
   that it will be verified during development testing.
9. Include the exact scope-to-feature matrix and remove "any subset works."
10. Attach only current documents:
    - revised OIT submission;
    - this follow-up audit;
    - current architecture/data-flow diagram;
    - current public Privacy and Terms URLs;
    - scope matrix;
    - vendor list and review status;
    - staging verification plan.
11. Mark old architecture and OpenRouter documents superseded or archive them
    outside the active submission index.

## Questions that require written answers

### Georgia Tech / Digital Learning

1. Does Georgia Tech permit this independent external student-built app to use a
   root-account Canvas API Developer Key, or is another intake/integration model
   required?
2. Does the January 1, 2026 LTI vetting process or its three-month lead time
   apply to a non-LTI OAuth REST app?
3. Who is the required data/system owner and must the student have a faculty,
   staff, department, or GT App sponsor?
4. Will GT issue a separate `test_cluster_only` key, and what test/beta hostname
   and accounts may be used?
5. What data exists in GT's test/beta Canvas environments, and may it be sent to
   the proposed staging vendors?
6. Does GT require separate development and production Developer Keys?
7. Can GT restrict a production pilot to named users, or must CanvasSync enforce
   the pilot population?
8. Does GT Canvas accept and enforce PKCE for API Developer Key authorization
   code flows?
9. Are the requested scopes and `allow_includes=true` acceptable?
10. What accessibility, operational-support, continuity, and incident-response
    evidence is required?

### Security, privacy, legal, and AI reviewers

11. What is the official data classification for course names, assignments,
    submission/completion status, announcements, syllabi, files, modules, pages,
    and OAuth credentials?
12. Have Supabase, Google Cloud, Vercel, and DeepInfra already completed
    applicable HECVAT/security reviews, or must this project initiate them?
13. Who has authority to accept the provider terms and pay for the accounts?
14. Are DeepInfra's standard terms acceptable, or is a DPA/enterprise agreement
    required?
15. Does the app have sufficient rights to send instructor-authored course
    materials to DeepInfra under DeepInfra's submission license and warranty?
16. May DeepInfra process content relating to students under 18?
17. What log and backup retention periods are approved?
18. What wording should be used for ownership, deletion limitations, and
    subprocessor disclosures?

### Project owner

19. Who is the legally identified operator of CanvasSync?
20. Is `canvassync@gatech.edu` a real, monitored, authorized mailbox?
21. Is there written approval or an active relationship with the GT App team?
22. Who will own support, incident response, vendor accounts, billing, and
    service continuity after the student maintainer graduates or leaves?
23. Is the intended first request only a development key, or is a real-student
    pilot being requested at the same time?

## Verification performed

- Confirmed Git branch and remote head equality.
- Confirmed draft PR state.
- Inspected Vercel production deployment metadata and live bundle.
- Confirmed live public home, Terms, and Privacy pages.
- Inspected Cloud Run revision configuration.
- Confirmed OAuth pending response.
- Confirmed direct DeepInfra configuration with AI disabled.
- Confirmed legacy sensitive endpoints return 404.
- Confirmed CORS allows the Vercel origin and rejects `canvassync.app` and an
  unrelated origin.
- Confirmed public demo session remains enabled.
- Confirmed retention job and scheduler state.
- Queried production Supabase schema for consent/session columns.
- Confirmed old AI log table exists and is empty.
- Demonstrated cross-site logout POST behavior.
- Compared source data handling with public policy text.
- Ran frontend tests: 1 suite and 1 test passed.
- Ran Python compilation check: passed.
- Ran production dependency audit: 43 advisories, 0 critical.

## Primary sources

- Instructure Canvas API Policy, effective August 12, 2025:
  https://www.instructure.com/policies/canvas-api-policy
- Instructure OAuth2 overview and endpoints:
  https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth
  https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth_endpoints
- Instructure Developer Keys:
  https://developerdocs.instructure.com/services/canvas/resources/developer_keys
- Instructure administrator guide, Developer API Key creation:
  https://community.canvaslms.com/t5/Admin-Guide/How-do-I-add-a-developer-API-key-for-an-account/ta-p/259
- Georgia Tech updated LTI vetting process, March 26, 2026:
  https://sites.gatech.edu/dlt-blog/2026/03/26/updated-lti-vetting-process/
- Georgia Tech AI standards and guidance:
  https://oit.gatech.edu/ai/guidance
- Georgia Tech Third Party Security Procedures:
  https://security.gatech.edu/third-party-security-procedures/
- Georgia Tech Services Security Checklist:
  https://security.gatech.edu/services-security-checklist/
- Georgia Tech Personal Information Privacy Policy:
  https://policylibrary.gatech.edu/legal/personal-information-privacy-policy
- Georgia Tech Use of Name Standards:
  https://brand.gatech.edu/our-look/use-of-name
- DeepInfra Terms, last modified July 4, 2024:
  https://deepinfra.com/terms
- DeepInfra Privacy Policy, last modified May 13, 2025:
  https://deepinfra.com/privacy
- DeepInfra inference data-privacy documentation:
  https://docs.deepinfra.com/account/data-privacy

## Final determination

**As-is:** do not send the current submission package and do not request
production OAuth.

**Permissible next draft:** after correcting the factual overstatements, send a
short request asking Georgia Tech to identify the standalone OAuth review path
and to consider a test-only Developer Key for a segregated staging environment.
State plainly that AI is disabled and production readiness is pending.

**Production readiness:** no. Production OAuth should be requested only after
the P0 findings are closed, the public policies are corrected, all relevant
vendors and AI use are approved, and a real GT development-key flow has passed
the full acceptance suite.
