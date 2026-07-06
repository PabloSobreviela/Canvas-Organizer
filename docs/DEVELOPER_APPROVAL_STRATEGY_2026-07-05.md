# CanvasSync GT Approval Strategy — Developer Brief

**Prepared:** July 5, 2026  
**Owner/contact:** `pablo3@gatech.edu`  
**Status:** Ready to send first inquiry; not ready for real-user pilot or production key.

## Positioning

Use this exact positioning:

> CanvasSync is an independent Georgia Tech student-developed external web app. It is not an official, sponsored, or endorsed Georgia Tech or Instructure service. It requests local Georgia Tech Canvas OAuth access through a Developer Key for a student's own authorized Canvas data.

Do not lead with “vendor,” “outside app,” “production pilot,” “official GT app,” or “LTI tool.” If GT classifies it as a third-party/vendor-style review because it uses Vercel, Google Cloud, Supabase, or DeepInfra, accept that path, but do not start there.

## Who to write to

Primary first contact:

- Georgia Tech Digital Learning's Canvas "Request Help" ServiceNow route:
  `https://gatech.service-now.com/continuity?id=sc_cat_item&sys_id=cb9a617fdbd30810391b9837db9619ad`
- Fallback: submit a general OIT ticket or email `support@oit.gatech.edu`, asking routing to Digital Learning / Canvas administration.

Why: Digital Learning's public Canvas contact page still lists `canvas@gatech.edu`, but it also provides the "Request Help" ServiceNow route. If the mailbox does not resolve in your mail client, use the ticket route as the primary channel.

Do not initially CC Security, Legal, Procurement, or Instructure. Ask Digital Learning to route the request. If routed:

- AI/vendor/security review: likely GT Cybersecurity / third-party review.
- HECVAT/security materials: `compliance@security.gatech.edu` is listed in GT’s Services Security Checklist.
- Actual incident report only: `soc@gatech.edu`.

## Approval strategy

1. Submit a process-first Digital Learning / Canvas ticket through ServiceNow.
2. Ask whether GT permits a student-developed, non-LTI external OAuth REST app.
3. Ask whether a streamlined student-development or limited-development path exists.
4. Separate OAuth approval from AI approval. Default position: AI can stay disabled for GT Canvas data until GT approves it.
5. Ask for a test-only/development Developer Key before any production key.
6. Provide the full technical package only after GT confirms the path or asks for it.
7. After test key issuance, run the staging OAuth/security evidence plan.
8. Request a limited pilot only after tests pass and GT answers the AI/sponsor/accessibility conditions.

## Current readiness

Ready:

- Public Terms/Privacy/consent match current runtime claims.
- Vercel production deployment `dpl_39Tr1EEwzoCkKsCTB59SkSd8o5An` is live on `https://canvas-organizer.vercel.app`.
- Runtime is Vercel frontend + Google Cloud Run backend + Supabase + direct DeepInfra.
- OpenRouter is not active runtime.
- `canvassync.app` is future/inactive and not used for callbacks, CORS, or policy links.
- OAuth fails closed until GT issues credentials.
- Canvas tokens are designed to be encrypted server-side, not stored in browser storage.
- CSRF/CORS/auth checks pass live backend verification.
- Supabase RLS/grants deny browser-role direct table access; backend uses service role.
- Retention/export/disconnect/delete controls exist.

Not ready:

- No GT Developer Key.
- No real GT OAuth/refresh/revoke/PKCE test.
- No GT decision on DeepInfra.
- No GT-confirmed staging callback.
- No faculty/staff sponsor or data owner if GT requires one.
- No accessibility artifact if GT requires one.
- No shared Redis rate limit backend for multi-instance/general launch.
- CRA dependency modernization remains before broad launch.

## Website wording posture

Public language should say:

- “independent Georgia Tech student-developed”
- “not official, sponsored, or endorsed”
- “student preview” before approval
- “Canvas-provided dates,” not “official Canvas dates”
- “AI-assisted dates are reviewable and must be verified in Canvas”

Avoid:

- “GT-approved”
- “OIT pilot”
- “production ready”
- “official Canvas app”
- “zero risk”
- “anonymous course text”
- “DeepInfra approved by GT”
- “ZDR with no exceptions”

## Package to send

Send first:

- Email body from `docs/GT_OIT_COMPLIANCE_REQUEST_2026-07-05.md`
- Public Terms: `https://canvas-organizer.vercel.app/terms`
- Public Privacy: `https://canvas-organizer.vercel.app/privacy`

Offer if requested:

- `docs/GT_OIT_COMPLIANCE_REQUEST_2026-07-05.md`
- `docs/OIT_SUBMISSION.md`
- `docs/GT_CANVAS_OAUTH_COMPLIANCE_AND_APPROVAL_MAP_2026-06-20.md`
- `docs/POST_RECONCILIATION_AUDIT_2026-06-20.md`
- `docs/verification/verify_deploy_results.json`

Do not attach historical audit files unless GT asks for remediation history. They include retired facts and are intentionally marked historical in `docs/README.md`.

## Projected timeline

These are planning estimates, not GT commitments.

| Stage | Best case | If routed to security/vendor/AI review |
| --- | ---: | ---: |
| First Digital Learning response | 1–5 business days | 1–2 weeks |
| Process/sponsor decision | 1 week | 2–4 weeks |
| Test-only Developer Key | 1–2 weeks after requested details | 3–8 weeks |
| Staging OAuth/security tests | 1–3 days after key | 1 week if scope issues |
| AI decision | parallel, 1–2 weeks | 4–10+ weeks if HECVAT/vendor review |
| Limited pilot approval | 1–3 weeks after evidence | 1–2 academic terms if formal review |

Practical expectation: OAuth-only development access is the fastest path. AI with course text is the approval risk.

## Hard line for compliance

Do not allow real GT Canvas users to sync until:

1. GT issues a development key.
2. The exact callback/scopes are tested.
3. OAuth refresh/revoke/logout are verified.
4. GT answers whether AI can process Canvas-derived course text.
5. Public policies still match the runtime.

## Final recommendation

Send a short process request now. Keep the ask narrow: local student-developed external OAuth REST app, test-only key, AI reviewed separately. This gives GT a low-friction way to say which path applies without forcing a production/security/procurement decision in the first email.
