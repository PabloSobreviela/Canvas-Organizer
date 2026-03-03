import os
import json
import re
import pytz
from datetime import datetime
import vertexai
from vertexai.generative_models import GenerativeModel, GenerationConfig

# Initialize Vertex AI
PROJECT_ID = os.getenv("GCP_PROJECT_ID")
LOCATION = os.getenv("GCP_LOCATION", "us-central1")
MODEL_NAME = os.getenv("MODEL_NAME", "gemini-2.5-flash-lite")

vertexai.init(project=PROJECT_ID, location=LOCATION)


def resolve_assignment_dates_with_gemini(
        assignments,
        announcements,
        files,
        course_timezone,  # This comes from app.py (e.g., "America/Los_Angeles")
        confidence_threshold=0.85,
        discover_new_assignments=True
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

    # --- STEP 3: THE PROMPT (SIMPLIFIED) ---
    # Status (RESOLVED/DISCOVERED) is now handled by backend based on presence of 'cid'
    full_prompt = f"""You are a Schedule Extraction Engine. Extract schedule items into JSON.

=== RULES ===

**RULE 1: ITEM CLASSIFICATION**
- Items with 'cid' (Canvas ID): Keep as-is, output with their cid
- If name **contains** "Exam", "Midterm", "Test", or "Final" → cat: "EXAM"
- If name **contains** "Quiz" → cat: "QUIZ"  
- "Lecture", chapter numbers (e.g., "1.1, 1.2") → cat: "LECTURE"
- "Homework", "HW", "Assignment" → cat: "ASSIGNMENT"
- "Attendance", "Participation", "Component", "Overall", "Total" → SKIP (do not output)
**NOTE**: Schedule tables now appear in markdown format (| header | header |) - parse these carefully

**RULE 2: DATE EXTRACTION & ENRICHMENT**
- For Canvas items with dates: use the provided 'due' date
- **For Canvas items with "No Date"**: Check syllabus "Important dates" section for matching assignment name, use that date
  - Example: Canvas has "HW01" with "No Date" + Syllabus says "26-Jan M Studio Webwork HW 01" → output "2026-01-26"
- For syllabus-only items: look for "Important dates" sections first (cleanest source)
- Lectures typically fall on T/Th (Tuesday/Thursday) if syllabus says "Lecture: TR"
- Extract dates as YYYY-MM-DD format

**RULE 3: LECTURE EXTRACTION (CRITICAL)**
- **For "Lecture: TR" courses**: Generate ALL Tuesday AND Thursday dates during the semester
  - Example: If semester runs Jan 13 - Apr 28, output lectures for EVERY Tue/Thu in that range
  - Expected count: ~28-32 lectures for a full semester
- **Match topics**: Try to match lecture topics (e.g., "1.1, 1.2", "4.5", "Shifted systems") from schedule text
- **If topics unclear**: Output "Lecture" with the date (better to have date without topic than skip entirely)
- **Other items**: Extract EVERY quiz, exam, and assignment from schedules

**RULE 4: DEDUPLICATION**
- If Canvas has "Exam 1", do NOT also output syllabus version of "Exam 1"
- Canvas items take priority over syllabus text items

=== OUTPUT FORMAT ===
{{
  "cc": "Course Code",
  "a": [
    {{ "cid": 12345, "nam": "HW01", "due": "2026-01-20", "cat": "ASSIGNMENT" }},
    {{ "nam": "Lecture: 1.1, 1.2", "due": "2026-01-13", "cat": "LECTURE" }},
    {{ "nam": "Quiz 1", "due": "2026-01-28", "cat": "QUIZ" }}
  ]
}}

=== INPUT DATA ===
Canvas Assignments:
{json.dumps([{
    "cid": a["canvas_assignment_id"],
    "nam": a["name"],
    "due": a["ai_ready_date"]
} for a in clean_assignments], ensure_ascii=False)}

Course Materials:
{json.dumps({
    "announcements": announcements,
    "files": files
}, ensure_ascii=False, indent=2)}
    """

    # --- STEP 4: CALL GEMINI ---
    generation_config = GenerationConfig(
        max_output_tokens=8192,
        temperature=0.1,
        top_p=0.95,
        response_mime_type="application/json"
    )

    model = GenerativeModel(MODEL_NAME)

    response = model.generate_content(
        full_prompt,
        generation_config=generation_config
    )

    raw_text = response.text.strip()
    match = re.search(r"\{.*\}", raw_text, re.DOTALL)
    cleaned = match.group(0) if match else raw_text

    try:
        parsed = json.loads(cleaned)

        if isinstance(parsed, list):
            return {"cc": "UNK", "a": parsed}

        assign_list = parsed.get("a") or parsed.get("assignments") or []

        # --- FINAL CLEANUP ---
        # The AI returns dates as YYYY-MM-DD strings in local time.
        # We pass them through as-is without appending timezone offsets,
        # since the frontend already handles them as local calendar dates.
        final_list = []
        for r in assign_list:
            if not isinstance(r, dict): continue

            # Filter Noise
            cat = (r.get("cat") or "").upper()
            nam = (r.get("nam") or "").upper()
            if cat == "NON_SCHEDULED": continue
            if "ATTENDANCE" in nam or "TOTAL" in nam or "COMPONENT" in nam: continue

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

            final_list.append(r)

        parsed["a"] = final_list
        return parsed

    except Exception as e:
        raise RuntimeError(f"Gemini JSON parse failed: {e}\nRaw output partial: {raw_text[:200]}")
