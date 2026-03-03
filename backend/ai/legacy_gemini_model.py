def resolve_assignment_dates_with_gemini(
        assignments,
        announcements,
        files,
        course_timezone,
        confidence_threshold=0.85,
        discover_new_assignments=True
):
    full_prompt = f"""You are a basic syllabus matcher. You must return JSON strictly adhering to the schema below.

    === TASKS ===

    TASK 1: UPDATE EXISTING CANVAS ITEMS (Type 1)
    - Iterate through every item in [CANVAS LIST].
    - If the item has a date ("due"), keep it.
    - If "due" is null, search [SYLLABUS] for the assignment name. If found, fill the date.
    - OUTPUT: A Type 1 entry (structure below).
    - CRITICAL: You must output one Type 1 entry for every ID in the input list.

    TASK 2: DISCOVER READINGS (Type 2)
    - Scan [SYLLABUS] for "Reading" or "Textbook" sections.
    - OUTPUT: A Type 2 entry (structure below).
    - RESTRICTION: Do NOT discover new Homeworks, Exams, or Quizzes. Only discover Readings.

    === SCHEMA RULES ===
    - You must include ALL fields: "cid", "nam", "des", "cat", "due", "st".
    - "des" (Description): Use null for Type 1. Use the reading details (e.g. "Chapter 1-3") for Type 2.
    - "cat" (Category): Use "ASSIGNMENT" for Type 1. Use "READING" for Type 2.
    - "st" (Status): 
        - "RESOLVED" (if date exists or found).
        - "CANNOT_DETERMINE" (if date missing).
        - "DISCOVERED" (for new Readings).
    - Timezone: {course_timezone}. Use 23:59:00 if time is missing.

    === INPUT DATA ===
    [CANVAS LIST]:
    {json.dumps([{
        "cid": a["canvas_assignment_id"],
        "nam": a["name"],
        "due": a.get("normalized_due_at") or a.get("original_due_at")
    } for a in assignments], ensure_ascii=False)}

    [SYLLABUS]:
    {json.dumps({"files": files, "announcements": announcements}, ensure_ascii=False, indent=None)}

    === OUTPUT FORMAT ===
    Return exactly this JSON structure:
    {{
      "cc": "CS 1331",
      "a": [
        // TYPE 1 EXAMPLE (Existing Item):
        {{ 
           "cid": 12345, 
           "nam": "HW 1", 
           "des": null, 
           "cat": "ASSIGNMENT", 
           "due": "2025-01-01T23:59:00-05:00", 
           "st": "RESOLVED" 
        }},
        // TYPE 2 EXAMPLE (New Reading):
        {{ 
           "cid": null, 
           "nam": "Read: Chapter 1", 
           "des": "Read pages 10-20", 
           "cat": "READING", 
           "due": "2025-01-02T23:59:00-05:00", 
           "st": "DISCOVERED" 
        }}
      ]
    }}
    """

    model = genai.GenerativeModel(MODEL_NAME)

    # Low temp is critical for Flash to follow strict JSON schemas
    generation_config = genai.GenerationConfig(
        temperature=0.1,
        response_mime_type="application/json"
    )

    try:
        response = model.generate_content(full_prompt, generation_config=generation_config)
        cleaned = response.text.strip()
        parsed = json.loads(cleaned)

        # --- SCHEMA HARDENING ---
        # 2.0 Flash is fast but can sometimes miss keys. This block ensures
        # your downstream system gets the exact keys it expects, preventing crashes.

        # Handle root object wrapper
        if isinstance(parsed, list):
            parsed = {"cc": "UNK", "a": parsed}

        assign_list = parsed.get("a") or parsed.get("assignments") or []
        validated_list = []

        for item in assign_list:
            # Enforce your legacy schema structure
            validated_item = {
                "cid": item.get("cid"),
                "nam": item.get("nam", "Unknown"),
                "des": item.get("des"),  # Ensure key exists (can be null)
                "cat": item.get("cat", "ASSIGNMENT"),
                "due": item.get("due"),
                "st": item.get("st", "CANNOT_DETERMINE")
            }

            # Simple Categorization Fallback (Python side)
            if validated_item["cid"] is not None:
                name_lower = validated_item["nam"].lower()
                if "exam" in name_lower or "midterm" in name_lower:
                    validated_item["cat"] = "EXAM"
                elif "quiz" in name_lower:
                    validated_item["cat"] = "QUIZ"
                else:
                    validated_item["cat"] = "ASSIGNMENT"

            validated_list.append(validated_item)

        return {"cc": "CS 1331", "a": validated_list}

    except Exception as e:
        print(f"Gemini Processing Failed: {e}")
        # FAILSAFE: Return original list in exact schema so system continues
        fallback = []
        for a in assignments:
            fallback.append({
                "cid": a["canvas_assignment_id"],
                "nam": a["name"],
                "des": None,
                "cat": "ASSIGNMENT",
                "due": a.get("normalized_due_at"),
                "st": "CANNOT_DETERMINE"
            })
        return {"cc": "ERR", "a": fallback}