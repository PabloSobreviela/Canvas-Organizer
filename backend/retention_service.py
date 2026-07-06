"""

Retention enforcement (docs/OIT_READINESS_AUDIT.md, R4).



Deletes stored content older than the configured retention windows. Intended to

run either:



  - as a scheduled Cloud Run Job:   python retention_service.py

Retention windows are defined in app_config.py and overridable via env vars.

A value of 0 disables purging for that category.

"""



from __future__ import annotations



import logging



import app_config

from db_supabase import (

    purge_course_file_texts_older_than,

    purge_announcements_older_than,

    purge_assignments_older_than,

    purge_courses_older_than,

    purge_syllabus_rules_older_than,

    purge_inactive_user_content,

)



logger = logging.getLogger(__name__)





def run_retention() -> dict:

    """Apply all configured retention windows. Returns per-category delete counts."""

    results = {

        "course_file_texts": purge_course_file_texts_older_than(

            app_config.COURSE_FILE_TEXT_RETENTION_DAYS

        ),

        "announcements": purge_announcements_older_than(

            app_config.ANNOUNCEMENT_RETENTION_DAYS

        ),

        "assignments": purge_assignments_older_than(

            app_config.ASSIGNMENT_RETENTION_DAYS

        ),

        "courses": purge_courses_older_than(

            app_config.COURSE_RETENTION_DAYS

        ),

        "syllabus_rules": purge_syllabus_rules_older_than(

            app_config.SYLLABUS_RULES_RETENTION_DAYS

        ),

    }

    if app_config.INACTIVE_USER_CONTENT_PURGE_DAYS > 0:

        results["inactive_users"] = purge_inactive_user_content(

            app_config.INACTIVE_USER_CONTENT_PURGE_DAYS

        )

    logger.info("Retention run complete: %s", results)

    return results

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(run_retention())
