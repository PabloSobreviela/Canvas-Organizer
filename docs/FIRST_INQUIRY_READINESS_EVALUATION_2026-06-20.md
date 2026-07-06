# CanvasSync First-Inquiry Readiness Evaluation

**Evaluation date:** June 20, 2026
**Target inquiry:** Georgia Tech Digital Learning at `canvas@gatech.edu`
**Inquiry purpose:** Determine the local review path for an independent
Georgia Tech student-developed external Canvas OAuth application

## Decision

### Process-only email

**Ready after minor edits.**

CanvasSync can responsibly ask Georgia Tech:

- whether a student-developed external OAuth REST app is permitted;
- whether a streamlined development/pilot path exists;
- whether a sponsor or data owner is required;
- whether the published LTI process applies;
- what is required before GT will issue a test-only Developer Key.

That first contact does not require a completed production deployment or a
production-ready app, provided the email clearly describes worktree controls as
under development and does not claim that they are already live.

### Current email plus proposed attachments and public links

**Not ready to send unchanged.**

The draft package creates an avoidable factual mismatch between:

1. the corrected local worktree;
2. the pushed GitHub branch;
3. the live Vercel frontend;
4. the live Cloud Run revision; and
5. the current Supabase schema.

An initial reviewer following the links would see policies and controls that
contradict the attached draft.

## Readiness summary

| Area | First-inquiry status | Assessment |
| --- | --- | --- |
| Correct local decision-maker | Ready | Digital Learning / GT local Canvas administration is correctly identified |
| Student-developed framing | Ready | Independent, non-endorsed wording is accurate |
| Non-LTI distinction | Ready | Correctly asks whether the LTI process applies rather than asserting it |
| OAuth architecture | Ready for discussion | Authorization-code, encrypted server-side token, scoped read-only design is credible |
| Scope request | Ready for discussion | Scope list maps to observed Canvas calls |
| GT OAuth proof | Pending by design | A development key is needed before it can be tested |
| DeepInfra route | Ready for disclosure | Dedicated key stored; exact synchronous model call tested |
| Public Terms/Privacy links | Blocker | Live bundle contains superseded contact and legal wording |
| Supabase consent/session schema | Blocker for attached technical claims | Migration 010 is awaiting final execution confirmation |
| CSRF/deletion fixes | Blocker for â€œliveâ€ claims | Implemented locally, not deployed |
| GitHub/source link | Blocker if shared | Remote branch remains at pre-remediation commit |
| Staging callback | Blocker for immediate key issuance | No exact separate staging URI is supplied |
| Post-remediation audit attachment | Blocker | Proposed attachment has not yet been produced |
| Redis/shared endpoint limiting | Disclosure, not inquiry blocker | Current process-local limitation is stated in the submission |

## Verified current state

### Worktree

The local worktree contains:

- origin plus custom-header CSRF protection;
- stricter deletion/storage cleanup;
- Canvas-revocation result checking;
- direct DeepInfra-only credential validation;
- updated Terms, Privacy, consent, and contact email;
- migration 010 for consent/session columns, RLS policies, indexes, and telemetry
  table removal;
- revised outreach and approval documents;
- an expanded deployment verification harness.

Tests performed:

- frontend: two suites, three tests passed;
- production frontend build: passed with existing lint warnings;
- Python compilation: passed;
- direct DeepInfra application call: passed with
  `Qwen/Qwen3-235B-A22B-Instruct-2507`;
- local CSRF behavior test: untrusted/missing-header requests returned 403 and a
  trusted request with the custom header succeeded.

### GitHub

The remote branch and draft PR still point to:

`c4014a34d580c8223c29e451bc15d0840d05ded3`

The current remediation is uncommitted and unpushed. A reviewer cannot verify
the new controls from the repository.

### Vercel

The live bundle is still:

`/static/js/main.1c266645.js`

It contains:

- `canvassync@gatech.edu`, not `pablo3@gatech.edu`;
- the old continued-use acceptance clause;
- the overbroad â€œYou and Georgia Tech retain ownershipâ€ wording;
- stale â€œAI usage metadataâ€ deletion text;
- no `X-CanvasSync-CSRF` client behavior;
- no updated ZDR-by-default disclosure.

Therefore the public `/terms` and `/privacy` links should not be included in the
first inquiry until the frontend is deployed.

### Cloud Run

The live backend remains revision:

`canvas-organizer-backend-00114-jxx`

Current facts:

- OAuth fails closed with HTTP 503 because GT credentials are placeholders;
- AI is disabled;
- the DeepInfra secret is not attached to this existing revision;
- CSRF changes are not deployed;
- consent version remains `2026-06-19`;
- Flask-Limiter uses `memory://`;
- maximum scale is 20 instances;
- the public demo is enabled.

The backend is safe enough to remain online while OAuth is unavailable, but it
must not be described as running the new remediation.

### Supabase

- All deprecated/demo application rows were cleared.
- `legal_consent_at`, `legal_consent_version`, and `session_version` are still
  absent.
