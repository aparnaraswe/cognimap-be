-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Pending Items — items skipped during upload due to
--            unresolvable tokens (missing shapes / images / sprites)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pending_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Original item data (raw Excel row, stored as JSON for full fidelity)
    item_code       VARCHAR(100) NOT NULL,          -- e.g. Gc_B1_001
    domain          VARCHAR(20),                    -- e.g. gc, gf
    source_file     VARCHAR(255),                   -- original uploaded filename
    raw_data        JSONB NOT NULL,                 -- full Excel row fields

    -- Why it was skipped
    unresolved_tokens  JSONB NOT NULL DEFAULT '[]', -- array of {token, field, reason}
    skip_reason        TEXT,                        -- human-readable summary

    -- Status
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- 'pending'  = waiting for tokens to be added
    -- 'resolved' = tokens added, ready to retry
    -- 'uploaded' = successfully inserted after retry

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Prevent duplicate pending entries for the same item_code
    UNIQUE (item_code)
);

CREATE INDEX IF NOT EXISTS idx_pending_items_status   ON pending_items(status);
CREATE INDEX IF NOT EXISTS idx_pending_items_domain   ON pending_items(domain);
CREATE INDEX IF NOT EXISTS idx_pending_items_created  ON pending_items(created_at DESC);
