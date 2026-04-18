const express = require('express');
const { pool } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const ADMIN_ROLES = ['super_admin', 'psychologist', 'client_admin'];
const GUARDIAN_ROLES = ['guardian', 'teacher'];

// ═══════════════════════════════════════
// GET /api/guardians — List guardian/teacher users
// ═══════════════════════════════════════
router.get('/', authenticate, requireRole(...ADMIN_ROLES), async (req, res) => {
    const { role, search, page = 1, limit = 50 } = req.query;
    try {
        let w = ` WHERE u.role IN ('guardian','teacher')`;
        const p = [];
        let pi = 0;
        if (req.user.role === 'client_admin') {
            p.push(req.user.organization_id);
            w += ` AND u.organization_id=$${++pi}`;
        }
        if (role && GUARDIAN_ROLES.includes(role)) {
            p.push(role); w += ` AND u.role=$${++pi}`;
        }
        if (search) {
            p.push(`%${search}%`);
            w += ` AND (u.first_name ILIKE $${pi+1} OR u.last_name ILIKE $${pi+1} OR u.email ILIKE $${pi+1})`;
            pi++;
        }
        const off = (parseInt(page) - 1) * parseInt(limit);
        p.push(parseInt(limit), off);
        const countR = await pool.query(`SELECT COUNT(*) FROM users u ${w}`, p.slice(0, pi));
        const r = await pool.query(`
            SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.phone, u.status, u.organization_id, u.created_at,
                   (SELECT COUNT(*) FROM student_guardians sg WHERE sg.guardian_id = u.id) as student_count
            FROM users u ${w}
            ORDER BY u.created_at DESC
            LIMIT $${++pi} OFFSET $${++pi}
        `, p);
        res.json({ guardians: r.rows, total: parseInt(countR.rows[0].count) });
    } catch (err) {
        console.error('List guardians error:', err);
        res.status(500).json({ error: 'Failed to list guardians' });
    }
});

// ═══════════════════════════════════════
// GET /api/guardians/:id/students — Students assigned to a guardian
// ═══════════════════════════════════════
router.get('/:id/students', authenticate, async (req, res) => {
    const guardianId = req.params.id;
    // Self-access or admin
    if (req.user.id !== guardianId && !ADMIN_ROLES.includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    try {
        const r = await pool.query(`
            SELECT u.id, u.first_name, u.last_name, u.email, u.grade, u.section,
                   u.date_of_birth, u.gender, u.status,
                   sg.relationship, sg.can_view_reports, sg.created_at as assigned_at,
                   (SELECT COUNT(*) FROM reports rp WHERE rp.user_id = u.id) as report_count
            FROM student_guardians sg
            JOIN users u ON sg.student_id = u.id
            WHERE sg.guardian_id = $1
            ORDER BY u.first_name, u.last_name
        `, [guardianId]);
        res.json({ students: r.rows });
    } catch (err) {
        console.error('Get guardian students error:', err);
        res.status(500).json({ error: 'Failed' });
    }
});

// ═══════════════════════════════════════
// POST /api/guardians/:id/students — Assign students to a guardian
// Body: { studentIds: [...], relationship: 'parent'|'guardian'|'teacher'|'counselor' }
// ═══════════════════════════════════════
router.post('/:id/students', authenticate, requireRole(...ADMIN_ROLES), async (req, res) => {
    const guardianId = req.params.id;
    const { studentIds, relationship = 'guardian' } = req.body;
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
        return res.status(400).json({ error: 'studentIds array required' });
    }
    try {
        // Verify guardian exists and has correct role
        const gR = await pool.query(`SELECT id, role FROM users WHERE id=$1 AND role IN ('guardian','teacher')`, [guardianId]);
        if (!gR.rows.length) return res.status(404).json({ error: 'Guardian/teacher not found' });

        let added = 0;
        for (const sid of studentIds) {
            try {
                await pool.query(`
                    INSERT INTO student_guardians (student_id, guardian_id, relationship, assigned_by)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (student_id, guardian_id) DO UPDATE SET
                        relationship = EXCLUDED.relationship,
                        updated_at = NOW()
                `, [sid, guardianId, relationship, req.user.id]);
                added++;
            } catch (e) {
                console.warn(`Failed to assign student ${sid}:`, e.message);
            }
        }
        res.json({ added, total: studentIds.length });
    } catch (err) {
        console.error('Assign students error:', err);
        res.status(500).json({ error: 'Failed to assign students' });
    }
});

