-- ═══════════════════════════════════════════════════════════════
-- PSYCHOMETRIC PLATFORM · DATABASE SCHEMA
-- ═══════════════════════════════════════════════════════════════
-- Supports: Students (8-18), Employees, Multi-role admin
-- Tests:    Gf, Personality, Interest, Aptitude, Domain Knowledge
-- Features: Project-scoped access, audit trail, report lifecycle
-- ═══════════════════════════════════════════════════════════════

-- ── EXTENSIONS ──
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ══════════════════════════════════════════
-- 1. ORGANIZATIONS & PROJECTS
-- ══════════════════════════════════════════

-- Schools, companies, or any client entity
CREATE TABLE organizations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    type            VARCHAR(20) NOT NULL CHECK (type IN ('school', 'company', 'clinic', 'other')),
    address         TEXT,
    city            VARCHAR(100),
    state           VARCHAR(100),
    country         VARCHAR(100) DEFAULT 'India',
    zone            VARCHAR(100),           -- geographic zone for bifurcation
    contact_name    VARCHAR(255),
    contact_email   VARCHAR(255),
    contact_phone   VARCHAR(20),
    metadata        JSONB DEFAULT '{}',     -- flexible: board, industry, size, etc.
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Projects scope data access for psychologists
-- e.g., "DPS Grade 8-10 Career Guidance 2026"
CREATE TABLE projects (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    type            VARCHAR(20) NOT NULL CHECK (type IN ('career_guidance', 'employee_screening', 'research', 'other')),
    status          VARCHAR(20) DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
    start_date      DATE,
    end_date        DATE,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════
-- 2. USERS & AUTHENTICATION
-- ══════════════════════════════════════════

-- All human users in one table, differentiated by role
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Auth
    email           VARCHAR(255) UNIQUE,    -- NULL for token-only students
    password_hash   VARCHAR(255),           -- NULL for token-only students
    
    -- Identity
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100),
    
    -- Role: what they can do
    role            VARCHAR(20) NOT NULL CHECK (role IN (
                        'super_admin',      -- you: sees everything
                        'psychologist',     -- assigned projects only
                        'client_admin',     -- their org only
                        'student',          -- their own tests/reports
                        'employee'          -- their own tests/reports
                    )),
    
    -- Organization link (NULL for super_admin)
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    
    -- Student-specific
    date_of_birth   DATE,
    age_band        VARCHAR(10),            -- '8-11', '12-14', '15-18'
    grade           VARCHAR(20),            -- 'Grade 8', 'Grade 10', etc.
    section         VARCHAR(20),            -- 'A', 'B', etc.
    
    -- Employee-specific
    department      VARCHAR(100),
    job_role        VARCHAR(100),
    
    -- Status
    is_active       BOOLEAN DEFAULT true,
    last_login      TIMESTAMPTZ,
    
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Token-based access (for students without accounts)
CREATE TABLE access_tokens (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token           VARCHAR(20) UNIQUE NOT NULL,    -- short code like "DPS-8A-0042"
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    session_id      UUID,                           -- links to specific test session
    expires_at      TIMESTAMPTZ NOT NULL,
    is_used         BOOLEAN DEFAULT false,
    used_at         TIMESTAMPTZ,
    created_by      UUID REFERENCES users(id),      -- who generated this token
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Psychologist ↔ Project assignments (scoped access)
CREATE TABLE project_assignments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    assigned_by     UUID REFERENCES users(id),
    permissions     JSONB DEFAULT '{"view_reports": true, "publish_reports": true, "edit_items": false}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, project_id)
);

-- ══════════════════════════════════════════
-- 3. QUESTION BANK (ITEMS)
-- ══════════════════════════════════════════

