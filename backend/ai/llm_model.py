import os
import json
import re
import pytz
from datetime import datetime
from ai.usage_telemetry import build_usage_payload, emit_usage_log, mark_usage_error

# Primary provider: OpenRouter
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://openrouter.ai/api/v1")
MODEL_NAME = os.getenv("MODEL_NAME", "qwen/qwen3.5-flash-02-23")

# Fallback provider: DeepInfra
LLM_FALLBACK_API_KEY = os.getenv("LLM_FALLBACK_API_KEY", "")
LLM_FALLBACK_BASE_URL = os.getenv("LLM_FALLBACK_BASE_URL", "https://api.deepinfra.com/v1/openai")
FALLBACK_MODEL = os.getenv("FALLBACK_MODEL", "Qwen/Qwen3-14B")

AI_DEBUG = (os.getenv("AI_DEBUG") or "").strip().lower() in ("1", "true", "yes")

_primary_client = None
_fallback_client = None


def _get_primary_client():
    """Lazily create an OpenAI client for the primary provider (OpenRouter)."""
    global _primary_client
    if _primary_client is not None:
        return _primary_client

    from openai import OpenAI

    if not LLM_API_KEY:
        raise RuntimeError(
            "LLM_API_KEY is not set. "
            "Configure it in .env or as an environment variable."
        )

    _primary_client = OpenAI(
        api_key=LLM_API_KEY,
        base_url=LLM_BASE_URL,
    )
    print(f"[OK] Primary LLM client initialized: {LLM_BASE_URL} (Model: {MODEL_NAME})")
    return _primary_client


def _get_fallback_client():
    """Lazily create an OpenAI client for the fallback provider (DeepInfra)."""
    global _fallback_client
    if _fallback_client is not None:
        return _fallback_client

    from openai import OpenAI

    if not LLM_FALLBACK_API_KEY:
        return None

    _fallback_client = OpenAI(
        api_key=LLM_FALLBACK_API_KEY,
        base_url=LLM_FALLBACK_BASE_URL,
    )
    print(f"[OK] Fallback LLM client initialized: {LLM_FALLBACK_BASE_URL} (Model: {FALLBACK_MODEL})")
    return _fallback_client


