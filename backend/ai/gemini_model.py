import os
import json
import re
import pytz
from datetime import datetime
from ai.usage_telemetry import build_usage_payload, emit_usage_log, mark_usage_error
# NOTE: vertexai and vertexai.generative_models are imported lazily inside
# the functions that need them.  The google-cloud-aiplatform SDK takes 15-40 s
# to import, which blocks gunicorn worker startup and causes Cloud Run to
# return 503s before Flask can handle any request.

PROJECT_ID = os.getenv("GCP_PROJECT_ID") or os.getenv("GOOGLE_CLOUD_PROJECT")
LOCATION = os.getenv("GCP_LOCATION", "us-central1")
MODEL_NAME = os.getenv("MODEL_NAME", "gemini-2.5-flash-lite")

# When true, include more diagnostic details in raised exceptions.
AI_DEBUG = (os.getenv("AI_DEBUG") or "").strip().lower() in ("1", "true", "yes")

_vertex_init_attempted = False
_vertex_initialized = False
_vertex_init_error: Exception | None = None


def _ensure_vertex_ai_initialized() -> None:
    """
    Initialize Vertex AI lazily.

    Cloud Run can return 503s if the container does slow/hanging network work at import time.
    Vertex initialization is not required for most endpoints, so do it only when needed.
    """
    import vertexai  # deferred import — heavy SDK

    global _vertex_init_attempted, _vertex_initialized, _vertex_init_error
    if _vertex_initialized or _vertex_init_attempted:
        return

    _vertex_init_attempted = True
    try:
        if PROJECT_ID:
            vertexai.init(project=PROJECT_ID, location=LOCATION)
            _vertex_initialized = True
            print(f"[OK] Vertex AI initialized: {PROJECT_ID} @ {LOCATION} (Model: {MODEL_NAME})")
        else:
            # Cloud Run sets GOOGLE_CLOUD_PROJECT automatically in many setups, but when running
            # locally this may be missing. We warn once and proceed; calls may still fail.
            _vertex_initialized = True
            print("[WARN] GCP_PROJECT_ID not found. Vertex AI calls may fail if not using ADC.")
    except Exception as e:
        _vertex_init_error = e
        print(f"[ERROR] Failed to initialize Vertex AI: {e}")


def _extract_first_json(value: str):
    """
    Extract and parse the first valid JSON object/array from a model response.

    Models sometimes wrap JSON in prose or code fences; raw_decode lets us find
    the first parseable JSON payload without relying on brittle regexes.
    """
    text = (value or "").strip()
    if not text:
        raise ValueError("Empty model response.")

    # Strip common code fence wrappers.
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


def _build_generation_config():
    """
    GenerationConfig API varies slightly across google-cloud-aiplatform versions.
    Build it defensively for maximum compatibility.
    """
    from vertexai.generative_models import GenerationConfig  # deferred import

    base_kwargs = dict(
        # Keep this bounded; huge outputs are slow and often unnecessary.
        max_output_tokens=4096,
        temperature=0.2,
        top_p=0.95,
    )
    try:
        return GenerationConfig(**base_kwargs, response_mime_type="application/json")
    except TypeError:
        # Older SDKs don't support response_mime_type; prompt still enforces JSON.
        return GenerationConfig(**base_kwargs)


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
        # Still protect against pathological prompts.
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

    # Allocate budget across selected files (context-size based).
    n = len(prepared)
    if n <= 0:
        return []

    # If min budget would exceed the total, fall back to equal split.
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


