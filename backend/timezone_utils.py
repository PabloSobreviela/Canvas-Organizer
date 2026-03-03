from datetime import datetime
from zoneinfo import ZoneInfo
import re


def normalize_to_iso_with_tz(date_input, course_timezone="America/New_York"):
    """
    Normalize any date input to ISO-8601 with explicit timezone.

    Handles:
    - None/empty -> None
    - Already has timezone -> convert to course timezone
    - No timezone -> assume course timezone
    - Invalid -> None

    Returns: ISO-8601 string with timezone (e.g., "2025-02-03T18:50:00-05:00") or None
    """
    if not date_input:
        return None

    # If already a datetime object
    if isinstance(date_input, datetime):
        if date_input.tzinfo is None:
            # Assume course timezone
            dt = date_input.replace(tzinfo=ZoneInfo(course_timezone))
        else:
            # Convert to course timezone
            dt = date_input.astimezone(ZoneInfo(course_timezone))
        return dt.isoformat()

    # If string, try to parse
    date_str = str(date_input).strip()

    try:
        # Try parsing with various formats
        dt = None

        # ISO format with timezone (e.g., "2025-02-03T18:50:00-05:00" or "2025-02-03T18:50:00Z")
        if re.match(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}', date_str):
            dt = datetime.fromisoformat(date_str)
        elif re.match(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', date_str):
            dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        # ISO format without timezone (e.g., "2025-02-03T18:50:00")
        elif re.match(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}', date_str):
            dt = datetime.fromisoformat(date_str)
            dt = dt.replace(tzinfo=ZoneInfo(course_timezone))
        # Canvas format (e.g., "2025-02-03T23:59:59Z")
        elif 'T' in date_str:
            dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        else:
            return None

        # Ensure it's in the course timezone
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo(course_timezone))
        else:
            dt = dt.astimezone(ZoneInfo(course_timezone))

        return dt.isoformat()

    except Exception as e:
        print(f"[WARN] Failed to parse date '{date_str}': {e}")
        return None


def parse_relative_date(relative_str, anchor_date=None, course_timezone="America/New_York"):
    """
    Parse relative dates like "next Monday", "in 2 weeks", etc.

    NOT IMPLEMENTED - placeholder for future enhancement.
    Returns None for now (should be handled by Gemini).
    """
    return None


def validate_date_is_reasonable(date_str, min_year=2024, max_year=2026):
    """
    Basic sanity check: is this date in a reasonable range for course deadlines?
    """
    if not date_str:
        return False

    try:
        dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        return min_year <= dt.year <= max_year
    except:
        return False


def format_for_display(iso_date, course_timezone="America/New_York", format_style="short"):
    """
    Format ISO date for human-readable display.

    format_style:
    - "short": "02/03/2025, 18:50"
    - "long": "February 3, 2025 at 6:50 PM"
    - "date_only": "02/03/2025"
    """
    if not iso_date:
        return "No due date"

    try:
        dt = datetime.fromisoformat(iso_date.replace('Z', '+00:00'))
        dt = dt.astimezone(ZoneInfo(course_timezone))

        if format_style == "short":
            return dt.strftime("%m/%d/%Y, %H:%M")
        elif format_style == "long":
            return dt.strftime("%B %d, %Y at %I:%M %p")
        elif format_style == "date_only":
            return dt.strftime("%m/%d/%Y")
        else:
            return dt.isoformat()
    except:
        return "Invalid date"
