const express = require('express');
const { pool } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/settings ── Get all settings (grouped by category)
router.get('/', authenticate, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT setting_key, setting_value, category, label, description, updated_at
             FROM platform_settings ORDER BY category, label`
        );
        // For non-super_admin, only return visibility/branding settings
        const user = req.user;
        let filtered = rows;
        if (user.role !== 'super_admin') {
            filtered = rows.filter(r => ['visibility', 'branding'].includes(r.category));
        }
        // Group by category
        const grouped = {};
        for (const row of filtered) {
            if (!grouped[row.category]) grouped[row.category] = [];
            grouped[row.category].push(row);
        }
        res.json({ settings: grouped, flat: filtered });
    } catch (err) {
        console.error('Settings fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

// ── GET /api/settings/:key ── Get single setting value
router.get('/:key', authenticate, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT setting_value FROM platform_settings WHERE setting_key = $1`, [req.params.key]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Setting not found' });
        res.json(rows[0].setting_value);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch setting' });
    }
});

// ── PUT /api/settings/:key ── Update setting (super_admin only)
router.put('/:key', authenticate, requireRole('super_admin'), async (req, res) => {
    const { value } = req.body;
    try {
        const { rows } = await pool.query(
            `UPDATE platform_settings SET setting_value = $1, updated_by = $2, updated_at = NOW()
             WHERE setting_key = $3 RETURNING *`,
            [JSON.stringify({ value }), req.user.id, req.params.key]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Setting not found' });
        await req.audit('setting.updated', 'platform_settings', rows[0].id, {
            key: req.params.key, newValue: value
        });
        res.json(rows[0]);
    } catch (err) {
        console.error('Settings update error:', err);
        res.status(500).json({ error: 'Failed to update setting' });
    }
});

// ── POST /api/settings/bulk ── Update multiple settings at once
router.post('/bulk', authenticate, requireRole('super_admin'), async (req, res) => {
    const { updates } = req.body; // [{key, value}, ...]
    if (!Array.isArray(updates)) return res.status(400).json({ error: 'updates must be an array' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const results = [];
        for (const { key, value } of updates) {
            const { rows } = await client.query(
                `UPDATE platform_settings SET setting_value = $1, updated_by = $2, updated_at = NOW()
                 WHERE setting_key = $3 RETURNING setting_key, setting_value`,
                [JSON.stringify({ value }), req.user.id, key]
            );
            if (rows.length) results.push(rows[0]);
        }
        await client.query('COMMIT');
        res.json({ updated: results.length, settings: results });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Bulk settings error:', err);
        res.status(500).json({ error: 'Failed to update settings' });
    } finally {
        client.release();
    }
});

module.exports = router;
