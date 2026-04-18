-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Sources (Multi-Tenant School / Institution Support)
-- ═══════════════════════════════════════════════════════════════
-- Run once against the live database.
-- Sources = named tenants (schools, tuition centres, companies).
-- Every user can belong to a source; every test session inherits it.
-- ═══════════════════════════════════════════════════════════════

-- 1. Create the sources table
CREATE TABLE IF NOT EXISTS sources (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name    VARCHAR(255) NOT NULL,           -- "IES School"
    source_code     VARCHAR(60)  NOT NULL UNIQUE,    -- "ies"  (slug, lowercase, no spaces)
    description     TEXT,
    type            VARCHAR(30)  DEFAULT 'school'
                        CHECK (type IN ('school','tuition','company','clinic','other')),
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

CREATE INDEX IF NOT EXISTS idx_sources_code     ON sources(source_code);
CREATE INDEX IF NOT EXISTS idx_sources_active   ON sources(is_active);

-- 2. Add source_id + enrollment_type to users
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS source_id        UUID REFERENCES sources(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS enrollment_type  VARCHAR(20) DEFAULT 'individual'
        CHECK (enrollment_type IN ('school_batch', 'individual', 'tuition', 'corporate'));

CREATE INDEX IF NOT EXISTS idx_users_source_id ON users(source_id);

-- 3. Add source_id to test_sessions (inherit at session assignment time)
ALTER TABLE test_sessions
    ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES sources(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_source_id ON test_sessions(source_id);

-- 4. Add source_id to reports (for filtered dashboards)
ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES sources(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reports_source_id ON reports(source_id);
