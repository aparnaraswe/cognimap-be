-- ═══════════════════════════════════════════════════════════════
-- BATCHES MIGRATION (Option B + C)
-- Replaces the `sources` table with `batches` (groupings within an organization)
-- Each batch represents a class/group/cohort within the single college (organization)
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Create batches table ──
CREATE TABLE IF NOT EXISTS batches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,        -- "Grade 10 — Section A"
    code            VARCHAR(60),                  -- short code like "10A"
    description     TEXT,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    grade           VARCHAR(20),                  -- "Grade 10"
    section         VARCHAR(20),                  -- "A"
    academic_year   VARCHAR(20),                  -- "2025-26"
    is_active       BOOLEAN DEFAULT true,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_batches_org ON batches(organization_id);
CREATE INDEX IF NOT EXISTS idx_batches_active ON batches(is_active);
CREATE INDEX IF NOT EXISTS idx_batches_grade ON batches(grade);

-- ── 2. Add batch_id to users, sessions, reports ──
ALTER TABLE users         ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES batches(id) ON DELETE SET NULL;
ALTER TABLE test_sessions ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES batches(id) ON DELETE SET NULL;
ALTER TABLE reports       ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_batch    ON users(batch_id);
CREATE INDEX IF NOT EXISTS idx_sessions_batch ON test_sessions(batch_id);
CREATE INDEX IF NOT EXISTS idx_reports_batch  ON reports(batch_id);

-- ── 3. Migrate existing sources → batches (if sources table exists) ──
-- Treats each existing source as a batch in the default organization.
-- Safe to run multiple times.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sources') THEN
        -- Copy each source into batches with the same id (so existing references still work)
        INSERT INTO batches (id, name, code, description, is_active, metadata, created_at, updated_at)
        SELECT s.id, s.display_name, s.source_code, s.description, s.is_active, s.metadata, s.created_at, s.updated_at
        FROM sources s
        ON CONFLICT (id) DO NOTHING;

        -- Copy source_id → batch_id where columns exist
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'source_id') THEN
            UPDATE users SET batch_id = source_id WHERE source_id IS NOT NULL AND batch_id IS NULL;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'test_sessions' AND column_name = 'source_id') THEN
            UPDATE test_sessions SET batch_id = source_id WHERE source_id IS NOT NULL AND batch_id IS NULL;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reports' AND column_name = 'source_id') THEN
            UPDATE reports SET batch_id = source_id WHERE source_id IS NOT NULL AND batch_id IS NULL;
        END IF;
    END IF;
END $$;

-- ── 4. Ensure at least one organization exists (the single college this deployment is for) ──
-- If no organizations exist, create a default one
INSERT INTO organizations (id, name, type, is_active)
SELECT gen_random_uuid(), 'My Institution', 'school', true
WHERE NOT EXISTS (SELECT 1 FROM organizations LIMIT 1);

-- ── 5. Backfill: link all batches to the first organization if not yet linked ──
UPDATE batches
SET organization_id = (SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1)
WHERE organization_id IS NULL;

-- ── 6. Backfill: link all users without an org to the first org ──
UPDATE users
SET organization_id = (SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1)
WHERE organization_id IS NULL AND role NOT IN ('super_admin');

-- ── 7. (Manual cleanup later — DO NOT run automatically) ──
-- After confirming the migration works:
--   ALTER TABLE users DROP COLUMN IF EXISTS source_id;
--   ALTER TABLE test_sessions DROP COLUMN IF EXISTS source_id;
--   ALTER TABLE reports DROP COLUMN IF EXISTS source_id;
--   DROP TABLE IF EXISTS sources;
