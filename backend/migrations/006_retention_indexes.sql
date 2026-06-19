-- Retention support (docs/OIT_READINESS_AUDIT.md, R4)
-- Indexes that make the time-based purge in retention_service.py efficient.

CREATE INDEX IF NOT EXISTS idx_course_file_texts_created_at
    ON course_file_texts (created_at);

CREATE INDEX IF NOT EXISTS idx_announcements_posted_at
    ON announcements (posted_at);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at
    ON ai_usage_logs (created_at);
