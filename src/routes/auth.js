const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const { generateToken, authenticate, authenticateToken, requireRole } = require('../middleware/auth');
const { resolveSourceScope } = require('../utils/sourceScope');
const { logAudit } = require('../middleware/audit');
const { sendStudentWelcome, sendParentWelcome, generatePassword } = require('../services/email');

const router = express.Router();

// ── Helper: create the student_guardians link row (idempotent) ──
async function linkStudentGuardian(studentId, guardianId, relationship = 'parent') {
    try {
        await pool.query(`
            INSERT INTO student_guardians (student_id, guardian_id, relationship, can_view_reports)
            VALUES ($1, $2, $3, true)
            ON CONFLICT (student_id, guardian_id) DO UPDATE
              SET relationship = EXCLUDED.relationship, can_view_reports = true
        `, [studentId, guardianId, relationship]);
    } catch (err) {
        // Table may not have a unique constraint — fall back to manual upsert
        try {
            const existing = await pool.query(
                'SELECT 1 FROM student_guardians WHERE student_id=$1 AND guardian_id=$2',
                [studentId, guardianId]
            );
            if (!existing.rows.length) {
                await pool.query(`
                    INSERT INTO student_guardians (student_id, guardian_id, relationship, can_view_reports)
                    VALUES ($1, $2, $3, true)
                `, [studentId, guardianId, relationship]);
            }
        } catch (e2) {
            console.warn('[linkStudentGuardian] failed:', e2.message);
        }
    }
}

// ── Helper: create + link a guardian account for a student ──
// Returns { parentUser, parentPlainPassword } or null on failure.
// parentPlainPassword is null if we reused an existing parent account
// (don't email a fresh password to a pre-existing user).
async function createLinkedParent({ parentEmail, parentName, studentRow, sourceId }) {
    const cleanEmail = String(parentEmail || '').toLowerCase().trim();
    if (!cleanEmail) return null;

    // If parent email already has an account, just link the student to it.
    const existing = await pool.query('SELECT id, email, first_name, role FROM users WHERE email = $1', [cleanEmail]);
    if (existing.rows.length) {
        const parent = existing.rows[0];
        await pool.query(
            'UPDATE users SET linked_student_id = $1 WHERE id = $2',
            [studentRow.id, parent.id]
        );
        await pool.query(
            'UPDATE users SET linked_parent_id = $1, parent_email = $2 WHERE id = $3',
            [parent.id, cleanEmail, studentRow.id]
        );
        // Only create a guardian assignment row if the existing user is a guardian/teacher.
        if (parent.role === 'guardian' || parent.role === 'teacher') {
            await linkStudentGuardian(studentRow.id, parent.id, 'parent');
        }
        return { parentUser: parent, parentPlainPassword: null };
    }

    // Create a fresh guardian account
    const plain = generatePassword(10);
    const hash = await bcrypt.hash(plain, 10);
    const firstName = parentName || 'Parent';
    try {
        const ins = await pool.query(`
            INSERT INTO users (
                email, password_hash, first_name, last_name, role,
                organization_id, source_id, parent_email,
                linked_student_id, is_active
            )
            VALUES ($1, $2, $3, '', 'guardian', NULL, $4, $5, $6, true)
            RETURNING id, email, first_name
        `, [cleanEmail, hash, firstName, sourceId || null, cleanEmail, studentRow.id]);
        const parent = ins.rows[0];

        // Link back from student → parent
        await pool.query(
            'UPDATE users SET linked_parent_id = $1, parent_email = $2 WHERE id = $3',
            [parent.id, cleanEmail, studentRow.id]
        );

        // Create the guardian assignment row so the parent sees this student in their dashboard
        await linkStudentGuardian(studentRow.id, parent.id, 'parent');

        return { parentUser: parent, parentPlainPassword: plain };
    } catch (err) {
        console.warn('[createLinkedParent] failed:', err.message);
        return null;
    }
}

