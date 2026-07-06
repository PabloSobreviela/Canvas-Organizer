import os
import json
import re
import pytz
from datetime import datetime

# Direct DeepInfra inference. No gateway or alternate-provider fallback exists.
APPROVED_DEEPINFRA_BASE_URL = "https://api.deepinfra.com/v1/openai"
APPROVED_DEEPINFRA_MODEL = "Qwen/Qwen3-235B-A22B-Instruct-2507"
LLM_BASE_URL = os.getenv("LLM_BASE_URL", APPROVED_DEEPINFRA_BASE_URL).rstrip("/")
MODEL_NAME = os.getenv("MODEL_NAME", APPROVED_DEEPINFRA_MODEL).strip()

# Requests fail rather than silently route to another provider or model.


def _env_bool(name: str, default: str) -> bool:
    return (os.getenv(name, default) or "").strip().lower() in ("1", "true", "yes", "on")


AI_DEBUG = _env_bool("AI_DEBUG", "")

# Deterministic structured-extraction settings (no max_tokens cap — use provider default).
AI_TEMPERATURE = float(os.getenv("AI_TEMPERATURE", "0.1"))
AI_TOP_P = float(os.getenv("AI_TOP_P", "0.9"))


_primary_client = None


def _clean_secret(value: str) -> str:
    """Strip whitespace and UTF-8 BOM often introduced by .env editors."""
    return (value or "").strip().strip("\ufeff").strip("\u200b")


def _resolve_llm_api_key() -> str:
    """Resolve only a dedicated direct DeepInfra credential."""
    value = _clean_secret(os.getenv("DEEPINFRA_API_KEY"))
    if not value or value in {"your-deepinfra-api-key", "your-api-key"}:
        return ""
    return value


LLM_API_KEY = _resolve_llm_api_key()


def _get_primary_client():
    """Lazily create an OpenAI-compatible client for direct DeepInfra inference."""
    global _primary_client
    if _primary_client is not None:
        return _primary_client

    from openai import OpenAI

    if not LLM_API_KEY:
        raise RuntimeError(
            "DEEPINFRA_API_KEY is not set. "
            "Configure a direct DeepInfra API key in Secret Manager."
        )
    if LLM_BASE_URL != APPROVED_DEEPINFRA_BASE_URL:
        raise RuntimeError(
            f"LLM_BASE_URL must be the approved direct DeepInfra endpoint: "
            f"{APPROVED_DEEPINFRA_BASE_URL}"
        )
    if MODEL_NAME != APPROVED_DEEPINFRA_MODEL:
        raise RuntimeError(
            f"MODEL_NAME must be the approved DeepInfra model: "
            f"{APPROVED_DEEPINFRA_MODEL}"
        )

    _primary_client = OpenAI(
        api_key=LLM_API_KEY,
        base_url=LLM_BASE_URL,
    )
    print(f"[OK] Direct DeepInfra client initialized (Model: {MODEL_NAME})")
    return _primary_client


def _response_to_text(response, target_model: str) -> str:
    choices = getattr(response, "choices", None) or []
    if not choices or not getattr(choices[0], "message", None):
        raise RuntimeError(
            f"LLM returned no choices (model={getattr(response, 'model', target_model)})."
        )
    return (choices[0].message.content or "").strip()


def _is_parseable_json(text: str) -> bool:
    try:
        _extract_first_json(text)
        return True
    except Exception:
        return False


