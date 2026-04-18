-- ═══════════════════════════════════════════════════
-- MIGRATION: Adaptive Engine + Cognitive Domains
-- Run this AFTER the initial schema.sql
-- ═══════════════════════════════════════════════════

-- 1. Add cognitive domains to items constraint
-- Drop and recreate the constraint to add gv, gq, gc, gs
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_domain_check;
ALTER TABLE items ADD CONSTRAINT items_domain_check CHECK (domain IN (
    'gf',       -- Fluid Reasoning
    'gv',       -- Visual Spatial
    'gq',       -- Quantitative Reasoning
    'gc',       -- Verbal Reasoning
    'gs',       -- Processing Speed
    'personality',
    'interest',
    'aptitude_numerical',
    'aptitude_verbal',
    'aptitude_attention',
    'domain_knowledge'
));

-- 2. Add adaptive state tracking to test_sessions
ALTER TABLE test_sessions ADD COLUMN IF NOT EXISTS adaptive_state JSONB DEFAULT '{}';
-- Stores live theta, streaks, current domain, items served, etc.
-- Example:
-- {
--   "currentDomain": "gf",
--   "currentDomainIndex": 0,
--   "domains": {
--     "gf": { "theta": 0.0, "correctStreak": 0, "incorrectStreak": 0, "itemsServed": 0, "currentDifficulty": 1, "completed": false },
--     "gv": { "theta": 0.0, ... }
--   },
--   "servedItemIds": ["uuid1", "uuid2"],
--   "anchorSchedule": [4, 8, 12, 16, 20]
-- }

-- 3. Add timer_mode to items for soft vs hard timer distinction
ALTER TABLE items ADD COLUMN IF NOT EXISTS timer_mode VARCHAR(10) DEFAULT 'soft'
    CHECK (timer_mode IN ('soft', 'hard'));

-- 4. Update scoring profiles for theta-based scoring
INSERT INTO scoring_profiles (domain, name, method, config)
VALUES
    ('gv', 'Visual Spatial - Theta', 'irt_theta', '{"maxItems": 24, "weight": 0.20}'),
    ('gq', 'Quantitative - Theta', 'irt_theta', '{"maxItems": 24, "weight": 0.20}'),
    ('gc', 'Verbal Reasoning - Theta', 'irt_theta', '{"maxItems": 24, "weight": 0.15}'),
    ('gs', 'Processing Speed - Theta', 'irt_theta', '{"maxItems": 24, "weight": 0.15}')
ON CONFLICT DO NOTHING;

-- Update Gf scoring to theta-based
UPDATE scoring_profiles SET method = 'irt_theta', config = '{"maxItems": 24, "weight": 0.30}'
WHERE domain = 'gf' AND method = 'sum_correct';

-- 5. Add global_theta to session_scores for the aggregated score
-- (session_scores already exists, just make sure we can store theta there)
-- No schema change needed — raw_score can hold theta, standard_score can hold global theta

COMMENT ON TABLE test_sessions IS 'adaptive_state JSONB holds live theta tracking per domain during test';
