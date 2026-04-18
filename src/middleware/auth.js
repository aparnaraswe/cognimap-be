const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

// ── Generate JWT token ──
function generateToken(user) {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            role: user.role,
            organizationId: user.organization_id,
            source_id: user.source_id || user.organization_id || null,
            batch_id: user.batch_id || null
        },
        JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );
}

// ── Verify JWT and attach user to request ──
function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// ── Token-based auth for students ──
async function authenticateToken(req, res, next) {
    const { token } = req.body;
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        const result = await pool.query(`
            SELECT at.*, u.id as user_id, u.role, u.first_name, u.organization_id
            FROM access_tokens at
            JOIN users u ON at.user_id = u.id
            WHERE at.token = $1
              AND at.expires_at > NOW()
              AND at.is_used = false
        `, [token]);

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid, expired, or already used token' });
        }

        const row = result.rows[0];
        req.user = {
            id: row.user_id,
            role: row.role,
            first_name: row.first_name,
            organizationId: row.organization_id,
            tokenId: row.id,
            sessionId: row.session_id
        };
        req.accessToken = row;
        next();
    } catch (err) {
        return res.status(500).json({ error: 'Token verification failed' });
    }
}

// ── Role-based access: only allow specific roles ──
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({
                error: 'Access denied',
                required: roles,
                current: req.user?.role
            });
        }
        next();
    };
}

// ── Project-scoped access: verify user has access to this project ──
async function requireProjectAccess(req, res, next) {
    const projectId = req.params.projectId || req.body.projectId || req.query.projectId;
    if (!projectId) return next(); // no project context, skip

    const user = req.user;

    // Super admins see everything
    if (user.role === 'super_admin') return next();

    // Client admins see their own org's projects
    if (user.role === 'client_admin') {
        const result = await pool.query(
            `SELECT 1 FROM projects WHERE id = $1 AND organization_id = $2`,
            [projectId, user.organizationId]
        );
        if (result.rows.length === 0) {
            return res.status(403).json({ error: 'Access denied to this project' });
        }
        return next();
    }

    // Psychologists need explicit assignment
    if (user.role === 'psychologist') {
        const result = await pool.query(
            `SELECT 1 FROM project_assignments WHERE user_id = $1 AND project_id = $2`,
            [user.id, projectId]
        );
        if (result.rows.length === 0) {
            return res.status(403).json({ error: 'You are not assigned to this project' });
        }
        return next();
    }

    // Students/employees only access their own sessions
    return next();
}

module.exports = {
    generateToken,
    authenticate,
    authenticateToken,
    requireRole,
    requireProjectAccess,
    JWT_SECRET
};