def resolve_assignment_dates_with_gemini(
        assignments,
        announcements,
        files,
        course_timezone,  # This comes from app.py (e.g., "America/Los_Angeles")
        confidence_threshold=0.85,
        discover_new_assignments=True,
        telemetry_context=None
):
    # --- STEP 1: UNIVERSAL TIMEZONE NORMALIZATION ---
    # We process dates while they are still raw data, BEFORE the AI sees them.

    clean_assignments = []

    # Default to UTC if timezone is missing/invalid
    try:
        target_tz = pytz.timezone(course_timezone) if course_timezone else pytz.utc
    except pytz.UnknownTimeZoneError:
        target_tz = pytz.timezone("America/New_York")  # Fallback

    for a in assignments:
        # Create a clean copy to avoid mutating the original data
        a_clean = a.copy()

        raw_due = a.get("normalized_due_at") or a.get("original_due_at")

        if raw_due and isinstance(raw_due, str) and "T" in raw_due:
            try:
                # 1. Parse Canvas UTC ISO format (e.g., 2025-08-21T03:59:59Z)
                # Ensure it has timezone info (UTC)
                dt_utc = datetime.fromisoformat(raw_due.replace("Z", "+00:00"))

                # 2. Convert to Course Timezone
                dt_local = dt_utc.astimezone(target_tz)

                # 3. Extract just the date string (YYYY-MM-DD)
                # This is what we feed the AI. It now sees "2025-08-20", not "21st".
                a_clean["ai_ready_date"] = dt_local.strftime("%Y-%m-%d")

            except ValueError:
                # Fallback for weird formats
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
    # Get current date in the course's timezone for AI context
    now_local = datetime.now(target_tz)
    today_str = now_local.strftime("%Y-%m-%d")
    tz_name = target_tz.zone if hasattr(target_tz, 'zone') else str(target_tz)
    
    # Build the prompt with best practices for Gemini 2.5 Flash Lite:
    # 1. Clear role assignment
    # 2. XML-style delimiters for structure
    # 3. Explicit few-shot examples
    # 4. Precise date format instructions
    # 5. Step-by-step processing rules
    
    # Prompt size controls: budget based on context size, not cost.
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
        # Prefer the end of documents slightly because due-date tables often live there.
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

    # --- STEP 4: CALL GEMINI ---
    from vertexai.generative_models import GenerativeModel, GenerationConfig  # deferred import

    _ensure_vertex_ai_initialized()
    generation_config = _build_generation_config()

    model = GenerativeModel(MODEL_NAME)

    response = model.generate_content(full_prompt, generation_config=generation_config)
    usage_payload = build_usage_payload(
        response,
        model_name=MODEL_NAME,
        operation="resolve_assignment_dates_with_gemini",
        telemetry_context=telemetry_context,
        prompt_chars=len(full_prompt),
    )

    raw_text = response.text.strip()

    try:
        parsed = _extract_first_json(raw_text)

        if isinstance(parsed, list):
            emit_usage_log(usage_payload)
            return {"cc": "UNK", "a": parsed, "_usage": usage_payload}

        assign_list = parsed.get("a") or parsed.get("assignments") or []

        # Ensure no Canvas items were omitted — backfill any missing by cid
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

        # Canvas item names for post-filter deduplication (remove AI-discovered duplicates)
        canvas_names = [str(a.get("name") or a.get("nam") or "").strip() for a in clean_assignments if a.get("name") or a.get("nam")]

        # --- FINAL CLEANUP ---
        # The AI returns dates as YYYY-MM-DD strings in local time.
        # We pass them through as-is without appending timezone offsets,
        # since the frontend already handles them as local calendar dates.
        final_list = []
        for r in assign_list:
            if not isinstance(r, dict): continue

            # Filter Noise - skip lectures, readings, and other non-deliverables
            cat = (r.get("cat") or "").upper()
            nam = (r.get("nam") or "").upper()
            if cat == "NON_SCHEDULED": continue
            if cat in ("LECTURE", "READING", "ATTENDANCE"): continue
            if "ATTENDANCE" in nam or "TOTAL" in nam or "COMPONENT" in nam: continue
            if "LECTURE" in nam or "READING" in nam or "CHAPTER" in nam: continue
            
            # Normalize QUIZ to EXAM
            if cat == "QUIZ":
                r["cat"] = "EXAM"

            # Keep dates as plain YYYY-MM-DD strings
            # The frontend's parseDueToDate() handles these correctly as local calendar dates
            due = r.get("due") or r.get("normalized_due_at")
            
            # Ensure we have a clean date string (no timezone manipulation needed)
            if due and isinstance(due, str):
                # If it's already a full ISO string with time, extract just the date
                if "T" in due:
                    due = due.split("T")[0]
                r["due"] = due

            # --- BACKEND STATUS ASSIGNMENT ---
            # AI no longer handles this - we determine status based on presence of cid
            if r.get("cid"):
                r["st"] = "RESOLVED"
            else:
                r["st"] = "DISCOVERED"
                # Post-filter: drop discovered items that duplicate Canvas items (e.g. "Exam 3 Su24 Key" vs "Exam 3")
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
        detail = f"Gemini JSON parse failed: {type(e).__name__}: {e}"
        if AI_DEBUG:
            detail += f"\nRaw output head: {raw_text[:400]}"
        else:
            detail += f"\nRaw output length: {len(raw_text)}"
        raise RuntimeError(detail)


