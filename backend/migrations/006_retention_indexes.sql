-- Retention support (docs/OIT_READINESS_AUDIT.md, R4)
-- Indexes that make the time-based purge in retention_service.py efficient.

CREATE INDEX IF NOT EXISTS idx_course_file_texts_created_at
    ON course_file_texts (created_at);

CREATE INDEX IF NOT EXISTS idx_announcements_posted_at
    ON announcements (posted_at);

CREATE INDEX IF NOT EXISTS idx_assignments_synced_at
    ON assignments (synced_at);

CREATE INDEX IF NOT EXISTS idx_courses_synced_at
    ON courses (synced_at);

CREATE INDEX IF NOT EXISTS idx_syllabus_rules_extracted_at
    ON syllabus_rules (extracted_at);

CREATE INDEX IF NOT EXISTS idx_users_last_login
    ON users (last_login);
