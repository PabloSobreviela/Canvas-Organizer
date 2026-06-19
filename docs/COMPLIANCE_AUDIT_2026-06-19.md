# CanvasSync Production Compliance Audit

**Audit date:** June 19, 2026
**Scope:** Production behavior, the exact deployed Vercel frontend and Cloud Run backend, the current repository worktree, Georgia Tech requirements relevant to a student-built application, the Instructure Canvas API Policy, and the application's Terms, Privacy Policy, consent text, and related documentation.
**Assessment:** **Red — not ready to represent as compliant or ready for a general Georgia Tech student launch.**

> This is a technical and documentary compliance gap assessment, not legal advice or a substitute for Georgia Tech, Instructure, or legal review.

## 1. Executive conclusion

The application cannot currently be verified as fully compliant. Several production behaviors directly contradict the live Privacy Policy, the repository's intended architecture, and the premise that requests now go directly to DeepInfra.

The most urgent finding is an unauthenticated production endpoint that exposes stored AI prompts, AI responses, user identifiers, and course identifiers. Production records also show that OpenRouter was still processing requests on June 19, 2026. This is not merely stale documentation: it is active production behavior.

The production OAuth implementation is also not a completed Georgia Tech Canvas OAuth integration. The deployed Cloud Run service uses placeholder Canvas OAuth credentials, requests no explicit OAuth scopes, does not persist or refresh the OAuth grant correctly, sends an application token through a URL query parameter, and does not revoke Canvas credentials on logout. A separate manual Canvas access-token path remains active.

In addition:

- `canvassync.app` does not point to the audited Vercel application. It redirects to an older Firebase-hosted application with Google sign-in.
- The Vercel application links to legal pages, but the live backend lacks the consent, deletion, export, and Canvas-disconnect endpoints that the frontend and Privacy Policy describe.
- The deployed backend stores full Canvas-derived data and full AI input/output without an implemented production retention or deletion mechanism.
- AI output is not clearly labeled as generative-AI output as required by the current Instructure API Policy.
- The current repository contains substantial improvements, but those changes are not the production system and still configure OpenRouter as the primary gateway rather than direct DeepInfra.
- Critical facts about Georgia Tech approval, vendor approval, contracts, data residency, retention, and the application's operator remain unanswered. Those facts cannot be inferred from code.

## 2. Evidence and deployment boundary

### 2.1 What is actually running

| Component | Production evidence observed June 19, 2026 |
|---|---|
| Public custom domain | `https://canvassync.app/` resolves to Firebase Hosting and redirects to `https://canvas-organizer-4437b.web.app/`. The visible application uses Google sign-in and does not expose the audited Vercel legal pages. |
| Current Vercel frontend | `https://canvas-organizer.vercel.app/`, production deployment `dpl_Hkv...`, created June 19, 2026 at 2:35:44 PM EDT. |
| Vercel build | Builds only `frontend`; the backend is excluded from the Vercel deployment. |
| Frontend API target | `https://canvas-organizer-backend-93870731079.us-central1.run.app` |
| Production backend | Google Cloud Run revision `canvas-organizer-backend-00112-w8m`, created May 19, 2026 at 19:27 UTC. The exact deployed source archive was inspected separately from the worktree. |
| Production database mode | Supabase-backed cloud mode, despite the legacy `USE_FIRESTORE` configuration name. |
| Production AI route | OpenRouter is configured as the primary OpenAI-compatible endpoint. Direct DeepInfra exists only as an optional fallback and is not configured with a fallback API key in the deployed service. |
| Current repository | Contains extensive uncommitted/newer work that is not evidence of production behavior. |

The current Vercel alias has no Vercel-managed custom domain. Consequently, documentation that treats `canvassync.app` and the Vercel application as the same production system is presently inaccurate.

### 2.2 Audit method

This assessment used:

