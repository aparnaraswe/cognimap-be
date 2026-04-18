-- ═══════════════════════════════════════════════════════════════
-- MULTI-SOURCE MIGRATION (the "real" model)
-- ═══════════════════════════════════════════════════════════════
-- Establishes:
--   • sources = top-level institutions (the canonical "tenant")
--   • items can belong to MULTIPLE sources (many-to-many via item_sources)
--   • batches nested INSIDE sources (each batch belongs to one source)
--   • users / sessions / reports strictly scoped by source_id
--   • organizations table is preserved as a no-op alias (will be dropped later)
-- Safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════

-- ── 0. Ensure sources table exists (in case migration-sources.sql wasn't run) ──
CREATE TABLE IF NOT EXISTS sources (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name    VARCHAR(255) NOT NULL,
    source_code     VARCHAR(60)  NOT NULL UNIQUE,
    description     TEXT,
    type            VARCHAR(30)  DEFAULT 'school',
    contact_name    VARCHAR(255),
    contact_email   VARCHAR(255),
    contact_phone   VARCHAR(30),
    address         TEXT,
    city            VARCHAR(100),
    state           VARCHAR(100),
    is_active       BOOLEAN      DEFAULT true,
    metadata        JSONB        DEFAULT '{}',
    created_at      TIMESTAMPTZ  DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sources_code   ON sources(source_code);
CREATE INDEX IF NOT EXISTS idx_sources_active ON sources(is_active);

-- ── 1. Ensure at least one source exists ──
INSERT INTO sources (id, display_name, source_code, type, is_active)
SELECT gen_random_uuid(), 'Default Institution', 'default', 'school', true
WHERE NOT EXISTS (SELECT 1 FROM sources LIMIT 1);

-- ── 1a. Ensure source_id columns exist on all relevant tables ──
ALTER TABLE users         ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES sources(id) ON DELETE SET NULL;
ALTER TABLE test_sessions ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES sources(id) ON DELETE SET NULL;
ALTER TABLE reports       ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES sources(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_source    ON users(source_id);
CREATE INDEX IF NOT EXISTS idx_sessions_source ON test_sessions(source_id);
CREATE INDEX IF NOT EXISTS idx_reports_source  ON reports(source_id);

-- ── 2. Add source_id to items table (primary source — the "owner") ──
ALTER TABLE items ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES sources(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_items_source ON items(source_id);

-- Backfill: items without a source get the default source
UPDATE items
SET source_id = (SELECT id FROM sources ORDER BY created_at ASC LIMIT 1)
WHERE source_id IS NULL;

-- ── 3. Create item_sources junction table (many-to-many) ──
CREATE TABLE IF NOT EXISTS item_sources (
    item_id    UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    source_id  UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    added_at   TIMESTAMPTZ DEFAULT NOW(),
    added_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (item_id, source_id)
);
CREATE INDEX IF NOT EXISTS idx_item_sources_source ON item_sources(source_id);
CREATE INDEX IF NOT EXISTS idx_item_sources_item   ON item_sources(item_id);

-- Backfill: every item with a source_id gets a row in item_sources
INSERT INTO item_sources (item_id, source_id)
SELECT id, source_id FROM items WHERE source_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── 4. Add source_id to batches (batches nested under sources) — only if batches exists ──
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'batches') THEN
        EXECUTE 'ALTER TABLE batches ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES sources(id) ON DELETE CASCADE';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_batches_source ON batches(source_id)';
        -- Backfill: batches without a source get the default source
        EXECUTE 'UPDATE batches SET source_id = (SELECT id FROM sources ORDER BY created_at ASC LIMIT 1) WHERE source_id IS NULL';
    END IF;
END $$;

-- ── 5. Backfill source_id on users / sessions / reports ──
-- Any record without a source gets the default source
UPDATE users
SET source_id = (SELECT id FROM sources ORDER BY created_at ASC LIMIT 1)
WHERE source_id IS NULL AND role NOT IN ('super_admin');

UPDATE test_sessions ts
SET source_id = u.source_id
FROM users u
WHERE ts.user_id = u.id AND ts.source_id IS NULL AND u.source_id IS NOT NULL;

UPDATE reports r
SET source_id = u.source_id
FROM users u
WHERE r.user_id = u.id AND r.source_id IS NULL AND u.source_id IS NOT NULL;

-- ── 6. Backfill batch source from member students (only if batches + users.batch_id exist) ──
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'batches')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'batch_id') THEN
        EXECUTE $sql$
            UPDATE batches b
            SET source_id = (
                SELECT u.source_id FROM users u WHERE u.batch_id = b.id AND u.source_id IS NOT NULL LIMIT 1
            )
            WHERE b.source_id IS NULL
        $sql$;
        EXECUTE 'UPDATE batches SET source_id = (SELECT id FROM sources ORDER BY created_at ASC LIMIT 1) WHERE source_id IS NULL';
    END IF;
END $$;

-- ── 7. Migrate organizations → sources (only if organizations table exists) ──
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizations') THEN
        INSERT INTO sources (display_name, source_code, type, address, city, state, contact_name, contact_email, contact_phone, is_active, metadata, created_at)
        SELECT
            o.name,
            LOWER(REGEXP_REPLACE(o.name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || SUBSTRING(o.id::text, 1, 8),
            COALESCE(o.type, 'school'),
            o.address, o.city, o.state, o.contact_name, o.contact_email, o.contact_phone,
            o.is_active, o.metadata, o.created_at
        FROM organizations o
        WHERE NOT EXISTS (
            SELECT 1 FROM sources s WHERE s.display_name = o.name
        )
        ON CONFLICT (source_code) DO NOTHING;
    END IF;
END $$;

-- ── 8. (Manual cleanup later — review before running) ──
-- Once you've verified the new model works:
--   ALTER TABLE users ALTER COLUMN source_id SET NOT NULL;
--   ALTER TABLE test_sessions ALTER COLUMN source_id SET NOT NULL;
--   ALTER TABLE reports ALTER COLUMN source_id SET NOT NULL;
--   ALTER TABLE batches ALTER COLUMN source_id SET NOT NULL;
--   ALTER TABLE items ALTER COLUMN source_id SET NOT NULL;
--   DROP TABLE IF EXISTS organizations CASCADE;