-- Every test item across all modules lives here
CREATE TABLE items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_code       VARCHAR(50) UNIQUE NOT NULL,    -- e.g., 'Gf_08_001', 'P5_AGR_001'
    
    -- Classification
    domain          VARCHAR(30) NOT NULL CHECK (domain IN (
                        'gf',               -- fluid intelligence
                        'gv',               -- visual spatial
                        'gq',               -- quantitative reasoning
                        'gc',               -- verbal/crystallized
                        'gs',               -- processing speed
                        'gwm',              -- working memory
                        'personality',      -- Big Five
                        'interest',         -- career interests
                        'aptitude_numerical',
                        'aptitude_verbal',
                        'aptitude_attention',
                        'domain_knowledge'
                    )),
    audience        VARCHAR(20) DEFAULT 'both' CHECK (audience IN ('student', 'employee', 'both')),
    
    -- Difficulty & targeting
    difficulty_level INTEGER CHECK (difficulty_level BETWEEN 1 AND 10),
    age_band_min    INTEGER DEFAULT 8,      -- minimum age
    age_band_max    INTEGER DEFAULT 99,     -- maximum age (99 = no upper limit)
    role            VARCHAR(20),            -- 'core', 'transitional', 'anchor', 'ceiling'
    anchor_group    VARCHAR(20),            -- for IRT anchoring
    
    -- Visual template
    template        VARCHAR(50) NOT NULL,   -- 'alternation_basic', 'park_bench_encounter', etc.
    
    -- Item content (flexible JSONB for any item type)
    content         JSONB NOT NULL,
    /*
        For Gf items, content looks like:
        {
            "shapeA": "triangle",
            "shapeB": "circle",
            "positionA": "top",
            "positionB": "bottom",
            "countStart": null,
            "step": null,
            "sequence": ["triangle_top", "circle_bottom", "triangle_top", "circle_bottom", null],
            "options": [
                {"value": "triangle_top", "tag": "distractor_previous"},
                {"value": "circle_bottom", "tag": "correct"},
                {"value": "square_top", "tag": "distractor_feature_swap"}
            ],
            "correctIndex": 1
        }
        
        For Personality items, content looks like:
        {
            "scene": "park_bench_encounter",
            "narration": "You see a new student sitting alone...",
            "sceneParams": {"mood": "warm", "timeOfDay": "morning"},
            "options": [
                {"text": "Walk over and sit with them", "trait": "agreeableness", "score": 2},
                {"text": "Wave and smile from where you are", "trait": "agreeableness", "score": 1},
                {"text": "Tell a teacher to check on them", "trait": "conscientiousness", "score": 1},
                {"text": "You're busy, maybe later", "trait": "agreeableness", "score": 0}
            ]
        }
        
        For Interest items, content looks like:
        {
            "media": "coding_activity.jpg",
            "mediaType": "image",
            "prompt": "How much does this activity interest you?",
            "scale": "likert5",
            "dimension": "investigative"
        }
    */
    
    -- Timing
    time_limit_sec  INTEGER DEFAULT 30,
    timer_mode      VARCHAR(10) DEFAULT 'soft' CHECK (timer_mode IN ('soft', 'hard')),
    
    -- Metadata
    is_practice     BOOLEAN DEFAULT false,  -- practice items shown before real test
    is_active       BOOLEAN DEFAULT true,
    version         INTEGER DEFAULT 1,
    
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast item queries
CREATE INDEX idx_items_domain ON items(domain);
CREATE INDEX idx_items_template ON items(template);
CREATE INDEX idx_items_difficulty ON items(difficulty_level);
CREATE INDEX idx_items_audience ON items(audience);
CREATE INDEX idx_items_active ON items(is_active) WHERE is_active = true;

-- ══════════════════════════════════════════
-- 4. TEST BATTERIES & CONFIGURATION
-- ══════════════════════════════════════════