- Vercel project configuration, environment metadata, deployment inspection, build output, and the deployed JavaScript bundle.
- Live, read-only HTTP behavior checks against the Vercel frontend and Cloud Run backend.
- The exact source archive attached to the active Cloud Run revision.
- The current local repository, including deployment scripts, legal text, database migrations, OAuth code, AI routing, telemetry, and local data directories.
- Current official Instructure, Georgia Tech, DeepInfra, and OpenRouter documentation.

No application behavior, cloud configuration, database records, policies, or production data were changed during this audit.

## 3. Immediate containment findings

### P0-01 — Public production disclosure of AI prompts, responses, and identifiers

**Affected system:** Live Cloud Run backend
**Status:** Confirmed

`GET /api/ai/usage-logs/dashboard` is publicly accessible without authentication. The response contains, among other fields:

- user identifiers;
- Canvas course identifiers;
- full or substantial AI prompt text;
- full AI response text;
- request and provider metadata; and
- the underlying raw telemetry object.

A bounded production check found 21 records. Seventeen included stored prompt and response content. Records extended through June 19, 2026. The sensitive values and content are intentionally not reproduced in this report.

This creates a direct confidentiality risk for Canvas-derived material and user-linked educational activity. It also contradicts the live Privacy Policy's statements that the application does not store full prompts or responses and that course material is de-identified before AI processing.

**Required planning response:**

1. Treat this as a potential privacy/security incident, not only a backlog defect.
2. Remove public access and stop returning prompt, response, user, course, and raw fields.
3. Preserve only the minimum audit evidence required for incident review.
4. Determine who accessed the endpoint using Cloud Run, load-balancer, Vercel, Supabase, and application logs.
5. Decide with the appropriate Georgia Tech privacy/security contact whether notification or formal incident handling is required.
6. Purge exposed AI content according to an approved preservation and deletion decision.

### P0-02 — Production still uses OpenRouter

**Affected system:** Live Cloud Run backend and current repository
**Status:** Confirmed

Production configuration sets OpenRouter as the primary endpoint. The deployed code sends prompts to that endpoint without a request-level provider pin, Zero Data Retention flag, `data_collection: deny`, or fallback restriction.

Production telemetry showed:

- 17 recent requests attributed to `openrouter` using the configured Qwen model; and
- four older records attributed to Vertex AI.

The newest OpenRouter record observed was dated June 19, 2026. Direct DeepInfra is coded only as a fallback, and the production fallback key is not configured.

The current local repository also continues to use an OpenRouter gateway pinned or intended to be pinned to DeepInfra. Deployment scripts, the Dockerfile, consent text, and documentation likewise reference OpenRouter. Therefore, neither the deployed system nor the current worktree implements the stated architecture of direct DeepInfra.

**Required decision:** Select and document exactly one architecture:

- direct DeepInfra; or
- OpenRouter routing to DeepInfra.

If direct DeepInfra is the decision, the runtime configuration, AI client, deployment scripts, container defaults, consent flow, Privacy Policy, Terms, subprocessors, incident analysis, and verification tests all need to be changed before launch.

### P0-03 — Custom production domain serves a different legacy application

**Affected system:** DNS/Firebase/Vercel
**Status:** Confirmed

`canvassync.app` serves or redirects to an older Firebase deployment with Google sign-in. The audited Vercel application is available only at its Vercel alias. Visiting `/privacy` on the custom domain returns to the legacy application rather than a Privacy Policy.

This makes it impossible for a user or reviewer to know which application, authentication system, legal text, and data practices govern the service.

**Required planning response:** Choose the canonical production origin, move the domain to it, retire or clearly quarantine the legacy application, and make every redirect URI, legal URL, support URL, cookie domain, and vendor registration consistent with that decision.

### P0-04 — Georgia Tech Canvas OAuth is not production-ready

**Affected system:** Live Cloud Run backend
**Status:** Confirmed

The deployed service uses placeholder Canvas OAuth client credentials. Its authorization request contains no explicit `scope` parameter. Its OAuth state is process-memory state rather than signed/persistent state, and it does not use PKCE. After callback it:

