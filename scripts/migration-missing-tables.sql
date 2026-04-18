-- ═══════════════════════════════════════════════════════════════════════════════
-- COGNIMAP — MISSING TABLES FIX
-- ═══════════════════════════════════════════════════════════════════════════════
-- Run this in Navicat after migration-master.sql to add the 3 missing tables:
--   1. custom_svg_shapes
--   2. pending_items
--   3. career_database  (+ report engine seed data)
-- All idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. CUSTOM SVG SHAPES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS custom_svg_shapes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shape_name      VARCHAR(50) UNIQUE NOT NULL,
    display_name    VARCHAR(100),
    svg_code        TEXT NOT NULL,
    default_color   VARCHAR(7) DEFAULT '#8B5CF6',
    category        VARCHAR(50),
    tags            JSONB DEFAULT '[]',
    description     TEXT,
    is_active       BOOLEAN DEFAULT true,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_svg_shapes_name   ON custom_svg_shapes(shape_name);
CREATE INDEX IF NOT EXISTS idx_custom_svg_shapes_active ON custom_svg_shapes(is_active) WHERE is_active = true;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_custom_svg_shapes_updated') THEN
        CREATE TRIGGER trg_custom_svg_shapes_updated
            BEFORE UPDATE ON custom_svg_shapes
            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
END $$;

-- Seed default shapes
INSERT INTO custom_svg_shapes (shape_name, display_name, svg_code, default_color, category, description)
SELECT 'hexagram', 'Six-Pointed Star', '<polygon points="50,15 65,40 90,40 70,55 80,80 50,65 20,80 30,55 10,40 35,40" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />', '#8B5CF6', 'geometric', 'Six-pointed star shape'
WHERE NOT EXISTS (SELECT 1 FROM custom_svg_shapes WHERE shape_name = 'hexagram');

INSERT INTO custom_svg_shapes (shape_name, display_name, svg_code, default_color, category, description)
SELECT 'octastar', 'Eight-Pointed Star', '<polygon points="50,5 60,35 90,35 65,55 75,85 50,65 25,85 35,55 10,35 40,35" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />', '#A855F7', 'geometric', 'Eight-pointed star shape'
WHERE NOT EXISTS (SELECT 1 FROM custom_svg_shapes WHERE shape_name = 'octastar');


-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. PENDING ITEMS (items skipped during upload due to unresolved tokens)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pending_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_code           VARCHAR(100) NOT NULL,
    domain              VARCHAR(20),
    source_file         VARCHAR(255),
    raw_data            JSONB NOT NULL,
    unresolved_tokens   JSONB NOT NULL DEFAULT '[]',
    skip_reason         TEXT,
    status              VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (item_code)
);