-- A test battery is a collection of sections (each section = one test type)
CREATE TABLE test_batteries (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    type            VARCHAR(20) NOT NULL CHECK (type IN ('preset', 'custom')),
    -- preset = pre-designed by psychometrician (career guidance batteries)
    -- custom = assembled by HR admin via test builder
    
    audience        VARCHAR(20) DEFAULT 'both' CHECK (audience IN ('student', 'employee', 'both')),
    age_band_min    INTEGER,
    age_band_max    INTEGER,
    
    -- Ordering & adaptive rules
    config          JSONB DEFAULT '{}',
    /*
        {
            "ordering": "ascending_difficulty",
            "stopRule": {"consecutiveWrong": 3},
            "practiceItems": true,
            "shuffleWithinSection": true,
            "showFeedbackOnPractice": true
        }
    */
    
    is_active       BOOLEAN DEFAULT true,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Sections within a battery (e.g., "Gf Section", "Personality Section")
CREATE TABLE battery_sections (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    battery_id      UUID NOT NULL REFERENCES test_batteries(id) ON DELETE CASCADE,
    
    name            VARCHAR(255) NOT NULL,  -- "Pattern Reasoning", "Personality"
    domain          VARCHAR(30) NOT NULL,   -- matches items.domain
    sort_order      INTEGER NOT NULL,       -- which section comes first
    
    -- How items are selected
    selection_mode  VARCHAR(20) DEFAULT 'auto' CHECK (selection_mode IN ('auto', 'manual')),
    -- auto = pull from item bank by domain/difficulty/age
    -- manual = specific items chosen by admin (for employee tests)
    
    config          JSONB DEFAULT '{}',
    /*
        For auto mode:
        { "count": 20, "difficultyRange": [1, 4], "timeLimitTotal": 600 }
        
        For manual mode:
        { "timeLimitTotal": 300 }
    */
    
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Manual item selection for custom test sections
CREATE TABLE battery_section_items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    section_id      UUID NOT NULL REFERENCES battery_sections(id) ON DELETE CASCADE,
    item_id         UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    sort_order      INTEGER NOT NULL,
    
    UNIQUE(section_id, item_id)
);

-- ══════════════════════════════════════════
-- 5. TEST SESSIONS & RESPONSES
-- ══════════════════════════════════════════

-- A session = one person taking one battery
CREATE TABLE test_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    battery_id      UUID NOT NULL REFERENCES test_batteries(id),
    project_id      UUID REFERENCES projects(id),
    
    -- Status
    status          VARCHAR(20) DEFAULT 'assigned' CHECK (status IN (
                        'assigned',     -- test assigned but not started
                        'in_progress',  -- student is currently taking it
                        'completed',    -- all sections done
                        'timed_out',    -- session expired
                        'abandoned'     -- started but never finished
                    )),
    
    -- Testing window control (switch on/off)
    is_open         BOOLEAN DEFAULT true,   -- can the person access this right now?
    opens_at        TIMESTAMPTZ,            -- scheduled open time
    closes_at       TIMESTAMPTZ,            -- scheduled close time
    
    -- Progress
    current_section INTEGER DEFAULT 0,
    current_item    INTEGER DEFAULT 0,
    
    -- Timing
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    
    -- Device info
    user_agent      TEXT,
    ip_address      INET,
    
    adaptive_state  JSONB DEFAULT '{}',      -- full adaptive engine state
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON test_sessions(user_id);
CREATE INDEX idx_sessions_project ON test_sessions(project_id);
CREATE INDEX idx_sessions_status ON test_sessions(status);

-- Every single response from every person
CREATE TABLE responses (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    session_id      UUID NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
    item_id         UUID NOT NULL REFERENCES items(id),
    
    -- What they chose
    selected_index  INTEGER,                -- which option index (0-based)
    selected_value  JSONB,                  -- the full option object they picked
    
    -- Scoring
    is_correct      BOOLEAN,                -- for items with correct answers (Gf, aptitude)
    score           NUMERIC(5,2),           -- trait score (personality), raw score, etc.
    trait           VARCHAR(50),            -- which trait this scores on
    
    -- Timing
    reaction_time_ms INTEGER,               -- how long they took
    timed_out       BOOLEAN DEFAULT false,
    
    -- Presentation
    presentation_order JSONB,               -- shuffled order of options shown
    
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_responses_session ON responses(session_id);
CREATE INDEX idx_responses_item ON responses(item_id);

-- ══════════════════════════════════════════
-- 6. SCORING & NORMS
-- ══════════════════════════════════════════

-- Scoring rules per domain
CREATE TABLE scoring_profiles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain          VARCHAR(30) NOT NULL,
    name            VARCHAR(255) NOT NULL,
    
    -- Scoring method
    method          VARCHAR(30) NOT NULL CHECK (method IN (
                        'sum_correct',      -- count correct answers (Gf, aptitude)
                        'trait_sum',        -- sum trait scores (personality)
                        'dimension_sum',    -- sum dimension scores (interest)
                        'irt_theta',        -- IRT-based scoring
                        'custom'
                    )),
    
    config          JSONB DEFAULT '{}',
    /*
        For personality:
        {
            "traits": ["openness","conscientiousness","extraversion","agreeableness","neuroticism"],
            "reverseItems": ["P5_NEU_003", "P5_EXT_007"]
        }
        
        For interest (Holland):
        {
            "dimensions": ["realistic","investigative","artistic","social","enterprising","conventional"]
        }
    */
    
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Norm tables for score interpretation
CREATE TABLE norms (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scoring_profile_id UUID NOT NULL REFERENCES scoring_profiles(id),
    
    -- Which population this norm applies to
    age_band_min    INTEGER NOT NULL,
    age_band_max    INTEGER NOT NULL,
    audience        VARCHAR(20) DEFAULT 'both',
    
    -- The norm data
    norm_data       JSONB NOT NULL,
    /*
        {
            "type": "percentile",
            "table": {
                "0-5":   {"percentile": 5,  "descriptor": "Very Low"},
                "6-10":  {"percentile": 25, "descriptor": "Below Average"},
                "11-15": {"percentile": 50, "descriptor": "Average"},
                "16-20": {"percentile": 75, "descriptor": "Above Average"},
                "21-25": {"percentile": 95, "descriptor": "Very High"}
            }
        }
    */
    
    sample_size     INTEGER,                -- how many people this norm is based on
    description     VARCHAR(255),
    
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Computed scores for a completed session
CREATE TABLE session_scores (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id      UUID NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
    
    domain          VARCHAR(30) NOT NULL,
    trait_or_dim    VARCHAR(50),            -- 'gf_total', 'agreeableness', 'investigative', etc.
    
    raw_score       NUMERIC(8,2),
    percentile      NUMERIC(5,1),
    standard_score  NUMERIC(6,2),           -- z-score, T-score, etc.
    descriptor      VARCHAR(50),            -- 'Average', 'Above Average', etc.
    
    norm_id         UUID REFERENCES norms(id),
    
    computed_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scores_session ON session_scores(session_id);

-- ══════════════════════════════════════════
-- 7. REPORTS
-- ══════════════════════════════════════════

CREATE TABLE reports (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    session_id      UUID REFERENCES test_sessions(id),    -- NULL for compiled career reports
    user_id         UUID NOT NULL REFERENCES users(id),
    project_id      UUID REFERENCES projects(id),
    
    -- Report content
    report_type     VARCHAR(30) NOT NULL CHECK (report_type IN (
                        'aptitude',              -- cognitive abilities only
                        'personality',           -- Big Five personality only
                        'interest',              -- Holland RIASEC only
                        'compiled',              -- combined career guidance
                        'comprehensive',         -- legacy combined
                        'screening_result'       -- employee screening
                    )),
    
    -- The actual report data
    report_data     JSONB NOT NULL,
    /*
        {
            "sections": [
                {
                    "title": "Fluid Intelligence",
                    "score": 82,
                    "percentile": 75,
                    "narrative": "Your pattern recognition..."
                },
                ...
            ],
            "careerSuggestions": [...],
            "strengthsAndGrowth": {...}
        }
    */
    
    -- Lifecycle
    status          VARCHAR(20) DEFAULT 'draft' CHECK (status IN (
                        'draft',            -- auto-generated, awaiting review
                        'in_review',        -- psychologist is reviewing
                        'published',        -- approved and visible to user
                        'revision',         -- sent back for changes
                        'archived'
                    )),
    
    -- Psychologist notes
    clinical_notes  TEXT,                   -- private notes (not shown to user)
    
    -- Who handled it
    reviewed_by     UUID REFERENCES users(id),
    published_by    UUID REFERENCES users(id),
    published_at    TIMESTAMPTZ,
    
    -- Sharing
    share_token     VARCHAR(50) UNIQUE,     -- for sharing via link
    share_expires   TIMESTAMPTZ,
    shared_with     JSONB DEFAULT '[]'::jsonb,  -- array of {email, method, sharedAt, sharedBy}
    
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reports_user ON reports(user_id);
CREATE INDEX idx_reports_project ON reports(project_id);
CREATE INDEX idx_reports_status ON reports(status);

-- ══════════════════════════════════════════
-- 8. AUDIT TRAIL
-- ══════════════════════════════════════════

CREATE TABLE audit_log (
    id              BIGSERIAL PRIMARY KEY,  -- BIGSERIAL for high volume
    
    -- Who
    user_id         UUID REFERENCES users(id),
    user_role       VARCHAR(20),
    user_email      VARCHAR(255),
    
    -- What
    action          VARCHAR(50) NOT NULL,
    /*
        Actions include:
        'user.login', 'user.logout', 'user.login_failed',
        'item.created', 'item.updated', 'item.deleted',
        'item.bulk_upload', 
        'battery.created', 'battery.updated',
        'session.assigned', 'session.started', 'session.completed',
        'session.opened', 'session.closed',
        'token.generated', 'token.used',
        'report.generated', 'report.reviewed', 'report.published',
        'report.viewed', 'report.shared', 'report.downloaded',
        'data.exported', 'data.viewed',
        'permission.granted', 'permission.revoked',
        'project.created', 'project.assignment_changed'
    */
    
    -- On what
    entity_type     VARCHAR(30),            -- 'item', 'report', 'session', 'user', etc.
    entity_id       UUID,                   -- which specific record
    
    -- Details
    details         JSONB DEFAULT '{}',
    /*
        {
            "description": "Published report for student Riya Sharma",
            "changes": {"status": {"from": "draft", "to": "published"}},
            "itemCount": 47  // for bulk uploads
        }
    */
    
    -- Context
    ip_address      INET,
    user_agent      TEXT,
    
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log is append-only, heavily read by date range
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_date ON audit_log(created_at);

-- ══════════════════════════════════════════
-- 9. MEDIA LIBRARY (for Type 3 items)
-- ══════════════════════════════════════════

CREATE TABLE media (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filename        VARCHAR(255) NOT NULL,
    original_name   VARCHAR(255),
    mime_type       VARCHAR(100),
    file_size       INTEGER,
    file_path       VARCHAR(500) NOT NULL,
    
    -- Categorization
    category        VARCHAR(50),            -- 'interest_activity', 'personality_scene', etc.
    tags            JSONB DEFAULT '[]',
    
    uploaded_by     UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════
-- 10. HELPER FUNCTIONS
-- ══════════════════════════════════════════

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER trg_organizations_updated BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_items_updated BEFORE UPDATE ON items FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_test_batteries_updated BEFORE UPDATE ON test_batteries FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_sessions_updated BEFORE UPDATE ON test_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_reports_updated BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_norms_updated BEFORE UPDATE ON norms FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ══════════════════════════════════════════
-- 11. DEFAULT DATA
-- ══════════════════════════════════════════

-- Default scoring profiles
INSERT INTO scoring_profiles (domain, name, method, config) VALUES
('gf', 'Fluid Intelligence - Sum Correct', 'sum_correct', '{"maxScore": 50}'),
('personality', 'Big Five - Trait Sum', 'trait_sum', '{"traits": ["openness","conscientiousness","extraversion","agreeableness","neuroticism"]}'),
('interest', 'Holland RIASEC', 'dimension_sum', '{"dimensions": ["realistic","investigative","artistic","social","enterprising","conventional"]}'),
('aptitude_numerical', 'Numerical Ability - Sum Correct', 'sum_correct', '{"maxScore": 30}'),
('aptitude_verbal', 'Verbal Ability - Sum Correct', 'sum_correct', '{"maxScore": 30}'),
('aptitude_attention', 'Attention to Detail - Sum Correct', 'sum_correct', '{"maxScore": 25}');

-- Default career guidance battery for students
INSERT INTO test_batteries (id, name, description, type, audience, age_band_min, age_band_max, config)
VALUES (
    uuid_generate_v4(),
    'Career Guidance Battery (Age 8-11)',
    'Standard career guidance assessment for younger students',
    'preset',
    'student',
    8, 11,
    '{
        "ordering": "ascending_difficulty",
        "stopRule": {"consecutiveWrong": 3},
        "practiceItems": true,
        "showFeedbackOnPractice": true,
        "shuffleWithinSection": true
    }'
);
