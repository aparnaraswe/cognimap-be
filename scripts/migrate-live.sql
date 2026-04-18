-- ═══════════════════════════════════════════════════════════════
-- FULL MIGRATION: Bring live DB up to match local DB
-- Safe to run multiple times (uses IF NOT EXISTS / IF NOT EXISTS)
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ══════════════════════════════════════════
-- EXTENSIONS
-- ══════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ══════════════════════════════════════════
-- FUNCTION
-- ══════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ══════════════════════════════════════════
-- TABLES (CREATE IF NOT EXISTS)
-- ══════════════════════════════════════════

-- 1. Organizations
CREATE TABLE IF NOT EXISTS organizations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    type            VARCHAR(20) NOT NULL CHECK (type IN ('school','company','clinic','other')),
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

-- 2. Projects
CREATE TABLE IF NOT EXISTS projects (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    type            VARCHAR(20) NOT NULL CHECK (type IN ('career_guidance','employee_screening','research','other')),
    status          VARCHAR(20) DEFAULT 'active' CHECK (status IN ('draft','active','paused','completed','archived')),
    start_date      DATE,
    end_date        DATE,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Users
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(255) UNIQUE,
    password_hash   VARCHAR(255),
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100),
    role            VARCHAR(20) NOT NULL CHECK (role IN ('super_admin','psychologist','client_admin','student','employee','guardian','teacher')),
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

-- 4. Access tokens
CREATE TABLE IF NOT EXISTS access_tokens (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token           VARCHAR(20) UNIQUE NOT NULL,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    session_id      UUID,
    expires_at      TIMESTAMPTZ NOT NULL,
    is_used         BOOLEAN DEFAULT false,
    used_at         TIMESTAMPTZ,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Project assignments
CREATE TABLE IF NOT EXISTS project_assignments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    assigned_by     UUID REFERENCES users(id),
    permissions     JSONB DEFAULT '{"view_reports": true, "publish_reports": true, "edit_items": false}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, project_id)
);

-- 6. Items (question bank)
CREATE TABLE IF NOT EXISTS items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_code       VARCHAR(50) UNIQUE NOT NULL,
    domain          VARCHAR(30) NOT NULL,
    audience        VARCHAR(20) DEFAULT 'both' CHECK (audience IN ('student','employee','both')),
    difficulty_level INTEGER CHECK (difficulty_level BETWEEN 1 AND 10),
    age_band_min    INTEGER DEFAULT 8,
    age_band_max    INTEGER DEFAULT 99,
    role            VARCHAR(20),
    anchor_group    VARCHAR(20),
    template        VARCHAR(50) NOT NULL,
    content         JSONB NOT NULL,
    time_limit_sec  INTEGER DEFAULT 30,
    timer_mode      VARCHAR(10) DEFAULT 'soft' CHECK (timer_mode IN ('soft','hard')),
    is_practice     BOOLEAN DEFAULT false,
    is_active       BOOLEAN DEFAULT true,
    version         INTEGER DEFAULT 1,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Test batteries
