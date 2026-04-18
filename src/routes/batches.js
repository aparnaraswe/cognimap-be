// ══════════════════════════════════════════════════════
// BATCHES ROUTE — groupings of students within an organization
// (replaces the old `sources` concept)
// ══════════════════════════════════════════════════════

const express = require('express');
const { pool } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { resolveSourceScope } = require('../utils/sourceScope');

const router = express.Router();

// ── GET /api/batches — List all batches (filtered by source scope) ──
router.get('/', authenticate, async (req, res) => {
    const { active, search } = req.query;
    const params = [];
    let where = 'WHERE 1=1';
    let idx = 0;

    // ── Source scope — enforced for non-super-admin, optional for super admin ──
    const scopedSourceId = resolveSourceScope(req);
    if (scopedSourceId) {
        params.push(scopedSourceId);
        where += ` AND b.source_id = $${++idx}`;
    }
    if (active === 'true')  where += ` AND b.is_active = true`;
    if (active === 'false') where += ` AND b.is_active = false`;
    if (search) {
        params.push(`%${search}%`);
        where += ` AND (b.name ILIKE $${++idx} OR b.code ILIKE $${idx})`;
    }

    try {
        const { rows } = await pool.query(`
            SELECT b.*,
                   o.name AS organization_name,
                   (SELECT COUNT(*)::int FROM users u WHERE u.batch_id = b.id) AS student_count
            FROM batches b
            LEFT JOIN organizations o ON b.organization_id = o.id
            ${where}
            ORDER BY b.created_at DESC
        `, params);
        res.json({ batches: rows });
    } catch (err) {
        console.error('Batches list error:', err);
        res.status(500).json({ error: 'Failed to fetch batches' });
    }
});

// ── GET /api/batches/:id — Get a single batch with student count ──
router.get('/:id', authenticate, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT b.*, o.name AS organization_name,
                   (SELECT COUNT(*)::int FROM users u WHERE u.batch_id = b.id) AS student_count,
                   (SELECT COUNT(*)::int FROM test_sessions ts WHERE ts.batch_id = b.id) AS session_count
            FROM batches b
            LEFT JOIN organizations o ON b.organization_id = o.id
            WHERE b.id = $1
        `, [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Batch not found' });
        // ── Source scope enforcement ──
        if (req.user.role !== 'super_admin') {
            const scopedSourceId = resolveSourceScope(req);
            if (scopedSourceId && rows[0].source_id && rows[0].source_id !== scopedSourceId) {
                return res.status(403).json({ error: 'Not authorized for this source' });
            }
        }
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch batch' });
    }
});

// ── POST /api/batches — Create a batch ──
router.post('/', authenticate, requireRole('super_admin', 'client_admin', 'psychologist'), async (req, res) => {
    const { name, code, description, grade, section, academic_year, organization_id, source_id, metadata } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    try {
        // Default to caller's organization if not provided
        const orgId = organization_id || req.user.organizationId || null;
        // Auto-assign source_id from source scope (super admin may pass one explicitly)
        const scopedSourceId = resolveSourceScope(req);
        const resolvedSourceId = (req.user.role === 'super_admin')
            ? (source_id || scopedSourceId || null)
            : (scopedSourceId || source_id || null);
        const result = await pool.query(`
            INSERT INTO batches (name, code, description, organization_id, source_id, grade, section, academic_year, metadata, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
        `, [name, code || null, description || null, orgId, resolvedSourceId, grade || null, section || null, academic_year || null, metadata || {}, req.user.id]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Batch create error:', err);
        res.status(500).json({ error: 'Failed to create batch' });
    }
});

// ── PUT /api/batches/:id — Update a batch ──
router.put('/:id', authenticate, requireRole('super_admin', 'client_admin', 'psychologist'), async (req, res) => {
    const { name, code, description, grade, section, academic_year, is_active, metadata } = req.body;
    try {
        // ── Source scope enforcement for non-super-admin ──
        if (req.user.role !== 'super_admin') {
            const scopedSourceId = resolveSourceScope(req);
            const existing = await pool.query('SELECT source_id FROM batches WHERE id = $1', [req.params.id]);
            if (!existing.rows.length) return res.status(404).json({ error: 'Batch not found' });
            if (scopedSourceId && existing.rows[0].source_id && existing.rows[0].source_id !== scopedSourceId) {
                return res.status(403).json({ error: 'Not authorized for this source' });
            }
        }
        const result = await pool.query(`
            UPDATE batches SET
                name = COALESCE($2, name),
                code = COALESCE($3, code),
                description = COALESCE($4, description),
                grade = COALESCE($5, grade),
                section = COALESCE($6, section),
                academic_year = COALESCE($7, academic_year),
                is_active = COALESCE($8, is_active),
                metadata = COALESCE($9, metadata),
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `, [req.params.id, name, code, description, grade, section, academic_year, is_active, metadata]);
        if (!result.rows.length) return res.status(404).json({ error: 'Batch not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update batch' });
    }
});

// ── DELETE /api/batches/:id — Soft-delete (set is_active=false) ──
router.delete('/:id', authenticate, requireRole('super_admin', 'client_admin'), async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE batches SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id`,
            [req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Batch not found' });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete batch' });
    }
});

// ── POST /api/batches/:id/students — Bulk-assign students to a batch ──
router.post('/:id/students', authenticate, requireRole('super_admin', 'client_admin', 'psychologist'), async (req, res) => {
    const { student_ids } = req.body;
    if (!Array.isArray(student_ids) || student_ids.length === 0) {
        return res.status(400).json({ error: 'student_ids must be a non-empty array' });
    }
    try {
        const result = await pool.query(
            `UPDATE users SET batch_id = $1 WHERE id = ANY($2::uuid[]) RETURNING id`,
            [req.params.id, student_ids]
        );
        res.json({ updated: result.rowCount });
    } catch (err) {
        console.error('Batch student-assign error:', err);
        res.status(500).json({ error: 'Failed to assign students' });
    }
});

module.exports = router;
