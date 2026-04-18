-- ═══════════════════════════════════════════════════
-- MIGRATION V4: Platform Settings + Report Enhancements
-- ═══════════════════════════════════════════════════

-- 1. Platform settings table (super_admin configurable)
CREATE TABLE IF NOT EXISTS platform_settings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    setting_key     VARCHAR(100) UNIQUE NOT NULL,
    setting_value   JSONB NOT NULL DEFAULT '{}',
    category        VARCHAR(50) NOT NULL DEFAULT 'general',
    label           VARCHAR(200),
    description     TEXT,
    updated_by      UUID REFERENCES users(id),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default settings
INSERT INTO platform_settings (setting_key, setting_value, category, label, description) VALUES
    ('passing_theta', '{"value": 0.0, "enabled": true}', 'scoring', 'Minimum Passing Theta', 'Students with global theta below this value are flagged as "Needs Attention"'),
    ('show_scores_to_student', '{"value": true}', 'visibility', 'Show Scores to Students', 'Whether students can see their theta scores and domain breakdowns'),
    ('show_clusters_to_student', '{"value": true}', 'visibility', 'Show Career Clusters', 'Whether students can see their career aptitude cluster scores'),
    ('show_report_to_student', '{"value": false}', 'visibility', 'Auto-show Report to Students', 'Whether reports are automatically visible to students (otherwise requires publishing)'),
    ('required_domains', '{"value": ["gf","gv","gq","gc","gs"]}', 'battery', 'Required Domains', 'Which domains must be included in a valid battery'),
    ('min_items_per_domain', '{"value": 10}', 'battery', 'Minimum Items Per Domain', 'Minimum items the adaptive engine should serve per domain'),
    ('max_test_duration_min', '{"value": 45}', 'battery', 'Maximum Test Duration (minutes)', 'Hard cap on total test time'),
    ('allow_resume', '{"value": true}', 'session', 'Allow Test Resume', 'Whether students can resume interrupted tests'),
    ('show_timer', '{"value": true}', 'session', 'Show Timer to Students', 'Whether the countdown timer is visible during testing'),
    ('show_progress', '{"value": true}', 'session', 'Show Progress Bar', 'Whether domain/item progress is visible during testing'),
    ('report_template', '{"value": "standard"}', 'report', 'Report Template', 'Which report layout to use (standard, detailed, minimal)'),
    ('org_name', '{"value": "Psychometric Assessment Platform"}', 'branding', 'Organisation Name', 'Shown in reports and student dashboard'),
    ('org_logo_url', '{"value": ""}', 'branding', 'Organisation Logo URL', 'Logo shown in reports')
ON CONFLICT (setting_key) DO NOTHING;

-- 2. Add columns to users for better management
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_phone VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(10) CHECK (gender IN ('male','female','other','prefer_not_to_say'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','inactive','suspended'));

-- 3. Report enhancements
ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_data_v2 JSONB DEFAULT '{}';
-- v2 stores structured: { theta, domains, clusters, narratives, classification }
