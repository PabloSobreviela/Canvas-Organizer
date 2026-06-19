# CanvasSync — GT OIT Full-Stack Audit (2026-06-06)

Re-audit after remediation tracks R1–R12. This document records the post-implementation
state and remaining human/operational steps for GT submission.

## Executive summary

The OAuth core is **production-grade** (PKCE, signed state cookie, encrypted tokens,
refresh/revoke, HttpOnly cookies with server-side session revocation). The June 2026
implementation pass completed:

- **Track A:** GT outreach package (`docs/GT_OIT_OUTREACH.md`)
- **Track B:** Doc reconciliation (Vercel + Cloud Run); removed `firebase.js`
- **Track C:** Full data lifecycle — Storage purge on delete/retention; extended retention categories; sanitized export
- **Track D:** Cookie-only sessions; `session_version` invalidation on logout; OAuth fail-closed on credential persist failure
- **Track E:** Consent version enforcement; `/api/canvas/test` gated
- **Track F:** Ops runbook updates; CI verify workflow; `LLM_API_KEY` boot validation
- **Track G:** Explicit Canvas OAuth `scope` parameter; scope list in OIT submission

**Still requires humans:** GT path decision, developer key provisioning, migration 005 +
verify_deploy against live staging/prod.

## Submission readiness

| Item | Status |
|------|--------|
| OAuth (PKCE, cookies, encryption, refresh, revoke) | Ready |
| Session revocation (`session_version`) | Ready |
| Consent at ingestion + version check | Ready |
| Export / disconnect / delete (+ Storage) | Ready |
| Retention (all content categories) | Ready |
| Doc consistency | Ready |
| GT integration path confirmed | **Pending** (`docs/GT_OIT_OUTREACH.md`) |
| GT developer key | **Pending** |
| verify_deploy + OAuth E2E proof | **Pending** (blocked on key) |
| Migration 005 in prod | **Pending** (run before/after deploy) |

## Key artifacts

- Submission package: `docs/OIT_SUBMISSION.md`
- GT outreach: `docs/GT_OIT_OUTREACH.md`
- Prior audit + remediation log: `docs/OIT_READINESS_AUDIT.md`
- Deploy: `DEPLOY.md`, `deploy.ps1`
- Verification: `docs/PROD_VERIFICATION.md`, `backend/tools/verify_deploy.py`
- Results template: `docs/verification/README.md`

## Migrations to apply

1. `backend/migrations/008_session_version.sql` — session invalidation column
2. `python backend/migrations/005_repair_account_keys.py` — one-time account key repair (use `--dry-run` first)

See `docs/OPS_RUNBOOK.md` §5.