def _call_llm(prompt: str, *, model: str = None, telemetry_context=None, operation: str = "unknown",
              expect_json: bool = True):
    """
    Send a chat-completion request directly to DeepInfra.

    If the response is not valid JSON, retry exactly once against the SAME
    model with stricter formatting instructions.
    """
    from openai import APIError, APIConnectionError, APITimeoutError, RateLimitError
    from ai.prompt_sanitizer import sanitize_text_for_llm
    import time

    client = _get_primary_client()
    target_model = model or MODEL_NAME
    if target_model != APPROVED_DEEPINFRA_MODEL:
        raise RuntimeError(
            f"AI model override rejected; only {APPROVED_DEEPINFRA_MODEL} is approved."
        )
    prompt = sanitize_text_for_llm(prompt)

    messages = [
        {"role": "system", "content": "You are an expert academic schedule extraction system. Respond with valid JSON only."},
        {"role": "user", "content": prompt},
    ]
    params = dict(
        model=target_model,
        messages=messages,
        temperature=AI_TEMPERATURE,
        top_p=AI_TOP_P,
        response_format={"type": "json_object"},
    )

    def _create(call_params):
        """One logical call with bounded retry on rate limits; no provider switch."""
        last_error = None
        for attempt in range(1, 4):
            try:
                return client.chat.completions.create(**call_params)
            except RateLimitError as e:
                last_error = e
                if attempt >= 3:
                    raise
                backoff = min(20.0, 2.0 * attempt)
                print(f"[WARN] LLM rate limited (attempt {attempt}/3); retrying in {backoff:.0f}s")
                time.sleep(backoff)
            except (APIError, APIConnectionError, APITimeoutError) as e:
                raise e
        if last_error is not None:
            raise last_error

    response = _create(params)
    raw_text = _response_to_text(response, target_model)

    json_retry = False
    if expect_json and not _is_parseable_json(raw_text):
        json_retry = True
        print("[WARN] LLM response was not valid JSON; retrying once with stricter instructions (same model/provider).")
        strict_params = dict(params)
        strict_params["messages"] = messages + [
            {"role": "assistant", "content": raw_text[:1000]},
            {"role": "user", "content": (
                "Your previous response was not valid JSON. Respond again with ONLY a single "
                "minified JSON object — no prose, no explanations, no markdown, no code fences. "
                "Start with '{' and end with '}'."
            )},
        ]
        response = _create(strict_params)
        raw_text = _response_to_text(response, target_model)

    return raw_text


def _extract_first_json(value: str):
    """
    Extract and parse the first valid JSON object/array from a model response.

    Models sometimes wrap JSON in prose or code fences; raw_decode lets us find
    the first parseable JSON payload without relying on brittle regexes.
    """
    text = (value or "").strip()
    if not text:
        raise ValueError("Empty model response.")

    if "```" in text:
        text = text.replace("```json", "").replace("```", "").strip()

    decoder = json.JSONDecoder()
    for i, ch in enumerate(text):
        if ch not in "{[":
            continue
        try:
            parsed, _end = decoder.raw_decode(text[i:])
            return parsed
        except Exception:
            continue
    raise ValueError("No valid JSON object/array found in response.")