- obtains Canvas token data but does not persist the OAuth access or refresh token;
- issues its own JWT;
- redirects with that JWT in `?token=...`;
- does not reliably establish the session expected by the current frontend;
- has no working OAuth refresh route; and
- performs no Canvas token revocation on logout.

The application also exposes a manual Canvas access-token credential endpoint that stores a user's token.

Instructure requires a developer key, approved redirect URI behavior, explicit/scoped access where scopes are used, token refresh for expiring access tokens, and token revocation when disconnecting. The repository contains no evidence that Georgia Tech issued or approved the production Developer Key, scopes, redirect URIs, pilot population, or data uses.

**Required planning response:** Do not claim Georgia Tech OAuth readiness until OIT or the responsible Canvas administrator provides written approval and the approved key configuration can be matched to the implementation.

## 4. Detailed findings

Severity meanings:

- **P0:** immediate exposure, active material contradiction, or launch blocker;
- **P1:** serious compliance/security gap that must be resolved before broader use;
- **P2:** material documentation, assurance, or operational weakness;
- **P3:** hardening or governance improvement.

| ID | Severity | Scope | Finding |
|---|---:|---|---|
| P0-01 | P0 | Production | Public AI telemetry endpoint exposes prompt/response content and user/course identifiers. |
| P0-02 | P0 | Production + repository | OpenRouter remains the active primary AI route; direct DeepInfra is not implemented as stated. |
| P0-03 | P0 | Production | `canvassync.app` serves a different Firebase/Google-auth application, not the Vercel application. |
| P0-04 | P0 | Production | Canvas OAuth uses placeholder credentials and an incomplete/insecure deployed flow. |
| P1-01 | P1 | Production | No enforceable legal-consent gate exists in the deployed backend. |
| P1-02 | P1 | Production | Promised delete, export, and Canvas-disconnect APIs are absent or return 404. |
| P1-03 | P1 | Production | Logout is stateless and does not revoke or remove Canvas credentials. |
| P1-04 | P1 | Production | Full Canvas-derived JSON/text and AI input/output are retained without a production retention/deletion service. |
| P1-05 | P1 | Production | AI output is not clearly labeled as generative-AI output. |
| P1-06 | P1 | Production | JWTs are placed in a URL query parameter and the frontend retains a bearer token in `localStorage`. |
| P1-07 | P1 | Production | Sensitive Cloud Run credentials are stored as literal environment variables instead of managed secret references. |
| P1-08 | P1 | Production | The deployed database schema source contains permissive RLS policy definitions; actual production migration/RLS state is unverified. |
| P1-09 | P1 | Production | OpenRouter account-level retention, routing, logging, and fallback settings are unverified, while request-level restrictions are absent. |
| P1-10 | P1 | Production | A public testing/logging interface exposes operational AI information and is not access-controlled. |
| P1-11 | P1 | Repository | The intended OAuth scope list does not clearly cover all Canvas endpoints used by synchronization. |
| P1-12 | P1 | Repository | Current code improvements have not been deployed or verified against the production database/configuration. |
| P2-01 | P2 | Legal text | Privacy and Terms contain factual claims that do not match production. |
| P2-02 | P2 | Legal text | Retention disclosures do not match either live behavior or the newer local defaults. |
| P2-03 | P2 | Legal text | Consent says submissions/grades are not collected, but the code requests per-user submission status. |
| P2-04 | P2 | Legal text | Operator identity, address, governing entity, and verified support/privacy contact are incomplete. |
| P2-05 | P2 | Legal text | Terms refer to an OIT pilot/suspension authority without repository evidence that such a pilot exists. |
| P2-06 | P2 | Vendors | Georgia Tech approval, contracts/DPA, subprocessor terms, region, and deletion assurances are unverified for all cloud/AI vendors. |
| P2-07 | P2 | Local data | An ignored local directory contains approximately 368 Canvas-derived files totaling about 806 MB, with no documented retention decision. |
| P2-08 | P2 | Frontend | The deployed Vercel build reports 61 dependency vulnerabilities, including one critical and 20 high findings. |
| P2-09 | P2 | Frontend | The live Vercel deployment lacks the security-header set present in the uncommitted local `vercel.json`. |
| P3-01 | P3 | Operations | Production rate limiting is process-local and cannot provide consistent distributed enforcement. |
| P3-02 | P3 | Repository | Course-specific JSON artifacts remain in source control and should be classified or replaced with synthetic fixtures. |

