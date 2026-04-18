-- ═══════════════════════════════════════════════════
-- MIGRATION: Add IRT + adaptive columns to items table
-- Run this AFTER schema.sql and migration-adaptive.sql
-- ═══════════════════════════════════════════════════

BEGIN;

-- IRT parameters (Item Response Theory)
ALTER TABLE items ADD COLUMN IF NOT EXISTS irt_a            NUMERIC(8,4);   -- discrimination
ALTER TABLE items ADD COLUMN IF NOT EXISTS irt_b            NUMERIC(8,4);   -- difficulty
ALTER TABLE items ADD COLUMN IF NOT EXISTS irt_c            NUMERIC(8,4);   -- guessing
ALTER TABLE items ADD COLUMN IF NOT EXISTS irt_calibrated   BOOLEAN DEFAULT false;

-- Adaptive engine constraints
ALTER TABLE items ADD COLUMN IF NOT EXISTS content_constraint VARCHAR(100);  -- e.g. 'no_repeat_shape'
ALTER TABLE items ADD COLUMN IF NOT EXISTS enemy_items       TEXT[];         -- item_codes that can't appear together
ALTER TABLE items ADD COLUMN IF NOT EXISTS exposure_control  NUMERIC(3,2) DEFAULT 1.0;  -- max exposure rate 0.0-1.0

-- Pending items table (for items with unresolved tokens / missing images)
CREATE TABLE IF NOT EXISTS pending_items (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_code         VARCHAR(50) UNIQUE NOT NULL,
    domain            VARCHAR(30),
    source_file       VARCHAR(255),
    raw_data          JSONB,
    unresolved_tokens JSONB DEFAULT '[]',
    skip_reason       TEXT,
    status            VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','resolved','skipped')),
    created_by        UUID REFERENCES users(id),
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

COMMIT;
