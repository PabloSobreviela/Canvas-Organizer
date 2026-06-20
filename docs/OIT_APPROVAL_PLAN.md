# CanvasSync Approval Plan

**Current as of:** June 20, 2026
**Project type:** Independent Georgia Tech student-developed external web app
**Current ask:** Review-path guidance and test-only Canvas Developer Key

## Principle

Student-developed status is important context and may support a narrower
development/pilot review than a purchased enterprise LTI product. No public
Georgia Tech source reviewed establishes a blanket exemption from Canvas
administrator approval, data stewardship, security, privacy, accessibility, or
AI restrictions. The plan therefore asks Georgia Tech directly whether a
streamlined student path applies rather than assuming either the enterprise LTI
process or an exemption.

Instructure's role is to define the OAuth/API mechanism and policy. The actual
Developer API Key is created and managed by Georgia Tech's local Canvas
root-account administrators; no global Instructure certification process is
identified for this external OAuth REST client.

## Phase 1 — Technical truth (complete and verified)

- Migration `010_compliance_state.sql` is applied in production.
- Deprecated rows/storage and the obsolete AI telemetry table are absent.
- Production grants, RLS, policies, indexes, and consent/session columns are
  verified.
- OAuth fails closed until GT issues a key.
- Cookie-authenticated mutations enforce Origin plus custom-header CSRF.
- Public Terms, Privacy, consent, architecture, and operations documents match
  the deployed Vercel/Cloud Run/Supabase state.
- Evidence is recorded in
  `docs/POST_RECONCILIATION_AUDIT_2026-06-20.md`.

## Phase 2 — Development review

- Send the concise process inquiry in `docs/GT_OIT_OUTREACH.md`.
- Attach `docs/OIT_SUBMISSION.md` and the latest audit.
- Request a separate `test_cluster_only` Developer Key.
- Ask whether a sponsor/data owner is required.
- Ask whether the LTI process or a streamlined student-development path applies.

## Phase 3 — Staging proof

- Separate Cloud Run service, Vercel URL, Supabase project, keys, and callback.
- No personal access tokens from testers.
- Verify OAuth, scopes, includes, token refresh/revocation, PKCE behavior,
  consent, CSRF, RLS, retention, export, deletion, and logs.
- DeepInfra's tested synchronous endpoint is the provider's ZDR-by-default
  inference path. Keep AI data testing within any conditions imposed by GT's
  local Canvas administrators.

## Phase 4 — Production review

- Resolve every condition in GT's written response.
- Complete any required accessibility, brand, privacy, security, data-owner, and
  AI/provider reviews.
- Request a separate production Developer Key with exact scopes and callback.
- Begin with a limited pilot and documented rollback/key-disable process.

## Current blockers

- No GT development or production Developer Key.
- No GT answer on the student-developed OAuth review path.
- No completed GT OAuth end-to-end test.
- No written local GT Canvas decision yet on DeepInfra processing of course
  material under the requested student-developed pilot.
- Shared Redis-compatible endpoint rate limiting is not configured.
