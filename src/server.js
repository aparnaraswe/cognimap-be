const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { auditMiddleware } = require('./middleware/audit');
const { sanitizeMiddleware } = require('./middleware/sanitize');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Global Middleware ──
// FIX #6: CORS restricted to configured origin (not wide open)
const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
    : ['http://localhost:5173', 'http://localhost:3000'];
app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (mobile apps, curl, Postman)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
            return callback(null, true);
        }
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
}));
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sanitizeMiddleware); // FIX #11: sanitize all string inputs
app.use(auditMiddleware);

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200,
    message: { error: 'Too many requests, please try again later' }
});
app.use('/api/', limiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Too many login attempts' }
});
app.use('/api/auth/login', authLimiter);

// FIX #7: Rate limit on test responses (max 2 per second per user)
const respondLimiter = rateLimit({
    windowMs: 1000,
    max: 2,
    keyGenerator: (req) => req.user?.id || req.ip,
    message: { error: 'Too many responses, slow down' }
});
app.use('/api/sessions/:id/respond', respondLimiter);

// ── Static Files ──
const fs = require('fs');
const itemImagesDir = path.join(__dirname, '../public/item-images');
if (!fs.existsSync(itemImagesDir)) fs.mkdirSync(itemImagesDir, { recursive: true });
// Shape library — always use backend's own public/custom
const customImagesDir = process.env.CUSTOM_SVG_DIR
  || path.join(__dirname, '../public/custom');
if (!fs.existsSync(customImagesDir)) fs.mkdirSync(customImagesDir, { recursive: true });
app.use(express.static(path.join(__dirname, '../public')));
// Explicit route for item images (extracted from Excel uploads)
app.use('/item-images', express.static(itemImagesDir));
// Explicit route for shape library SVGs — serves from FE public/custom in dev
app.use('/custom', express.static(customImagesDir));

// Serve React frontend in production
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../../frontend/dist')));
}

// ── API Routes ──
app.use('/api/auth', require('./routes/auth'));
app.use('/api/items', require('./routes/items'));
app.use('/api/batteries', require('./routes/batteries'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/config', require('./routes/config'));
app.use('/api/tokens', require('./routes/tokens'));
app.use('/api/guardians', require('./routes/guardians'));
app.use('/api/report-config', require('./routes/reportConfig'));
app.use('/api/grievances', require('./routes/grievance'));
app.use('/api/batches', require('./routes/batches'));
// Legacy: sources route still mounted for backward compatibility, will be removed
app.use('/api/sources', require('./routes/sources'));

// ── Health Check ──
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

// ── API Documentation ──
app.get('/api', (req, res) => {
    res.json({
        name: 'Psychometric Platform API',
        version: '1.0.0',
        endpoints: {
            auth: {
                'POST /api/auth/register': 'Register new user',
                'POST /api/auth/login': 'Login with email/password',
                'POST /api/auth/token-access': 'Access via student token',
                'GET  /api/auth/me': 'Get current user profile',
            },
            items: {
                'GET    /api/items': 'Browse question bank (filterable)',
                'GET    /api/items/:id': 'Get single item',
                'PUT    /api/items/:id': 'Edit item',
                'DELETE /api/items/:id': 'Deactivate item',
                'POST   /api/items/upload': 'Upload Excel/CSV',
                'GET    /api/items/templates/list': 'List all templates',
            },
            batteries: {
                'GET    /api/batteries': 'List all test batteries',
                'GET    /api/batteries/:id': 'Get battery with sections',
                'POST   /api/batteries': 'Create battery with sections',
                'PUT    /api/batteries/:id': 'Update battery',
                'DELETE /api/batteries/:id': 'Deactivate battery',
            },
            sessions: {
                'POST  /api/sessions/assign': 'Assign battery to users',
                'PATCH /api/sessions/:id/toggle': 'Open/close test',
                'POST  /api/sessions/:id/start': 'Start test session',
                'POST  /api/sessions/:id/respond': 'Save response',
                'POST  /api/sessions/:id/complete': 'Complete session',
                'GET   /api/sessions': 'List sessions',
            },
            reports: {
                'POST  /api/reports/generate/:sessionId': 'Generate report',
                'PATCH /api/reports/:id/review': 'Review report',
                'PATCH /api/reports/:id/publish': 'Publish report',
                'GET   /api/reports': 'List reports',
                'GET   /api/reports/share/:token': 'View shared report',
            },
            audit: {
                'GET /api/audit': 'Query audit logs (super admin)',
                'GET /api/audit/summary': 'Audit dashboard stats',
            }
        }
    });
});

// ── 404 Handler ──
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// SPA fallback: serve index.html for all non-API routes in production
if (process.env.NODE_ENV === 'production') {
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
    });
}

// ── Error Handler ──
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ── Auto-migrate: create pending_items table if not exists ──
const { pool: _migPool } = require('./config/database');
_migPool.query(`
  CREATE TABLE IF NOT EXISTS pending_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_code         VARCHAR(100) NOT NULL,
    domain            VARCHAR(20),
    source_file       VARCHAR(255),
    raw_data          JSONB NOT NULL DEFAULT '{}',
    unresolved_tokens JSONB NOT NULL DEFAULT '[]',
    skip_reason       TEXT,
    status            VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (item_code)
  );
  CREATE INDEX IF NOT EXISTS idx_pending_items_status ON pending_items(status);
  CREATE INDEX IF NOT EXISTS idx_pending_items_domain ON pending_items(domain);
`).then(() => console.log('[migration] pending_items table ready'))
  .catch(e => console.warn('[migration] pending_items:', e.message));

// ── Start Server ──
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════╗
║   Psychometric Platform API                  ║
║   Running on http://localhost:${PORT}           ║
║                                              ║
║   API docs: http://localhost:${PORT}/api        ║
║   Health:   http://localhost:${PORT}/api/health ║
╚══════════════════════════════════════════════╝
    `);
});

module.exports = app;
