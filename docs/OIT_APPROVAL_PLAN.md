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

## Phase 1 — Technical truth

- Apply `backend/migrations/010_compliance_state.sql`.
- Remove deprecated database data and the obsolete AI telemetry table.
- Verify actual production RLS policies with database-owner access.
- Keep OAuth fail-closed until GT issues a key.
- Protect cookie-authenticated mutations against CSRF.
- Keep current public Terms, Privacy, consent, architecture, and operations
  documents aligned with deployed behavior.

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
