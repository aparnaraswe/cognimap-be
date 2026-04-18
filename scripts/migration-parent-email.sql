-- ═══════════════════════════════════════════════════════════════
-- PARENT EMAIL & GUARDIAN LINKING
-- Adds parent_email column + linked_parent_id (FK to users)
-- This lets us auto-create a guardian user account when a student
-- is registered with a parent_email, and link the two records.
-- Also defensively adds the phone/gender/parent_name/parent_phone
-- columns from migration-v4 (in case that migration was skipped on
-- some environments).
-- Safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════

-- 1. Add parent_email column to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_email VARCHAR(255);

-- 2. Add linked_parent_id — points to the parent's user record
--    A student row may reference their guardian's user id here.
ALTER TABLE users ADD COLUMN IF NOT EXISTS linked_parent_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_linked_parent ON users(linked_parent_id);

-- 3. Add a reverse helper — track which student a guardian was created for
ALTER TABLE users ADD COLUMN IF NOT EXISTS linked_student_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_linked_student ON users(linked_student_id);

-- 4. Defensive: ensure the contact fields exist on users (originally added in migration-v4)
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone         VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_name   VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_phone  VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender        VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS status        VARCHAR(20) DEFAULT 'active';
