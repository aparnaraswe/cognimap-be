// ══════════════════════════════════════════════════════
// SOURCE SCOPE MIDDLEWARE
// ══════════════════════════════════════════════════════
// Automatically determines which source(s) the current user can access:
//
//   • super_admin → can access all sources, override via ?sourceId= query
//                    sets req.scopedSourceId = null (means "all sources")
//                    or specific id if provided
//
//   • client_admin / psychologist / teacher / student / etc.
//                 → locked to req.user.source_id (or organizationId fallback)
//                   sets req.scopedSourceId = their source id
//                   returns 403 if they have no source
//
// Routes should use req.scopedSourceId in WHERE clauses:
//   if (req.scopedSourceId) query += ` AND source_id = $X`
// ══════════════════════════════════════════════════════

function sourceScope(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    if (req.user.role === 'super_admin') {
        // Super admin can override via query param, or see everything
        req.scopedSourceId = req.query.sourceId || req.headers['x-source-id'] || null;
        req.canCrossSource = true;
        return next();
    }

    // Everyone else is locked to their assigned source
    const ownSource = req.user.source_id || req.user.sourceId || req.user.organizationId || req.user.organization_id;
    if (!ownSource) {
        return res.status(403).json({
            error: 'No source assigned',
            message: 'Your account is not linked to any source. Please contact your administrator.'
        });
    }

    req.scopedSourceId = ownSource;
    req.canCrossSource = false;
    next();
}

// Optional middleware that requires the request to be scoped to ONE source
// (super admin must specify ?sourceId=, others are locked already)
function requireSingleSource(req, res, next) {
    if (!req.scopedSourceId) {
        return res.status(400).json({
            error: 'Source required',
            message: 'You must specify a source. Use ?sourceId=... in the URL.'
        });
    }
    next();
}

module.exports = { sourceScope, requireSingleSource };
