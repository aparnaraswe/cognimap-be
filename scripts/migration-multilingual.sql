-- ═══════════════════════════════════════════════════════════
-- MIGRATION: Multilingual support
-- Adds language preference to test sessions
-- Adds translations JSONB to items
-- Supported: en (English), hi (Hindi), mr (Marathi)
-- ═══════════════════════════════════════════════════════════

-- 1. Add language column to test_sessions
ALTER TABLE test_sessions
    ADD COLUMN IF NOT EXISTS language VARCHAR(5) DEFAULT 'en';

-- 2. Add translations column to items
--    Structure:
--    {
--      "hi": {
--        "narration": "...",          -- for personality/story items
--        "prompt": "...",             -- for interest items
--        "options": [
--          { "text": "..." },         -- translated option texts
--          ...
--        ]
--      },
--      "mr": { ... }
--    }
ALTER TABLE items
    ADD COLUMN IF NOT EXISTS translations JSONB DEFAULT '{}'::jsonb;

-- 3. Index for fast language lookup
CREATE INDEX IF NOT EXISTS idx_items_translations ON items USING gin(translations);
CREATE INDEX IF NOT EXISTS idx_sessions_language  ON test_sessions(language);

-- 4. Add language preference to users (remembered for next session)
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(5) DEFAULT 'en';
