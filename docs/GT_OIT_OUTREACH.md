# GT OIT / Digital Learning — Canvas Developer Key Outreach

**Status:** Pending response from GT Digital Learning (`canvas@gatech.edu`)
**Contact:** canvas@gatech.edu (Georgia Tech Digital Learning Team)
**Prepared:** 2026-06-06

---

## Decision required (S-0.1)

Before GT provisions a Canvas Developer Key, we need written confirmation on the integration path:

> CanvasSync's proposed initial integration model is a **GT App student-productivity feature backed by a Canvas OAuth2 REST API client using a Canvas Developer Key**. It is **not** initially designed as a Canvas-embedded LTI tool. The OAuth2 model is appropriate because CanvasSync operates *outside* Canvas and each student authorizes access to their own Canvas data. **LTI 1.3 should only become the primary path if GT requires CanvasSync to launch from within Canvas or appear in Canvas course/module/assignment placements.**
>
> **Question:** Can CanvasSync proceed as a GT App OAuth2 REST integration (root-account developer key), or must all new Canvas-connected student tools be routed through the LTI 1.3 vetting path (1EdTech certification, ≥3 months before course start)?

---

## GT response (record here when received)

| Field | Value |
| --- | --- |
| **Date received** | _pending_ |
| **Respondent / team** | _pending_ |
| **Approved path** | _OAuth2 REST / LTI 1.3 / other_ |
| **Conditions or scope limits** | _pending_ |
| **Timeline / next steps** | _pending_ |
| **Beta testing available?** | _gatech.beta.instructure.com key?_ |

---

## Email draft (copy and send to canvas@gatech.edu)

**Subject:** Canvas Developer Key request — CanvasSync (GT App, OAuth2 REST, read-only)

Hello Digital Learning Team,

I am a Georgia Tech student building **CanvasSync**, a student productivity web app that consolidates Canvas assignment due dates with AI-extracted deadlines from syllabi into one calendar view. The app is intended to surface through the **GT App** experience and runs **outside** Canvas (not an LTI launch).

**Integration model:** Canvas OAuth2 authorization-code flow with PKCE. Each student authorizes read-only access to their **own** Canvas data. We do not write to Canvas and do not access other users' data.

**Architecture:**
- Frontend: React SPA on Vercel (`https://canvassync.app`)
- Backend: Flask on Google Cloud Run
- Database: Supabase (Postgres + RLS, encrypted OAuth tokens)
- AI: OpenRouter → DeepInfra (zero-data-retention routing) for due-date extraction from course text

**Redirect URI (production):** `{YOUR_CLOUD_RUN_URL}/api/auth/canvas/callback`
**Canvas instance:** `https://gatech.instructure.com`

**Read-only scopes requested:**
- `url:GET|/api/v1/users/self`
- `url:GET|/api/v1/courses`
- `url:GET|/api/v1/courses/:course_id/assignments`
- `url:GET|/api/v1/courses/:course_id/files`
- `url:GET|/api/v1/courses/:course_id/modules`
- `url:GET|/api/v1/courses/:course_id/pages`
- `url:GET|/api/v1/announcements`

We request `require_scopes=true` and no write scopes on the developer key.

**Question:** GT's published LTI vetting process (Jan 2026) applies to new LTI integrations. CanvasSync is **not** an LTI tool — it is an external OAuth2 REST client. **Can we proceed with a root-account Canvas Developer Key for this model, or must all new Canvas-connected student tools use the LTI 1.3 path?**

Attached / linked documentation:
- `docs/OIT_SUBMISSION.md` — full submission package
- `docs/OIT_FULL_AUDIT_2026-06-06.md` — security and data-handling audit
- Privacy policy: `https://canvassync.app/privacy`

Thank you for your guidance.

---

## Attachments checklist

- [ ] `docs/OIT_SUBMISSION.md`
- [ ] `docs/OIT_FULL_AUDIT_2026-06-06.md`
- [ ] Architecture diagram (from README)
- [ ] OpenRouter privacy settings screenshot (account I/O logging off)
- [ ] `docs/verification/verify_deploy_results.json` (after staging deploy)