CREATE INDEX IF NOT EXISTS idx_pending_items_status  ON pending_items(status);
CREATE INDEX IF NOT EXISTS idx_pending_items_domain  ON pending_items(domain);
CREATE INDEX IF NOT EXISTS idx_pending_items_created ON pending_items(created_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. CAREER DATABASE (used by report engine for career pathway matching)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS career_database (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    career           VARCHAR(200) NOT NULL,
    field            VARCHAR(100) NOT NULL,
    aptitude_cluster VARCHAR(50) NOT NULL,
    min_aptitude     INTEGER NOT NULL DEFAULT 50,
    riasec           VARCHAR(6) NOT NULL,
    traits           JSONB NOT NULL DEFAULT '{}',
    flag_condition   JSONB,
    degrees          JSONB NOT NULL DEFAULT '[]',
    institutions     JSONB NOT NULL DEFAULT '[]',
    is_active        BOOLEAN NOT NULL DEFAULT true,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_career_database_field   ON career_database(field);
CREATE INDEX IF NOT EXISTS idx_career_database_cluster ON career_database(aptitude_cluster);
CREATE INDEX IF NOT EXISTS idx_career_database_active  ON career_database(is_active);


-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. REPORT ENGINE SETTINGS (seed into platform_settings)
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO platform_settings (setting_key, setting_value, category, label, description)
VALUES (
    'career_match_weights',
    '{"value":{"aptitude":0.40,"interest":0.35,"personality":0.25}}',
    'report_engine', 'Career Match Weights',
    'Weights for aptitude, interest, and personality when computing career match scores'
) ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO platform_settings (setting_key, setting_value, category, label, description)
VALUES (
    'scoring_thresholds',
    '{"value":{"aptitudeClassification":{"exceptional":1.5,"advanced":0.5,"age_appropriate":-1.5},"personalityCutoffs":{"high":75,"moderate":45},"interestStrengthBands":{"strong":70,"moderate":45},"fitLevels":{"high":80,"mid":60}}}',
    'report_engine', 'Scoring Thresholds',
    'Thresholds for aptitude classification, personality cutoffs, interest bands, fit levels'
) ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO platform_settings (setting_key, setting_value, category, label, description)
VALUES (
    'report_sections',
    '{"value":{"aptitude":true,"personality":true,"interest":true,"career":true,"summary":true}}',
    'report_engine', 'Report Sections',
    'Toggle which sections appear in generated reports'
) ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO platform_settings (setting_key, setting_value, category, label, description)
VALUES (
    'cluster_formulas',
    '{"value":{"analytical":{"gf":0.6,"gq":0.4},"design":{"gv":1.0},"communication":{"gc":1.0},"operational":{"gs":1.0},"strategic":{"gf":0.7,"gv":0.3}}}',
    'report_engine', 'Cluster Formulas',
    'Domain weight formulas for computing aptitude cluster scores'
) ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO platform_settings (setting_key, setting_value, category, label, description)
VALUES (
    'domain_weights',
    '{"value":{"gf":0.30,"gv":0.20,"gq":0.20,"gc":0.15,"gs":0.15}}',
    'report_engine', 'Domain Weights',
    'Weights for computing the global aptitude theta from individual domain thetas'
) ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO platform_settings (setting_key, setting_value, category, label, description)
VALUES (
    'narrative_templates',
    '{"value":{"aptitude":{"gf":{"exceptional":"demonstrates outstanding pattern recognition and abstract reasoning ability.","advanced":"shows strong fluid reasoning skills above expectations.","age_appropriate":"demonstrates fluid reasoning skills on track for this age band.","developing":"shows emerging fluid reasoning skills."},"gv":{"exceptional":"displays exceptional visual-spatial processing.","advanced":"shows strong visual-spatial abilities.","age_appropriate":"demonstrates visual-spatial skills appropriate for this age.","developing":"shows developing visual-spatial skills."},"gq":{"exceptional":"exhibits outstanding quantitative reasoning.","advanced":"demonstrates strong quantitative abilities.","age_appropriate":"shows quantitative reasoning on track.","developing":"demonstrates emerging quantitative skills."},"gc":{"exceptional":"shows exceptional verbal reasoning and vocabulary depth.","advanced":"demonstrates strong verbal reasoning.","age_appropriate":"shows verbal reasoning appropriate for this age.","developing":"shows developing verbal skills."},"gs":{"exceptional":"demonstrates exceptional processing speed.","advanced":"shows strong processing speed.","age_appropriate":"demonstrates processing speed appropriate for this age.","developing":"shows developing processing speed."}},"personality":{"openness":{"high":"Shows strong curiosity, creativity, and willingness to explore.","moderate":"Demonstrates a balanced approach to new experiences.","low":"Prefers established routines and practical approaches."},"conscientiousness":{"high":"Highly organized, dependable, and goal-oriented.","moderate":"Generally organized with occasional flexibility.","low":"Prefers spontaneity and flexibility over rigid structure."},"extraversion":{"high":"Energized by social interaction. Naturally outgoing.","moderate":"Comfortable in both social and solitary settings.","low":"Draws energy from solitude and reflection."},"agreeableness":{"high":"Naturally empathetic, cooperative, and concerned with others.","moderate":"Balances cooperation with healthy assertiveness.","low":"Values direct communication and independent thinking."},"neuroticism":{"high":"May experience heightened emotional sensitivity.","moderate":"Generally stable with normal emotional responses.","low":"Demonstrates exceptional emotional resilience."}},"interest":{"realistic":{"strong":"Shows strong interest in hands-on, practical work.","moderate":"Has some interest in practical activities.","low":"Less drawn to hands-on physical activities."},"investigative":{"strong":"Strongly drawn to research and analysis.","moderate":"Shows balanced interest in analytical work.","low":"Less drawn to pure research."},"artistic":{"strong":"Strongly drawn to creative expression.","moderate":"Appreciates creativity while valuing structure.","low":"Prefers structured environments."},"social":{"strong":"Strongly motivated by helping and teaching.","moderate":"Values working with people.","low":"Prefers independent work."},"enterprising":{"strong":"Strongly drawn to leadership and business.","moderate":"Shows interest in leadership opportunities.","low":"Prefers collaborative or technical roles."},"conventional":{"strong":"Naturally inclined toward organized, data-oriented work.","moderate":"Appreciates structure and order.","low":"Prefers variety and flexibility."}}}}',
    'report_engine', 'Narrative Templates',
    'Text templates for domain/trait/interest narratives in reports'
) ON CONFLICT (setting_key) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. SEED CAREER DATABASE (default career pathways)
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO career_database (career, field, aptitude_cluster, min_aptitude, riasec, traits, degrees, institutions, sort_order)
SELECT 'Data Science & AI', 'Technology', 'analytical', 70, 'IRC',
    '{"openness":"high","conscientiousness":"high"}',
    '[{"name":"B.Tech Computer Science (AI/ML)","match":"97%","sub":"4-year engineering with AI/ML specialisation"},{"name":"B.Sc Data Science","match":"94%","sub":"3-year programme with statistics and programming core"}]',
    '[{"name":"IIT Bombay","loc":"Mumbai, India","type":"india"},{"name":"IIT Madras","loc":"Chennai, India","type":"india"},{"name":"MIT","loc":"Cambridge, USA","type":"global"}]',
    1
WHERE NOT EXISTS (SELECT 1 FROM career_database WHERE career = 'Data Science & AI');

INSERT INTO career_database (career, field, aptitude_cluster, min_aptitude, riasec, traits, degrees, institutions, sort_order)
SELECT 'Software Engineer', 'Technology', 'analytical', 60, 'IRC',
    '{"openness":"high","conscientiousness":"high"}',
    '[{"name":"B.Tech Computer Science","match":"96%","sub":"4-year core engineering programme"},{"name":"B.Sc Computer Science","match":"90%","sub":"3-year science track"}]',
    '[{"name":"IIT Bombay","loc":"Mumbai, India","type":"india"},{"name":"IIT Delhi","loc":"Delhi, India","type":"india"},{"name":"BITS Pilani","loc":"Pilani, India","type":"india"}]',
    2
WHERE NOT EXISTS (SELECT 1 FROM career_database WHERE career = 'Software Engineer');

INSERT INTO career_database (career, field, aptitude_cluster, min_aptitude, riasec, traits, degrees, institutions, sort_order)
SELECT 'Research Scientist', 'Science', 'analytical', 75, 'IRC',
    '{"openness":"high","conscientiousness":"moderate"}',
    '[{"name":"B.Sc Physics (Honours)","match":"92%","sub":"3-year honours programme"},{"name":"BS-MS Dual 5-year (IISER)","match":"87%","sub":"Integrated research training"}]',
    '[{"name":"IISc Bangalore","loc":"Bangalore, India","type":"india"},{"name":"IISER","loc":"Multiple, India","type":"india"},{"name":"ETH Zurich","loc":"Zurich, Switzerland","type":"global"}]',
    3
WHERE NOT EXISTS (SELECT 1 FROM career_database WHERE career = 'Research Scientist');

INSERT INTO career_database (career, field, aptitude_cluster, min_aptitude, riasec, traits, degrees, institutions, sort_order)
SELECT 'Medical Doctor', 'Healthcare', 'analytical', 70, 'ISR',
    '{"conscientiousness":"high","agreeableness":"high"}',
    '[{"name":"MBBS","match":"95%","sub":"5.5-year programme including internship"}]',
    '[{"name":"AIIMS Delhi","loc":"Delhi, India","type":"india"},{"name":"CMC Vellore","loc":"Vellore, India","type":"india"},{"name":"Johns Hopkins","loc":"Baltimore, USA","type":"global"}]',
    4
WHERE NOT EXISTS (SELECT 1 FROM career_database WHERE career = 'Medical Doctor');

INSERT INTO career_database (career, field, aptitude_cluster, min_aptitude, riasec, traits, degrees, institutions, sort_order)
SELECT 'Architect', 'Design', 'design', 65, 'AIR',
    '{"openness":"high","conscientiousness":"moderate"}',
    '[{"name":"B.Arch","match":"96%","sub":"5-year architecture programme"},{"name":"B.Des (Spatial Design)","match":"82%","sub":"4-year design programme"}]',
    '[{"name":"IIT Kharagpur","loc":"Kharagpur, India","type":"india"},{"name":"SPA Delhi","loc":"Delhi, India","type":"india"},{"name":"AA School London","loc":"London, UK","type":"global"}]',
    5
WHERE NOT EXISTS (SELECT 1 FROM career_database WHERE career = 'Architect');

INSERT INTO career_database (career, field, aptitude_cluster, min_aptitude, riasec, traits, degrees, institutions, sort_order)
SELECT 'Graphic Designer', 'Design', 'design', 55, 'AIS',
    '{"openness":"high","extraversion":"moderate"}',
    '[{"name":"B.Des Communication Design","match":"95%","sub":"4-year design programme"},{"name":"BFA (Applied Art)","match":"88%","sub":"4-year fine arts programme"}]',
    '[{"name":"NID Ahmedabad","loc":"Ahmedabad, India","type":"india"},{"name":"IDC IIT Bombay","loc":"Mumbai, India","type":"india"},{"name":"Parsons NYC","loc":"New York, USA","type":"global"}]',
    6
WHERE NOT EXISTS (SELECT 1 FROM career_database WHERE career = 'Graphic Designer');

INSERT INTO career_database (career, field, aptitude_cluster, min_aptitude, riasec, traits, degrees, institutions, sort_order)
SELECT 'Journalist', 'Communication', 'communication', 60, 'ASE',
    '{"openness":"high","extraversion":"high"}',
    '[{"name":"BA Journalism & Mass Communication","match":"94%","sub":"3-year programme"},{"name":"BA English (Honours)","match":"85%","sub":"3-year language and literature programme"}]',
    '[{"name":"IIMC Delhi","loc":"Delhi, India","type":"india"},{"name":"ACJ Chennai","loc":"Chennai, India","type":"india"},{"name":"Columbia Journalism","loc":"New York, USA","type":"global"}]',
    7
WHERE NOT EXISTS (SELECT 1 FROM career_database WHERE career = 'Journalist');

INSERT INTO career_database (career, field, aptitude_cluster, min_aptitude, riasec, traits, degrees, institutions, sort_order)
SELECT 'Teacher / Educator', 'Education', 'communication', 55, 'SAI',
    '{"agreeableness":"high","conscientiousness":"high"}',
    '[{"name":"B.Ed","match":"92%","sub":"2-year education programme"},{"name":"BA + B.Ed Integrated","match":"90%","sub":"4-year integrated programme"}]',
    '[{"name":"NCERT Delhi","loc":"Delhi, India","type":"india"},{"name":"TISS Mumbai","loc":"Mumbai, India","type":"india"}]',
    8
WHERE NOT EXISTS (SELECT 1 FROM career_database WHERE career = 'Teacher / Educator');

INSERT INTO career_database (career, field, aptitude_cluster, min_aptitude, riasec, traits, degrees, institutions, sort_order)
SELECT 'Chartered Accountant', 'Finance', 'operational', 65, 'CEI',
    '{"conscientiousness":"high","neuroticism":"low"}',
    '[{"name":"B.Com + CA","match":"96%","sub":"Commerce degree with CA articleship"},{"name":"BBA (Finance)","match":"82%","sub":"3-year business administration"}]',
    '[{"name":"ICAI","loc":"Pan-India","type":"india"},{"name":"SRCC Delhi","loc":"Delhi, India","type":"india"}]',
    9
WHERE NOT EXISTS (SELECT 1 FROM career_database WHERE career = 'Chartered Accountant');

INSERT INTO career_database (career, field, aptitude_cluster, min_aptitude, riasec, traits, degrees, institutions, sort_order)
SELECT 'Civil Services (IAS/IPS)', 'Government', 'strategic', 70, 'SEC',
    '{"conscientiousness":"high","openness":"high"}',
    '[{"name":"Any Graduation + UPSC","match":"95%","sub":"Any bachelor degree followed by UPSC preparation"},{"name":"BA Political Science","match":"88%","sub":"Commonly chosen humanities background"}]',
    '[{"name":"LBSNAA Mussoorie","loc":"Mussoorie, India","type":"india"},{"name":"JNU Delhi","loc":"Delhi, India","type":"india"}]',
    10
WHERE NOT EXISTS (SELECT 1 FROM career_database WHERE career = 'Civil Services (IAS/IPS)');


-- ═══════════════════════════════════════════════════════════════════════════════
-- DONE — All missing tables, indexes, seed data, and settings are in place.
-- ═══════════════════════════════════════════════════════════════════════════════
