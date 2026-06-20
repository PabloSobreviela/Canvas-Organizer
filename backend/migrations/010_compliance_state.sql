-- Consolidated production compliance migration.
--
-- Safe to run more than once. This migration intentionally does not delete
-- current application data. Deprecated-data cleanup is an explicit operator
-- action and must not be repeated during future deploys.

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS legal_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS legal_consent_version TEXT,
  ADD COLUMN IF NOT EXISTS session_version INT NOT NULL DEFAULT 0;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_file_texts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.syllabus_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- The backend is the only database client. Remove Data API privileges from
-- browser-facing roles in addition to denying rows with RLS. Keep the service
-- role explicit because the Cloud Run backend uses it.
REVOKE ALL ON TABLE public.users FROM anon, authenticated;
REVOKE ALL ON TABLE public.courses FROM anon, authenticated;
REVOKE ALL ON TABLE public.assignments FROM anon, authenticated;
REVOKE ALL ON TABLE public.course_file_texts FROM anon, authenticated;
REVOKE ALL ON TABLE public.announcements FROM anon, authenticated;
REVOKE ALL ON TABLE public.syllabus_rules FROM anon, authenticated;
REVOKE ALL ON TABLE public.rate_limits FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.users TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.courses TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assignments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.course_file_texts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.announcements TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.syllabus_rules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rate_limits TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, PUBLIC;

DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Users can view own courses" ON public.courses;
DROP POLICY IF EXISTS "Users can manage own courses" ON public.courses;
DROP POLICY IF EXISTS "Users can view own assignments" ON public.assignments;
DROP POLICY IF EXISTS "Users can manage own assignments" ON public.assignments;
DROP POLICY IF EXISTS "Users can view own files" ON public.course_file_texts;
DROP POLICY IF EXISTS "Users can manage own files" ON public.course_file_texts;
DROP POLICY IF EXISTS "Users can view own announcements" ON public.announcements;
DROP POLICY IF EXISTS "Users can manage own announcements" ON public.announcements;
DROP POLICY IF EXISTS "Users can view own syllabus rules" ON public.syllabus_rules;
DROP POLICY IF EXISTS "Users can manage own syllabus rules" ON public.syllabus_rules;
DROP POLICY IF EXISTS "Users can view own rate limits" ON public.rate_limits;
DROP POLICY IF EXISTS "Users can manage own rate limits" ON public.rate_limits;

DROP POLICY IF EXISTS deny_direct_users ON public.users;
DROP POLICY IF EXISTS deny_direct_courses ON public.courses;
DROP POLICY IF EXISTS deny_direct_assignments ON public.assignments;
DROP POLICY IF EXISTS deny_direct_course_file_texts ON public.course_file_texts;
DROP POLICY IF EXISTS deny_direct_file_texts ON public.course_file_texts;
DROP POLICY IF EXISTS deny_direct_announcements ON public.announcements;
DROP POLICY IF EXISTS deny_direct_syllabus_rules ON public.syllabus_rules;
DROP POLICY IF EXISTS deny_direct_rate_limits ON public.rate_limits;

CREATE POLICY deny_direct_users
  ON public.users FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY deny_direct_courses
  ON public.courses FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY deny_direct_assignments
  ON public.assignments FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY deny_direct_course_file_texts
  ON public.course_file_texts FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY deny_direct_announcements
  ON public.announcements FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY deny_direct_syllabus_rules
  ON public.syllabus_rules FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY deny_direct_rate_limits
  ON public.rate_limits FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_assignments_synced_at
  ON public.assignments (synced_at);
CREATE INDEX IF NOT EXISTS idx_courses_synced_at
  ON public.courses (synced_at);
CREATE INDEX IF NOT EXISTS idx_course_file_texts_created_at
  ON public.course_file_texts (created_at);
CREATE INDEX IF NOT EXISTS idx_announcements_posted_at
  ON public.announcements (posted_at);
CREATE INDEX IF NOT EXISTS idx_syllabus_rules_extracted_at
  ON public.syllabus_rules (extracted_at);
CREATE INDEX IF NOT EXISTS idx_users_last_login
  ON public.users (last_login);

DROP TABLE IF EXISTS public.ai_usage_logs;

COMMIT;
