// ══════════════════════════════════════════════════════
// SOURCE SCOPE HELPER
// ══════════════════════════════════════════════════════
// Resolves which source(s) the current request can access.
//
//   • super_admin: respects ?sourceId= query, defaults to ALL sources (null)
//                  if omitted; can override via X-Source-Id header
//   • everyone else: locked to their own source_id (or organization_id fallback)
//                    cannot be overridden
//
// Usage in any route:
//   const { resolveSourceScope } = require('../utils/sourceScope');
//   const sourceId = resolveSourceScope(req);
//   if (sourceId) query += ` AND source_id = $X`;
//
// For routes that REQUIRE a single source (uploads, assignments):
//   const sourceId = requireSourceScope(req, res);
//   if (!sourceId) return;  // requireSourceScope already sent the 400/403
// ══════════════════════════════════════════════════════

/**
 * Resolves the active source for the current request.
 * Returns null if super_admin is viewing all sources.
 * Returns a UUID string otherwise.
 */
function resolveSourceScope(req) {
    const user = req.user || {};
    if (user.role === 'super_admin') {
        // Super admin can see everything by default
        const override = req.query.sourceId || req.headers['x-source-id'] || null;
        return override && override !== 'all' ? override : null;
    }
    // Everyone else is locked to their own source
    return user.source_id || user.sourceId || user.organization_id || user.organizationId || null;
}

/**
 * Like resolveSourceScope but enforces that a source MUST be set.
 * Sends a 400/403 response and returns null if not.
 */
function requireSourceScope(req, res) {
    const sid = resolveSourceScope(req);
    if (!sid) {
        if (req.user?.role === 'super_admin') {
            res.status(400).json({ error: 'Source required', message: 'Super admin must specify ?sourceId=... or X-Source-Id header for this action.' });
        } else {
            res.status(403).json({ error: 'No source assigned', message: 'Your account is not linked to any source. Contact an administrator.' });
        }
        return null;
    }
    return sid;
}

/**
 * Returns true if the request can cross source boundaries.
 * Only super_admin can.
 */
function canCrossSource(req) {
    return req.user?.role === 'super_admin';
}

module.exports = { resolveSourceScope, requireSourceScope, canCrossSource };