def _normalize_name_for_dedupe(raw: str) -> str:
    """Normalize assignment name for duplicate detection (exam/test/quiz -> exam, etc)."""
    if not raw:
        return ""
    text = str(raw).strip().lower()
    text = re.sub(r"\b(quizzes?|tests?|midterms?|finals?|exams?)\b", " exam ", text)
    text = re.sub(r"\b(homeworks?|hws?|assignments?)\b", " assignment ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _discovered_matches_canvas_item(discovered_name: str, canvas_names: list) -> bool:
    """Return True if discovered item matches any Canvas item by name (avoids duplicates)."""
    dnorm = _normalize_name_for_dedupe(discovered_name)
    if not dnorm or len(dnorm) < 3:
        return False
    for cname in canvas_names or []:
        cnorm = _normalize_name_for_dedupe(cname)
        if not cnorm:
            continue
        if dnorm in cnorm or cnorm in dnorm:
            return True
        dwords = set(w for w in dnorm.split() if len(w) >= 2 and not w.isdigit())
        cwords = set(w for w in cnorm.split() if len(w) >= 2 and not w.isdigit())
        if dwords and cwords and len(dwords & cwords) / max(len(dwords | cwords), 1) >= 0.7:
            return True
    return False


def _normalize_text_for_prompt(value: str) -> str:
    """
    Normalize extracted text before sending it to the model.

    We keep content as-is (no summarization), but remove noisy form-feed markers and
    collapse excessive blank lines to reduce token waste.
    """
    text = value or ""
    text = re.sub(r"\f\d*", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def _clip_text_head_tail(text: str, max_chars: int, tail_fraction: float = 0.6) -> str:
    """
    Clip long text to max_chars using a head+tail strategy so end-of-document
    tables (common for syllabi) aren't dropped.
    """
    if max_chars is None or max_chars <= 0:
        return text or ""
    s = text or ""
    if len(s) <= max_chars:
        return s

    marker = "\n\n...[TRUNCATED]...\n\n"
    if max_chars <= len(marker) + 20:
        return s[:max_chars]

    tail_fraction = min(0.9, max(0.1, float(tail_fraction)))
    tail_chars = int((max_chars - len(marker)) * tail_fraction)
    head_chars = (max_chars - len(marker)) - tail_chars
    if head_chars < 10:
        head_chars = 10
        tail_chars = (max_chars - len(marker)) - head_chars
    return s[:head_chars] + marker + s[-tail_chars:]


def _file_priority_for_prompt(file_name: str, file_type: str) -> int:
    """
    Sort files so we include the most assignment-relevant materials first.
    Lower is higher priority.
    """
    t = (file_type or "").strip().lower()
    n = (file_name or "").strip().lower()

    if t == "syllabus" or "syllabus" in n:
        return 0
    if t == "schedule" or any(k in n for k in ("schedule", "calendar")):
        return 1
    if t == "front_page" or "front page" in n or "homepage" in n:
        return 2
    if t == "modules" or "module" in n:
        return 3
    return 9


def _build_files_payload_for_prompt(
    files: list,
    *,
    max_files: int,
    total_text_chars_budget: int,
    per_file_soft_cap_chars: int,
    per_file_min_chars: int,
    tail_fraction: float = 0.6,
) -> list:
    """
    Build a list of {file_name, file_type, text} dicts for the prompt.

    We avoid losing important content by:
    - prioritizing syllabus/schedule-like sources
    - budgeting total text across files (context-size based)
    - clipping with head+tail (keeps end-of-document due-date tables)
    """
    files = files or []
    max_files = int(max_files or 0)
    if max_files <= 0:
        return []

    total_text_chars_budget = int(total_text_chars_budget or 0)
    if total_text_chars_budget <= 0:
        total_text_chars_budget = 200_000

    per_file_soft_cap_chars = int(per_file_soft_cap_chars or 0)
    if per_file_soft_cap_chars <= 0:
        per_file_soft_cap_chars = total_text_chars_budget

    per_file_min_chars = int(per_file_min_chars or 0)
    if per_file_min_chars <= 0:
        per_file_min_chars = 4000

    prepared = []
    for f in files:
        if not isinstance(f, dict):
            continue
        name = f.get("file_name") or f.get("fileName") or ""
        ftype = f.get("file_type") or f.get("fileType") or ""
        text = f.get("extracted_text") or f.get("extractedText") or ""
        if not text:
            continue
        prepared.append({
            "file_name": str(name),
            "file_type": str(ftype),
            "text": _normalize_text_for_prompt(str(text)),
        })

    if not prepared:
        return []

    prepared.sort(
        key=lambda x: (
            _file_priority_for_prompt(x.get("file_name"), x.get("file_type")),
            -len(x.get("text") or ""),
        )
    )
    prepared = prepared[:max_files]

    n = len(prepared)
    if n <= 0:
        return []

    if per_file_min_chars * n > total_text_chars_budget:
        per_file_budget = max(1000, total_text_chars_budget // n)
    else:
        per_file_budget = max(per_file_min_chars, total_text_chars_budget // n)

    payload = []
    for item in prepared:
        text_budget = min(per_file_soft_cap_chars, per_file_budget)
        payload.append({
            "file_name": item.get("file_name", ""),
            "file_type": item.get("file_type", ""),
            "text": _clip_text_head_tail(item.get("text") or "", text_budget, tail_fraction=tail_fraction),
        })
    return payload


def resolve_assignment_dates_with_llm(
        assignments,
        announcements,
        files,
        course_timezone,
        confidence_threshold=0.85,
        discover_new_assignments=True,
        telemetry_context=None
):
    # --- STEP 1: UNIVERSAL TIMEZONE NORMALIZATION ---
    clean_assignments = []

    try:
        target_tz = pytz.timezone(course_timezone) if course_timezone else pytz.utc
    except pytz.UnknownTimeZoneError:
        target_tz = pytz.timezone("America/New_York")

    for a in assignments:
        a_clean = a.copy()

        raw_due = a.get("normalized_due_at") or a.get("original_due_at")

        if raw_due and isinstance(raw_due, str) and "T" in raw_due:
            try:
                dt_utc = datetime.fromisoformat(raw_due.replace("Z", "+00:00"))
                dt_local = dt_utc.astimezone(target_tz)
                a_clean["ai_ready_date"] = dt_local.strftime("%Y-%m-%d")
            except ValueError:
                a_clean["ai_ready_date"] = raw_due.split("T")[0]
        else:
            a_clean["ai_ready_date"] = "No Date"

        clean_assignments.append(a_clean)

    # --- STEP 2: PRE-PROCESS TEXT FILES ---
    for f in files:
        if "extracted_text" in f:
            raw = f["extracted_text"]
            clean = re.sub(r'\f\d*', '', raw)
            clean = re.sub(r'\n{3,}', '\n\n', clean)
            f["extracted_text"] = clean

    # --- STEP 3: THE PROMPT ---
    now_local = datetime.now(target_tz)
    today_str = now_local.strftime("%Y-%m-%d")
    tz_name = target_tz.zone if hasattr(target_tz, 'zone') else str(target_tz)
    
    max_files_for_prompt = int(os.getenv("AI_MAX_FILES_FOR_PROMPT", "12"))
    files_total_chars = int(os.getenv("AI_FILES_TOTAL_CHARS", "220000"))
    per_file_soft_cap_chars = int(os.getenv("AI_FILE_SOFT_CAP_CHARS", "50000"))
    per_file_min_chars = int(os.getenv("AI_FILE_MIN_CHARS", "4000"))
    max_announcement_chars = int(os.getenv("AI_MAX_ANNOUNCEMENT_CHARS", "1200"))

    files_payload = _build_files_payload_for_prompt(
        files,
        max_files=max_files_for_prompt,
        total_text_chars_budget=files_total_chars,
        per_file_soft_cap_chars=per_file_soft_cap_chars,
        per_file_min_chars=per_file_min_chars,
        tail_fraction=float(os.getenv("AI_FILE_TAIL_FRACTION", "0.65")),
    )

    canvas_json = json.dumps([{
        "cid": a["canvas_assignment_id"],
        "nam": a["name"],
        "due": a["ai_ready_date"],
    } for a in clean_assignments], ensure_ascii=False, separators=(",", ":"))

    materials_json = json.dumps({
        "announcements": [{
            "title": a.get("title"),
            "posted_at": a.get("posted_at"),
            "message": (a.get("message") or "")[:max_announcement_chars],
        } for a in (announcements[:5] if announcements else [])],
        "files": [{
            "file_name": f.get("file_name", ""),
            "file_type": f.get("file_type", ""),
            "text": (f.get("text", "") or ""),
        } for f in files_payload],
    }, ensure_ascii=False, separators=(",", ":"))

    full_prompt = f"""Extract assignment due dates with 100% date accuracy. Output minified JSON only.
ctx: today={today_str}; tz={tz_name}; Canvas dates already in local {tz_name}.

RULES:
1 COPY Canvas dates verbatim; never shift/modify them.
2 FILL every Canvas "No Date" item from the materials. Match by number across name variants: Quiz 1=Q1, "Webwork HW 03"=HW3=HW 3=Homework 3, Midterm 1=Exam 1. Search schedule tables. Convert written dates exactly ("Jan 20","January 20"->"2026-01-20"). Leave "No Date" ONLY if truly absent.
3 DISCOVER: add a materials-only item (no cid) ONLY if NO Canvas item matches it by name/number.
4 DEDUPE (strict): exactly one row per assignment. If a Canvas item matches, output ONLY its cid row; NEVER add a second cid-less row. "Exam 3"="Exam 3 Su24 Key"="Test 3"; "HW1"="HW 1"="Homework 1".
5 CATEGORY: EXAM=exam/midterm/final/test/quiz; ASSIGNMENT=homework/hw/lab/project. SKIP attendance/participation/lecture/reading/chapter/total.

EXAMPLE:
Canvas:[{{"cid":100,"nam":"HW1","due":"No Date"}},{{"cid":101,"nam":"Quiz 2","due":"No Date"}}] Materials:"HW1 due Jan 15. Quiz 2 Feb 12. Final Mar 20."
->{{"cc":"CS101","a":[{{"cid":100,"nam":"HW1","due":"2026-01-15","cat":"ASSIGNMENT"}},{{"cid":101,"nam":"Quiz 2","due":"2026-02-12","cat":"EXAM"}},{{"nam":"Final","due":"2026-03-20","cat":"EXAM"}}]}}

CANVAS:{canvas_json}
MATERIALS:{materials_json}

OUTPUT: minified JSON only (no spaces, no newlines, no prose), schema:
{{"cc":"CODE","a":[{{"cid":NUM_or_null,"nam":"NAME","due":"YYYY-MM-DD","cat":"EXAM|ASSIGNMENT"}}]}}
Every Canvas cid MUST appear exactly once. Every "due" MUST be exactly YYYY-MM-DD."""

    # --- STEP 4: CALL LLM ---
    raw_text = _call_llm(
        full_prompt,
        operation="resolve_assignment_dates",
        telemetry_context=telemetry_context,
    )

    try:
        parsed = _extract_first_json(raw_text)

        if isinstance(parsed, list):
            return {"cc": "UNK", "a": parsed}

        assign_list = parsed.get("a") or parsed.get("assignments") or []

        returned_cids = {str(r.get("cid")) for r in assign_list if isinstance(r, dict) and r.get("cid")}
        for a in clean_assignments:
            cid = a.get("canvas_assignment_id")
            if not cid or str(cid) in returned_cids:
                continue
            assign_list.append({
                "cid": cid,
                "nam": a.get("name"),
                "due": a.get("ai_ready_date") or "No Date",
                "cat": "EXAM" if "quiz" in str(a.get("name") or "").lower() or "exam" in str(a.get("name") or "").lower() else "ASSIGNMENT",
            })

        canvas_names = [str(a.get("name") or a.get("nam") or "").strip() for a in clean_assignments if a.get("name") or a.get("nam")]

        # --- FINAL CLEANUP ---
        final_list = []
        for r in assign_list:
            if not isinstance(r, dict): continue

            cat = (r.get("cat") or "").upper()
            nam = (r.get("nam") or "").upper()
            if cat == "NON_SCHEDULED": continue
            if cat in ("LECTURE", "READING", "ATTENDANCE"): continue
            if "ATTENDANCE" in nam or "TOTAL" in nam or "COMPONENT" in nam: continue
            if "LECTURE" in nam or "READING" in nam or "CHAPTER" in nam: continue
            
            if cat == "QUIZ":
                r["cat"] = "EXAM"

            due = r.get("due") or r.get("normalized_due_at")
            
            if due and isinstance(due, str):
                if "T" in due:
                    due = due.split("T")[0]
                r["due"] = due

            if r.get("cid"):
                r["st"] = "RESOLVED"
            else:
                r["st"] = "DISCOVERED"
                if canvas_names and _discovered_matches_canvas_item(
                    r.get("nam") or r.get("name") or "", canvas_names
                ):
                    continue

            final_list.append(r)

        parsed["a"] = final_list
        return parsed

    except Exception as e:
        detail = f"LLM JSON parse failed: {type(e).__name__}: {e}"
        if AI_DEBUG:
            detail += f"\nRaw output head: {raw_text[:400]}"
        else:
            detail += f"\nRaw output length: {len(raw_text)}"
        raise RuntimeError(detail)


def resync_assignment_dates_with_llm(
        existing_assignments,
        canvas_assignments,
        previous_files,
        new_files,
        announcements,
        course_timezone,
        confidence_threshold=0.85,
        discover_new_assignments=True,
        telemetry_context=None
):
    """
    RESYNC function: Conservative approach that preserves existing data unless
    there's clear evidence of change from new source files.
    
    Key differences from initial sync:
    1. Existing discovered items are preserved unless contradicted
    2. AI is shown both old and new files to understand what changed
    3. Only updates are made when new files provide clear different information
    """
    
    try:
        target_tz = pytz.timezone(course_timezone) if course_timezone else pytz.utc
    except pytz.UnknownTimeZoneError:
        target_tz = pytz.timezone("America/New_York")
    
    clean_canvas = []
    for a in canvas_assignments:
        a_clean = a.copy()
        raw_due = a.get("normalized_due_at") or a.get("original_due_at")
        
        if raw_due and isinstance(raw_due, str) and "T" in raw_due:
            try:
                dt_utc = datetime.fromisoformat(raw_due.replace("Z", "+00:00"))
                dt_local = dt_utc.astimezone(target_tz)
                a_clean["ai_ready_date"] = dt_local.strftime("%Y-%m-%d")
            except ValueError:
                a_clean["ai_ready_date"] = raw_due.split("T")[0]
        else:
            a_clean["ai_ready_date"] = "No Date"
        
        clean_canvas.append(a_clean)
    
    existing_resolved = []
    existing_discovered = []
    
    for a in existing_assignments:
        if a.get("canvas_assignment_id") or a.get("canvasAssignmentId"):
            continue
        
        raw_due = a.get("normalized_due_at") or a.get("normalizedDueAt") or a.get("due")
        status = a.get("status") or a.get("st") or ""
        
        ai_ready_date = "No Date"
        if raw_due and isinstance(raw_due, str):
            if "T" in raw_due:
                try:
                    dt_utc = datetime.fromisoformat(raw_due.replace("Z", "+00:00"))
                    dt_local = dt_utc.astimezone(target_tz)
                    ai_ready_date = dt_local.strftime("%Y-%m-%d")
                except ValueError:
                    ai_ready_date = raw_due.split("T")[0]
            elif re.match(r'^\d{4}-\d{2}-\d{2}$', raw_due):
                ai_ready_date = raw_due
            else:
                ai_ready_date = raw_due
        
        item = {
            "nam": a.get("name") or a.get("nam"),
            "due": ai_ready_date,
            "cat": a.get("category") or a.get("cat"),
            "des": (a.get("description") or a.get("des") or "")[:600],
        }
        
        if status == "RESOLVED":
            item["st"] = "RESOLVED"
            existing_resolved.append(item)
        else:
            item["st"] = "DISCOVERED"
            existing_discovered.append(item)
    
    def clean_file_text(files):
        result = []
        for f in files or []:
            if not isinstance(f, dict):
                continue
            text = f.get("extracted_text") or f.get("extractedText") or ""
            result.append({
                "file_name": f.get("file_name") or f.get("fileName"),
                "file_type": f.get("file_type") or f.get("fileType"),
                "extracted_text": _normalize_text_for_prompt(str(text)),
            })
        return result
    
    prev_files_clean = clean_file_text(previous_files or [])
    new_files_clean = clean_file_text(new_files or [])
    
    now_local = datetime.now(target_tz)
    today_str = now_local.strftime("%Y-%m-%d")
    tz_name = target_tz.zone if hasattr(target_tz, 'zone') else str(target_tz)
    
    max_new_files_for_prompt = int(os.getenv("AI_RESYNC_MAX_NEW_FILES_FOR_PROMPT", "12"))
    max_prev_files_for_prompt = int(os.getenv("AI_RESYNC_MAX_PREV_FILES_FOR_PROMPT", "10"))
    new_files_total_chars = int(os.getenv("AI_RESYNC_NEW_FILES_TOTAL_CHARS", "180000"))
    prev_files_total_chars = int(os.getenv("AI_RESYNC_PREV_FILES_TOTAL_CHARS", "120000"))
    per_file_soft_cap_chars = int(os.getenv("AI_FILE_SOFT_CAP_CHARS", "50000"))
    per_file_min_chars = int(os.getenv("AI_FILE_MIN_CHARS", "4000"))
    max_announcement_chars = int(os.getenv("AI_MAX_ANNOUNCEMENT_CHARS", "1200"))

    allow_additions = bool(discover_new_assignments)

    prev_files_payload = _build_files_payload_for_prompt(
        prev_files_clean,
        max_files=max_prev_files_for_prompt,
        total_text_chars_budget=prev_files_total_chars,
        per_file_soft_cap_chars=per_file_soft_cap_chars,
        per_file_min_chars=per_file_min_chars,
        tail_fraction=float(os.getenv("AI_FILE_TAIL_FRACTION", "0.65")),
    )
    new_files_payload = _build_files_payload_for_prompt(
        new_files_clean,
        max_files=max_new_files_for_prompt,
        total_text_chars_budget=new_files_total_chars,
        per_file_soft_cap_chars=per_file_soft_cap_chars,
        per_file_min_chars=per_file_min_chars,
        tail_fraction=float(os.getenv("AI_FILE_TAIL_FRACTION", "0.65")),
    )

    canvas_json = json.dumps([{
        "cid": a["canvas_assignment_id"],
        "nam": a["name"],
        "due": a["ai_ready_date"],
    } for a in clean_canvas], ensure_ascii=False, separators=(",", ":"))

    existing_json = json.dumps(existing_discovered, ensure_ascii=False, separators=(",", ":"))

    prev_materials_json = json.dumps([{
        "file_name": item.get("file_name", ""),
        "file_type": item.get("file_type", ""),
        "text": (item.get("text", "") or ""),
    } for item in prev_files_payload], ensure_ascii=False, separators=(",", ":"))

    new_materials_json = json.dumps([{
        "file_name": item.get("file_name", ""),
        "file_type": item.get("file_type", ""),
        "text": (item.get("text", "") or ""),
    } for item in new_files_payload], ensure_ascii=False, separators=(",", ":"))

    announcements_json = json.dumps([{
        "title": a.get("title"),
        "posted_at": a.get("posted_at"),
        "message": (a.get("message") or "")[:max_announcement_chars],
    } for a in (announcements[:5] if announcements else [])], ensure_ascii=False, separators=(",", ":"))

    full_prompt = f"""RESYNC an existing assignment list with 100% date accuracy. Output minified JSON only.
ctx: today={today_str}; tz={tz_name}; dates already in local {tz_name}. allow_additions={str(allow_additions).lower()}.

RULES:
1 PRESERVE existing items unless new materials give clear contrary evidence. Canvas dates are authoritative; copy verbatim, never shift.
2 FILL every Canvas "No Date" item from materials. Match by number across name variants: Quiz 1=Q1, "Webwork HW 03"=HW3=Homework 3, Midterm 1=Exam 1. Search schedule tables. Convert written dates exactly ("Jan 20"->"2026-01-20").
3 ACTION per row: CANVAS=fresh Canvas item (has cid, authoritative); KEEP=existing discovered, unchanged; UPDATE=discovered whose date new materials clearly correct; ADD=new materials-only item. If allow_additions=false, NEVER output ADD. NEVER ADD an item matching a Canvas item ("Exam 3 Su24 Key"="Exam 3").
4 CATEGORY: EXAM=exam/midterm/final/test/quiz; ASSIGNMENT=homework/hw/lab/project. SKIP attendance/participation/lecture/reading/chapter/total.

EXAMPLE:
Canvas:[{{"cid":100,"nam":"HW1","due":"2026-01-15"}}] ExistingDiscovered:[{{"nam":"Midterm","due":"2026-02-10","cat":"EXAM"}}]
->{{"cc":"CS101","changes_summary":"Preserved existing","a":[{{"cid":100,"nam":"HW1","due":"2026-01-15","cat":"ASSIGNMENT","action":"CANVAS"}},{{"nam":"Midterm","due":"2026-02-10","cat":"EXAM","action":"KEEP"}}]}}

CANVAS:{canvas_json}
EXISTING_DISCOVERED:{existing_json}
MATERIALS_PREVIOUS:{prev_materials_json}
MATERIALS_NEW:{new_materials_json}
ANNOUNCEMENTS:{announcements_json}

OUTPUT: minified JSON only (no spaces, no newlines, no prose), schema:
{{"cc":"CODE","changes_summary":"BRIEF","a":[{{"cid":NUM_or_null,"nam":"NAME","due":"YYYY-MM-DD","cat":"EXAM|ASSIGNMENT","action":"CANVAS|KEEP|UPDATE|ADD"}}]}}
Every "due" MUST be exactly YYYY-MM-DD."""

    # --- STEP 4: CALL LLM ---
    raw_text = _call_llm(
        full_prompt,
        operation="resync_assignment_dates",
        telemetry_context=telemetry_context,
    )
    
    try:
        parsed = _extract_first_json(raw_text)

        if isinstance(parsed, list):
            return {"cc": "UNK", "a": parsed, "changes_summary": "Unknown"}
        
        assign_list = parsed.get("a") or parsed.get("assignments") or []
        changes_summary = parsed.get("changes_summary", "No summary provided")
        canvas_names_resync = [str(a.get("name") or a.get("nam") or "").strip() for a in clean_canvas if a.get("name") or a.get("nam")]
        
        final_list = []
        for r in assign_list:
            if not isinstance(r, dict):
                continue
            
            cat = (r.get("cat") or "").upper()
            nam = (r.get("nam") or "").upper()
            if cat == "NON_SCHEDULED":
                continue
            if cat in ("LECTURE", "READING", "ATTENDANCE"):
                continue
            if "ATTENDANCE" in nam or "TOTAL" in nam or "COMPONENT" in nam:
                continue
            if "LECTURE" in nam or "READING" in nam or "CHAPTER" in nam:
                continue
            
            if cat == "QUIZ":
                r["cat"] = "EXAM"
            
            action = r.get("action", "KEEP").upper()
            
            if action == "REMOVE":
                continue
            
            due = r.get("due") or r.get("normalized_due_at")
            if due and isinstance(due, str) and "T" in due:
                due = due.split("T")[0]
            r["due"] = due
            
            if r.get("cid"):
                r["st"] = "RESOLVED"
            elif action == "ADD":
                r["st"] = "DISCOVERED"
            elif action in ("KEEP", "UPDATE"):
                r["st"] = "DISCOVERED"
            else:
                r["st"] = "DISCOVERED"
            
            if not r.get("cid") and canvas_names_resync and _discovered_matches_canvas_item(
                r.get("nam") or r.get("name") or "", canvas_names_resync
            ):
                continue
            
            final_list.append(r)

        parsed["a"] = final_list
        return parsed
        
    except Exception as e:
        detail = f"LLM RESYNC JSON parse failed: {type(e).__name__}: {e}"
        if AI_DEBUG:
            detail += f"\nRaw output head: {raw_text[:400]}"
        else:
            detail += f"\nRaw output length: {len(raw_text)}"
        raise RuntimeError(detail)
