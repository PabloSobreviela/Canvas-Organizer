# Georgia Tech Digital Learning Outreach

**Status:** Draft — not yet sent
**Recipient:** `canvas@gatech.edu`
**Project contact:** `pablo3@gatech.edu`
**Prepared:** June 20, 2026

## Recommended first inquiry

**Subject:** Process guidance for a Georgia Tech student-developed external Canvas OAuth app

Hello Digital Learning Team,

I am a Georgia Tech student developing **CanvasSync**, an independent
student-productivity web application that consolidates a student's own Canvas
deadlines and authorized course scheduling information. It is not an official,
sponsored, or endorsed Georgia Tech or Instructure service.

CanvasSync is an external web app, not an LTI launch or Canvas placement. Its
proposed integration is a confidential OAuth2 authorization-code client using a
Developer Key issued in Georgia Tech's local Canvas root account. It requests
read-only access to the authorizing student's own course, assignment, file,
page, module, syllabus, and announcement data.

Before requesting credential provisioning, I would appreciate guidance on the
applicable local process:

1. Does Georgia Tech permit an independent student-developed external OAuth
   REST application to receive a local Canvas Developer Key?
2. Is there a streamlined student-development or limited-pilot path?
3. Does the published 2026 LTI vetting process apply to this non-LTI model?
4. Is a faculty/staff sponsor, department, data owner, or other institutional
   owner required?
5. What security, privacy, accessibility, support, brand, and continuity
   materials should be supplied?
6. If the model is permitted, may a separate test-only Developer Key be
   requested after I provide the exact staging callback and scope list?
7. May the optional AI data flow be reviewed separately, with AI disabled for
   GT Canvas-derived data during initial OAuth testing?

The current design keeps Canvas tokens encrypted and server-side, requires
versioned consent, provides export/disconnect/deletion controls, and uses
read-only scoped access. The optional AI route is direct to DeepInfra using
`Qwen/Qwen3-235B-A22B-Instruct-2507`; there is no OpenRouter or alternate
provider fallback.

I understand that this is a Georgia Tech local Canvas-administration decision.
I am not requesting global Instructure partner certification, a marketplace
listing, or production approval in this first inquiry.

I can provide the detailed architecture, data inventory, scope matrix, Terms,
Privacy Policy, security controls, and test plan in the format your team
prefers.

Thank you,

Georgia Tech student developer
`pablo3@gatech.edu`

## Materials to provide after GT identifies the path

- `docs/OIT_SUBMISSION.md`
- `docs/GT_CANVAS_OAUTH_COMPLIANCE_AND_APPROVAL_MAP_2026-06-20.md`
- `docs/POST_RECONCILIATION_AUDIT_2026-06-20.md`
- public Privacy Policy: `https://canvas-organizer.vercel.app/privacy`
- public Terms: `https://canvas-organizer.vercel.app/terms`
- exact staging callback and requested scopes

## Response log

| Field | Value |
| --- | --- |
| Date sent | Pending |
| Date received | Pending |
| Respondent | Pending |
| Approved review path | Pending |
| Student/sponsor requirements | Pending |
| Development-key decision | Pending |
| AI conditions | Pending |
| Production review conditions | Pending |