CREATE TABLE IF NOT EXISTS test_batteries (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    type            VARCHAR(20) NOT NULL CHECK (type IN ('preset','custom')),
    audience        VARCHAR(20) DEFAULT 'both' CHECK (audience IN ('student','employee','both')),
    age_band_min    INTEGER,
    age_band_max    INTEGER,
    config          JSONB DEFAULT '{}',
    is_active       BOOLEAN DEFAULT true,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Battery sections
CREATE TABLE IF NOT EXISTS battery_sections (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    battery_id      UUID NOT NULL REFERENCES test_batteries(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    domain          VARCHAR(30) NOT NULL,
    sort_order      INTEGER NOT NULL,
    selection_mode  VARCHAR(20) DEFAULT 'auto' CHECK (selection_mode IN ('auto','manual')),
    config          JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Battery section items
CREATE TABLE IF NOT EXISTS battery_section_items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    section_id      UUID NOT NULL REFERENCES battery_sections(id) ON DELETE CASCADE,
    item_id         UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    sort_order      INTEGER NOT NULL,
    UNIQUE(section_id, item_id)
);

-- 10. Test sessions
CREATE TABLE IF NOT EXISTS test_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    battery_id      UUID NOT NULL REFERENCES test_batteries(id),
    project_id      UUID REFERENCES projects(id),
    status          VARCHAR(20) DEFAULT 'assigned' CHECK (status IN ('assigned','in_progress','completed','timed_out','abandoned')),
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

-- 11. Responses
CREATE TABLE IF NOT EXISTS responses (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- 12. Scoring profiles
CREATE TABLE IF NOT EXISTS scoring_profiles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain          VARCHAR(30) NOT NULL,
    name            VARCHAR(255) NOT NULL,
    method          VARCHAR(30) NOT NULL CHECK (method IN ('sum_correct','trait_sum','dimension_sum','irt_theta','custom')),
    config          JSONB DEFAULT '{}',
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 13. Norms
CREATE TABLE IF NOT EXISTS norms (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- 14. Session scores
CREATE TABLE IF NOT EXISTS session_scores (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- 15. Reports
CREATE TABLE IF NOT EXISTS reports (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id      UUID REFERENCES test_sessions(id),
    user_id         UUID NOT NULL REFERENCES users(id),
    project_id      UUID REFERENCES projects(id),
    report_type     VARCHAR(30) NOT NULL CHECK (report_type IN ('aptitude','personality','interest','compiled','comprehensive','screening_result')),
    report_data     JSONB NOT NULL,
    status          VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','in_review','published','revision','archived')),
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

-- 16. Media library
CREATE TABLE IF NOT EXISTS media (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- 17. Audit log
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

-- 18. Pending items (unresolved uploads)
CREATE TABLE IF NOT EXISTS pending_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_code       VARCHAR(100) UNIQUE NOT NULL,
    domain          VARCHAR(20),
    source_file     VARCHAR(255),
    raw_data        JSONB DEFAULT '{}' NOT NULL,
    unresolved_tokens JSONB DEFAULT '[]' NOT NULL,
    skip_reason     TEXT,
    status          VARCHAR(20) DEFAULT 'pending' NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_by      UUID
);

-- 19. Platform settings
CREATE TABLE IF NOT EXISTS platform_settings (
    id              SERIAL PRIMARY KEY,
    setting_key     VARCHAR(100) UNIQUE NOT NULL,
    setting_value   JSONB NOT NULL,
    category        VARCHAR(50),
    label           VARCHAR(255),
    description     TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by      UUID
);

-- 20. Custom SVG shapes
CREATE TABLE IF NOT EXISTS custom_svg_shapes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shape_name      VARCHAR(50) UNIQUE NOT NULL,
    display_name    VARCHAR(100),
    svg_code        TEXT NOT NULL,
    default_color   VARCHAR(7) DEFAULT '#8B5CF6',
    category        VARCHAR(50),
    tags            JSONB DEFAULT '[]',
    description     TEXT,
    is_active       BOOLEAN DEFAULT true,
    created_by      UUID,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 21. Report access
CREATE TABLE IF NOT EXISTS report_access (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id       UUID NOT NULL,
    user_id         UUID NOT NULL,
    granted_by      UUID,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(report_id, user_id)
);

-- 22. Student guardians
CREATE TABLE IF NOT EXISTS student_guardians (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id      UUID NOT NULL,
    guardian_id     UUID NOT NULL,
    relationship    VARCHAR(30) DEFAULT 'guardian' CHECK (relationship IN ('parent','guardian','teacher','counselor')),
    can_view_reports BOOLEAN DEFAULT true,
    assigned_by     UUID,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(student_id, guardian_id)
);

-- ══════════════════════════════════════════
-- ADD MISSING COLUMNS TO EXISTING TABLES
-- (safe: IF NOT EXISTS)
-- ══════════════════════════════════════════

-- Items: IRT parameters
ALTER TABLE items ADD COLUMN IF NOT EXISTS irt_a            NUMERIC(4,2);
ALTER TABLE items ADD COLUMN IF NOT EXISTS irt_b            NUMERIC(4,2);
ALTER TABLE items ADD COLUMN IF NOT EXISTS irt_c            NUMERIC(3,2) DEFAULT 0.33;
ALTER TABLE items ADD COLUMN IF NOT EXISTS irt_calibrated   BOOLEAN DEFAULT false;
ALTER TABLE items ADD COLUMN IF NOT EXISTS content_constraint VARCHAR(50);
ALTER TABLE items ADD COLUMN IF NOT EXISTS enemy_items       TEXT[] DEFAULT '{}';
ALTER TABLE items ADD COLUMN IF NOT EXISTS exposure_control  NUMERIC(3,2) DEFAULT 1.0;

-- Session scores: CAT columns
ALTER TABLE session_scores ADD COLUMN IF NOT EXISTS sem                 NUMERIC(5,3);
ALTER TABLE session_scores ADD COLUMN IF NOT EXISTS items_administered  INTEGER;

-- Test sessions: adaptive state
ALTER TABLE test_sessions ADD COLUMN IF NOT EXISTS adaptive_state JSONB DEFAULT '{}';

-- ══════════════════════════════════════════
-- DOMAIN CONSTRAINT (add gwm + all domains)
-- ══════════════════════════════════════════
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_domain_check;
ALTER TABLE items ADD CONSTRAINT items_domain_check CHECK (domain IN (
    'gf','gv','gq','gc','gs','gwm',
    'personality','interest',
    'aptitude_numerical','aptitude_verbal','aptitude_attention',
    'domain_knowledge'
));

-- Users role constraint (add guardian, teacher)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
    'super_admin','psychologist','client_admin','student','employee','guardian','teacher'
));

-- IRT range constraints (safe: drop first)
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_irt_a_range;
ALTER TABLE items ADD CONSTRAINT items_irt_a_range CHECK (irt_a IS NULL OR (irt_a >= 0.1 AND irt_a <= 3.0));
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_irt_b_range;
ALTER TABLE items ADD CONSTRAINT items_irt_b_range CHECK (irt_b IS NULL OR (irt_b >= -4.0 AND irt_b <= 4.0));
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_irt_c_range;
ALTER TABLE items ADD CONSTRAINT items_irt_c_range CHECK (irt_c IS NULL OR (irt_c >= 0.0 AND irt_c <= 0.5));
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_exposure_range;
ALTER TABLE items ADD CONSTRAINT items_exposure_range CHECK (exposure_control IS NULL OR (exposure_control >= 0.0 AND exposure_control <= 1.0));

-- ══════════════════════════════════════════
-- INDEXES (CREATE IF NOT EXISTS via DO block)
-- ══════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_items_domain     ON items(domain);
CREATE INDEX IF NOT EXISTS idx_items_template   ON items(template);
CREATE INDEX IF NOT EXISTS idx_items_difficulty  ON items(difficulty_level);
CREATE INDEX IF NOT EXISTS idx_items_audience    ON items(audience);
CREATE INDEX IF NOT EXISTS idx_items_active      ON items(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_sessions_user     ON test_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project  ON test_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status   ON test_sessions(status);
CREATE INDEX IF NOT EXISTS idx_responses_session ON responses(session_id);
CREATE INDEX IF NOT EXISTS idx_responses_item    ON responses(item_id);
CREATE INDEX IF NOT EXISTS idx_scores_session    ON session_scores(session_id);
CREATE INDEX IF NOT EXISTS idx_reports_user      ON reports(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_project   ON reports(project_id);
CREATE INDEX IF NOT EXISTS idx_reports_status    ON reports(status);
CREATE INDEX IF NOT EXISTS idx_audit_user        ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action      ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_entity      ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_date        ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_custom_svg_shapes_name   ON custom_svg_shapes(shape_name);
CREATE INDEX IF NOT EXISTS idx_custom_svg_shapes_active ON custom_svg_shapes(is_active) WHERE is_active = true;

-- ══════════════════════════════════════════
-- TRIGGERS (safe: OR REPLACE not available, use DROP IF EXISTS)
-- ══════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_organizations_updated ON organizations;
CREATE TRIGGER trg_organizations_updated BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_projects_updated ON projects;
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_items_updated ON items;
CREATE TRIGGER trg_items_updated BEFORE UPDATE ON items FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_test_batteries_updated ON test_batteries;
CREATE TRIGGER trg_test_batteries_updated BEFORE UPDATE ON test_batteries FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_sessions_updated ON test_sessions;
CREATE TRIGGER trg_sessions_updated BEFORE UPDATE ON test_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_reports_updated ON reports;
CREATE TRIGGER trg_reports_updated BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_norms_updated ON norms;
CREATE TRIGGER trg_norms_updated BEFORE UPDATE ON norms FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ══════════════════════════════════════════
-- VIEW: CAT item pool
-- ══════════════════════════════════════════
CREATE OR REPLACE VIEW v_cat_item_pool AS
SELECT id, item_code, domain, irt_a, irt_b, irt_c, irt_calibrated,
       difficulty_level, template, content_constraint, enemy_items,
       exposure_control, age_band_min, age_band_max, time_limit_sec,
       timer_mode, content, anchor_group
FROM items
WHERE is_active = true
  AND is_practice = false
  AND irt_a IS NOT NULL
  AND irt_b IS NOT NULL
  AND domain IN ('gf','gv','gq','gc','gs');

-- ══════════════════════════════════════════
-- SEED DATA (safe: ON CONFLICT DO NOTHING)
-- ══════════════════════════════════════════
INSERT INTO scoring_profiles (domain, name, method, config) VALUES
    ('gf', 'Fluid Intelligence - Theta', 'irt_theta', '{"maxItems": 24, "weight": 0.30}'),
    ('gv', 'Visual Spatial - Theta', 'irt_theta', '{"maxItems": 24, "weight": 0.20}'),
    ('gq', 'Quantitative - Theta', 'irt_theta', '{"maxItems": 24, "weight": 0.20}'),
    ('gc', 'Verbal Reasoning - Theta', 'irt_theta', '{"maxItems": 24, "weight": 0.15}'),
    ('gs', 'Processing Speed - Theta', 'irt_theta', '{"maxItems": 24, "weight": 0.15}'),
    ('personality', 'Big Five - Trait Sum', 'trait_sum', '{"traits": ["openness","conscientiousness","extraversion","agreeableness","neuroticism"]}'),
    ('interest', 'Holland RIASEC', 'dimension_sum', '{"dimensions": ["realistic","investigative","artistic","social","enterprising","conventional"]}'),
    ('aptitude_numerical', 'Numerical Ability', 'sum_correct', '{"maxScore": 30}'),
    ('aptitude_verbal', 'Verbal Ability', 'sum_correct', '{"maxScore": 30}'),
    ('aptitude_attention', 'Attention to Detail', 'sum_correct', '{"maxScore": 25}')
ON CONFLICT DO NOTHING;

COMMIT;
