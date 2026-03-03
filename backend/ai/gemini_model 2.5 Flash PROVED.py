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
    full_prompt = f"""You are a deadline reconciliation system. Your job: match Canvas assignments to schedule entries and discover new ones.

        === PURPOSE (NON-NEGOTIABLE) ===
        Your purpose is to DISCOVER assignments, MATCH them to existing Canvas assignments, and FILL missing dates/times.
        You are NOT here to debate, “challenge”, or second-guess due dates.

        You should almost never change an existing Canvas due date/time. Only do so in VERY, VERY EXTREME cases (defined below).

        === CORE RULES (READ FIRST) ===

        1) MATCHING PRIORITY (always first):
           Before discovering anything new, check if it matches an existing Canvas assignment by name.
           - "Homework 0" in Canvas + "Homework 0 (1/14)" in schedule = SAME assignment
           - If names match → output a TYPE 1 update for that Canvas item (do NOT create a duplicate TYPE 2)
           - HOMEWORK 0 COUNTS as asn assignment even if it's homework 0

        2) PRESERVE CANVAS DUE DATES (strong rule):
           Canvas due dates/times are usually correct. Keep them unless you meet the EXTREME OVERRIDE rule.
           - If Canvas has a due_at and schedule mentions the same item without an explicit different due date/time → keep Canvas exactly.
           - If Canvas has due_at and schedule disagrees → STILL keep Canvas by default (do not argue; do not “fix”).
           - Use schedule primarily to fill missing Canvas due_at (Canvas due_at is null) or to confirm (without changing).

           EXTREME OVERRIDE (the only time you may change an existing Canvas due_at):
           You may change a Canvas due_at ONLY if ALL conditions are met:
           (a) The schedule/materials explicitly state a different due date/time for the SAME assignment, AND
           (b) The statement is clearly authoritative and unambiguous (e.g., official course calendar/announcement/LMS text), AND

           Otherwise: do NOT change Canvas due_at. (Prefer status="RESOLVED")

           NOTE: “Explicitly contradicted” means the source literally gives a different date/time, not a suggestion or implication.

        3) DATES MUST HAVE TIMEZONES:
           All dates must be ISO-8601 with timezone: {course_timezone}
           - Valid: "2025-01-14T12:00:00-05:00"
           - If the source gives only a DATE (no time), set the time to 23:59:00 in {course_timezone}.
           - For DISCOVERED READING items where no date is stated at all, set normalized_due_at = null (still status="DISCOVERED").
           - When receiving start and end dates ALWAYS mark the start date.

        4) NO HALLUCINATIONS:
           Only discover items explicitly written in the provided text.
           - If unsure, skip it
           - Do NOT waste thinking tokens on inferred assignments. Only list EXPLICITLY LISTED ASSIGNMENTS, be it in the assignment tab or in the schedule/syllabus files.

        5) Do NOT CREATE ASSIGNMENTS where there are none:
           You will receive confusing information that may slightly indicate student obligations but:
           - DO NOT DISCOVER an assignment that will not have a submission
           - When discovering assignments, infer only items that would have an external submission or are clearly graded deliverables
           - Signups, classes and special classes without submission DO NOT count and should NOT be listed

        === TIMEZONE REFERENCE ===
        {course_timezone}: Use -05:00 (EST) for Nov-Mar, -04:00 (EDT) for Mar-Oct

        # In gemini_model.py prompt string, replace the OUTPUT FORMAT section with:

    === OUTPUT FORMAT (STRICT JSON, MINIFIED) ===
    Return ONE JSON object, no extra text:

    {{
      "cc": "CS 1331",
      "a": [
        // TYPE 1 or TYPE 2 entries
      ]
    }}

    TYPE 1 - Canvas Assignment Updates:
    {{ "cid": 12345, "due": "YYYY-MM-DDTHH:MM:SS-05:00" | null, "cat": "EXAM", "st": "RESOLVED" }}

    TYPE 2 - New Discoveries:
    {{ "cid": null, "nam": "Exam 1", "des": "…", "cat": "EXAM", "due": "YYYY-MM-DDTHH:MM:SS-04:00" | null, "st": "DISCOVERED" }}

        Status values:
        - RESOLVED: No conflicts, date confirmed
        - CONFLICT: Same assignment has different dates in different sources
          Specific conflict rules: try by all means possible to correctly determine the value of a conflict.
          If it is reasonably difficult to infer and you would not be confident in the resulting value do use the conflict tag but avoid it.
        - CANNOT_DETERMINE: No due date found
        - DISCOVERED: New item found in schedule (TYPE 2 only)

        === REQUIREMENTS ===

        **For every Canvas assignment, you MUST output exactly ONE TYPE 1 entry.**

        If Canvas has a due date and you find no EXTREME OVERRIDE:
        - status="RESOLVED"
        - normalized_due_at = Canvas date (keep exact time)

        If no due date found anywhere:
        - status="CANNOT_DETERMINE"
        - normalized_due_at=null

        === CATEGORIES ===

        You must categorize EVERY assignment (both Canvas and discovered) into ONE of these categories:

        ASSIGNMENT = regular graded deliverables (homework, quiz, project, lab, webwork, problem set)
        EXAM = high-stakes assessments (exam, midterm, final, test)
        QUIZ = graded mini-tests (quiz, short quiz, checkpoint, weekly quiz) that are NOT midterms/finals
          - Quiz specification: be careful when labeling quizzes: Attendance quizzes are STILL attendance, and the word quiz is not 100% definitive. Look at context
          - Pay special attention to every item labeled quiz as they have a high mislabel rate
        ATTENDANCE = participation tracking (attendance, daily activity, studio check-in, participation points)
        READING = non-graded studying tasks (textbook sections, watching, viewing, listening) with no submission: only identify explicit reading instructions, not inferred.

        IMPORTANT (Syllabus tables):
        If a class-session row contains a "Textbook Sections" / "Readings" column (examples: lines like "G:", "K&T:", "L:", "Chapter", "Sections", "pp.", "pages"),
        you MUST create a TYPE 2 DISCOVERED entry with category="READING".

        Rules for these READING discoveries:
        - Create at most ONE READING item per class date (merge all book/section references from that row into one item).
        - Use the class date as normalized_due_at at 23:59:00 in {course_timezone}.
        - The "name" MUST be the textbook sections summary (NOT the date).
          - Format: "Read: <sections>", e.g. "Read: G 3.1–3.3 & 5.1–5.3; K&T 1.1–1.2; L 0.3–0.4"
          - Keep it concise (≤ 120 characters). If longer, truncate with "…".
        - Put the FULL textbook sections text in "description" (can be multi-line).
        - Lecture materials DO NOT COUNT as reading-> Only list readings if specified in the syllabus

        PLACEHOLDER = grade calculation containers (NOT real assignments)
          - Examples: "Overall Grade", "Exam Component", "Phase I Individual Score", "Total Points"
          - Usually have NO due date AND no submission required
          - Purpose: organize grades, not actual work

        Categorization rules:
        1. If name contains "exam", "midterm", "final", "test" → EXAM
        2. If name contains "quiz" or "checkpoint" → QUIZ
        3. If name contains "attendance", "participation", "daily activity", "studio" AND is worth few points (0-5) → ATTENDANCE
        4. If name contains "component", "total", "grade", "score", "individual score" AND no due date → PLACEHOLDER
        5. If name starts with "reading:" or is non-graded material → READING
        6. Everything else → ASSIGNMENT

        CRITICAL: For Canvas assignments, you MUST output a "category" field in your TYPE 1 response.

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
