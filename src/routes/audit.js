const express = require('express');
const { pool } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/audit ── Query audit logs (super admin only)
router.get('/', authenticate, requireRole('super_admin'), async (req, res) => {
    const {
        userId, action, entityType, entityId,
        dateFrom, dateTo,
        page = 1, limit = 100
    } = req.query;

    let query = `SELECT * FROM audit_log WHERE 1=1`;
    const params = [];
    let paramIdx = 0;

    if (userId) { params.push(userId); query += ` AND user_id = $${++paramIdx}`; }
    if (action) { params.push(action); query += ` AND action = $${++paramIdx}`; }
    if (entityType) { params.push(entityType); query += ` AND entity_type = $${++paramIdx}`; }
    if (entityId) { params.push(entityId); query += ` AND entity_id = $${++paramIdx}`; }
    if (dateFrom) { params.push(dateFrom); query += ` AND created_at >= $${++paramIdx}`; }
    if (dateTo) { params.push(dateTo); query += ` AND created_at <= $${++paramIdx}`; }

    // Count
    const countResult = await pool.query(`SELECT COUNT(*) FROM (${query}) sub`, params);
    const total = parseInt(countResult.rows[0].count);

    // Paginate
    const offset = (parseInt(page) - 1) * parseInt(limit);
    params.push(parseInt(limit));
    params.push(offset);
    query += ` ORDER BY created_at DESC LIMIT $${++paramIdx} OFFSET $${++paramIdx}`;

    try {
        const result = await pool.query(query, params);
        res.json({
            logs: result.rows,
            pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) }
        });
    } catch (err) {
        console.error('Audit fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});

// ── GET /api/audit/summary ── Quick stats for admin dashboard
router.get('/summary', authenticate, requireRole('super_admin'), async (req, res) => {
    try {
        const [logins, uploads, reports, recentActions] = await Promise.all([
            pool.query(`SELECT COUNT(*) FROM audit_log WHERE action = 'user.login' AND created_at > NOW() - INTERVAL '24 hours'`),
            pool.query(`SELECT COUNT(*) FROM audit_log WHERE action = 'item.bulk_upload' AND created_at > NOW() - INTERVAL '7 days'`),
            pool.query(`SELECT COUNT(*) FROM audit_log WHERE action = 'report.published' AND created_at > NOW() - INTERVAL '7 days'`),
            pool.query(`SELECT action, COUNT(*) as count FROM audit_log WHERE created_at > NOW() - INTERVAL '24 hours' GROUP BY action ORDER BY count DESC LIMIT 10`)
        ]);

        res.json({
            last24h: {
                logins: parseInt(logins.rows[0].count),
                topActions: recentActions.rows
            },
            last7d: {
                uploads: parseInt(uploads.rows[0].count),
                reportsPublished: parseInt(reports.rows[0].count)
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch audit summary' });
    }
});

module.exports = router;
