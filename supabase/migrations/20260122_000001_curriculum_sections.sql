-- Add new columns to direction_subjects table
ALTER TABLE direction_subjects 
ADD COLUMN IF NOT EXISTS section TEXT DEFAULT 'general',
ADD COLUMN IF NOT EXISTS has_credit BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS has_exam BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS has_test BOOLEAN DEFAULT FALSE;

-- Update existing records to have default section
UPDATE direction_subjects SET section = 'general' WHERE section IS NULL;

COMMENT ON COLUMN direction_subjects.section IS 'Section category: general, special_legal, special';
COMMENT ON COLUMN direction_subjects.has_credit IS 'Whether subject has credit (зачет)';
COMMENT ON COLUMN direction_subjects.has_exam IS 'Whether subject has exam (экзамен)';
COMMENT ON COLUMN direction_subjects.has_test IS 'Whether subject has computer test (комп. тест)';
