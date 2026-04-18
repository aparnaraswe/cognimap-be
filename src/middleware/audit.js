const { pool } = require('../config/database');

// ── Log an audit event ──
async function logAudit({ userId, userRole, userEmail, action, entityType, entityId, details, req }) {
    try {
        await pool.query(`
            INSERT INTO audit_log (user_id, user_role, user_email, action, entity_type, entity_id, details, ip_address, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
            userId || null,
            userRole || null,
            userEmail || null,
            action,
            entityType || null,
            entityId || null,
            JSON.stringify(details || {}),
            req ? (req.ip || req.connection?.remoteAddress) : null,
            req ? req.get('user-agent') : null
        ]);
    } catch (err) {
        // Audit logging should never crash the app
        console.error('Audit log error:', err.message);
    }
}

// ── Express middleware to attach audit helper to request ──
function auditMiddleware(req, res, next) {
    req.audit = (action, entityType, entityId, details) => {
        const user = req.user || {};
        return logAudit({
            userId: user.id,
            userRole: user.role,
            userEmail: user.email,
            action,
            entityType,
            entityId,
            details,
            req
        });
    };
    next();
}

module.exports = { logAudit, auditMiddleware };
