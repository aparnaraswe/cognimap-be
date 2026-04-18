const express = require('express');
const { pool } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { resolveSourceScope } = require('../utils/sourceScope');
const { logAudit } = require('../middleware/audit');

const router = express.Router();
const ADMIN_ROLES = ['super_admin', 'psychologist', 'client_admin'];

// ─── Auto-migrate sources table on first load ───────────────────────────────
pool.query(`
  CREATE TABLE IF NOT EXISTS sources (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name    VARCHAR(255) NOT NULL,
    source_code     VARCHAR(60)  NOT NULL UNIQUE,
    description     TEXT,
    type            VARCHAR(30)  DEFAULT 'school',
    contact_name    VARCHAR(255),
    contact_email   VARCHAR(255),
    contact_phone   VARCHAR(30),
    address         TEXT,
    city            VARCHAR(100),
    state           VARCHAR(100),
    is_active       BOOLEAN      DEFAULT true,
    metadata        JSONB        DEFAULT '{}',
    created_at      TIMESTAMPTZ  DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_sources_code   ON sources(source_code);
  CREATE INDEX IF NOT EXISTS idx_sources_active ON sources(is_active);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS source_id       UUID REFERENCES sources(id) ON DELETE SET NULL;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS enrollment_type VARCHAR(20) DEFAULT 'individual';
  CREATE INDEX IF NOT EXISTS idx_users_source_id ON users(source_id);
`).catch(e => console.warn('[sources migration]', e.message));

// ── GET /api/sources ── List sources
//   Super admin: ALWAYS sees ALL sources (so they can switch between them).
//                Ignores X-Source-Id header on this endpoint.
//   Non-super-admin: locked to their OWN source only.
router.get('/', authenticate, async (req, res) => {
    try {
        const { active, search } = req.query;
        let q = `
            SELECT s.*,
                   (SELECT COUNT(*) FROM users u WHERE u.source_id = s.id) AS user_count
            FROM sources s
            WHERE 1=1
        `;
        const params = [];
        let pi = 0;

        // ── Scope: non-super-admins are locked to their assigned source.
        //          Super admins always see ALL sources (this is the "switcher" endpoint). ──
        if (req.user.role !== 'super_admin') {
            const ownSourceId =
                req.user.source_id || req.user.sourceId ||
                req.user.organization_id || req.user.organizationId || null;
            if (ownSourceId) {
                params.push(ownSourceId);
                q += ` AND s.id = $${++pi}`;
            } else {
                // No source assigned → return empty list rather than leaking everything
                return res.json({ sources: [] });
            }
        }

        if (active === 'true')  { q += ` AND s.is_active = true`; }
        if (active === 'false') { q += ` AND s.is_active = false`; }
        if (search) {
            params.push(`%${search}%`);
            q += ` AND (s.display_name ILIKE $${++pi} OR s.source_code ILIKE $${pi})`;
        }
        q += ` ORDER BY s.display_name ASC`;
        const result = await pool.query(q, params);
        res.json({ sources: result.rows });
    } catch (err) {
        console.error('List sources error:', err);
        res.status(500).json({ error: 'Failed to fetch sources' });
    }
});

