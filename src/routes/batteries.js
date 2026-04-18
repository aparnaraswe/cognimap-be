const express = require('express');
const { pool } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/batteries ── List all batteries
router.get('/', authenticate, requireRole('super_admin', 'psychologist', 'client_admin'), async (req, res) => {
    const { audience, status, page = 1, limit = 50 } = req.query;
    let query = `
        SELECT tb.*,
               (SELECT COUNT(*) FROM battery_sections bs WHERE bs.battery_id = tb.id) as section_count,
               (SELECT COUNT(*) FROM test_sessions ts WHERE ts.battery_id = tb.id) as session_count
        FROM test_batteries tb WHERE 1=1
    `;
    const params = [];
    let pi = 0;
    if (audience) { params.push(audience); query += ` AND (tb.audience = $${++pi} OR tb.audience = 'both')`; }
    if (status === 'active') query += ` AND tb.is_active = true`;

    const countQ = `SELECT COUNT(*) FROM (${query}) sub`;
    const countR = await pool.query(countQ, params);
    const total = parseInt(countR.rows[0].count);

    const offset = (parseInt(page) - 1) * parseInt(limit);
    params.push(parseInt(limit), offset);
    query += ` ORDER BY tb.created_at DESC LIMIT $${++pi} OFFSET $${++pi}`;

    try {
        const result = await pool.query(query, params);
        res.json({ batteries: result.rows, total });
    } catch (err) {
        console.error('Batteries fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch batteries' });
    }
});

// ── GET /api/batteries/:id ── Single battery with sections
router.get('/:id', authenticate, async (req, res) => {
    try {
        const bat = await pool.query('SELECT * FROM test_batteries WHERE id = $1', [req.params.id]);
        if (!bat.rows.length) return res.status(404).json({ error: 'Battery not found' });

        const secs = await pool.query(
            'SELECT * FROM battery_sections WHERE battery_id = $1 ORDER BY sort_order', [req.params.id]
        );

        // For manual sections, also fetch assigned items
        for (const sec of secs.rows) {
            if (sec.selection_mode === 'manual') {
                const items = await pool.query(`
                    SELECT i.item_code, i.template, i.difficulty_level, bsi.sort_order
                    FROM battery_section_items bsi
                    JOIN items i ON i.id = bsi.item_id
                    WHERE bsi.section_id = $1 ORDER BY bsi.sort_order
                `, [sec.id]);
                sec.items = items.rows;
            }
        }

        res.json({ battery: bat.rows[0], sections: secs.rows });
    } catch (err) {
        console.error('Battery detail error:', err);
        res.status(500).json({ error: 'Failed to fetch battery' });
    }
});

// ── POST /api/batteries ── Create new battery with sections
router.post('/', authenticate, requireRole('super_admin', 'psychologist'), async (req, res) => {
    const { name, description, type, audience, ageBandMin, ageBandMax, config, sections } = req.body;

    if (!name || !sections || !sections.length) {
        return res.status(400).json({ error: 'name and sections[] required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const batR = await client.query(`
            INSERT INTO test_batteries (name, description, type, audience, age_band_min, age_band_max, config, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [name, description || null, type || 'custom', audience || 'student',
            ageBandMin || 8, ageBandMax || 18, JSON.stringify(config || {}), req.user.id]);
        const battery = batR.rows[0];

        const createdSections = [];
        for (let i = 0; i < sections.length; i++) {
            const s = sections[i];
            const secR = await client.query(`
                INSERT INTO battery_sections (battery_id, name, domain, sort_order, selection_mode, config)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *
            `, [battery.id, s.name, s.domain, i + 1, s.selectionMode || 'auto',
                JSON.stringify(s.config || {})]);
            createdSections.push(secR.rows[0]);
        }

        await client.query('COMMIT');

        await req.audit('battery.created', 'test_battery', battery.id, {
            description: `Created battery "${name}" with ${sections.length} sections`
        });

        res.status(201).json({ battery, sections: createdSections });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Battery create error:', err);
        res.status(500).json({ error: 'Failed to create battery' });
    } finally {
        client.release();
    }
});

// ── PUT /api/batteries/:id ── Update battery
router.put('/:id', authenticate, requireRole('super_admin', 'psychologist'), async (req, res) => {
    const { name, description, audience, config, isActive } = req.body;
    try {
        const result = await pool.query(`
            UPDATE test_batteries SET
                name = COALESCE($2, name),
                description = COALESCE($3, description),
                audience = COALESCE($4, audience),
                config = COALESCE($5, config),
                is_active = COALESCE($6, is_active)
            WHERE id = $1 RETURNING *
        `, [req.params.id, name, description, audience,
            config ? JSON.stringify(config) : null, isActive]);

        if (!result.rows.length) return res.status(404).json({ error: 'Battery not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update battery' });
    }
});

// ── DELETE /api/batteries/:id ── Deactivate battery
router.delete('/:id', authenticate, requireRole('super_admin'), async (req, res) => {
    try {
        await pool.query('UPDATE test_batteries SET is_active = false WHERE id = $1', [req.params.id]);
        res.json({ message: 'Battery deactivated' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete battery' });
    }
});

module.exports = router;
