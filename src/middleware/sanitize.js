// ══════════════════════════════════════════════════════
// INPUT SANITIZATION MIDDLEWARE
// FIX #11: Prevents XSS through user inputs
// ══════════════════════════════════════════════════════

/**
 * Strip HTML tags and dangerous characters from a string value.
 */
function sanitizeString(val) {
    if (typeof val !== 'string') return val;
    return val
        .replace(/<[^>]*>/g, '')         // strip HTML tags
        .replace(/javascript:/gi, '')     // strip javascript: protocol
        .replace(/on\w+=/gi, '')          // strip event handlers like onclick=
        .trim();
}

/**
 * Recursively sanitize all string values in an object.
 * Skips known safe fields (password, content JSONB, svgCode).
 */
function sanitizeObject(obj, skipKeys = new Set(['password', 'password_hash', 'content', 'adaptive_state', 'report_data', 'config', 'details', 'svgCode'])) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(v => sanitizeObject(v, skipKeys));
    const cleaned = {};
    for (const [key, val] of Object.entries(obj)) {
        if (skipKeys.has(key)) {
            cleaned[key] = val; // Don't sanitize passwords, JSONB content, SVG code, etc.
        } else if (typeof val === 'string') {
            cleaned[key] = sanitizeString(val);
        } else if (typeof val === 'object' && val !== null) {
            cleaned[key] = sanitizeObject(val, skipKeys);
        } else {
            cleaned[key] = val;
        }
    }
    return cleaned;
}

/**
 * Express middleware: sanitizes req.body on every request.
 */
function sanitizeMiddleware(req, res, next) {
    if (req.body && typeof req.body === 'object') {
        req.body = sanitizeObject(req.body);
    }
    next();
}

module.exports = { sanitizeMiddleware, sanitizeString, sanitizeObject };
