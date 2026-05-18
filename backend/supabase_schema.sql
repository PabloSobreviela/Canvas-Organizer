-- Canvas Organizer - Supabase Schema
-- Replaces Firestore collections with Postgres tables
-- Run this in the Supabase SQL Editor to set up the database

-- Users table (replaces Firestore 'users' collection)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canvas_user_id TEXT UNIQUE,
    canvas_instance_url TEXT,
    email TEXT,
    display_name TEXT,
    avatar_url TEXT,
    canvas_api_url TEXT,
    canvas_api_token_encrypted TEXT,
    canvas_credential_key TEXT,
    canvas_access_token_encrypted TEXT,
    canvas_refresh_token_encrypted TEXT,
    canvas_token_expires_at TIMESTAMPTZ,
    course_colors JSONB DEFAULT '{}',
    starred_courses JSONB DEFAULT '{}',
    sync_enabled_courses JSONB DEFAULT '{}',
    completed_items JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- Courses table (replaces Firestore 'users/{id}/courses' subcollection)
CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    canvas_course_id TEXT NOT NULL,
    canvas_course_id_str TEXT,
    course_name TEXT,
    course_code TEXT,
    canvas_credential_key TEXT,
    metadata JSONB DEFAULT '{}',
    sync_version INT DEFAULT 0,
    last_sync_at TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, canvas_credential_key, canvas_course_id)
);

CREATE INDEX IF NOT EXISTS idx_courses_user_id ON courses (user_id);
CREATE INDEX IF NOT EXISTS idx_courses_canvas_id ON courses (user_id, canvas_course_id_str);

-- Assignments table (replaces Firestore 'users/{id}/assignments' subcollection)
CREATE TABLE IF NOT EXISTS assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id TEXT NOT NULL,
    name TEXT,
    description TEXT,
    original_due_at TEXT,
    normalized_due_at TEXT,
    canvas_assignment_id INT,
    source_of_truth TEXT DEFAULT 'Canvas',
    confidence FLOAT,
    status TEXT DEFAULT 'OK',
    category TEXT DEFAULT 'ASSIGNMENT',
    deliverable INT DEFAULT 1,
    raw_canvas_json JSONB,
    discovered_key TEXT,
    course_name TEXT,
    course_code TEXT,
    canvas_credential_key TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignments_user_id ON assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_assignments_course ON assignments (user_id, course_id);
CREATE INDEX IF NOT EXISTS idx_assignments_canvas_id ON assignments (user_id, course_id, canvas_assignment_id);
CREATE INDEX IF NOT EXISTS idx_assignments_discovered ON assignments (user_id, discovered_key);

-- Course file texts (replaces Firestore 'users/{id}/courseFileText' subcollection)
CREATE TABLE IF NOT EXISTS course_file_texts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id TEXT NOT NULL,
    canvas_file_id TEXT,
    file_type TEXT DEFAULT 'schedule',
    file_name TEXT,
    storage_path TEXT,
    extracted_text TEXT,
    sync_version INT,
    is_previous BOOLEAN DEFAULT FALSE,
    archived_at TIMESTAMPTZ,
    canvas_credential_key TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cft_user_course ON course_file_texts (user_id, course_id);
CREATE INDEX IF NOT EXISTS idx_cft_type ON course_file_texts (user_id, course_id, file_type);

-- Announcements (replaces Firestore 'users/{id}/announcements' subcollection)
CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id TEXT NOT NULL,
    canvas_announcement_id TEXT,
    title TEXT,
    message TEXT,
    posted_at TEXT,
    raw_json JSONB,
    canvas_credential_key TEXT,
    UNIQUE(user_id, course_id, canvas_announcement_id, canvas_credential_key)
);

CREATE INDEX IF NOT EXISTS idx_announcements_course ON announcements (user_id, course_id);

-- Syllabus rules (replaces Firestore 'users/{id}/syllabusRules' subcollection)
CREATE TABLE IF NOT EXISTS syllabus_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id TEXT NOT NULL,
    course_name TEXT,
    rules_json TEXT,
    canvas_credential_key TEXT,
    extracted_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, course_id, canvas_credential_key)
);

-- AI usage logs (replaces Firestore 'users/{id}/aiUsageLogs' subcollection)
CREATE TABLE IF NOT EXISTS ai_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id TEXT,
    request_id TEXT,
    operation TEXT,
    model TEXT,
    input_tokens INT DEFAULT 0,
    output_tokens INT DEFAULT 0,
    total_tokens INT DEFAULT 0,
    cached_tokens INT DEFAULT 0,
    estimated_cost_usd FLOAT DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    pricing_source TEXT DEFAULT 'unconfigured',
    status TEXT DEFAULT 'ok',
    prompt_chars INT DEFAULT 0,
    is_resync BOOLEAN,
    canvas_credential_key TEXT,
    raw_json JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_logs_user ON ai_usage_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_logs_created ON ai_usage_logs (user_id, created_at DESC);

-- Rate limits (replaces Firestore '_systemRateLimits' collection)
CREATE TABLE IF NOT EXISTS rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    limit_key TEXT NOT NULL,
    time_window TEXT DEFAULT 'hour',
    bucket_id TEXT NOT NULL,
    count INT DEFAULT 0,
    limit_value INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, limit_key, time_window, bucket_id)
);

-- Enable Row Level Security on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_file_texts ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE syllabus_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- RLS policies: backend uses service_role key which bypasses RLS.
-- These policies are for any future direct client access.
CREATE POLICY "Users can view own data" ON users FOR SELECT USING (true);
CREATE POLICY "Users can view own courses" ON courses FOR SELECT USING (true);
CREATE POLICY "Users can view own assignments" ON assignments FOR SELECT USING (true);
CREATE POLICY "Users can view own file texts" ON course_file_texts FOR SELECT USING (true);
CREATE POLICY "Users can view own announcements" ON announcements FOR SELECT USING (true);
CREATE POLICY "Users can view own syllabus rules" ON syllabus_rules FOR SELECT USING (true);
CREATE POLICY "Users can view own ai logs" ON ai_usage_logs FOR SELECT USING (true);
CREATE POLICY "Service can manage rate limits" ON rate_limits FOR ALL USING (true);

-- Create storage bucket for course files
INSERT INTO storage.buckets (id, name, public) VALUES ('course-files', 'course-files', false)
ON CONFLICT (id) DO NOTHING;