// ── POST /api/auth/register ──
// Optional auth: if caller is authenticated, auto-assign their organization to the new user
router.post('/register', (req, res, next) => {
    // Try to parse auth token but don't fail if missing (allows first-time setup)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const jwt = require('jsonwebtoken');
        try {
            req.user = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET || 'dev-secret-change-in-production');
        } catch (_) { /* ignore invalid tokens */ }
    }
    next();
}, async (req, res) => {
    const {
        email, password, firstName, lastName, role,
        organizationId, sourceId, batchId, dateOfBirth,
        grade, section, department, jobRole,
        parent_email, parentEmail, parent_name, parentName, phone, parent_phone, parentPhone, gender,
        sendEmail = true,
    } = req.body;

    const resolvedParentEmail = (parent_email || parentEmail || '').toLowerCase().trim() || null;
    const resolvedParentName  = parent_name || parentName || null;
    const resolvedParentPhone = parent_phone || parentPhone || null;

    if (!email || !password || !firstName || !role) {
        return res.status(400).json({ error: 'email, password, firstName, and role are required' });
    }

    try {
        const exists = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
        if (exists.rows.length > 0) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        // Calculate age band from DOB
        let ageBand = null;
        if (dateOfBirth) {
            const age = Math.floor((Date.now() - new Date(dateOfBirth)) / 31557600000);
            if (age <= 11) ageBand = '8-11';
            else if (age <= 14) ageBand = '12-14';
            else if (age <= 18) ageBand = '15-18';
            else ageBand = '18+';
        }

        // ── Resolve source_id ──
        // Super admin: prefer body sourceId, then X-Source-Id header (active source from
        //              the source switcher), then their own callerSource.
        // Others:      locked to their own source — ignore any passed sourceId.
        const callerIsSuper = req.user?.role === 'super_admin';
        const callerSource  = req.user?.source_id || req.user?.organizationId || req.user?.organization_id || null;
        const headerSource  = req.headers['x-source-id'] && req.headers['x-source-id'] !== 'all'
            ? req.headers['x-source-id']
            : null;
        let resolvedSource;
        if (callerIsSuper) {
            resolvedSource = sourceId || organizationId || headerSource || callerSource;
        } else if (req.user) {
            resolvedSource = callerSource;
        } else {
            resolvedSource = sourceId || organizationId || null;
        }

        // organization_id is a legacy column with a FK to organizations(id).
        // We've moved to source-based isolation — leave it NULL for new users
        // and only populate source_id.
        const result = await pool.query(`
            INSERT INTO users (email, password_hash, first_name, last_name, role, organization_id, source_id, batch_id,
                              date_of_birth, age_band, grade, section, department, job_role,
                              phone, gender, parent_name, parent_phone, parent_email)
            VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            RETURNING id, email, first_name, last_name, role, organization_id, source_id, batch_id, age_band
        `, [email, passwordHash, firstName, lastName, role,
            resolvedSource, batchId || null,
            dateOfBirth || null, ageBand, grade || null, section || null,
            department || null, jobRole || null,
            phone || null, gender || null, resolvedParentName, resolvedParentPhone, resolvedParentEmail]);

        const user = result.rows[0];
        const token = generateToken(user);

        await logAudit({
            userId: user.id, userRole: role, userEmail: email,
            action: 'user.registered', entityType: 'user', entityId: user.id,
            details: { role }, req
        });

        // ── Look up source name (for nicer email body) ──
        let sourceName = null;
        if (resolvedSource) {
            try {
                const sr = await pool.query('SELECT display_name FROM sources WHERE id = $1', [resolvedSource]);
                sourceName = sr.rows[0]?.display_name || null;
            } catch (_) {}
        }

        // ── Auto-create + link a guardian account if parent_email provided ──
        let parentInfo = null;
        if (role === 'student' && resolvedParentEmail) {
            parentInfo = await createLinkedParent({
                parentEmail: resolvedParentEmail,
                parentName: resolvedParentName,
                studentRow: user,
                sourceId: resolvedSource,
            });
        }

        // ── Fire welcome emails (non-blocking; we don't fail registration on email errors) ──
        if (sendEmail !== false) {
            // Student
            sendStudentWelcome({
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                password,                       // plain password the admin set
                sourceName,
            }).catch(e => console.warn('[email] student welcome failed:', e.message));

            // Parent (only if a fresh account was just created — existing accounts keep their old password)
            if (parentInfo?.parentPlainPassword) {
                sendParentWelcome({
                    email: parentInfo.parentUser.email,
                    parentName: resolvedParentName,
                    studentName: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
                    password: parentInfo.parentPlainPassword,
                }).catch(e => console.warn('[email] parent welcome failed:', e.message));
            }
        }

        res.status(201).json({
            user,
            token,
            parentLinked: !!parentInfo,
            parentEmailed: !!parentInfo?.parentPlainPassword,
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// ── POST /api/auth/login ──
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }

    try {
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND is_active = true', [email]
        );

        if (result.rows.length === 0) {
            await logAudit({
                userEmail: email, action: 'user.login_failed',
                details: { reason: 'user not found' }, req
            });
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);

        if (!valid) {
            await logAudit({
                userId: user.id, userEmail: email, action: 'user.login_failed',
                details: { reason: 'wrong password' }, req
            });
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

        const token = generateToken(user);

        await logAudit({
            userId: user.id, userRole: user.role, userEmail: email,
            action: 'user.login', entityType: 'user', entityId: user.id, req
        });

        res.json({
            user: {
                id: user.id,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                role: user.role,
                organization_id: user.organization_id,
                source_id: user.source_id,
                batch_id: user.batch_id,
                age_band: user.age_band
            },
            token
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// ── POST /api/auth/token-access ──
// For students accessing via token (no account needed)
router.post('/token-access', authenticateToken, async (req, res) => {
    const user = req.user;

    // Mark token as used
    await pool.query(
        'UPDATE access_tokens SET is_used = true, used_at = NOW() WHERE id = $1',
        [req.accessToken.id]
    );

    const jwt = generateToken({
        id: user.id,
        role: user.role,
        organization_id: user.organizationId
    });

    await logAudit({
        userId: user.id, userRole: user.role,
        action: 'token.used', entityType: 'access_token', entityId: req.accessToken.id,
        details: { token: req.body.token }, req
    });

    res.json({
        user: { id: user.id, role: user.role, first_name: user.first_name || user.firstName },
        token: jwt,
        sessionId: user.sessionId
    });
});

// ── GET /api/auth/me ──
router.get('/me', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, email, first_name, last_name, role, organization_id,
                    age_band, grade, section, department, job_role,
                    phone, parent_name, parent_phone, date_of_birth, gender
             FROM users WHERE id = $1`, [req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

// ── PUT /api/auth/me ── Update own profile (any authenticated user)
router.put('/me', authenticate, async (req, res) => {
    const { first_name, last_name, phone, parent_name, parent_phone, date_of_birth, gender } = req.body;
    try {
        let ageBand = undefined;
        if (date_of_birth) {
            const age = Math.floor((Date.now() - new Date(date_of_birth).getTime()) / 31557600000);
            if (age <= 11) ageBand = '8-11';
            else if (age <= 14) ageBand = '12-14';
            else if (age <= 18) ageBand = '15-18';
            else ageBand = '18+';
        }
        const result = await pool.query(`
            UPDATE users SET
                first_name = COALESCE($2, first_name), last_name = COALESCE($3, last_name),
                phone = COALESCE($4, phone), parent_name = COALESCE($5, parent_name),
                parent_phone = COALESCE($6, parent_phone),
                date_of_birth = COALESCE($7, date_of_birth), gender = COALESCE($8, gender),
                age_band = COALESCE($9, age_band)
            WHERE id = $1
            RETURNING id, email, first_name, last_name, role, grade, section, age_band, phone, parent_name, parent_phone, date_of_birth, gender
        `, [req.user.id, first_name, last_name, phone, parent_name, parent_phone, date_of_birth || null, gender, ageBand]);
        if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
        res.json({ user: result.rows[0] });
    } catch (err) {
        console.error('Profile update error:', err);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// ── GET /api/auth/users ── List users (admin only)
router.get('/users', authenticate, requireRole('super_admin', 'psychologist', 'client_admin'), async (req, res) => {
    const { role, search, batchId, page = 1, limit = 100 } = req.query;
    // Build query with LEFT JOIN to batches so missing batches don't filter rows out.
    let query = `
        SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.organization_id,
               u.grade, u.section, u.age_band, u.is_active,
               u.source_id, u.batch_id, b.name AS batch_name
        FROM users u
        LEFT JOIN batches b ON u.batch_id = b.id
        WHERE 1=1`;
    const params = [];
    let pi = 0;

    if (role) { params.push(role); query += ` AND u.role = $${++pi}`; }
    if (search) { params.push(`%${search}%`); query += ` AND (u.first_name ILIKE $${++pi} OR u.last_name ILIKE $${pi} OR u.email ILIKE $${pi})`; }
    // ── Source scope — enforced for non-super-admin, optional for super admin ──
    const scopedSourceId = resolveSourceScope(req);
    if (scopedSourceId) {
        params.push(scopedSourceId);
        query += ` AND u.source_id = $${++pi}`;
    }
    // ── Batch filter ──
    if (batchId) { params.push(batchId); query += ` AND u.batch_id = $${++pi}`; }

    const countR = await pool.query(`SELECT COUNT(*) FROM (${query}) sub`, params);
    const total = parseInt(countR.rows[0].count);

    const offset = (parseInt(page) - 1) * parseInt(limit);
    params.push(parseInt(limit), offset);
    query += ` ORDER BY u.first_name ASC LIMIT $${++pi} OFFSET $${++pi}`;

    try {
        const result = await pool.query(query, params);
        res.json({ users: result.rows, total });
    } catch (err) {
        console.error('Users fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// ── PUT /api/auth/users/:id ── Update user (admin only)
router.put('/users/:id', authenticate, requireRole('super_admin', 'client_admin'), async (req, res) => {
    const { first_name, last_name, email, role, grade, section, age_band, phone, parent_name, parent_phone, date_of_birth, gender, status } = req.body;
    try {
        // ── Source scope: non-super-admin cannot update users outside their source ──
        if (req.user.role !== 'super_admin') {
            const scopedSourceId = resolveSourceScope(req);
            const tgt = await pool.query('SELECT source_id FROM users WHERE id = $1', [req.params.id]);
            if (!tgt.rows.length) return res.status(404).json({ error: 'User not found' });
            if (scopedSourceId && tgt.rows[0].source_id && tgt.rows[0].source_id !== scopedSourceId) {
                return res.status(403).json({ error: 'Not authorized for this source' });
            }
        }
        const result = await pool.query(`
            UPDATE users SET
                first_name = COALESCE($2, first_name), last_name = COALESCE($3, last_name),
                email = COALESCE($4, email), role = COALESCE($5, role),
                grade = COALESCE($6, grade), section = COALESCE($7, section),
                age_band = COALESCE($8, age_band), phone = COALESCE($9, phone),
                parent_name = COALESCE($10, parent_name), parent_phone = COALESCE($11, parent_phone),
                date_of_birth = COALESCE($12, date_of_birth), gender = COALESCE($13, gender),
                status = COALESCE($14, status)
            WHERE id = $1 RETURNING id, email, first_name, last_name, role, grade, section, age_band, phone, parent_name, status
        `, [req.params.id, first_name, last_name, email, role, grade, section, age_band, phone, parent_name, parent_phone, date_of_birth, gender, status]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('User update error:', err);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// ── PATCH /api/auth/users/:id/toggle ── Activate/deactivate user
router.patch('/users/:id/toggle', authenticate, requireRole('super_admin', 'client_admin'), async (req, res) => {
    try {
        // ── Source scope: non-super-admin cannot toggle users outside their source ──
        if (req.user.role !== 'super_admin') {
            const scopedSourceId = resolveSourceScope(req);
            const tgt = await pool.query('SELECT source_id FROM users WHERE id = $1', [req.params.id]);
            if (!tgt.rows.length) return res.status(404).json({ error: 'User not found' });
            if (scopedSourceId && tgt.rows[0].source_id && tgt.rows[0].source_id !== scopedSourceId) {
                return res.status(403).json({ error: 'Not authorized for this source' });
            }
        }
        const result = await pool.query(`
            UPDATE users SET is_active = NOT is_active, status = CASE WHEN is_active THEN 'inactive' ELSE 'active' END
            WHERE id = $1 RETURNING id, first_name, last_name, is_active, status
        `, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to toggle user' });
    }
});

// ── POST /api/auth/users/:id/resend-credentials ── Regenerate password and email the user
router.post('/users/:id/resend-credentials', authenticate, requireRole('super_admin', 'client_admin'), async (req, res) => {
    try {
        // ── Source scope: non-super-admin cannot touch users outside their source ──
        if (req.user.role !== 'super_admin') {
            const scopedSourceId = resolveSourceScope(req);
            const tgt = await pool.query('SELECT source_id FROM users WHERE id = $1', [req.params.id]);
            if (!tgt.rows.length) return res.status(404).json({ error: 'User not found' });
            if (scopedSourceId && tgt.rows[0].source_id && tgt.rows[0].source_id !== scopedSourceId) {
                return res.status(403).json({ error: 'Not authorized for this source' });
            }
        }

        const userResult = await pool.query(
            `SELECT id, email, first_name, last_name, role, parent_name, linked_student_id
             FROM users WHERE id = $1`,
            [req.params.id]
        );
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const user = userResult.rows[0];
        if (!user.email) return res.status(400).json({ error: 'User has no email on file' });

        const newPassword = generatePassword(10);
        const newHash = await bcrypt.hash(newPassword, 12);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);

        // ── Pick the appropriate template based on role ──
        let sendResult;
        if (user.role === 'parent') {
            let studentName = '';
            if (user.linked_student_id) {
                const s = await pool.query(
                    'SELECT first_name, last_name FROM users WHERE id = $1',
                    [user.linked_student_id]
                );
                if (s.rows.length) {
                    studentName = `${s.rows[0].first_name || ''} ${s.rows[0].last_name || ''}`.trim();
                }
            }
            sendResult = await sendParentWelcome({
                email: user.email,
                parentName: user.parent_name || user.first_name,
                studentName,
                password: newPassword,
            });
        } else {
            sendResult = await sendStudentWelcome({
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                password: newPassword,
            });
        }

        if (sendResult?.ok === false && !sendResult.skipped) {
            return res.status(502).json({ error: 'Password reset but email failed', detail: sendResult.error });
        }

        res.json({
            ok: true,
            emailed: !!sendResult?.ok,
            skipped: !!sendResult?.skipped,
            to: user.email,
        });
    } catch (err) {
        console.error('Resend credentials error:', err);
        res.status(500).json({ error: 'Failed to resend credentials' });
    }
});

// ── Helper: derive age band from DOB ──
function deriveAgeBand(dob) {
    if (!dob) return null;
    const age = Math.floor((Date.now() - new Date(dob).getTime()) / 31557600000);
    if (age <= 11) return '8-11';
    if (age <= 14) return '12-14';
    if (age <= 18) return '15-18';
    return '18+';
}

// ── Helper: insert one user (used by both JSON-bulk and Excel-bulk) ──
async function insertBulkUser(u, callerSourceId) {
    const bcryptjs = require('bcryptjs');
    const plainPwd = String(u.password || 'student123');
    const hash = await bcryptjs.hash(plainPwd, 10);
    const dob = u.date_of_birth || u.dateOfBirth || u.dob || null;
    const ageBand = u.age_band || u.ageBand || deriveAgeBand(dob) || '12-14';

    const r = await pool.query(`
        INSERT INTO users (
            email, password_hash, first_name, last_name, role,
            grade, section, age_band, gender, phone,
            parent_name, parent_phone, parent_email, date_of_birth,
            organization_id, source_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NULL, $15)
        ON CONFLICT (email) DO NOTHING
        RETURNING id, email, first_name
    `, [
        String(u.email || '').toLowerCase().trim(),
        hash,
        u.first_name || u.firstName || '',
        u.last_name  || u.lastName  || '',
        u.role || 'student',
        u.grade   || '',
        u.section || '',
        ageBand,
        u.gender       || null,
        u.phone        || null,
        u.parent_name  || u.parentName  || null,
        u.parent_phone || u.parentPhone || null,
        u.parent_email || u.parentEmail || null,
        dob,
        callerSourceId || null,
    ]);

    const created = r.rows[0] || null;

    // ── Fire welcome email + parent notification (non-blocking) ──
    if (created) {
        const email = String(u.email || '').toLowerCase().trim();
        const firstName = u.first_name || u.firstName || '';

        sendStudentWelcome({
            email,
            firstName,
            lastName:   u.last_name || u.lastName || '',
            password:   plainPwd,
            sourceName: null,
        }).catch(e => console.warn(`[email] student welcome (${email}):`, e.message));

        const parentEmail = u.parent_email || u.parentEmail || null;
        if (parentEmail) {
            sendParentWelcome({
                email:       parentEmail,
                parentName:  u.parent_name || u.parentName || 'Parent/Guardian',
                studentName: `${firstName} ${u.last_name || u.lastName || ''}`.trim(),
                password:    null,
            }).catch(e => console.warn(`[email] parent notify (${parentEmail}):`, e.message));
        }
    }

    return created;
}

// ── POST /api/auth/users/bulk ── Bulk create students from JSON
router.post('/users/bulk', authenticate, requireRole('super_admin', 'psychologist', 'client_admin'), async (req, res) => {
    const { users: userList } = req.body;
    if (!Array.isArray(userList)) return res.status(400).json({ error: 'users must be an array' });

    const callerSourceId = req.user.source_id || req.user.organization_id || req.headers['x-source-id'] || null;

    const created = []; const errors = [];
    for (const u of userList) {
        try {
            if (!u.email || !(u.first_name || u.firstName)) {
                errors.push({ email: u.email || '(missing)', error: 'Missing email or first_name' });
                continue;
            }
            const row = await insertBulkUser(u, callerSourceId);
            if (row) created.push(row);
            else errors.push({ email: u.email, error: 'Email already exists' });
        } catch (err) {
            errors.push({ email: u.email, error: err.message });
        }
    }
    res.json({ created: created.length, errors: errors.length, createdUsers: created, errorList: errors });
});

// ── POST /api/auth/users/bulk-upload ── Bulk create from Excel/CSV file ──
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
    storage: multer.diskStorage({
        destination: uploadDir,
        filename: (req, file, cb) => cb(null, `users_${Date.now()}_${file.originalname}`),
    }),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

router.post('/users/bulk-upload', authenticate, requireRole('super_admin', 'psychologist', 'client_admin'), upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const callerSourceId = req.user.source_id || req.user.organization_id || req.headers['x-source-id'] || null;

    try {
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) return res.status(400).json({ error: 'Excel file is empty' });
        const sheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
        if (rows.length === 0) return res.status(400).json({ error: 'No rows found in the file' });

        const normalize = (obj) => {
            const out = {};
            for (const [k, v] of Object.entries(obj)) {
                const key = String(k).trim().toLowerCase().replace(/\s+/g, '_');
                out[key] = typeof v === 'string' ? v.trim() : v;
            }
            return out;
        };

        const created = []; const errors = [];
        for (let i = 0; i < rows.length; i++) {
            const r = normalize(rows[i]);
            try {
                const userObj = {
                    email:         r.email,
                    first_name:    r.first_name  || r.firstname  || r.name || '',
                    last_name:     r.last_name   || r.lastname   || r.surname || '',
                    password:      r.password    || 'student123',
                    role:          (r.role || 'student').toLowerCase(),
                    grade:         r.grade || r.class || '',
                    section:       r.section || '',
                    gender:        r.gender || null,
                    phone:         r.phone  || r.mobile || null,
                    parent_name:   r.parent_name  || r.parent   || r.guardian || null,
                    parent_phone:  r.parent_phone || r.guardian_phone || null,
                    parent_email:  r.parent_email || r.guardian_email || null,
                    date_of_birth: r.date_of_birth || r.dob || null,
                    age_band:      r.age_band || r.ageband || null,
                };

                if (!userObj.email || !userObj.first_name) {
                    errors.push({ row: i + 2, email: userObj.email || '(missing)', error: 'Missing email or first_name' });
                    continue;
                }

                const inserted = await insertBulkUser(userObj, callerSourceId);
                if (inserted) created.push(inserted);
                else errors.push({ row: i + 2, email: userObj.email, error: 'Email already exists' });
            } catch (err) {
                errors.push({ row: i + 2, email: r.email || '(parse error)', error: err.message });
            }
        }

        try { fs.unlinkSync(req.file.path); } catch (_) {}

        res.json({
            total: rows.length,
            created: created.length,
            errors: errors.length,
            createdUsers: created,
            errorList: errors,
        });
    } catch (err) {
        console.error('Bulk upload error:', err);
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        res.status(500).json({ error: err.message || 'Failed to process file' });
    }
});

module.exports = router;
