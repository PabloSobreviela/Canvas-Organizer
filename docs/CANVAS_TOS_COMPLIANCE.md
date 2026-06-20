# Canvas OAuth and API Policy Alignment

**Updated:** June 20, 2026

References:

- https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth
- https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth_endpoints
- https://developerdocs.instructure.com/services/canvas/resources/developer_keys
- https://www.instructure.com/policies/canvas-api-policy

## Current status

| Area | Status |
| --- | --- |
| Multi-user OAuth design | Implemented; GT credentials and E2E proof pending |
| Manual PAT solicitation | Disabled in production |
| Tokens in URLs | Removed |
| Token encryption | Implemented |
| Refresh | Implemented; real GT test pending |
| Local credential removal | Implemented |
| Remote revocation | Attempted and HTTP success checked; real GT test pending |
| Scoped read-only access | Implemented; GT scope approval pending |
| Consent/re-consent | Implemented; migration 010 verified in production |
| API minimization/retention | Implemented |
| AI disclosure/labels | Implemented; institutional/path decision pending |
| Developer Key | Not issued |

## Policy mapping

- Multi-user users are directed through OAuth; the app does not ask them to
  generate personal access tokens.
- OAuth and app-session tokens are not placed in redirect URLs.
- Canvas access/refresh tokens are encrypted and remain on the backend.
- The requested scopes are read-only and correspond to observed API calls.
- Canvas-derived content, full announcement messages, extracted course text,
  and AI processing are disclosed before ingestion.
- Materially more permissive data-practice changes require a new consent
  version rather than relying only on continued use.
- AI-generated/assisted dates are labeled and users are told to verify Canvas.
- The app claims no ownership of Customer/User/rightsholder content.
- Raw payload persistence is disabled and stale active content is purged.
- Rate-conscious sync controls exist; general endpoint limits are not described
  as distributed while using `memory://`.

## Remaining external dependencies

- GT must identify the applicable student-development review path.
- A Georgia Tech local Canvas root-account administrator must issue and
  configure the Developer Key. This is not a request for global Instructure
  certification or partner approval.
- Exact scopes, includes, callback, test environment, and pilot conditions must
  be approved.
- OAuth, refresh, revoke, PKCE, and error behavior require a real GT Canvas test.
- DeepInfra's synchronous inference path is documented by the provider as ZDR by
  default, with a reserved debugging/security exception. GT's local Canvas
  administrators still decide whether that data flow is acceptable when issuing
  the key.
