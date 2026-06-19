# OpenRouter / DeepInfra Privacy - CanvasSync AI Pipeline

CanvasSync uses **OpenRouter** as the API gateway and routes inference to
**DeepInfra** with per-request Zero Data Retention (ZDR) required. AI date
extraction is a core product feature.

**References:**
- [OpenRouter - Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- [OpenRouter - Zero Data Retention (ZDR)](https://openrouter.ai/docs/guides/features/zdr)
- [DeepInfra - Data privacy](https://docs.deepinfra.com/account/data-privacy)

---

## Account And Request Configuration

| Control | CanvasSync setting |
|---------|-------------------|
| Private Input & Output Logging | **OFF** |
| Use inputs/outputs to improve OpenRouter | **OFF** |
| Per-request ZDR routing | **ON** (`OPENROUTER_ENFORCE_ZDR=true`) |
| Provider data collection | **DENIED** (`OPENROUTER_DENY_DATA_COLLECTION=true`) |
| Provider pin | **DeepInfra only** (`OPENROUTER_PROVIDER_ONLY=deepinfra`) |
| Automatic fallback | **OFF** (`OPENROUTER_ALLOW_FALLBACK=false`) |
| Disclosed providers | **OpenRouter, DeepInfra** (`DISCLOSED_AI_PROVIDERS=openrouter,deepinfra`) |

OpenRouter documents that `provider.zdr=true` restricts routing to endpoints with
a Zero Data Retention policy, `provider.data_collection="deny"` restricts routing
to providers that do not collect user data, and `provider.only=["deepinfra"]`
allows only DeepInfra endpoints. With provider fallback disabled, requests should
fail instead of routing to another provider if the pinned DeepInfra ZDR route is
unavailable. Metadata such as token counts and latency may still be retained for
billing and operations.

---

## What We Send

| Included | Not intentionally included |
|----------|----------------------------|
| Course code, assignment titles/dates | Student name, email, Canvas user id |
| Truncated syllabus/module text after best-effort redaction | Grades, submissions |
| Short announcement excerpts | Session JWT |

Before each API call, `backend/ai/prompt_sanitizer.py` applies **best-effort**
regex redaction for obvious identifiers such as emails, phone-like patterns,
common ID formats, and token-like values. This is **not** a guarantee that all
PII is removed or that the prompt is anonymous. Syllabi, announcements, and
files may still contain instructor names, student names, office hours, locations,
or other identifying text.

---

## Code Enforcement

| Mechanism | Location |
|-----------|----------|
| ZDR per request | `backend/ai/llm_model.py` (`provider["zdr"] = True`) |
| Provider data collection denied | `backend/ai/llm_model.py` (`provider["data_collection"] = "deny"`) |
| DeepInfra-only routing | `OPENROUTER_PROVIDER_ONLY=deepinfra` |
| Disclosed provider allowlist | `DISCLOSED_AI_PROVIDERS` |
| Prompt sanitization | `backend/ai/prompt_sanitizer.py` |
| No prompt/response DB logs | `AI_LOG_MAX_PROMPT_CHARS=0`, `AI_LOG_MAX_RESPONSE_CHARS=0` |
| Legal consent before ingestion | `@require_consent` on sync + resolve endpoints |

---

## OIT Packet Checklist

- [ ] Screenshot OpenRouter privacy settings (I/O logging off)
- [ ] Confirm production model appears on OpenRouter's ZDR endpoint list
- [ ] Attach this document and `docs/OIT_SUBMISSION.md` section 6

*Last updated: 2026-06-16*
