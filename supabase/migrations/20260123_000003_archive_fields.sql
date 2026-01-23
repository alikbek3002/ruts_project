-- Add archived_at column to subjects
ALTER TABLE "subjects" 
ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ DEFAULT NULL;

-- Add archived_at column to classes
ALTER TABLE "classes" 
ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ DEFAULT NULL;

-- Add archived_at column to users (for archiving teachers/students)
-- Note: users table is usually public.users or auth.users depending on setup, 
-- assuming public.users based on project context
ALTER TABLE "users" 
ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ DEFAULT NULL;

-- Create indices for performance on frequent filtering
CREATE INDEX IF NOT EXISTS "idx_subjects_archived_at" ON "subjects" ("archived_at");
CREATE INDEX IF NOT EXISTS "idx_classes_archived_at" ON "classes" ("archived_at");
CREATE INDEX IF NOT EXISTS "idx_users_archived_at" ON "users" ("archived_at");

-- Update RLS policies (optional, generally Admins can see everything, 
-- but public read might need filtering if implemented via RLS. 
-- For now, API filtering is the primary method).