// ── GET /api/sources/:id ── Get single source
router.get('/:id', authenticate, async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT s.*,
                    (SELECT COUNT(*) FROM users u WHERE u.source_id = s.id) AS user_count
             FROM sources s WHERE s.id = $1`,
            [req.params.id]
        );
        if (!r.rows.length) return res.status(404).json({ error: 'Source not found' });
        res.json({ source: r.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch source' });
    }
});

// ── POST /api/sources ── Create source (super_admin only)
router.post('/', authenticate, requireRole('super_admin'), async (req, res) => {
    const {
        display_name, source_code, description = '', type = 'school',
        contact_name, contact_email, contact_phone, address, city, state
    } = req.body;

    if (!display_name || !source_code) {
        return res.status(400).json({ error: 'display_name and source_code are required' });
    }
    // Normalise source_code: lowercase, alphanumeric + hyphens
    const slug = source_code.toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 60);
    if (!slug) return res.status(400).json({ error: 'source_code must contain alphanumeric characters' });

    try {
        const exists = await pool.query('SELECT 1 FROM sources WHERE source_code=$1', [slug]);
        if (exists.rows.length) return res.status(409).json({ error: 'Source code already exists' });

        const r = await pool.query(`
            INSERT INTO sources
                (display_name, source_code, description, type,
                 contact_name, contact_email, contact_phone, address, city, state)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            RETURNING *
        `, [display_name, slug, description, type,
            contact_name || null, contact_email || null, contact_phone || null,
            address || null, city || null, state || null]);

        await logAudit({
            userId: req.user.id, userRole: req.user.role,
            action: 'source.created', entityType: 'source', entityId: r.rows[0].id,
            details: { display_name, source_code: slug }, req
        });

        res.status(201).json({ source: r.rows[0] });
    } catch (err) {
        console.error('Create source error:', err);
        res.status(500).json({ error: 'Failed to create source' });
    }
});

// ── PUT /api/sources/:id ── Update source
router.put('/:id', authenticate, requireRole('super_admin', 'client_admin'), async (req, res) => {
    const {
        display_name, description, type,
        contact_name, contact_email, contact_phone, address, city, state, is_active
    } = req.body;

    try {
        const r = await pool.query(`
            UPDATE sources SET
                display_name  = COALESCE($2, display_name),
                description   = COALESCE($3, description),
                type          = COALESCE($4, type),
                contact_name  = COALESCE($5, contact_name),
                contact_email = COALESCE($6, contact_email),
                contact_phone = COALESCE($7, contact_phone),
                address       = COALESCE($8, address),
                city          = COALESCE($9, city),
                state         = COALESCE($10, state),
                is_active     = COALESCE($11, is_active),
                updated_at    = NOW()
            WHERE id = $1
            RETURNING *
        `, [req.params.id, display_name, description, type,
            contact_name, contact_email, contact_phone,
            address, city, state, is_active]);

        if (!r.rows.length) return res.status(404).json({ error: 'Source not found' });
        res.json({ source: r.rows[0] });
    } catch (err) {
        console.error('Update source error:', err);
        res.status(500).json({ error: 'Failed to update source' });
    }
});

// ── PATCH /api/sources/:id/toggle ── Toggle active
router.patch('/:id/toggle', authenticate, requireRole('super_admin'), async (req, res) => {
    try {
        const r = await pool.query(`
            UPDATE sources SET is_active = NOT is_active, updated_at = NOW()
            WHERE id = $1 RETURNING id, display_name, is_active
        `, [req.params.id]);
        if (!r.rows.length) return res.status(404).json({ error: 'Source not found' });
        res.json(r.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to toggle source' });
    }
});

// ══════════════════════════════════════════════════════
// SOURCE SETTINGS — Per-source question limits per domain
// Stored in sources.metadata.questionsPerDomain
//   { cognitive: { gf: 10, gv: 8, gq: 10, gc: 12, gs: 8, gwm: 10 },
//     personality: { openness: 6, conscientiousness: 6, ... },
//     interest:    { realistic: 5, investigative: 5, ... } }
// ══════════════════════════════════════════════════════

// ── GET /api/sources/:id/settings ── Read question-per-domain limits
router.get('/:id/settings', authenticate, async (req, res) => {
    try {
        const r = await pool.query('SELECT metadata FROM sources WHERE id = $1', [req.params.id]);
        if (!r.rows.length) return res.status(404).json({ error: 'Source not found' });
        const md = r.rows[0].metadata || {};
        res.json({
            questionsPerDomain: md.questionsPerDomain || {
                cognitive: {},
                personality: {},
                interest: {},
            },
        });
    } catch (err) {
        console.error('Get source settings error:', err);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

// ── PUT /api/sources/:id/settings ── Update question-per-domain limits
router.put('/:id/settings', authenticate, requireRole('super_admin', 'client_admin', 'psychologist'), async (req, res) => {
    const { questionsPerDomain } = req.body;
    if (!questionsPerDomain || typeof questionsPerDomain !== 'object') {
        return res.status(400).json({ error: 'questionsPerDomain object required' });
    }

    // Sanitise: only positive integers, drop bad values
    const clean = {};
    for (const testType of ['cognitive', 'personality', 'interest']) {
        const inSection = questionsPerDomain[testType];
        if (inSection && typeof inSection === 'object') {
            const cleanSection = {};
            for (const [k, v] of Object.entries(inSection)) {
                const n = parseInt(v, 10);
                if (Number.isFinite(n) && n >= 1 && n <= 100) cleanSection[k] = n;
            }
            clean[testType] = cleanSection;
        }
    }

    try {
        // Merge into existing metadata (preserve other fields)
        const existing = await pool.query('SELECT metadata FROM sources WHERE id = $1', [req.params.id]);
        if (!existing.rows.length) return res.status(404).json({ error: 'Source not found' });
        const md = existing.rows[0].metadata || {};
        md.questionsPerDomain = clean;

        const r = await pool.query(
            'UPDATE sources SET metadata = $2, updated_at = NOW() WHERE id = $1 RETURNING metadata',
            [req.params.id, md]
        );
        res.json({ questionsPerDomain: r.rows[0].metadata.questionsPerDomain });
    } catch (err) {
        console.error('Update source settings error:', err);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// ── DELETE /api/sources/:id ── Soft-delete (set inactive)
router.delete('/:id', authenticate, requireRole('super_admin'), async (req, res) => {
    try {
        // Check if any users are assigned
        const uc = await pool.query('SELECT COUNT(*) FROM users WHERE source_id=$1', [req.params.id]);
        if (parseInt(uc.rows[0].count) > 0) {
            return res.status(409).json({
                error: `Cannot delete: ${uc.rows[0].count} user(s) are assigned to this source`
            });
        }
        await pool.query('UPDATE sources SET is_active=false, updated_at=NOW() WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete source' });
    }
});

module.exports = router;
