-- ═══════════════════════════════════════════════════════════════════════════════
-- COGNIMAP — MASTER MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════════
-- Run this ONCE on a fresh or existing database to bring it to the latest schema.
-- Every statement is idempotent (IF NOT EXISTS / IF EXISTS guards) — safe to re-run.
--
-- Usage:
--   psql -U postgres -d cognimap -f scripts/migration-master.sql
--   OR: node scripts/run-migration.js migration-master.sql
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. CORE TABLES (from schema.sql)
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1a. Organizations
CREATE TABLE IF NOT EXISTS organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    type            VARCHAR(20) DEFAULT 'school',
    address         TEXT,
    city            VARCHAR(100),
    state           VARCHAR(100),
    country         VARCHAR(100) DEFAULT 'India',
    zone            VARCHAR(100),
    contact_name    VARCHAR(255),
    contact_email   VARCHAR(255),
    contact_phone   VARCHAR(20),
    metadata        JSONB DEFAULT '{}',
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 1b. Projects
CREATE TABLE IF NOT EXISTS projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    type            VARCHAR(20) DEFAULT 'career_guidance',
    status          VARCHAR(20) DEFAULT 'active',
    start_date      DATE,
    end_date        DATE,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 1c. Users
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE,
    password_hash   VARCHAR(255),
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100),
    role            VARCHAR(20) NOT NULL DEFAULT 'student',
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    date_of_birth   DATE,
    age_band        VARCHAR(10),
    grade           VARCHAR(20),
    section         VARCHAR(20),
    department      VARCHAR(100),
    job_role        VARCHAR(100),
    is_active       BOOLEAN DEFAULT true,
    last_login      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 1d. Access tokens
CREATE TABLE IF NOT EXISTS access_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token           VARCHAR(20) UNIQUE NOT NULL,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    session_id      UUID,
    expires_at      TIMESTAMPTZ NOT NULL,
    is_used         BOOLEAN DEFAULT false,
    used_at         TIMESTAMPTZ,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 1e. Project assignments
CREATE TABLE IF NOT EXISTS project_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    assigned_by     UUID REFERENCES users(id),
    permissions     JSONB DEFAULT '{"view_reports": true, "publish_reports": true, "edit_items": false}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, project_id)
);

-- 1f. Items (question bank)
CREATE TABLE IF NOT EXISTS items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_code       VARCHAR(50) UNIQUE NOT NULL,
    domain          VARCHAR(30) NOT NULL,
    audience        VARCHAR(20) DEFAULT 'both',
    difficulty_level INTEGER,
    age_band_min    INTEGER DEFAULT 8,
    age_band_max    INTEGER DEFAULT 99,
    role            VARCHAR(20),
    anchor_group    VARCHAR(20),
    template        VARCHAR(50) NOT NULL DEFAULT 'default',
    content         JSONB NOT NULL DEFAULT '{}',
    time_limit_sec  INTEGER DEFAULT 30,
    timer_mode      VARCHAR(10) DEFAULT 'soft',
    is_practice     BOOLEAN DEFAULT false,
    is_active       BOOLEAN DEFAULT true,
    version         INTEGER DEFAULT 1,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_items_domain     ON items(domain);
CREATE INDEX IF NOT EXISTS idx_items_template   ON items(template);
CREATE INDEX IF NOT EXISTS idx_items_difficulty  ON items(difficulty_level);
CREATE INDEX IF NOT EXISTS idx_items_audience    ON items(audience);
CREATE INDEX IF NOT EXISTS idx_items_active      ON items(is_active) WHERE is_active = true;

-- 1g. Test batteries
CREATE TABLE IF NOT EXISTS test_batteries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    type            VARCHAR(20) DEFAULT 'preset',
    audience        VARCHAR(20) DEFAULT 'both',
    age_band_min    INTEGER,
    age_band_max    INTEGER,
    config          JSONB DEFAULT '{}',
    is_active       BOOLEAN DEFAULT true,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 1h. Battery sections
CREATE TABLE IF NOT EXISTS battery_sections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    battery_id      UUID NOT NULL REFERENCES test_batteries(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    domain          VARCHAR(30) NOT NULL,
    sort_order      INTEGER NOT NULL,
    selection_mode  VARCHAR(20) DEFAULT 'auto',
    config          JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 1i. Battery section items (manual selection)
CREATE TABLE IF NOT EXISTS battery_section_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_id      UUID NOT NULL REFERENCES battery_sections(id) ON DELETE CASCADE,
    item_id         UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    sort_order      INTEGER NOT NULL,
    UNIQUE(section_id, item_id)
);

