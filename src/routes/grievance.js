const express = require('express');
const { pool } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { resolveSourceScope } = require('../utils/sourceScope');

const router = express.Router();

// ── POST /api/grievances — Student submits a grievance
router.post('/', authenticate, async (req, res) => {
    const { category, subject, description } = req.body;
    if (!subject || !description) return res.status(400).json({ error: 'Subject and description are required' });
    try {
        const result = await pool.query(`
            INSERT INTO grievances (user_id, category, subject, description)
            VALUES ($1, $2, $3, $4) RETURNING *
        `, [req.user.id, category || 'general', subject, description]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Grievance create error:', err);
        res.status(500).json({ error: 'Failed to submit grievance' });
    }
});

// ── GET /api/grievances — Get grievances (students see own, admins see source-scoped)
router.get('/', authenticate, async (req, res) => {
    const { status, page = 1, limit = 50 } = req.query;
    const isAdmin = ['super_admin', 'psychologist', 'client_admin'].includes(req.user.role);
    let where = 'WHERE 1=1';
    const params = [];
    let idx = 0;

    if (!isAdmin) {
        params.push(req.user.id);
        where += ` AND g.user_id = $${++idx}`;
    } else {
        // ── Source scope — non-super-admin sees only grievances from users in their source ──
        const scopedSourceId = resolveSourceScope(req);
        if (scopedSourceId) {
            params.push(scopedSourceId);
            where += ` AND u.source_id = $${++idx}`;
        }
    }
    if (status) {
        params.push(status);
        where += ` AND g.status = $${++idx}`;
    }

    try {
        const countR = await pool.query(`
            SELECT COUNT(*) FROM grievances g
            JOIN users u ON g.user_id = u.id
            ${where}
        `, params);
        const total = parseInt(countR.rows[0].count);
        const offset = (parseInt(page) - 1) * parseInt(limit);
        params.push(parseInt(limit), offset);
        const { rows } = await pool.query(`
            SELECT g.*, u.first_name, u.last_name, u.email, u.grade, u.section
            FROM grievances g
            JOIN users u ON g.user_id = u.id
            ${where}
            ORDER BY g.created_at DESC
            LIMIT $${++idx} OFFSET $${++idx}
        `, params);
        res.json({ grievances: rows, total });
    } catch (err) {
        console.error('Grievances fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch grievances' });
    }
});

// ── PATCH /api/grievances/:id/reply — Admin replies to grievance
router.patch('/:id/reply', authenticate, requireRole('super_admin', 'psychologist', 'client_admin'), async (req, res) => {
    const { admin_reply, status } = req.body;
    if (!admin_reply) return res.status(400).json({ error: 'Reply is required' });
    try {
        const result = await pool.query(`
            UPDATE grievances SET
                admin_reply = $2, replied_by = $3, replied_at = NOW(),
                status = COALESCE($4, status), updated_at = NOW()
            WHERE id = $1 RETURNING *
        `, [req.params.id, admin_reply, req.user.id, status || 'in_progress']);
        if (!result.rows.length) return res.status(404).json({ error: 'Grievance not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Grievance reply error:', err);
        res.status(500).json({ error: 'Failed to reply' });
    }
});

// ── PATCH /api/grievances/:id/status — Admin updates status
router.patch('/:id/status', authenticate, requireRole('super_admin', 'psychologist', 'client_admin'), async (req, res) => {
    const { status } = req.body;
    try {
        const extra = status === 'resolved' ? ', resolved_at = NOW()' : '';
        const result = await pool.query(`
            UPDATE grievances SET status = $2, updated_at = NOW()${extra}
            WHERE id = $1 RETURNING *
        `, [req.params.id, status]);
        if (!result.rows.length) return res.status(404).json({ error: 'Grievance not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update status' });
    }
});

module.exports = router;
