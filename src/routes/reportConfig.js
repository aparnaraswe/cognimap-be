// ══════════════════════════════════════════════════════
// REPORT CONFIG ROUTES — Admin endpoints for managing
// report engine configuration and career database
// ══════════════════════════════════════════════════════

const express = require('express');
const { pool } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { invalidateCache } = require('../engine/configLoader');

const router = express.Router();

// ═══════════════════════════════════════
// GET /api/report-config
// Get all report engine config settings
// ═══════════════════════════════════════
router.get('/', authenticate, requireRole('super_admin'), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT setting_key, setting_value, label, description FROM platform_settings WHERE category = 'report_engine' ORDER BY setting_key`
        );
        res.json({ settings: rows });
    } catch (err) {
        console.error('Fetch report config error:', err);
        res.status(500).json({ error: 'Failed to fetch report config' });
    }
});

// ═══════════════════════════════════════
// PUT /api/report-config/:key
// Update a single report engine setting (upsert)
// ═══════════════════════════════════════
router.put('/:key', authenticate, requireRole('super_admin'), async (req, res) => {
    const { key } = req.params;
    const { setting_value, label, description } = req.body;
    if (!setting_value) return res.status(400).json({ error: 'setting_value is required' });
    try {
        const { rows } = await pool.query(`
            INSERT INTO platform_settings (setting_key, setting_value, category, label, description)
            VALUES ($1, $2, 'report_engine', COALESCE($3, $1), $4)
            ON CONFLICT (setting_key) DO UPDATE SET
                setting_value = EXCLUDED.setting_value,
                label = COALESCE(EXCLUDED.label, platform_settings.label),
                description = COALESCE(EXCLUDED.description, platform_settings.description)
            RETURNING *
        `, [key, JSON.stringify(setting_value), label || null, description || null]);
        invalidateCache();
        res.json(rows[0]);
    } catch (err) {
        console.error('Update report config error:', err);
        res.status(500).json({ error: 'Failed to update report config' });
    }
});

// ═══════════════════════════════════════
// GET /api/report-config/careers
// List all careers (with optional ?field= filter)
// Returns both active and inactive for admin
// ═══════════════════════════════════════
router.get('/careers', authenticate, requireRole('super_admin'), async (req, res) => {
    const { field } = req.query;
    try {
        let query = 'SELECT * FROM career_database';
        const params = [];
        if (field) {
            query += ' WHERE field = $1';
            params.push(field);
        }
        query += ' ORDER BY sort_order, career';
        const { rows } = await pool.query(query, params);
        res.json({ careers: rows });
    } catch (err) {
        console.error('Fetch careers error:', err);
        res.status(500).json({ error: 'Failed to fetch careers' });
    }
});

// ═══════════════════════════════════════
// POST /api/report-config/careers
// Create a new career entry
// ═══════════════════════════════════════
router.post('/careers', authenticate, requireRole('super_admin'), async (req, res) => {
    const { career, field, aptitude_cluster, min_aptitude, riasec, traits, flag_condition, degrees, institutions } = req.body;
    if (!career || !field || !aptitude_cluster || !riasec) {
        return res.status(400).json({ error: 'career, field, aptitude_cluster, and riasec are required' });
    }
    try {
        const { rows } = await pool.query(`
            INSERT INTO career_database (career, field, aptitude_cluster, min_aptitude, riasec, traits, flag_condition, degrees, institutions)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [
            career, field, aptitude_cluster, min_aptitude || 50, riasec,
            JSON.stringify(traits || {}), flag_condition ? JSON.stringify(flag_condition) : null,
            JSON.stringify(degrees || []), JSON.stringify(institutions || [])
        ]);
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error('Create career error:', err);
        res.status(500).json({ error: 'Failed to create career' });
    }
});

// ═══════════════════════════════════════
// PUT /api/report-config/careers/:id
// Update a career entry
// ═══════════════════════════════════════
router.put('/careers/:id', authenticate, requireRole('super_admin'), async (req, res) => {
    const { id } = req.params;
    const { career, field, aptitude_cluster, min_aptitude, riasec, traits, flag_condition, degrees, institutions, is_active, sort_order } = req.body;
    try {
        const { rows } = await pool.query(`
            UPDATE career_database SET
                career = COALESCE($2, career),
                field = COALESCE($3, field),
                aptitude_cluster = COALESCE($4, aptitude_cluster),
                min_aptitude = COALESCE($5, min_aptitude),
                riasec = COALESCE($6, riasec),
                traits = COALESCE($7, traits),
                flag_condition = COALESCE($8, flag_condition),
                degrees = COALESCE($9, degrees),
                institutions = COALESCE($10, institutions),
                is_active = COALESCE($11, is_active),
                sort_order = COALESCE($12, sort_order),
                updated_at = NOW()
            WHERE id = $1 RETURNING *
        `, [
            id,
            career || null, field || null, aptitude_cluster || null,
            min_aptitude != null ? min_aptitude : null,
            riasec || null,
            traits ? JSON.stringify(traits) : null,
            flag_condition !== undefined ? (flag_condition ? JSON.stringify(flag_condition) : null) : null,
            degrees ? JSON.stringify(degrees) : null,
            institutions ? JSON.stringify(institutions) : null,
            is_active != null ? is_active : null,
            sort_order != null ? sort_order : null
        ]);
        if (!rows.length) return res.status(404).json({ error: 'Career not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error('Update career error:', err);
        res.status(500).json({ error: 'Failed to update career' });
    }
});

// ═══════════════════════════════════════
// DELETE /api/report-config/careers/:id
// Soft-delete a career (set is_active = false)
// ═══════════════════════════════════════
router.delete('/careers/:id', authenticate, requireRole('super_admin'), async (req, res) => {
    const { id } = req.params;
    try {
        const { rows } = await pool.query(`
            UPDATE career_database SET is_active = false, updated_at = NOW()
            WHERE id = $1 RETURNING *
        `, [id]);
        if (!rows.length) return res.status(404).json({ error: 'Career not found' });
        res.json({ message: 'Career deactivated', career: rows[0] });
    } catch (err) {
        console.error('Delete career error:', err);
        res.status(500).json({ error: 'Failed to delete career' });
    }
});

module.exports = router;