def resync_assignment_dates_with_gemini(
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
    
    # Default to UTC if timezone is missing/invalid
    try:
        target_tz = pytz.timezone(course_timezone) if course_timezone else pytz.utc
    except pytz.UnknownTimeZoneError:
        target_tz = pytz.timezone("America/New_York")
    
    # Process Canvas assignments (same as initial sync)
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
    
    # Process existing items - separate RESOLVED (Canvas-origin) from DISCOVERED (syllabus-origin)
    existing_resolved = []  # From Canvas - may have timezone drift
    existing_discovered = []  # From syllabus - should be stable
    
    for a in existing_assignments:
        # Skip if it's a fresh Canvas item (we have new data for those)
        if a.get("canvas_assignment_id") or a.get("canvasAssignmentId"):
            continue
        
        # Get the raw due date
        raw_due = a.get("normalized_due_at") or a.get("normalizedDueAt") or a.get("due")
        status = a.get("status") or a.get("st") or ""
        
        # Normalize date
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
        
        # Separate by origin
        if status == "RESOLVED":
            item["st"] = "RESOLVED"
            existing_resolved.append(item)
        else:
            item["st"] = "DISCOVERED"
            existing_discovered.append(item)
    
    # Pre-process file texts for prompt inclusion (no hard truncation here; budgeting happens later).
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
    
    # Get current date context
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

    # Build the RESYNC prompt with best practices
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

    # Call Gemini with very low temperature for consistency
    from vertexai.generative_models import GenerativeModel, GenerationConfig  # deferred import

    _ensure_vertex_ai_initialized()
    generation_config = _build_generation_config()
    
    model = GenerativeModel(MODEL_NAME)
    
    response = model.generate_content(full_prompt, generation_config=generation_config)
    usage_payload = build_usage_payload(
        response,
        model_name=MODEL_NAME,
        operation="resync_assignment_dates_with_gemini",
        telemetry_context=telemetry_context,
        prompt_chars=len(full_prompt),
    )
    
    raw_text = response.text.strip()
    
    try:
        parsed = _extract_first_json(raw_text)
        
        if isinstance(parsed, list):
            emit_usage_log(usage_payload)
            return {"cc": "UNK", "a": parsed, "changes_summary": "Unknown", "_usage": usage_payload}
        
        assign_list = parsed.get("a") or parsed.get("assignments") or []
        changes_summary = parsed.get("changes_summary", "No summary provided")
        canvas_names_resync = [str(a.get("name") or a.get("nam") or "").strip() for a in clean_canvas if a.get("name") or a.get("nam")]
        
        print(f"[RESYNC] AI changes summary: {changes_summary}")
        
        # Process results
        final_list = []
        for r in assign_list:
            if not isinstance(r, dict):
                continue
            
            # Filter noise - skip lectures, readings, and other non-deliverables
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
            
            # Normalize QUIZ to EXAM
            if cat == "QUIZ":
                r["cat"] = "EXAM"
            
            action = r.get("action", "KEEP").upper()
            
            # Skip items marked for removal
            if action == "REMOVE":
                print(f"[RESYNC] Removing: {r.get('nam')} - {r.get('reason', 'No reason')}")
                continue
            
            # Clean up date
            due = r.get("due") or r.get("normalized_due_at")
            if due and isinstance(due, str) and "T" in due:
                due = due.split("T")[0]
            r["due"] = due
            
            # Set status based on action and presence of cid
            if r.get("cid"):
                r["st"] = "RESOLVED"
            elif action == "ADD":
                r["st"] = "DISCOVERED"
            elif action in ("KEEP", "UPDATE"):
                r["st"] = "DISCOVERED"  # Preserve as discovered
            else:
                r["st"] = "DISCOVERED"
            
            # Post-filter: drop discovered items that duplicate Canvas items
            if not r.get("cid") and canvas_names_resync and _discovered_matches_canvas_item(
                r.get("nam") or r.get("name") or "", canvas_names_resync
            ):
                print(f"[RESYNC] Skipping duplicate of Canvas item: {r.get('nam')}")
                continue
            
            # Log updates
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
        detail = f"Gemini RESYNC JSON parse failed: {type(e).__name__}: {e}"
        if AI_DEBUG:
            detail += f"\nRaw output head: {raw_text[:400]}"
        else:
            detail += f"\nRaw output length: {len(raw_text)}"
        raise RuntimeError(detail)
