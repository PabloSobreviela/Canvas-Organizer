# OpenRouter privacy — CanvasSync AI pipeline

CanvasSync uses **OpenRouter** as the LLM API for due-date extraction. AI is a **core** product feature.

**References:**
- [OpenRouter — Data collection](https://openrouter.ai/docs/guides/privacy/data-collection)
- [OpenRouter — Zero Data Retention (ZDR)](https://openrouter.ai/docs/guides/features/zdr)
- [OpenRouter — Privacy policy](https://openrouter.ai/privacy)

---

## Account configuration (verified)

| Control | CanvasSync setting |
|---------|-------------------|
| Private Input & Output Logging | **OFF** |
| Use inputs/outputs to improve OpenRouter | **OFF** |
| Per-request ZDR routing | **ON** (`OPENROUTER_ENFORCE_ZDR=true` in code) |

OpenRouter states that prompts and completions are **not stored** unless logging is explicitly enabled. Metadata (token counts, latency) is retained for billing.

---

## What we send

| Included | Excluded |
|----------|----------|
| Course code, assignment titles/dates | Student name, email, Canvas user id |
| Truncated syllabus/module text | Grades, submissions |
| Short announcement excerpts | Session JWT |

Before each API call, `backend/ai/prompt_sanitizer.py` redacts emails, phone numbers, and common ID patterns.

**Limitation:** Content anonymity is **not fully guaranteed**. Course documents may still contain names or other identifying text after redaction.

---

## Code enforcement

| Mechanism | Location |
|-----------|----------|
| ZDR per request | `backend/ai/llm_model.py` — `extra_body.provider.zdr = true` |
| Prompt sanitization | `backend/ai/prompt_sanitizer.py` |
| No prompt/response DB logs | `AI_LOG_MAX_PROMPT_CHARS=0` |
| Legal consent before AI | `POST /api/user/legal-consent`, gate on `/api/resolve_course_dates` |

---

## Action items (not in user-facing docs yet)

- [ ] Document and review secondary LLM fallback provider policy before enabling in production (`OPENROUTER_ALLOW_FALLBACK=false` by default).
- [ ] Screenshot OpenRouter privacy settings for OIT packet.
- [ ] Confirm production model on [ZDR endpoints list](https://openrouter.ai/api/v1/endpoints/zdr).

---

*Last updated: 2026-05-20*
