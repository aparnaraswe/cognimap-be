-- ═══════════════════════════════════════════════════
-- MIGRATION V5: Dynamic Config, Access Control, Form Builder
-- ═══════════════════════════════════════════════════

-- 1. New settings for access control / dynamic config
INSERT INTO platform_settings (setting_key, setting_value, category, label, description) VALUES
    -- Passing criteria
    ('passing_criteria', '{
        "value": {
            "globalThetaMin": 0.0,
            "domainThetaMin": {"gf": -0.5, "gv": -0.5, "gq": -0.5, "gc": -0.5, "gs": -0.5},
            "minDomainsAboveThreshold": 3,
            "flagForReview": {"thetaBelow": -1.0, "consecutiveTimeouts": 3, "totalTimeUnder": 120},
            "classifications": {
                "exceptional": {"min": 1.5, "label": "Exceptional", "color": "#7C3AED"},
                "advanced": {"min": 0.5, "label": "Advanced", "color": "#059669"},
                "age_appropriate": {"min": -1.5, "label": "Age Appropriate", "color": "#D97706"},
                "developing": {"min": -999, "label": "Developing", "color": "#DC2626"}
            }
        }
    }', 'scoring', 'Passing Criteria & Classifications', 'Theta thresholds for each classification band and domain-level pass/fail rules'),

    -- Report section visibility
    ('report_sections_visible', '{
        "value": {
            "overall_score": true,
            "domain_breakdown": true,
            "domain_narratives": true,
            "career_clusters": true,
            "career_suggestions": true,
            "strengths_weaknesses": true,
            "theta_bars": true,
            "percentiles": false,
            "raw_scores": false,
            "clinical_notes": false
        }
    }', 'visibility', 'Report Sections Visible to Students', 'Toggle which sections of the report students/parents can see'),

    -- Student form fields (dynamic onboarding)
    ('form_fields_student_registration', '{
        "value": [
            {"id": "first_name", "label": "First Name", "type": "text", "required": true, "group": "basic"},
            {"id": "last_name", "label": "Last Name", "type": "text", "required": false, "group": "basic"},
            {"id": "email", "label": "Email", "type": "email", "required": false, "group": "basic"},
            {"id": "date_of_birth", "label": "Date of Birth", "type": "date", "required": true, "group": "basic"},
            {"id": "gender", "label": "Gender", "type": "select", "required": false, "options": ["Male","Female","Other","Prefer not to say"], "group": "basic"},
            {"id": "grade", "label": "Grade / Class", "type": "text", "required": true, "group": "academic"},
            {"id": "section", "label": "Section", "type": "text", "required": false, "group": "academic"},
            {"id": "phone", "label": "Phone", "type": "text", "required": false, "group": "contact"},
            {"id": "parent_name", "label": "Parent/Guardian Name", "type": "text", "required": false, "group": "parent"},
            {"id": "parent_phone", "label": "Parent Phone", "type": "text", "required": false, "group": "parent"}
        ]
    }', 'forms', 'Student Registration Form Fields', 'Dynamic form fields shown when creating students. Super admin can add/remove/reorder without code changes.'),

    -- Test type definitions
    ('test_types', '{
        "value": [
            {
                "id": "aptitude_cognitive",
                "name": "Cognitive Aptitude Test",
                "domains": ["gf", "gv", "gq", "gc", "gs"],
                "domainLabels": {"gf": "Fluid Reasoning", "gv": "Visual Spatial", "gq": "Quantitative", "gc": "Verbal Reasoning", "gs": "Processing Speed"},
                "ageBands": ["8-11", "12-14", "15-18"],
                "itemsPerDomain": 15,
                "hasAdaptiveEngine": true,
                "reportType": "comprehensive",
                "active": true
            }
        ]
    }', 'tests', 'Test Type Definitions', 'Define available test types. Each test type specifies domains, age bands, and scoring rules.'),

    -- Auto-report generation
    ('auto_generate_report', '{"value": true}', 'report', 'Auto-Generate Reports', 'Automatically generate report when a test session is completed'),
    
    -- Student self-service
    ('student_can_view_past_tests', '{"value": true}', 'visibility', 'Student Can View Past Tests', 'Whether students can see their completed test history'),
    
    -- Notification settings
    ('notify_admin_on_completion', '{"value": true}', 'session', 'Notify Admin on Completion', 'Send notification to admin when a student completes a test')
    
ON CONFLICT (setting_key) DO NOTHING;

-- 2. Add metadata column to users for dynamic form data
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}';
-- Custom fields stores any dynamic form field data that doesn't have its own column
-- e.g. {"blood_group": "A+", "medical_conditions": "None", "consent_given": true}

-- 3. Add report_config to reports for per-report visibility overrides
ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_config JSONB DEFAULT '{}';

-- 4. Index for faster config lookups
CREATE INDEX IF NOT EXISTS idx_settings_category ON platform_settings(category);
CREATE INDEX IF NOT EXISTS idx_settings_key ON platform_settings(setting_key);