- The obsolete `ai_usage_logs` table still exists and is empty.
- Migration 010 is entered in the Supabase SQL editor.
- Supabase is waiting for final confirmation because the migration drops the
  empty telemetry table.

### DeepInfra

- A dedicated DeepInfra key is stored in Google Secret Manager.
- Direct synchronous inference was tested successfully.
- The returned model was exactly
  `Qwen/Qwen3-235B-A22B-Instruct-2507`.
- DeepInfra describes ordinary synchronous inference as ZDR by default, with a
  limited debugging/security logging exception.
- No separate special ZDR URL was identified; the ordinary synchronous API is
  the documented ZDR-by-default path.

## Inquiry blockers

### I-1 â€” The public links contradict the draft

The outreach draft proposes attaching the public Terms and Privacy URLs.
Those pages are live but still reflect the old deployment.

**Resolution:** Deploy the corrected frontend before including the links, or
remove the links and say that revised policies are attached as drafts.

### I-2 â€” The source is not available in the stated form

The corrected source and documents are local only.

**Resolution:** Commit and push the intended inquiry state before sharing the
repository or PR. Preserve unrelated local benchmark files outside the commit.

### I-3 â€” The submission describes controls as current without consistently
distinguishing worktree from production

`docs/OIT_SUBMISSION.md` says the architecture has CSRF-protected mutations,
versioned consent, RLS, and retry-safe deletion. These exist in the worktree,
but the production site does not have all of them.

**Resolution:** Either deploy and verify them, or add an explicit status box:

> â€œThe following controls are implemented in the review branch and awaiting
> deployment; the public pilot remains disabled because OAuth credentials have
> not been issued.â€

### I-4 â€” No exact staging callback exists

The email asks GT to issue a test key configured with a staging callback but
does not provide an exact URI. Canvas Developer Keys require configured redirect
URIs.

**Resolution options:**

1. For the first email, ask only for process guidance and whether a test key is
   available; provide the callback after GT answers.
2. Provision a separate staging backend/frontend and include its exact callback.

Option 1 is recommended for the first inquiry.

### I-5 â€” The listed â€œlatest post-remediation auditâ€ does not exist

Existing dated audits are historical or pre-remediation.

**Resolution:** Remove that attachment from the first inquiry, or produce a
post-deployment verification/audit after migration and deployment.

## Items that do not block the first inquiry

- No GT OAuth credential: this is the subject of the inquiry.
- No real OAuth round trip: impossible before the development key.
- AI disabled in production: acceptable and strategically useful.
- GT has not decided whether DeepInfra is acceptable: ask explicitly.
- No shared Redis Flask-Limiter backend: disclose it; GT can state whether it is
  required before a development key or pilot.
- Dependency/build warnings: relevant to later hardening, not to asking which
  local process applies.
- No global Instructure certification: not applicable to the current non-LTI
  architecture.

## Recommended first inquiry

Send a short process inquiry, not the full approval packet.

Recommended contents:

1. Identify yourself as a Georgia Tech student developer.
2. State that CanvasSync is independent and non-endorsed.
3. Explain that it is an external, non-LTI OAuth REST app.
4. Ask whether GT permits this model and whether a streamlined student path
   exists.
5. Ask whether a sponsor/data owner is required.
6. Ask whether a test-only Developer Key can be issued after providing an exact
   staging callback.
7. Ask whether AI review can be handled separately, with AI disabled during
   initial OAuth testing.
8. Offer the detailed scope/data/security package on request.

Do not yet include:

- the current public Terms/Privacy URLs;
- the GitHub branch or PR;
- a request to provision the key immediately;
- the nonexistent post-remediation audit;
- statements that the remediated controls are already deployed.

## Minimum work before sending the short inquiry

Only one document edit is required:

- revise `docs/GT_OIT_OUTREACH.md` so it is process-only and removes the current
  public links and immediate key-configuration request.

The database migration, deployment, Git push, and post-deployment audit may
follow while waiting for GT's answer.

## Minimum work before sending the full technical package

1. Confirm and run Supabase migration 010.
2. Verify columns, RLS policies, indexes, and telemetry-table removal.
3. Deploy Cloud Run with the new source.
4. Deploy the Vercel frontend.
5. Run the updated deployment verifier.
6. Confirm live Terms, Privacy, email, consent version, CSRF behavior, deleted
   endpoints, and DeepInfra mode.
7. Commit and push the reviewed source/documents.
8. Produce a new post-remediation audit.
9. Provision a separate staging environment and callback if GT is ready to issue
   a development key.

## Final recommendation

**Send/no-send decision today:**

- **Send:** a shortened process-only inquiry after editing the email.
- **Do not send:** the current attachment list or public links.

Readiness estimates:

- process-only inquiry: **90% ready**;
- current inquiry exactly as drafted: **55% ready**;
- full development-key technical package: **65% ready**;
- real-user pilot: **not ready**.
