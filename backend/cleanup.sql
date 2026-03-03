-- ✅ 1. REMOVE DUPLICATES FIRST (keep newest)
DELETE FROM course_file_text
WHERE id NOT IN (
  SELECT MAX(id)
  FROM course_file_text
  GROUP BY course_id, file_name, storage_path
);

-- ✅ 2. CONVERT syllabus → schedule
UPDATE course_file_text
SET file_type = 'schedule'
WHERE file_type = 'syllabus';

-- ✅ 3. ADD UNIQUE INDEX LAST (NOW SAFE)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_course_file
ON course_file_text (course_id, file_name, storage_path);