def _call_llm(prompt: str, *, model: str = None, telemetry_context=None, operation: str = "unknown"):
    """
    Send a chat-completion request via the primary provider.
    On failure, retries against the fallback provider with a different model.
    """
    from openai import APIError, APIConnectionError, APITimeoutError

    target_model = model or MODEL_NAME
    client = _get_primary_client()

    messages = [
        {"role": "system", "content": "You are an expert academic schedule extraction system. Respond with valid JSON only."},
        {"role": "user", "content": prompt},
    ]
    params = dict(
        model=target_model,
        messages=messages,
        max_tokens=4096,
        temperature=0.2,
        top_p=0.95,
    )

    try:
        response = client.chat.completions.create(**params)
    except (APIError, APIConnectionError, APITimeoutError) as e:
        fallback_client = _get_fallback_client()
        if fallback_client and FALLBACK_MODEL:
            print(f"[WARN] Primary ({target_model}) failed: {e}; falling back to {FALLBACK_MODEL}")
            params["model"] = FALLBACK_MODEL
            response = fallback_client.chat.completions.create(**params)
        else:
            raise

    usage_payload = build_usage_payload(
        response,
        model_name=response.model or target_model,
        operation=operation,
        telemetry_context=telemetry_context,
        prompt_chars=len(prompt),
    )

    raw_text = (response.choices[0].message.content or "").strip()
    return raw_text, usage_payload


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
    
    max_files_for_prompt = int(os.getenv("AI_MAX_FILES_FOR_PROMPT", "25"))
    files_total_chars = int(os.getenv("AI_FILES_TOTAL_CHARS", "900000"))
    per_file_soft_cap_chars = int(os.getenv("AI_FILE_SOFT_CAP_CHARS", "250000"))
    per_file_min_chars = int(os.getenv("AI_FILE_MIN_CHARS", "10000"))
    max_announcement_chars = int(os.getenv("AI_MAX_ANNOUNCEMENT_CHARS", "1200"))

    files_payload = _build_files_payload_for_prompt(
        files,
        max_files=max_files_for_prompt,
        total_text_chars_budget=files_total_chars,
        per_file_soft_cap_chars=per_file_soft_cap_chars,
        per_file_min_chars=per_file_min_chars,
        tail_fraction=float(os.getenv("AI_FILE_TAIL_FRACTION", "0.65")),
    )

    full_prompt = f"""<role>You are an expert academic schedule extraction system. Your ONLY job is to extract assignment deadlines with 100% date accuracy.</role>

<context>
- Today's date: {today_str}
- Course timezone: {tz_name}
- All Canvas dates have ALREADY been converted to local {tz_name} time
</context>

<rules>
RULE 1 - COPY CANVAS DATES EXACTLY:
- If a Canvas item has a date like "2026-01-20", output EXACTLY "2026-01-20"
- NEVER change, shift, or modify Canvas dates
- Canvas dates are pre-converted and correct

RULE 2 - FILL IN MISSING DATES (CRITICAL FOR QUIZZES):
- Every Canvas item with "No Date" MUST be checked against the syllabus. If a date exists, use it.
- Quizzes often have dates in schedule tables — search for "Quiz 1", "Quiz 2", "Q1", "Q2", etc. and match by number.
- Extract dates EXACTLY as written (e.g., "January 20" -> "2026-01-20", "Jan 20" -> "2026-01-20")
- Do NOT leave any Canvas item with "No Date" if the syllabus contains its date. Be thorough.

RULE 3 - SYLLABUS-ONLY DISCOVERY:
- ONLY add syllabus items that have NO matching Canvas item
- If syllabus says "Due Jan 20" and it's Spring 2026, output "2026-01-20"

RULE 4 - CRITICAL DEDUPLICATION (NO EXCEPTIONS):
- If a Canvas item exists for an assignment, output ONLY the Canvas version with its cid. NEVER output a separate discovered entry.
- "Exam 3" = "Exam 3 Su24 Key" = "Quiz 3" = "Test 3" (same assignment when number matches)
- "HW1" = "HW 1" = "Homework 1" = "HW01" (same assignment)
- When syllabus mentions something that matches a Canvas item by name/number, output ONLY the Canvas row with cid — do NOT add a second row without cid.
- File names like "Exam 3 Su24 Key.pdf" refer to the same "Exam 3" in Canvas — merge into the Canvas item, never create a duplicate.

RULE 5 - CATEGORIES:
- EXAM: exam, midterm, final, test, quiz (quizzes are deliverables — include them with dates)
- ASSIGNMENT: homework, hw, lab, project, assignment
- SKIP: attendance, participation, lecture, reading, chapter, total
</rules>

<few_shot_examples>
EXAMPLE 1:
INPUT:
Canvas: [{{"cid": 100, "nam": "HW1", "due": "2026-01-15"}}, {{"cid": 101, "nam": "Midterm", "due": "No Date"}}]
Syllabus: "HW 1 due Jan 15. Midterm Feb 10. Final Exam March 20."

OUTPUT:
{{"cc": "CS101", "a": [
  {{"cid": 100, "nam": "HW1", "due": "2026-01-15", "cat": "ASSIGNMENT"}},
  {{"cid": 101, "nam": "Midterm", "due": "2026-02-10", "cat": "EXAM"}},
  {{"nam": "Final Exam", "due": "2026-03-20", "cat": "EXAM"}}
]}}

EXAMPLE 2 (QUIZZES — fill ALL dates from syllabus):
INPUT:
Canvas: [{{"cid": 200, "nam": "Quiz 1", "due": "No Date"}}, {{"cid": 201, "nam": "Quiz 2", "due": "No Date"}}, {{"cid": 202, "nam": "Quiz 3", "due": "No Date"}}]
Syllabus: "Schedule: Quiz 1 Jan 15, Quiz 2 Feb 12, Quiz 3 Mar 5."

OUTPUT:
{{"cc": "MATH101", "a": [
  {{"cid": 200, "nam": "Quiz 1", "due": "2026-01-15", "cat": "EXAM"}},
  {{"cid": 201, "nam": "Quiz 2", "due": "2026-02-12", "cat": "EXAM"}},
  {{"cid": 202, "nam": "Quiz 3", "due": "2026-03-05", "cat": "EXAM"}}
]}}

BAD: If Canvas has "Exam 3" and syllabus has "Exam 3 Su24 Key.pdf", output ONLY {{"cid": 102, "nam": "Exam 3", ...}} — do NOT add {{"nam": "Exam 3 Su24 Key", ...}} as a separate row.
</few_shot_examples>

<input_data>
<canvas_assignments>
{json.dumps([{
    "cid": a["canvas_assignment_id"],
    "nam": a["name"],
    "due": a["ai_ready_date"]
} for a in clean_assignments], ensure_ascii=False, indent=2)}
</canvas_assignments>

<syllabus_materials>
{json.dumps({
    "announcements": [{
        "title": a.get("title"),
        "posted_at": a.get("posted_at"),
        "message": (a.get("message") or "")[:max_announcement_chars],
    } for a in (announcements[:5] if announcements else [])],
    "files": [{
        "file_name": f.get("file_name", ""),
        "file_type": f.get("file_type", ""),
        "text": (f.get("text", "") or "")
    } for f in files_payload]
}, ensure_ascii=False, indent=2)}
</syllabus_materials>
</input_data>

<output_format>
Return ONLY valid JSON with this exact structure:
{{"cc": "COURSE_CODE", "a": [
  {{"cid": NUMBER_OR_NULL, "nam": "NAME", "due": "YYYY-MM-DD", "cat": "EXAM|ASSIGNMENT"}}
]}}

CRITICAL:
- Every Canvas item (with cid) MUST appear in the output. Do not omit any.
- Every "due" field MUST be exactly YYYY-MM-DD format. Nothing else.
- For Canvas items with "No Date", search the syllabus thoroughly (including schedule tables) and fill in the date if found.
</output_format>"""

    # --- STEP 4: CALL LLM ---
    raw_text, usage_payload = _call_llm(
        full_prompt,
        operation="resolve_assignment_dates",
        telemetry_context=telemetry_context,
    )

    try:
        parsed = _extract_first_json(raw_text)

        if isinstance(parsed, list):
            emit_usage_log(usage_payload)
            return {"cc": "UNK", "a": parsed, "_usage": usage_payload}

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
        emit_usage_log(usage_payload)
        parsed["_usage"] = usage_payload
        return parsed

    except Exception as e:
        emit_usage_log(mark_usage_error(usage_payload, e))
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
    
    max_new_files_for_prompt = int(os.getenv("AI_RESYNC_MAX_NEW_FILES_FOR_PROMPT", "25"))
    max_prev_files_for_prompt = int(os.getenv("AI_RESYNC_MAX_PREV_FILES_FOR_PROMPT", "10"))
    new_files_total_chars = int(os.getenv("AI_RESYNC_NEW_FILES_TOTAL_CHARS", "700000"))
    prev_files_total_chars = int(os.getenv("AI_RESYNC_PREV_FILES_TOTAL_CHARS", "300000"))
    per_file_soft_cap_chars = int(os.getenv("AI_FILE_SOFT_CAP_CHARS", "250000"))
    per_file_min_chars = int(os.getenv("AI_FILE_MIN_CHARS", "10000"))
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

    full_prompt = f"""<role>You are an expert academic schedule RESYNC system. Your job is to UPDATE an existing assignment list with 100% date accuracy.</role>

<context>
- Today's date: {today_str}
- Course timezone: {tz_name}
- All dates have ALREADY been converted to local {tz_name} time
</context>

<rules>
RULE 1 - PRESERVE EXISTING DATA:
- Existing items are CORRECT unless you have clear evidence otherwise
- Canvas dates are authoritative - copy them exactly
- Discovered items from syllabus should be preserved

RULE 2 - COPY DATES EXACTLY / FILL MISSING:
- If Canvas shows "2026-01-20", output EXACTLY "2026-01-20"
- NEVER change, shift, or modify existing dates
- For Canvas items with "No Date", search the syllabus/schedule for quiz and exam dates — fill them in when found (Quiz 1, Quiz 2, etc. by number)

RULE 3 - ACTIONS:
- CANVAS: Fresh Canvas item (has 'cid') - use as authoritative
- KEEP: Preserve existing discovered item unchanged
- ADD: New item found in syllabus/materials that wasn't there before (ONLY if allowed below)
- UPDATE: A discovered item exists but the new materials clearly correct/clarify its due date
- SKIP items: attendance, participation, lecture, reading, chapter, total
- NEVER use action=ADD for an item that matches a Canvas item. "Exam 3 Su24 Key" = "Exam 3" in Canvas — do NOT add as separate entry.

RULE 4 - CATEGORIES:
- EXAM: exam, midterm, final, test, quiz
- ASSIGNMENT: homework, hw, lab, project, assignment

RULE 5 - ADDITIONS POLICY:
- allow_additions = {str(allow_additions).lower()}
- If allow_additions is false: NEVER output action="ADD"
</rules>

<few_shot_example>
INPUT:
Canvas: [{{"cid": 100, "nam": "HW1", "due": "2026-01-15"}}]
Existing Discovered: [{{"nam": "Midterm", "due": "2026-02-10", "cat": "EXAM"}}]

OUTPUT:
{{"cc": "CS101", "changes_summary": "Preserved all existing items", "a": [
  {{"cid": 100, "nam": "HW1", "due": "2026-01-15", "cat": "ASSIGNMENT", "action": "CANVAS"}},
  {{"nam": "Midterm", "due": "2026-02-10", "cat": "EXAM", "action": "KEEP"}}
]}}
</few_shot_example>

<input_data>
<canvas_assignments>
{json.dumps([{
    "cid": a["canvas_assignment_id"],
    "nam": a["name"],
    "due": a["ai_ready_date"]
} for a in clean_canvas], ensure_ascii=False, indent=2)}
</canvas_assignments>

<existing_discovered>
{json.dumps(existing_discovered, ensure_ascii=False, indent=2)}
</existing_discovered>

<materials_previous>
{json.dumps([{
    "file_name": item.get("file_name", ""),
    "file_type": item.get("file_type", ""),
    "text": (item.get("text", "") or "")
} for item in prev_files_payload], ensure_ascii=False, indent=2)}
</materials_previous>

<materials_new>
{json.dumps([{
    "file_name": item.get("file_name", ""),
    "file_type": item.get("file_type", ""),
    "text": (item.get("text", "") or "")
} for item in new_files_payload], ensure_ascii=False, indent=2)}
</materials_new>

<announcements>
{json.dumps([{
    "title": a.get("title"),
    "posted_at": a.get("posted_at"),
    "message": (a.get("message") or "")[:max_announcement_chars],
} for a in (announcements[:5] if announcements else [])], ensure_ascii=False, indent=2)}
</announcements>
</input_data>

<output_format>
Return ONLY valid JSON:
{{"cc": "CODE", "changes_summary": "BRIEF_SUMMARY", "a": [
  {{"cid": NUMBER_OR_NULL, "nam": "NAME", "due": "YYYY-MM-DD", "cat": "EXAM|ASSIGNMENT", "action": "CANVAS|KEEP|UPDATE|ADD"}}
]}}

CRITICAL: Every "due" field MUST be exactly YYYY-MM-DD format. Nothing else.
</output_format>"""

    # --- STEP 4: CALL LLM ---
    raw_text, usage_payload = _call_llm(
        full_prompt,
        operation="resync_assignment_dates",
        telemetry_context=telemetry_context,
    )
    
    try:
        parsed = _extract_first_json(raw_text)
        
        if isinstance(parsed, list):
            emit_usage_log(usage_payload)
            return {"cc": "UNK", "a": parsed, "changes_summary": "Unknown", "_usage": usage_payload}
        
        assign_list = parsed.get("a") or parsed.get("assignments") or []
        changes_summary = parsed.get("changes_summary", "No summary provided")
        canvas_names_resync = [str(a.get("name") or a.get("nam") or "").strip() for a in clean_canvas if a.get("name") or a.get("nam")]
        
        print(f"[RESYNC] AI changes summary: {changes_summary}")
        
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
                print(f"[RESYNC] Removing: {r.get('nam')} - {r.get('reason', 'No reason')}")
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
                print(f"[RESYNC] Skipping duplicate of Canvas item: {r.get('nam')}")
                continue
            
            if action == "UPDATE":
                print(f"[RESYNC] Updating: {r.get('nam')} - {r.get('reason', 'No reason')}")
            elif action == "ADD":
                print(f"[RESYNC] Adding new: {r.get('nam')}")
            
            final_list.append(r)

        parsed["a"] = final_list
        emit_usage_log(usage_payload)
        parsed["_usage"] = usage_payload
        return parsed
        
    except Exception as e:
        emit_usage_log(mark_usage_error(usage_payload, e))
        detail = f"LLM RESYNC JSON parse failed: {type(e).__name__}: {e}"
        if AI_DEBUG:
            detail += f"\nRaw output head: {raw_text[:400]}"
        else:
            detail += f"\nRaw output length: {len(raw_text)}"
        raise RuntimeError(detail)