-- 1j. Test sessions
CREATE TABLE IF NOT EXISTS test_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    battery_id      UUID NOT NULL REFERENCES test_batteries(id),
    project_id      UUID REFERENCES projects(id),
    status          VARCHAR(20) DEFAULT 'assigned',
    is_open         BOOLEAN DEFAULT true,
    opens_at        TIMESTAMPTZ,
    closes_at       TIMESTAMPTZ,
    current_section INTEGER DEFAULT 0,
    current_item    INTEGER DEFAULT 0,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    user_agent      TEXT,
    ip_address      INET,
    adaptive_state  JSONB DEFAULT '{}',
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON test_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON test_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status  ON test_sessions(status);

-- 1k. Responses
CREATE TABLE IF NOT EXISTS responses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
    item_id         UUID NOT NULL REFERENCES items(id),
    selected_index  INTEGER,
    selected_value  JSONB,
    is_correct      BOOLEAN,
    score           NUMERIC(5,2),
    trait           VARCHAR(50),
    reaction_time_ms INTEGER,
    timed_out       BOOLEAN DEFAULT false,
    presentation_order JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_responses_session ON responses(session_id);
CREATE INDEX IF NOT EXISTS idx_responses_item    ON responses(item_id);

-- 1l. Scoring profiles
CREATE TABLE IF NOT EXISTS scoring_profiles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain          VARCHAR(30) NOT NULL,
    name            VARCHAR(255) NOT NULL,
    method          VARCHAR(30) NOT NULL,
    config          JSONB DEFAULT '{}',
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 1m. Norms
CREATE TABLE IF NOT EXISTS norms (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scoring_profile_id UUID NOT NULL REFERENCES scoring_profiles(id),
    age_band_min    INTEGER NOT NULL,
    age_band_max    INTEGER NOT NULL,
    audience        VARCHAR(20) DEFAULT 'both',
    norm_data       JSONB NOT NULL,
    sample_size     INTEGER,
    description     VARCHAR(255),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 1n. Session scores
CREATE TABLE IF NOT EXISTS session_scores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
    domain          VARCHAR(30) NOT NULL,
    trait_or_dim    VARCHAR(50),
    raw_score       NUMERIC(8,2),
    percentile      NUMERIC(5,1),
    standard_score  NUMERIC(6,2),
    descriptor      VARCHAR(50),
    norm_id         UUID REFERENCES norms(id),
    computed_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scores_session ON session_scores(session_id);

-- 1o. Reports
CREATE TABLE IF NOT EXISTS reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID REFERENCES test_sessions(id),
    user_id         UUID NOT NULL REFERENCES users(id),
    project_id      UUID REFERENCES projects(id),
    report_type     VARCHAR(30) NOT NULL,
    report_data     JSONB NOT NULL DEFAULT '{}',
    status          VARCHAR(20) DEFAULT 'draft',
    clinical_notes  TEXT,
    reviewed_by     UUID REFERENCES users(id),
    published_by    UUID REFERENCES users(id),
    published_at    TIMESTAMPTZ,
    share_token     VARCHAR(50) UNIQUE,
    share_expires   TIMESTAMPTZ,
    shared_with     JSONB DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reports_user    ON reports(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_project ON reports(project_id);
CREATE INDEX IF NOT EXISTS idx_reports_status  ON reports(status);

-- 1p. Audit log
CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID REFERENCES users(id),
    user_role       VARCHAR(20),
    user_email      VARCHAR(255),
    action          VARCHAR(50) NOT NULL,
    entity_type     VARCHAR(30),
    entity_id       UUID,
    details         JSONB DEFAULT '{}',
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_date   ON audit_log(created_at);

-- 1q. Media library
CREATE TABLE IF NOT EXISTS media (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename        VARCHAR(255) NOT NULL,
    original_name   VARCHAR(255),
    mime_type       VARCHAR(100),
    file_size       INTEGER,
    file_path       VARCHAR(500) NOT NULL,
    category        VARCHAR(50),
    tags            JSONB DEFAULT '[]',
    uploaded_by     UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. SOURCES (multi-tenant isolation — replaces organizations for new data)
-- ═══════════════════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. BATCHES (student grouping within a source)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS batches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id       UUID REFERENCES sources(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    name            VARCHAR(255) NOT NULL,
    code            VARCHAR(50),
    description     TEXT,
    grade           VARCHAR(20),
    section         VARCHAR(20),
    academic_year   VARCHAR(20),
    is_active       BOOLEAN DEFAULT true,
    metadata        JSONB DEFAULT '{}',
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_batches_source ON batches(source_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. GUARDIAN SYSTEM (student_guardians + report_access)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS student_guardians (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guardian_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    relationship    VARCHAR(30) DEFAULT 'guardian',
    can_view_reports BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(student_id, guardian_id)
);
CREATE INDEX IF NOT EXISTS idx_sg_student  ON student_guardians(student_id);
CREATE INDEX IF NOT EXISTS idx_sg_guardian ON student_guardians(guardian_id);

CREATE TABLE IF NOT EXISTS report_access (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id       UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_by      UUID REFERENCES users(id),
    granted_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(report_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ra_report ON report_access(report_id);
CREATE INDEX IF NOT EXISTS idx_ra_user   ON report_access(user_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. GRIEVANCE / SUPPORT TICKETS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS grievances (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    category        VARCHAR(50) NOT NULL DEFAULT 'general',
    subject         VARCHAR(255) NOT NULL,
    description     TEXT NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'open',
    priority        VARCHAR(10) DEFAULT 'normal',
    admin_reply     TEXT,
    replied_by      UUID REFERENCES users(id),
    replied_at      TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_grievances_user   ON grievances(user_id);
CREATE INDEX IF NOT EXISTS idx_grievances_status ON grievances(status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. PLATFORM SETTINGS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS platform_settings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    setting_key     VARCHAR(100) UNIQUE NOT NULL,
    setting_value   JSONB NOT NULL DEFAULT '{}',
    category        VARCHAR(50) NOT NULL DEFAULT 'general',
    label           VARCHAR(200),
    description     TEXT,
    updated_by      UUID REFERENCES users(id),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. REPORT CONFIGURATION
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS report_sections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_type     VARCHAR(30) NOT NULL,
    section_key     VARCHAR(50) NOT NULL,
    label           VARCHAR(200) NOT NULL,
    description     TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_enabled      BOOLEAN DEFAULT true,
    config          JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(report_type, section_key)
);

CREATE TABLE IF NOT EXISTS report_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(200) NOT NULL,
    report_type     VARCHAR(30) NOT NULL,
    description     TEXT,
    sections        JSONB NOT NULL DEFAULT '[]',
    styling         JSONB DEFAULT '{}',
    is_default      BOOLEAN DEFAULT false,
    is_active       BOOLEAN DEFAULT true,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7b. ITEM ↔ SOURCE JUNCTION (many-to-many: items can belong to multiple sources)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS item_sources (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id    UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    source_id  UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    added_by   UUID REFERENCES users(id),
    added_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(item_id, source_id)
);
CREATE INDEX IF NOT EXISTS idx_item_sources_source ON item_sources(source_id);
CREATE INDEX IF NOT EXISTS idx_item_sources_item   ON item_sources(item_id);

-- Backfill: any item with a source_id gets a row in item_sources
INSERT INTO item_sources (item_id, source_id)
SELECT id, source_id FROM items WHERE source_id IS NOT NULL
ON CONFLICT (item_id, source_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. COLUMN ADDITIONS ON EXISTING TABLES (all IF NOT EXISTS — safe to re-run)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── batches table additions (for databases where batches already existed) ──
ALTER TABLE batches ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS code            VARCHAR(50);
ALTER TABLE batches ADD COLUMN IF NOT EXISTS created_by      UUID REFERENCES users(id);

-- ── users table additions ──
ALTER TABLE users ADD COLUMN IF NOT EXISTS source_id         UUID REFERENCES sources(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS enrollment_type   VARCHAR(20) DEFAULT 'individual';
ALTER TABLE users ADD COLUMN IF NOT EXISTS batch_id          UUID REFERENCES batches(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone             VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_name       VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_phone      VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_email      VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender            VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS status            VARCHAR(20) DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_fields     JSONB DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS linked_parent_id  UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS linked_student_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(5) DEFAULT 'en';

CREATE INDEX IF NOT EXISTS idx_users_source_id     ON users(source_id);
CREATE INDEX IF NOT EXISTS idx_users_batch_id      ON users(batch_id);
CREATE INDEX IF NOT EXISTS idx_users_linked_parent ON users(linked_parent_id);
CREATE INDEX IF NOT EXISTS idx_users_linked_student ON users(linked_student_id);

-- ── test_sessions additions ──
ALTER TABLE test_sessions ADD COLUMN IF NOT EXISTS source_id    UUID REFERENCES sources(id) ON DELETE SET NULL;
ALTER TABLE test_sessions ADD COLUMN IF NOT EXISTS batch_id     UUID REFERENCES batches(id) ON DELETE SET NULL;
ALTER TABLE test_sessions ADD COLUMN IF NOT EXISTS assigned_by  UUID REFERENCES users(id);
ALTER TABLE test_sessions ADD COLUMN IF NOT EXISTS language     VARCHAR(5) DEFAULT 'en';

CREATE INDEX IF NOT EXISTS idx_sessions_source ON test_sessions(source_id);
CREATE INDEX IF NOT EXISTS idx_sessions_batch  ON test_sessions(batch_id);

-- ── items additions ──
ALTER TABLE items ADD COLUMN IF NOT EXISTS source_id     UUID REFERENCES sources(id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN IF NOT EXISTS sub_domain    VARCHAR(50);
ALTER TABLE items ADD COLUMN IF NOT EXISTS translations  JSONB DEFAULT '{}'::jsonb;
ALTER TABLE items ADD COLUMN IF NOT EXISTS svg_data      TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS custom_shapes JSONB;
ALTER TABLE items ADD COLUMN IF NOT EXISTS pending_review BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_items_source       ON items(source_id);
CREATE INDEX IF NOT EXISTS idx_items_sub_domain   ON items(sub_domain);
CREATE INDEX IF NOT EXISTS idx_items_translations ON items USING gin(translations);
CREATE INDEX IF NOT EXISTS idx_items_pending      ON items(pending_review) WHERE pending_review = true;

-- ── responses additions (IRT columns) ──
ALTER TABLE responses ADD COLUMN IF NOT EXISTS theta_before   NUMERIC(6,3);
ALTER TABLE responses ADD COLUMN IF NOT EXISTS theta_after    NUMERIC(6,3);
ALTER TABLE responses ADD COLUMN IF NOT EXISTS se_before      NUMERIC(6,3);
ALTER TABLE responses ADD COLUMN IF NOT EXISTS se_after       NUMERIC(6,3);
ALTER TABLE responses ADD COLUMN IF NOT EXISTS item_info      NUMERIC(8,4);
ALTER TABLE responses ADD COLUMN IF NOT EXISTS domain         VARCHAR(30);

CREATE INDEX IF NOT EXISTS idx_responses_domain ON responses(domain);

-- ── reports additions ──
ALTER TABLE reports ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES sources(id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS batch_id  UUID REFERENCES batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reports_batch  ON reports(batch_id);

-- ── access_tokens additions ──
ALTER TABLE access_tokens ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES sources(id) ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 9. HELPER FUNCTION — auto-update updated_at
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers (DROP + CREATE to be idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_updated') THEN
    CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_items_updated') THEN
    CREATE TRIGGER trg_items_updated BEFORE UPDATE ON items FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sessions_updated') THEN
    CREATE TRIGGER trg_sessions_updated BEFORE UPDATE ON test_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_reports_updated') THEN
    CREATE TRIGGER trg_reports_updated BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sources_updated') THEN
    CREATE TRIGGER trg_sources_updated BEFORE UPDATE ON sources FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_batches_updated') THEN
    CREATE TRIGGER trg_batches_updated BEFORE UPDATE ON batches FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_grievances_updated') THEN
    CREATE TRIGGER trg_grievances_updated BEFORE UPDATE ON grievances FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 10. DEFAULT DATA (inserted only if tables are empty)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Default scoring profiles (skip if any already exist)
INSERT INTO scoring_profiles (domain, name, method, config)
SELECT 'gf', 'Fluid Intelligence - Sum Correct', 'sum_correct', '{"maxScore": 50}'
WHERE NOT EXISTS (SELECT 1 FROM scoring_profiles WHERE domain = 'gf');

INSERT INTO scoring_profiles (domain, name, method, config)
SELECT 'personality', 'Big Five - Trait Sum', 'trait_sum', '{"traits": ["openness","conscientiousness","extraversion","agreeableness","neuroticism"]}'
WHERE NOT EXISTS (SELECT 1 FROM scoring_profiles WHERE domain = 'personality');

INSERT INTO scoring_profiles (domain, name, method, config)
SELECT 'interest', 'Holland RIASEC', 'dimension_sum', '{"dimensions": ["realistic","investigative","artistic","social","enterprising","conventional"]}'
WHERE NOT EXISTS (SELECT 1 FROM scoring_profiles WHERE domain = 'interest');

-- Default platform settings (skip if any already exist)
INSERT INTO platform_settings (setting_key, setting_value, category, label, description)
SELECT 'passing_theta', '{"value": 0.0, "enabled": true}', 'scoring', 'Minimum Passing Theta', 'Students with global theta below this value are flagged'
WHERE NOT EXISTS (SELECT 1 FROM platform_settings WHERE setting_key = 'passing_theta');

INSERT INTO platform_settings (setting_key, setting_value, category, label, description)
SELECT 'show_scores_to_student', '{"value": true}', 'visibility', 'Show Scores to Students', 'Whether students can see their theta scores'
WHERE NOT EXISTS (SELECT 1 FROM platform_settings WHERE setting_key = 'show_scores_to_student');

INSERT INTO platform_settings (setting_key, setting_value, category, label, description)
SELECT 'show_report_to_student', '{"value": false}', 'visibility', 'Auto-show Report to Students', 'Whether reports are automatically visible'
WHERE NOT EXISTS (SELECT 1 FROM platform_settings WHERE setting_key = 'show_report_to_student');

-- ═══════════════════════════════════════════════════════════════════════════════
-- DONE
-- ═══════════════════════════════════════════════════════════════════════════════
-- All tables, columns, indexes, and triggers are now at the latest version.
-- This file is idempotent — re-running it is always safe.
