# Canvas OAuth / API Terms Compliance

**Date:** 2026-05-20  
**References:**
- [Canvas OAuth2 Overview](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth)
- [Canvas API Policy](https://www.instructure.com/policies/canvas-api-policy)

---

## Summary

| Area | Status | Notes |
|------|--------|-------|
| OAuth for multi-user | **Compliant** (after fixes) | OAuth primary; PAT disabled in cloud prod |
| Token storage | **Compliant** | Server-side Fernet encryption |
| Tokens in URLs | **Fixed** | Session cookie; no JWT in redirect |
| Refresh tokens | **Fixed** | Auto-refresh before Canvas API calls |
| Revoke on logout | **Fixed** | `DELETE /login/oauth2/token` + DB wipe |
| Manual PAT UX | **Mitigated** | Off in prod; API rejects body tokens |
| Rate limits / scraping | **Improved** | Per-user limits; sync throttling helper |
| Data retention | **Improved** | TTL cleanup endpoint + policy doc |
| GT developer key | **OK** | `gatech.instructure.com` when key registered |

---

## Instructure requirements (mapped)

### Must use OAuth for multi-user apps

> Applications in use by multiple users MUST use OAuth to obtain tokens.

**Before:** OAuth primary, but manual PAT path and body-token fallback existed.  
**After:** Cloud mode rejects client-supplied tokens; `REACT_APP_ENABLE_MANUAL_TOKEN_CONNECT` must stay unset in production.

### Do not pass tokens in URLs

> Don't pass tokens or session IDs around in URLs.

**Before:** App session JWT in `#token=` fragment.  
**After:** OAuth callback sets HttpOnly cookie on API domain; redirect to frontend without secrets.

### Store tokens securely

> Tokens should be stored and used in a secure manner… Properly secure the database.

**Implementation:** `CANVAS_TOKEN_ENCRYPTION_KEY` + Fernet (`enc:v1:` prefix) in `backend/db_supabase.py`.

### Manual token generation is for testing only

> Asking any other user to manually generate a token and enter it is a **violation of Canvas API Policy**.

**Action:** Remove PAT UI from production builds; document dev-only testing via Canvas profile page for single-developer use.

### Token expiration and refresh

> Developer keys after Oct 2015: tokens expire in 1 hour; use refresh tokens.

**Before:** Refresh tokens stored but never used before sync.  
**After:** `backend/canvas_token_service.py` refreshes when `canvas_token_expires_at` is near/past.

### Revoke on logout

Canvas documents `DELETE /login/oauth2/token`.

**After:** Logout handler revokes at Canvas and clears encrypted credentials in Supabase.

---

## Compliance matrix

| ID | Requirement | Implementation |
|----|-------------|----------------|
| T1 | OAuth required | `/api/auth/canvas/login` + callback |
| T2 | No URL tokens | Cookie session |
| T3 | Secure storage | Fernet + service role DB access |
| T4 | Refresh rotation | `refresh_canvas_access_token()` |
| T5 | Revoke on logout | `revoke_canvas_tokens()` |
| T6 | Acceptable API use | Hourly rate limits; sync spacing env |
| T7 | Data minimization | Retention cleanup API; privacy doc |
| T8 | Transparency | `docs/INSTITUTIONAL_COMPLIANCE.md` |
| T9 | Registered dev key | GT instance URL in env |

---

## GT-first posture

- Default instance: `https://gatech.instructure.com`
- Timezone default: `America/New_York` (configurable)
- Institutional approval for AI processing of syllabus content remains an **organizational** step outside this codebase

---

## Ongoing obligations

1. Register and maintain Canvas developer key with GT.
2. Publish privacy policy covering stored syllabus/announcement text and AI processing.
3. Monitor Canvas API rate limit headers; backoff on 429.
4. Respond to user data deletion requests via `/api/user/delete-data`.
