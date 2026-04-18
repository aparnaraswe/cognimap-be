-- Add "Questions per Section" setting (admin-controlled, default 15)
INSERT INTO platform_settings (setting_key, setting_value, category, label, description) VALUES
    ('items_per_section', '{"value": 15}', 'session', 'Questions Per Section', 'Number of questions to ask per section/domain in each test. Applied to all sections unless overridden by battery config.')
ON CONFLICT (setting_key) DO NOTHING;