### 4.1 Consent and user controls

The deployed frontend attempts to call legal-consent, deletion, export, and Canvas-disconnect APIs. The active backend does not register those routes. Live verification returned 404 for the relevant endpoints, including the routes used by the current frontend.

No deployed backend gate checks legal-consent version before:

- storing a manual Canvas token;
- synchronizing Canvas material;
- processing course material with AI; or
- using the demo AI flow.

The current repository adds consent gating and user-control routes, but their existence in the worktree does not cure the production behavior.

### 4.2 Canvas data collected and retained

The deployed code can request and retain:

- course records;
- assignments and user-specific submission state;
- announcements;
- syllabus body;
- front-page content;
- modules and pages;
- file metadata, downloaded file contents, and extracted text; and
- raw Canvas response objects for several data types.

AI prompts can include assignment details, syllabus text, file text, module/page text, and announcement snippets.

This is broader and more identifiable than a simple schedule organizer. Course IDs, user IDs, submission status, instructor content, and potentially names embedded in announcements/pages are not reliably de-identified merely by omitting the user's name from a structured prompt.

The deployed code has no general TTL/retention service. A file-version cleanup keeps two versions, but that is not a user-data retention policy.

The newer repository defaults propose approximately:

- 180 days for multiple Canvas-derived tables; and
- 365 days for AI usage logs.

The live Privacy Policy instead says data is retained until the user deletes it or stops using the service. There is no implemented production deletion-on-inactivity mechanism, and the newer repository disables inactive-user purging by default. Neither implementation matches the disclosure.

### 4.3 Instructure Canvas API Policy alignment

