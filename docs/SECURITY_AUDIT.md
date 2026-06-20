# CanvasSync Security Review

**Updated:** June 20, 2026
**Scope:** Current source, Vercel frontend, Google Cloud Run backend/job, and
Supabase production project
**Contact:** `pablo3@gatech.edu`

CanvasSync is an independent Georgia Tech student-developed application. This
document records technical controls; it does not claim Georgia Tech approval.

## Current controls

- Canvas OAuth authorization-code flow; no production personal-token entry.
- Signed and expiring OAuth state; PKCE implemented pending GT Canvas testing.
- Canvas access and refresh tokens remain server-side and are Fernet-encrypted.
- Secure, HttpOnly application-session cookie with server-side session version.
- Origin allowlist plus `X-CanvasSync-CSRF` on unsafe cookie-authenticated
  requests.
- Strict production CORS and response security headers.
- Canvas/file SSRF defenses and pagination-host validation.
- Raw Canvas JSON disabled in production.
- Supabase browser roles denied by both object grants and RLS; backend service
  role only.
- Database-backed per-user sync spacing/hourly controls.
- Private daily retention job with 180-day stale-content windows.
- Export, disconnect, and deletion controls; deletion verifies private-storage
  cleanup before removing the user row.
- Direct DeepInfra only, exact endpoint and exact model enforced lazily in every
  environment; no alternate provider/model fallback.
- No application AI prompt/completion telemetry endpoint or active write path.

## Open limitations

| Item | Current treatment |
| --- | --- |
| Georgia Tech OAuth credentials | Placeholder secrets; OAuth fails closed |
| Real OAuth/refresh/revoke proof | Requires a GT development key |
| PKCE compatibility | Must be verified against GT Canvas |
| Flask endpoint limits | Process-local `memory://`; Cloud Run held to one max instance |
| Shared Redis | Required before increasing service instances or claiming distributed endpoint limits |
| Browser-only cache on other devices | Cannot refresh after session invalidation; clears when the app is reopened unauthenticated, on sign-out, or when site data is cleared |
| Dependency modernization | CRA dependency tree still has non-critical audit findings; migrate to a maintained build tool before broad launch |
| DNS rebinding defense | Host allowlisting exists; outbound IP pinning is deferred |

## Required acceptance tests after each deploy

1. Health and security headers pass.
2. Anonymous access to authenticated/ingestion endpoints is rejected.
3. Trusted-origin CORS succeeds and unknown origins fail.
4. Unsafe cookie request without the custom CSRF header returns `403
   csrf_failed`.
5. Supabase `anon` and `authenticated` roles cannot read/write application
   tables.
6. Retention job uses the same backend image and its latest scheduled execution
   succeeds.
7. Public Terms, Privacy, consent version, provider/model, contact email, and
   frontend API target match the deployed backend.
8. OAuth, refresh, disconnect, and deletion are manually tested after GT issues
   a development key.

## Launch gate

This security posture is suitable for a process inquiry and a request for a
test-only Developer Key. It is not evidence of a completed real-user pilot.
Georgia Tech must still decide the local review path, key configuration, AI
conditions, sponsorship, and production approval.
