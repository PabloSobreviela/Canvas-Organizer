import os
import json
import google.generativeai as genai

MODEL_NAME = os.getenv("MODEL_NAME", "gemini-2.5-flash-lite")
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))


def resolve_assignment_dates_with_gemini(
        assignments,
        announcements,
        files,
        course_timezone,
        confidence_threshold=0.85,
        discover_new_assignments=True
):
    full_prompt = f"""You are a deadline reconciliation system. Your job: fill missing Canvas dates and discover new assignments from the schedule.

        === PURPOSE ===
        1. If a Canvas assignment has a NULL due date, find the date in the schedule.
        2. If a Canvas assignment HAS a due date, KEEP IT (do not change it).
        3. Discover new assignments listed in the schedule but missing from Canvas.

        === CORE RULES ===

        1) EXISTING CANVAS DATES ARE FINAL:
           - If the input Canvas assignment has a date, output that date exactly.
           - STATUS = "RESOLVED".
           - Do NOT override existing dates, even if the schedule says otherwise.

        2) FILLING MISSING DATES:
           - If the input Canvas assignment has NO date (null), look for a matching name in the schedule.
           - If found, use that date. STATUS = "RESOLVED".
           - If not found, STATUS = "CANNOT_DETERMINE".

        3) DATES MUST HAVE TIMEZONES:
           All dates must be ISO-8601 with timezone: {course_timezone}
           - Valid: "2025-01-14T12:00:00-05:00"
           - If the source gives only a DATE (no time), set the time to 23:59:00 in {course_timezone}.
           - For DISCOVERED READING items where no date is stated at all, set normalized_due_at = null.
           - When receiving start and end dates ALWAYS mark the start date.

        4) NO HALLUCINATIONS:
           Only discover items explicitly written in the provided text. If unsure, skip it.

        5) Do NOT CREATE ASSIGNMENTS where there are none:
           - DO NOT DISCOVER an assignment that will not have a submission.
           - Signups, classes, and special classes without submission DO NOT count.

        === TIMEZONE REFERENCE ===
        {course_timezone}: Use -05:00 (EST) for Nov-Mar, -04:00 (EDT) for Mar-Oct

        === OUTPUT FORMAT (STRICT JSON, MINIFIED) ===
        Return ONE JSON object, no extra text:

        {{
          "cc": "CS 1331",
          "a": [
            // TYPE 1 or TYPE 2 entries
          ]
        }}

        TYPE 1 - Canvas Assignment Updates:
        {{ "cid": 12345, "due": "YYYY-MM-DDTHH:MM:SS-05:00" | null, "cat": "EXAM", "st": "RESOLVED" | "CANNOT_DETERMINE" }}

        TYPE 2 - New Discoveries:
        {{ "cid": null, "nam": "Exam 1", "des": "…", "cat": "EXAM", "due": "YYYY-MM-DDTHH:MM:SS-04:00" | null, "st": "DISCOVERED" }}

        === CATEGORIES ===

        You must categorize EVERY assignment (both Canvas and discovered) into ONE of these categories:

        ASSIGNMENT = regular graded deliverables (homework, quiz, project, lab, webwork, problem set)
        EXAM = high-stakes assessments (exam, midterm, final, test)
        ATTENDANCE = participation tracking (attendance, daily activity, studio check-in, participation points)
        READING = non-graded EXPLICIT studying tasks (textbook sections, watching, viewing, listening) with no submission.
        PLACEHOLDER = grade calculation containers (NOT real assignments, e.g. "Total Points", "Overall Grade")

        IMPORTANT (Syllabus tables):
        If a class-session row contains a "Textbook Sections" / "Readings" column, you MUST create a TYPE 2 DISCOVERED entry with category="READING".
        - Create at most ONE READING item per class date.
        - Name format: "Reading: <sections summary>"

        Categorization rules:
        1. If name contains "exam", "midterm", "final", "test" → EXAM
        2. If name contains "attendance", "participation" AND is worth few points → ATTENDANCE
        3. If name contains "component", "total", "grade" AND no due date → PLACEHOLDER
        4. If name starts with "reading:" or is non-graded material → READING
        5. Everything else → ASSIGNMENT

        === DATA ===

        Canvas assignments (with their current due dates):
        {json.dumps([{
        "cid": a["canvas_assignment_id"],
        "nam": a["name"],
        "due": a.get("normalized_due_at") or a.get("original_due_at")
    } for a in assignments], ensure_ascii=False, separators=(",", ":"))}

        Course materials:
        {json.dumps({
        "announcements": announcements,
        "files": files
    }, ensure_ascii=False, indent=2)}

        Ensure to return no text other than the valid JSON
        """

    model = genai.GenerativeModel(MODEL_NAME)
    response = model.generate_content(full_prompt)
    raw_text = response.text.strip()
    cleaned = raw_text.replace("```json", "").replace("```", "").strip()

    try:
        parsed = json.loads(cleaned)

        # Handle backward compatibility if AI returns just a list
        # After parsed = json.loads(cleaned)

        # Backward compatibility if AI returns just a list
        if isinstance(parsed, list):
            return {"cc": "UNK", "a": parsed}

        assign_list = parsed.get("a") or parsed.get("assignments") or []

        expected_ids = {a["canvas_assignment_id"] for a in assignments if a.get("canvas_assignment_id")}
        returned_ids = {
            (r.get("cid") if "cid" in r else r.get("canvas_assignment_id"))
            for r in assign_list
            if isinstance(r, dict) and ((r.get("cid") if "cid" in r else r.get("canvas_assignment_id")) is not None)
        }

        missing = expected_ids - returned_ids
        # ... keep your warning print

        invalid_dates = []
        for r in assign_list:
            if not isinstance(r, dict):
                continue
            due = r.get("due") if "due" in r else r.get("normalized_due_at")
            if due and isinstance(due, str):
                if "T" in due and not ("+" in due.split("T")[1] or "-" in due.split("T")[1]):
                    invalid_dates.append({
                        "assignment": r.get("nam") or r.get("name") or r.get("cid") or r.get("canvas_assignment_id"),
                        "date": due
                    })

        if invalid_dates:
            print(f"⚠️  WARNING: {len(invalid_dates)} dates missing timezone offset:")
            for item in invalid_dates[:5]:
                print(f"    - {item['assignment']}: {item['date']}")

        return parsed
    except Exception as e:
        raise RuntimeError(
            f"Gemini JSON parse failed: {e}\nRaw output:\n{raw_text}"
        )
