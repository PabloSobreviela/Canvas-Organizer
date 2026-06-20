-- Fix permissive RLS policies: deny direct client access; backend uses service_role only.
-- Run in Supabase SQL Editor after initial schema deploy.

DROP POLICY IF EXISTS "Users can view own data" ON users;
DROP POLICY IF EXISTS "Users can view own courses" ON courses;
DROP POLICY IF EXISTS "Users can view own assignments" ON assignments;
DROP POLICY IF EXISTS "Users can view own file texts" ON course_file_texts;
DROP POLICY IF EXISTS "Users can view own announcements" ON announcements;
DROP POLICY IF EXISTS "Users can view own syllabus rules" ON syllabus_rules;
DROP POLICY IF EXISTS "Service can manage rate limits" ON rate_limits;
DROP POLICY IF EXISTS "deny_direct_users" ON users;
DROP POLICY IF EXISTS "deny_direct_courses" ON courses;
DROP POLICY IF EXISTS "deny_direct_assignments" ON assignments;
DROP POLICY IF EXISTS "deny_direct_file_texts" ON course_file_texts;
DROP POLICY IF EXISTS "deny_direct_announcements" ON announcements;
DROP POLICY IF EXISTS "deny_direct_syllabus_rules" ON syllabus_rules;
DROP POLICY IF EXISTS "deny_direct_rate_limits" ON rate_limits;

REVOKE ALL ON TABLE users, courses, assignments, course_file_texts, announcements, syllabus_rules, rate_limits
  FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE users, courses, assignments, course_file_texts, announcements, syllabus_rules, rate_limits
  TO service_role;

-- Deny all direct access for anon/authenticated roles (service_role bypasses RLS).
CREATE POLICY "deny_direct_users" ON users FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_direct_courses" ON courses FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_direct_assignments" ON assignments FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_direct_file_texts" ON course_file_texts FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_direct_announcements" ON announcements FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_direct_syllabus_rules" ON syllabus_rules FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_direct_rate_limits" ON rate_limits FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