// ═══════════════════════════════════════
// DELETE /api/guardians/:id/students/:studentId — Remove assignment
// ═══════════════════════════════════════
router.delete('/:id/students/:studentId', authenticate, requireRole(...ADMIN_ROLES), async (req, res) => {
    try {
        await pool.query(
            `DELETE FROM student_guardians WHERE guardian_id=$1 AND student_id=$2`,
            [req.params.id, req.params.studentId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to remove assignment' });
    }
});

// ═══════════════════════════════════════
// GET /api/guardians/my-students — Guardian's own assigned students
// ═══════════════════════════════════════
router.get('/my-students', authenticate, requireRole(...GUARDIAN_ROLES), async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT u.id, u.first_name, u.last_name, u.email, u.grade, u.section,
                   u.date_of_birth, u.gender,
                   sg.relationship, sg.can_view_reports,
                   (SELECT COUNT(*) FROM reports rp WHERE rp.user_id = u.id) as report_count,
                   (SELECT COUNT(*) FROM test_sessions ts WHERE ts.user_id = u.id AND ts.status = 'completed') as tests_completed,
                   (SELECT COUNT(*) FROM test_sessions ts WHERE ts.user_id = u.id) as tests_total
            FROM student_guardians sg
            JOIN users u ON sg.student_id = u.id
            WHERE sg.guardian_id = $1
            ORDER BY u.first_name, u.last_name
        `, [req.user.id]);
        res.json({ students: r.rows });
    } catch (err) {
        console.error('My students error:', err);
        res.status(500).json({ error: 'Failed' });
    }
});

// ═══════════════════════════════════════
// GET /api/guardians/my-students/:studentId/reports — Reports for an assigned student
// ═══════════════════════════════════════
router.get('/my-students/:studentId/reports', authenticate, requireRole(...GUARDIAN_ROLES), async (req, res) => {
    const { studentId } = req.params;
    try {
        // Verify assignment exists and can_view_reports is true
        const sg = await pool.query(
            `SELECT * FROM student_guardians WHERE guardian_id=$1 AND student_id=$2 AND can_view_reports=true`,
            [req.user.id, studentId]
        );
        if (!sg.rows.length) return res.status(403).json({ error: 'Not authorized to view this student\'s reports' });

        // Check for per-report access control: if report_access rows exist, filter by those
        const r = await pool.query(`
            SELECT rp.id, rp.report_type, rp.created_at, rp.report_data,
                   u.first_name || ' ' || COALESCE(u.last_name,'') as student_name
            FROM reports rp
            JOIN users u ON rp.user_id = u.id
            WHERE rp.user_id = $1
            AND (
                NOT EXISTS (SELECT 1 FROM report_access ra WHERE ra.report_id = rp.id)
                OR EXISTS (SELECT 1 FROM report_access ra WHERE ra.report_id = rp.id AND ra.user_id = $2)
            )
            ORDER BY rp.created_at DESC
        `, [studentId, req.user.id]);

        // Strip clinical notes from report data for guardians
        const reports = r.rows.map(rp => {
            if (rp.report_data?.clinicalNotes) {
                const { clinicalNotes, ...rest } = rp.report_data;
                rp.report_data = rest;
            }
            return rp;
        });

        res.json({ reports });
    } catch (err) {
        console.error('Student reports error:', err);
        res.status(500).json({ error: 'Failed' });
    }
});

// ═══════════════════════════════════════
// POST /api/reports/:id/access — Set report access (multi-select user IDs)
// Body: { userIds: [...] }
// ═══════════════════════════════════════
router.post('/report-access/:reportId', authenticate, requireRole(...ADMIN_ROLES), async (req, res) => {
    const { reportId } = req.params;
    const { userIds } = req.body;
    if (!Array.isArray(userIds)) return res.status(400).json({ error: 'userIds array required' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Clear existing access
        await client.query(`DELETE FROM report_access WHERE report_id=$1`, [reportId]);
        // Insert new
        for (const uid of userIds) {
            await client.query(
                `INSERT INTO report_access (report_id, user_id, granted_by) VALUES ($1, $2, $3)
                 ON CONFLICT DO NOTHING`,
                [reportId, uid, req.user.id]
            );
        }
        await client.query('COMMIT');
        res.json({ success: true, count: userIds.length });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Set report access error:', err);
        res.status(500).json({ error: 'Failed' });
    } finally {
        client.release();
    }
});

// ═══════════════════════════════════════
// GET /api/guardians/report-access/:reportId — Get access list for a report
// ═══════════════════════════════════════
router.get('/report-access/:reportId', authenticate, requireRole(...ADMIN_ROLES), async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT ra.user_id, u.first_name, u.last_name, u.email, u.role, ra.created_at
            FROM report_access ra
            JOIN users u ON ra.user_id = u.id
            WHERE ra.report_id = $1
        `, [req.params.reportId]);
        res.json({ access: r.rows });
    } catch (err) {
        res.status(500).json({ error: 'Failed' });
    }
});

module.exports = router;