The current [Canvas API Policy](https://www.instructure.com/policies/canvas-api-policy), effective August 12, 2025, emphasizes privacy, transparency, limited and expected data use, protection of API information, rate-limit compliance, and specific generative-AI disclosures.

Material gaps include:

- Users are not accurately told which AI provider receives content.
- Full prompts/responses and linked identifiers are publicly disclosed.
- AI reports/results are not clearly labeled as AI-generated.
- The application does not clearly disclose AI limitations, risks, and the ownership/treatment of generated output at the point of use.
- The exact data sent for each AI feature is not made sufficiently concrete.
- There is no evidence that all requested Canvas access is limited to Georgia Tech-approved scopes.
- Production deletion, disconnection, and token revocation do not function as represented.

The API Policy also requires the developer to have rights to use information submitted to generative AI. The code can submit instructor-authored course materials and potentially other people’s content. User consent alone may not establish the developer’s right to send all course content to a third-party AI processor; this requires institutional/legal determination.

### 4.4 Georgia Tech alignment

Georgia Tech's [Data Categorization](https://security.gatech.edu/data-categorization) guidance treats data as Protected by default unless categorized otherwise and identifies student information as Protected. The [Personal Information Privacy Policy](https://policylibrary.gatech.edu/legal/personal-information-privacy-policy) requires minimization and clear articulation of whose data is collected, why, how it is used, and with whom it is shared. The [Cyber Security Policy](https://policylibrary.gatech.edu/information-technology/cyber-security-policy) requires protection of Georgia Tech data and compliance with protected-data practices.

Georgia Tech's January 2025 [FERPA Basics training](https://registrar.gatech.edu/public/2025-02/FERPA%20Basics%20-%20Faculty%20January%202025_3.pdf) directs use of unapproved tools involving student data toward Cybersecurity review and raises the need for vendor agreements or permission.

No written Georgia Tech approval, Developer Key issuance, data classification, security review, vendor approval, pilot approval, or FERPA determination was found in the repository. Planning documents and outreach drafts are not approval evidence.

Georgia Tech also published an [updated LTI vetting process](https://sites.gatech.edu/dlt-blog/2026/03/26/updated-lti-vetting-process/) effective January 1, 2026. CanvasSync appears to be a standalone Canvas OAuth application rather than an LTI integration, so that exact process may not apply. OIT or Digital Learning must answer which review path does apply.

### 4.5 AI provider and retention representations

There are currently three incompatible descriptions:

1. The user's stated intended architecture: direct DeepInfra, no OpenRouter.
2. The current repository/consent direction: OpenRouter routed or pinned to DeepInfra.
3. The active production behavior: OpenRouter as the primary endpoint without an application-level provider pin or request-level data-retention restrictions.

DeepInfra's public site markets zero-data-retention options, but its [Terms](https://deepinfra.com/terms) also permit limited storage of submissions for debugging and require the customer to possess the necessary rights and permissions. The actual account configuration and contract—not marketing language—must support any “zero retention” claim.

OpenRouter's current documentation makes routing, fallback, provider data-collection, and logging behavior dependent on request parameters and account settings. Those settings were not available for audit. The deployed requests do not enforce the necessary restrictions themselves.

Until the architecture and contractual settings are verified, the policies must not promise:

- direct DeepInfra processing;
- guaranteed zero retention;
- no OpenRouter involvement;
- DeepInfra-only routing;
- disabled provider fallback; or
- no prompt/response logging.

### 4.6 Privacy Policy claim-by-claim comparison

| Live disclosure | Production finding | Assessment |
|---|---|---|
| AI processing uses OpenRouter. | Confirmed, despite the stated plan to remove it. | Factually true for current production, inconsistent with intended architecture. |
| Course material is de-identified before AI processing. | Prompts contain course text and linked operational metadata; de-identification is not reliably implemented or demonstrated. | Unsupported/overstated. |
| Full prompts and responses are not stored. | Full/substantial prompts and responses are stored and publicly returned. | False in production. |
| OpenRouter logging is disabled and ZDR is used where supported. | No request-level controls; account settings were not verified. | Unverified. |
| OAuth tokens are removed on logout. | Deployed logout does not revoke or remove Canvas credentials. | False in production. |
| Users can delete/export their data. | Required live backend endpoints are absent/404. | False in production. |
| Data is retained until deletion or the user stops using the service. | No inactivity purge; no working deletion endpoint; indefinite production retention is possible. | False or materially incomplete. |
| Tokens are encrypted. | Manual Canvas tokens use configured encryption, but the OAuth implementation does not correctly persist the grant. | Partially true; disclosure does not explain the two credential paths. |
| RLS protects Supabase data. | Current production database policy state was not verifiable; deployed schema source contains permissive policies. | Unverified and high risk. |
| Consent is obtained before AI processing. | No deployed server-side consent gate. | False in production. |

### 4.7 Terms of Service comparison

The Terms correctly state that the application is independent and not an official Georgia Tech or Instructure service. However:

- the subprocessors list reflects OpenRouter and not the stated direct-DeepInfra architecture;
- it does not fully describe the different live applications under the custom domain and Vercel alias;
- it treats AI as a core feature without clarifying whether users may use non-AI functions without AI processing;
- it refers to OIT's ability to suspend a pilot, but no evidence of an authorized OIT pilot was found;
- it does not establish the operator's complete legal identity/contact details;
- it cannot cure incorrect Privacy Policy claims or absent user-control functionality; and
- the liability cap, governing-law language, and student-project framing require legal/institutional confirmation.

### 4.8 Security and operational observations affecting compliance

- Sensitive service credentials are stored directly in Cloud Run environment variables. They should be moved to Secret Manager and rotated as part of the remediation.
- The deployed OAuth token is placed in a redirect query string, where it can enter browser history, screenshots, logs, referrers, and monitoring systems.
- The frontend uses a `localStorage` bearer-token fallback despite policy language emphasizing HttpOnly sessions.
- The production Vercel deployment lacks the CSP, frame, content-type, referrer, permissions, and related headers in the current local configuration.
- The Vercel build reported one critical, 20 high, 35 moderate, and five low dependency vulnerabilities.
- Production CORS correctly rejected an unrelated test origin during this audit, but configuration still allows broad Vercel preview origins and should be narrowed to explicitly approved environments.
- Application rate limiting uses process-local memory and is not reliable across Cloud Run instances.

## 5. Repository and legacy-data findings

The repository is partially migrated. Newer code contains meaningful improvements:

- signed OAuth state and PKCE;
- HttpOnly session cookies;
- Canvas access/refresh token persistence and revocation;
- legal-consent enforcement;
- deletion, export, and disconnect routes;
- data-retention services;
- reduced AI telemetry;
- more restrictive database policies; and
- stronger Vercel security headers.

These improvements are not evidence that production is compliant. Before deployment they require:

1. reconciliation with the intended direct-DeepInfra architecture;
2. reconciliation of OAuth scopes with every Canvas endpoint used;
3. verification that production database migrations are safe and complete;
4. a policy rewrite and version bump;
5. forced re-consent for materially changed AI/provider/data terms;
6. end-to-end tests against the real approved Developer Key; and
7. verification on the canonical custom domain.

The local `backend/data/storage` directory contains approximately 368 ignored files totaling roughly 806 MB. Paths and sampled structure indicate Canvas-derived pages/files/text. Because it is ignored, it was not found in Git tracking, but it still represents locally retained educational data. Its purpose, owner, approved retention, backup status, and deletion requirement must be decided.

The tracked `data/app.db` currently has empty tables. Two small course-numbered JSON artifacts remain tracked and should be classified, removed, or replaced with synthetic fixtures even though no obvious direct identifier was found in the limited review.

## 6. Questions that must be answered

These questions materially affect compliance and cannot be answered from the codebase. They should be answered in writing before a compliant-launch decision.

### Product, operator, and production scope

1. Which URL is the canonical service: `canvassync.app`, the Firebase URL, or `canvas-organizer.vercel.app`?
2. Is the older Firebase/Google-auth application intentionally public? If so, what policies and data practices govern it?
3. Who is the legal operator/data controller: an individual student, a Georgia Tech organization, a company, or Georgia Tech?
4. What legal name, physical/mailing address, and monitored privacy/security contact should appear in the policies?
5. Does `canvassync@gatech.edu` exist, is it monitored, and is its use authorized?
6. Is the app limited to the developer/private testers, a defined pilot, or any Georgia Tech student?
7. Is there an actual OIT-approved pilot that supports the Terms' statement that OIT may suspend access?
8. Is the service or any future version paid, monetized, sponsored, or used for research?

### Georgia Tech and Canvas authorization

9. Has Georgia Tech OIT/Digital Learning issued or approved a Canvas Developer Key for this application?
10. Who owns the key, and what are its approved redirect URIs, scopes, user population, data categories, expiration/review date, and rate limits?
11. Which Georgia Tech review path applies to this standalone OAuth application? Does the 2026 LTI vetting process apply, or is there a separate OAuth/vendor process?
12. Has Georgia Tech classified the Canvas data handled by the app and approved sending any of it to external AI/cloud providers?
13. Has Georgia Tech completed FERPA, privacy, cybersecurity, accessibility, records-retention, procurement, trademark, and legal reviews where required?
14. Are the requested Canvas scopes approved and sufficient for files, front pages, syllabi, modules, pages, announcements, assignments, and submission status?
15. Is user-specific submission status actually required? If yes, how should it be disclosed? If no, should it be removed?
16. Can module pages, announcements, or files contain student-authored content or student names in the intended courses?

### AI architecture and rights

17. Is the final AI path direct DeepInfra or OpenRouter-to-DeepInfra?
18. If direct DeepInfra, what exact endpoint, account/project, model, region, routing behavior, retention setting, and fallback behavior are approved?
19. If OpenRouter remains involved, what exact provider pin, ZDR, data-collection, logging, and fallback settings are contractually and technically enforced?
20. Does DeepInfra provide a DPA or other contract appropriate for the approved Georgia Tech data classification?
21. Does the account provide guaranteed zero retention, or can submissions be retained for debugging, abuse prevention, or legal compliance?
22. Are any submitted course materials used for training, evaluation, human review, or service improvement by any provider or subprocessor?
23. Who has the legal right to authorize sending instructor-authored or student-authored Canvas material to the AI provider?
24. Can users decline AI processing and still use non-AI organizer features, or is consent to AI a condition of all use?
25. What AI limitations, risk warnings, output ownership terms, and “AI-generated” labels should be shown at the point of use?

### Vendors, storage, and security

26. Have Supabase, Google Cloud, Vercel, DeepInfra, and—if applicable—OpenRouter been approved by Georgia Tech?
27. What contracts, DPAs, breach terms, subprocessors, regions, backup behavior, deletion guarantees, and audit rights apply to each?
28. Which Supabase region is used, and have the restrictive RLS/session/consent/retention migrations actually been applied in production?
29. Who can access Supabase, Cloud Run, Vercel, provider dashboards, logs, and secrets?
30. What is the approved retention period for each Canvas table, extracted file, raw response, AI metric, audit log, backup, and inactive account?
31. Does “stop using the service” trigger deletion? If so, after how long and through what verified job?
32. What is the required process and completion window for access, export, correction, deletion, and Canvas disconnection requests?
33. What is the incident-response contact and required notification path for the public AI-log exposure?
34. Have access logs been reviewed to determine whether anyone else retrieved the public AI logs?
35. Are the locally retained 806 MB of Canvas-derived files still required, and who authorizes their retention or deletion?
36. Were any real credentials or protected data ever committed, included in build artifacts, copied into backups, or shared outside the approved team?

### Policy and consent governance

37. What policy version should replace `2026-05-20` after the architecture and disclosures are corrected?
38. How will material changes trigger re-consent rather than relying only on continued use?
39. Who approves the final Privacy Policy, Terms, consent language, and subprocessors list?
40. What evidence must be retained to prove a user's consent version and timestamp without retaining unnecessary personal data?

## 7. Remediation plan and launch gates

This section is planning only; no remediation was performed during the audit.

### Phase 0 — Containment and incident decision

- Disable public access to AI logs and remove prompt/response/user/course fields.
- Pause production AI processing if the approved provider and retention configuration cannot immediately be demonstrated.
- Preserve appropriate audit logs, inspect access history, and obtain an incident determination.
- Rotate sensitive application credentials and move them to managed secrets.

**Gate:** No protected or user-linked content is publicly accessible, and the incident owner has documented the disposition.

### Phase 1 — Decide the authoritative architecture

- Select the canonical domain and retire the conflicting legacy frontend.
- Select direct DeepInfra or OpenRouter-mediated DeepInfra.
- Define the approved data inventory, AI payload, OAuth scopes, regions, vendors, and retention periods.
- Obtain written answers to the institutional and contractual questions above.

**Gate:** One approved architecture and one data-flow diagram match code, infrastructure, and legal text.

### Phase 2 — Complete Georgia Tech/Canvas authorization

- Obtain the approved Canvas Developer Key and exact scope/redirect configuration.
- Confirm the applicable OIT/Digital Learning review path.
- Complete vendor, security, FERPA/privacy, accessibility, and legal reviews required by Georgia Tech.

**Gate:** Written approval exists and can be matched to the deployed configuration.

### Phase 3 — Align implementation

- Deploy the secure OAuth/session/token lifecycle.
- Remove or formally govern manual access-token handling.
- Enforce consent server-side before Canvas ingestion or AI processing.
- Implement verified export, deletion, disconnect, token revocation, and inactivity/retention jobs.
- Minimize stored raw Canvas data and AI telemetry.
- Make all AI provider/retention restrictions enforceable in requests and configuration.
- Apply and verify restrictive production RLS.
- Label AI output clearly and disclose limitations at the point of use.
- Resolve critical/high dependency vulnerabilities and deploy security headers.

**Gate:** Automated and manual production verification passes on the canonical domain with no placeholder credentials or missing routes.

### Phase 4 — Rewrite and version legal disclosures

- Rewrite Privacy, Terms, and consent text from the approved data-flow inventory.
- List the actual vendors and direct/indirect AI processing path.
- State exact data categories, purposes, legal/operator identity, retention, deletion, provider retention, and user choices.
- Correct the submission-status and de-identification language.
- Remove unsupported OIT/pilot claims.
- Increment the legal version and require re-consent.

**Gate:** The deployed legal pages and consent text match observed production behavior claim by claim.

### Phase 5 — Independent verification before launch

- Re-run deployment-source, endpoint, OAuth, deletion, retention, RLS, CORS, header, dependency, and secret-management checks.
- Verify vendor dashboards/settings and retain screenshots or exports as evidence.
- Confirm the custom domain, legal links, OAuth redirects, cookies, and support contacts.
- Have Georgia Tech and qualified legal/privacy reviewers approve the launch posture.

**Gate:** No open P0/P1 finding, all required questions answered, and approval evidence retained.

## 8. Minimum evidence package for a future “compliant” claim

- Georgia Tech/OIT approval and approved Canvas Developer Key configuration.
- Final data-flow and data-inventory diagrams.
- Vendor list, contracts/DPA, subprocessors, regions, retention, and deletion terms.
- DeepInfra/OpenRouter account-setting evidence as applicable.
- Production database migration and RLS verification.
- OAuth scope-to-endpoint matrix.
- Consent-version and re-consent test results.
- User export, deletion, disconnect, and token-revocation test evidence.
- Retention-job and backup-deletion evidence.
- AI-output labeling screenshots.
- Canonical-domain/DNS and legal-page verification.
- Dependency/security scan results.
- Incident disposition for the public AI telemetry endpoint.
- Final policy approval and release record.

## 9. Official sources consulted

- Instructure, [Canvas API Policy](https://www.instructure.com/policies/canvas-api-policy), effective August 12, 2025.
- Instructure, [Developer Keys](https://developerdocs.instructure.com/services/canvas/oauth2/file.developer_keys).
- Instructure, [OAuth2 Endpoints](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth_endpoints).
- Georgia Tech Cybersecurity, [Data Categorization](https://security.gatech.edu/data-categorization).
- Georgia Tech Policy Library, [Personal Information Privacy Policy](https://policylibrary.gatech.edu/legal/personal-information-privacy-policy).
- Georgia Tech Policy Library, [Cyber Security Policy](https://policylibrary.gatech.edu/information-technology/cyber-security-policy).
- Georgia Tech Registrar, [FERPA Basics — Faculty, January 2025](https://registrar.gatech.edu/public/2025-02/FERPA%20Basics%20-%20Faculty%20January%202025_3.pdf).
- Georgia Tech Digital Learning, [Updated LTI Vetting Process](https://sites.gatech.edu/dlt-blog/2026/03/26/updated-lti-vetting-process/), March 26, 2026.
- DeepInfra, [Privacy Policy](https://deepinfra.com/privacy) and [Terms of Use](https://deepinfra.com/terms).
- OpenRouter, [Zero Data Retention](https://openrouter.ai/docs/features/zdr), [Provider Routing](https://openrouter.ai/docs/features/provider-routing), and [Privacy Policy](https://openrouter.ai/privacy).

## 10. Final readiness determination

**Current result: not compliant-ready.**

The application should not presently be described as:

- using direct DeepInfra;
- protected by complete Georgia Tech Canvas OAuth;
- obtaining enforceable consent before AI processing;
- providing functional export/deletion/disconnection;
- retaining no AI prompts/responses;
- using only de-identified course material; or
- operating under a single, unambiguous production URL and policy set.

A future compliance determination depends on containment of the public log exposure, a documented provider decision, Georgia Tech approval, verified vendor terms, deployment of the newer controls, policy correction, and written answers to the questions in Section 6.
