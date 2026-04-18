const express = require('express');
const { pool } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { resolveSourceScope } = require('../utils/sourceScope');
const cognitiveEngine = require('../engine/cat-engine');
const personalityEngine = require('../engine/personality');
const interestEngine = require('../engine/interest');
const { sendTokenEmail, sendTokenToParentEmail, sendTestAssignedEmail, sendParentTestAssignedEmail } = require('../services/email');
const { LANGUAGES, SUPPORTED_CODES, getAllStrings, translateItem } = require('../config/i18n');

const router = express.Router();

// ── Detect what engine to use based on domain list ──
const COGNITIVE_DOMAINS = new Set(['gf', 'gv', 'gq', 'gc', 'gs', 'gwm']);
const PERSONALITY_DOMAINS = new Set(['personality']);
const INTEREST_DOMAINS = new Set(['interest']);

function detectTestType(domainList) {
    if (domainList.some(d => PERSONALITY_DOMAINS.has(d))) return 'personality';
    if (domainList.some(d => INTEREST_DOMAINS.has(d))) return 'interest';
    return 'cognitive'; // default — adaptive IRT
}

// ══════════════════════════════════════════════
// POST /api/sessions/assign-by-type
// Simplified: just pick a test type, battery is auto-managed
// ══════════════════════════════════════════════
const BATTERY_NAMES = {
    cognitive: 'Cognitive Aptitude Assessment',
    personality: 'Personality Assessment (Big Five)',
    interest: 'Career Interest Assessment (RIASEC)',
};
const DOMAIN_ORDER = ['gf', 'gv', 'gq', 'gc', 'gs', 'gwm', 'personality', 'interest'];
const DOMAIN_LABELS_MAP = { gf: 'Fluid Reasoning', gv: 'Visual Spatial', gq: 'Quantitative Reasoning', gc: 'Verbal Reasoning', gs: 'Processing Speed', gwm: 'Working Memory', personality: 'Personality', interest: 'Career Interest' };
const TYPE_DOMAINS = {
    cognitive: ['gf', 'gv', 'gq', 'gc', 'gs', 'gwm'],
    personality: ['personality'],
    interest: ['interest'],
};

router.post('/assign-by-type', authenticate, requireRole('super_admin', 'psychologist', 'client_admin'), async (req, res) => {
    const { testType, userIds, projectId, opensAt, closesAt, generateTokens, sourceId, batchId } = req.body;
    if (!testType || !userIds || !Array.isArray(userIds) || userIds.length === 0)
        return res.status(400).json({ error: 'testType and userIds[] required' });
    if (!BATTERY_NAMES[testType])
        return res.status(400).json({ error: 'testType must be cognitive, personality, or interest' });

    try {
        // Find or create the battery for this test type
        const batteryName = BATTERY_NAMES[testType];
        let batteryId;

        const existing = await pool.query('SELECT id FROM test_batteries WHERE name = $1 AND is_active = true', [batteryName]);
        if (existing.rows.length) {
            batteryId = existing.rows[0].id;
        } else {
            // Auto-create battery + sections from available items
            const domainFilter = TYPE_DOMAINS[testType];
            const domResult = await pool.query(`
                SELECT DISTINCT domain FROM items WHERE is_active = true AND is_practice = false AND domain = ANY($1)
            `, [domainFilter]);
            if (domResult.rows.length === 0)
                return res.status(400).json({ error: `No ${testType} items uploaded yet. Upload items first.` });

            const br = await pool.query(
                `INSERT INTO test_batteries (name, description, type, audience, is_active, created_by)
                 VALUES ($1, $2, 'preset', 'student', true, $3) RETURNING id`,
                [batteryName, `Auto-created for ${testType} assessment`, req.user.id]
            );
            batteryId = br.rows[0].id;

            const sorted = domResult.rows.map(r => r.domain).sort((a, b) => DOMAIN_ORDER.indexOf(a) - DOMAIN_ORDER.indexOf(b));
            for (let i = 0; i < sorted.length; i++) {
                await pool.query(
                    `INSERT INTO battery_sections (battery_id, name, domain, sort_order) VALUES ($1, $2, $3, $4)`,
                    [batteryId, DOMAIN_LABELS_MAP[sorted[i]] || sorted[i], sorted[i], i + 1]
                );
            }
        }

        // Create sessions for each student
        const sessions = [], tokens = [];
        for (const userId of userIds) {
            // Resolve source: use passed sourceId, else inherit from the user's own source_id
            // Resolve batch: use passed batchId, else inherit from the user's own batch_id
            let resolvedSourceId = sourceId || null;
            let resolvedBatchId = batchId || null;
            if (!resolvedSourceId || !resolvedBatchId) {
                const uR = await pool.query('SELECT source_id, batch_id FROM users WHERE id=$1', [userId]);
                if (!resolvedSourceId) resolvedSourceId = uR.rows[0]?.source_id || null;
                if (!resolvedBatchId) resolvedBatchId = uR.rows[0]?.batch_id || null;
            }
            const sr = await pool.query(`
                INSERT INTO test_sessions (user_id, battery_id, project_id, source_id, batch_id, is_open, opens_at, closes_at)
                VALUES ($1,$2,$3,$4,$5,true,$6,$7) RETURNING *
            `, [userId, batteryId, projectId || null, resolvedSourceId, resolvedBatchId, opensAt || null, closesAt || null]);
            sessions.push(sr.rows[0]);

            // ── Always fetch user info for email notifications ──
            let tokenCode = null;
            try {
                const uInfo = await pool.query(`
                    SELECT u.email, u.first_name, u.last_name, u.parent_email, u.parent_name,
                           u.linked_parent_id,
                           p.email AS linked_parent_email, p.first_name AS linked_parent_name
                    FROM users u
                    LEFT JOIN users p ON p.id = u.linked_parent_id
                    WHERE u.id = $1
                `, [userId]);
                if (uInfo.rows.length) {
                    const u = uInfo.rows[0];

                    if (generateTokens) {
                        const code = genToken();
                        const exp = closesAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                        await pool.query(`INSERT INTO access_tokens (token,user_id,session_id,expires_at,created_by) VALUES ($1,$2,$3,$4,$5)`,
                            [code, userId, sr.rows[0].id, exp, req.user.id]);
                        tokens.push({ userId, sessionId: sr.rows[0].id, token: code });
                        tokenCode = code;
                    }

                    // ── Notify student (always) ──
                    if (u.email) {
                        sendTestAssignedEmail({
                            email: u.email, firstName: u.first_name,
                            testType, token: tokenCode,
                            expiresAt: tokenCode ? (closesAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)) : null,
                            opensAt, closesAt,
                        }).catch(e => console.warn(`[email] assign→student (${u.email}):`, e.message));
                    }

                    // ── Notify parent (parent_email column OR auto-linked guardian account) ──
                    const parentTo   = u.parent_email || u.linked_parent_email || null;
                    const parentName = u.parent_name  || u.linked_parent_name  || null;
                    if (parentTo) {
                        sendParentTestAssignedEmail({
                            parentEmail: parentTo,
                            parentName,
                            studentName: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email,
                            testType,
                            opensAt, closesAt,
                        }).catch(e => console.warn(`[email] assign→parent (${parentTo}):`, e.message));
                    }
                }
            } catch (emailErr) {
                console.warn('[email] assign notification failed:', emailErr.message);
            }
        }
        await req.audit('session.assigned', 'test_session', null, {
            description: `Assigned ${testType} test to ${userIds.length} users`, testType, batteryId, sourceId, batchId
        });
        res.status(201).json({ sessions, tokens, batteryId, testType });
    } catch (err) { console.error('Assign-by-type error:', err); res.status(500).json({ error: 'Failed to assign' }); }
});

// ══════════════════════════════════════════════
// POST /api/sessions/assign-by-email
// Assign a test to one or more students by email address.
// Body: { testType, emails: ["a@x.com","b@y.com"], generateTokens, opensAt, closesAt }
// Returns: { assigned: [...], notFound: [...], blocked: [...] }
//   - assigned: { email, userId, sessionId, sourceName, token? }
//   - notFound: emails that don't match any user
//   - blocked:  emails that belong to a different source than the caller (non-super-admin)
// ══════════════════════════════════════════════
router.post('/assign-by-email', authenticate, requireRole('super_admin', 'psychologist', 'client_admin'), async (req, res) => {
    const { testType, emails, opensAt, closesAt, generateTokens } = req.body;
    if (!testType || !Array.isArray(emails) || emails.length === 0)
        return res.status(400).json({ error: 'testType and emails[] required' });
    if (!BATTERY_NAMES[testType])
        return res.status(400).json({ error: 'testType must be cognitive, personality, or interest' });

    const isSuperAdmin = req.user.role === 'super_admin';
    const callerSourceId = req.user.organization_id || req.user.organizationId || null;

    try {
        // Find or create the battery for this test type (same logic as assign-by-type)
        const batteryName = BATTERY_NAMES[testType];
        let batteryId;
        const existing = await pool.query('SELECT id FROM test_batteries WHERE name = $1 AND is_active = true', [batteryName]);
        if (existing.rows.length) {
            batteryId = existing.rows[0].id;
        } else {
            const domainFilter = TYPE_DOMAINS[testType];
            const domResult = await pool.query(`
                SELECT DISTINCT domain FROM items WHERE is_active = true AND is_practice = false AND domain = ANY($1)
            `, [domainFilter]);
            if (domResult.rows.length === 0)
                return res.status(400).json({ error: `No ${testType} items uploaded yet. Upload items first.` });
            const br = await pool.query(
                `INSERT INTO test_batteries (name, description, type, audience, is_active, created_by)
                 VALUES ($1, $2, 'preset', 'student', true, $3) RETURNING id`,
                [batteryName, `Auto-created for ${testType} assessment`, req.user.id]
            );
            batteryId = br.rows[0].id;
            const sorted = domResult.rows.map(r => r.domain).sort((a, b) => DOMAIN_ORDER.indexOf(a) - DOMAIN_ORDER.indexOf(b));
            for (let i = 0; i < sorted.length; i++) {
                await pool.query(
                    `INSERT INTO battery_sections (battery_id, name, domain, sort_order) VALUES ($1, $2, $3, $4)`,
                    [batteryId, DOMAIN_LABELS_MAP[sorted[i]] || sorted[i], sorted[i], i + 1]
                );
            }
        }

        // Resolve emails → users
        const cleanedEmails = emails.map(e => String(e).trim().toLowerCase()).filter(Boolean);
        const userR = await pool.query(`
            SELECT u.id, u.email, u.first_name, u.last_name,
                   u.source_id, u.batch_id, u.parent_email, u.parent_name,
                   u.linked_parent_id,
                   p.email AS linked_parent_email, p.first_name AS linked_parent_name,
                   s.display_name AS source_name
            FROM users u
            LEFT JOIN users p ON p.id = u.linked_parent_id
            LEFT JOIN sources s ON u.source_id = s.id
            WHERE LOWER(u.email) = ANY($1::text[])
        `, [cleanedEmails]);
        const usersByEmail = new Map(userR.rows.map(u => [u.email.toLowerCase(), u]));

        const assigned = [];
        const notFound = [];
        const blocked = [];

        for (const email of cleanedEmails) {
            const u = usersByEmail.get(email);
            if (!u) { notFound.push(email); continue; }

            // Source isolation: non-super-admin cannot assign across sources
            if (!isSuperAdmin && callerSourceId && u.source_id && u.source_id !== callerSourceId) {
                blocked.push({ email, reason: 'Belongs to a different source' });
                continue;
            }

            const sr = await pool.query(`
                INSERT INTO test_sessions (user_id, battery_id, source_id, batch_id, is_open, opens_at, closes_at)
                VALUES ($1,$2,$3,$4,true,$5,$6) RETURNING *
            `, [u.id, batteryId, u.source_id, u.batch_id, opensAt || null, closesAt || null]);

            const entry = { email, userId: u.id, sessionId: sr.rows[0].id, name: `${u.first_name || ''} ${u.last_name || ''}`.trim(), sourceName: u.source_name };

            let tokenCode = null;
            if (generateTokens) {
                const code = genToken();
                const exp = closesAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                await pool.query(`INSERT INTO access_tokens (token,user_id,session_id,expires_at,created_by) VALUES ($1,$2,$3,$4,$5)`,
                    [code, u.id, sr.rows[0].id, exp, req.user.id]);
                entry.token = code;
                tokenCode = code;
            }

            // ── Always notify student ──
            if (u.email) {
                sendTestAssignedEmail({
                    email: u.email,
                    firstName: u.first_name,
                    testType,
                    token: tokenCode,
                    opensAt: opensAt || null,
                    closesAt: closesAt || null,
                }).catch(e => console.warn(`[email] assigned→student (${u.email}):`, e.message));
            }

            // ── Notify parent (parent_email column OR auto-linked guardian account) ──
            const parentTo   = u.parent_email || u.linked_parent_email || null;
            const parentName = u.parent_name  || u.linked_parent_name  || null;
            if (parentTo) {
                sendParentTestAssignedEmail({
                    parentEmail: parentTo,
                    parentName,
                    studentName: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email,
                    testType,
                    opensAt: opensAt || null,
                    closesAt: closesAt || null,
                }).catch(e => console.warn(`[email] assigned→parent (${parentTo}):`, e.message));
            }

            assigned.push(entry);
        }

        await req.audit('session.assigned_by_email', 'test_session', null, {
            description: `Assigned ${testType} test to ${assigned.length} users by email (${notFound.length} not found, ${blocked.length} blocked)`,
            testType, batteryId, count: assigned.length
        });

        res.status(201).json({ assigned, notFound, blocked, batteryId, testType });
    } catch (err) {
        console.error('Assign-by-email error:', err);
        res.status(500).json({ error: 'Failed to assign by email' });
    }
});

// ══════════════════════════════════════════════
// POST /api/sessions/assign (legacy — kept for compatibility)
// ══════════════════════════════════════════════
router.post('/assign', authenticate, requireRole('super_admin', 'psychologist', 'client_admin'), async (req, res) => {
    const { batteryId, userIds, projectId, opensAt, closesAt, generateTokens } = req.body;
    if (!batteryId || !userIds || !Array.isArray(userIds))
        return res.status(400).json({ error: 'batteryId and userIds[] required' });
    try {
        const sessions = [], tokens = [];
        for (const userId of userIds) {
            const sr = await pool.query(`
                INSERT INTO test_sessions (user_id, battery_id, project_id, is_open, opens_at, closes_at)
                VALUES ($1,$2,$3,true,$4,$5) RETURNING *
            `, [userId, batteryId, projectId || null, opensAt || null, closesAt || null]);
            sessions.push(sr.rows[0]);
            if (generateTokens) {
                const code = genToken();
                const exp = closesAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                await pool.query(`INSERT INTO access_tokens (token,user_id,session_id,expires_at,created_by) VALUES ($1,$2,$3,$4,$5)`,
                    [code, userId, sr.rows[0].id, exp, req.user.id]);
                tokens.push({ userId, sessionId: sr.rows[0].id, token: code });
            }
        }
        await req.audit('session.assigned', 'test_session', null, {
            description: `Assigned battery to ${userIds.length} users`, batteryId
        });
        res.status(201).json({ sessions, tokens });
    } catch (err) { console.error('Assign error:', err); res.status(500).json({ error: 'Failed to assign' }); }
});

// ══════════════════════════════════════════════
// POST /api/sessions/:id/start
// Detects test type → initializes correct engine
// ══════════════════════════════════════════════
router.post('/:id/start', authenticate, async (req, res) => {
    try {
        const sr = await pool.query(
            'SELECT * FROM test_sessions WHERE id=$1 AND user_id=$2 AND is_open=true', [req.params.id, req.user.id]);
        if (!sr.rows.length) return res.status(404).json({ error: 'Session not found or not open' });
        const session = sr.rows[0];
        if (session.status === 'completed') return res.status(400).json({ error: 'Already completed' });

        const ur = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
        const user = ur.rows[0];

        // ── Load per-source question limits (saved in sources.metadata.questionsPerDomain) ──
        // Format: { cognitive: { gf: 10, gv: 8, ... }, personality: { openness: 6, ... }, interest: { realistic: 5, ... } }
        let sourceLimits = {};
        const sourceId = session.source_id || user.source_id || user.organization_id;
        if (sourceId) {
            const srcR = await pool.query('SELECT metadata FROM sources WHERE id = $1', [sourceId]);
            sourceLimits = srcR.rows[0]?.metadata?.questionsPerDomain || {};
        }
        // Backward-compat with old global setting
        const ipsR = await pool.query(
            `SELECT setting_value FROM platform_settings WHERE setting_key = 'items_per_section'`
        );
        const adminMaxItems = ipsR.rows[0]?.setting_value?.value ?? cognitiveEngine.MAX_ITEMS_PER_DOMAIN;
        cognitiveEngine.setMaxItemsPerDomain(adminMaxItems);

        const secR = await pool.query(
            'SELECT domain, config FROM battery_sections WHERE battery_id=$1 ORDER BY sort_order', [session.battery_id]);
        let domainList = secR.rows.map(r => r.domain);

        // Compute battery info for the welcome screen
        const batteryR = await pool.query('SELECT config FROM test_batteries WHERE id=$1', [session.battery_id]);
        const batteryConfig = batteryR.rows[0]?.config || {};
        let estimatedMinutes = 0;
        let totalItems = 0;
        const sectionInfo = {};
        for (const s of secR.rows) {
            const sc = s.config || {};
            const secTime = sc.timeLimitTotal ? Math.ceil(sc.timeLimitTotal / 60) : 7;
            // Per-source override takes priority, then battery section config, then default
            const sourceCap = sourceLimits.cognitive?.[s.domain] || sourceLimits.personality?.[s.domain] || sourceLimits.interest?.[s.domain];
            const secItems = sourceCap || sc.count || cognitiveEngine.MAX_ITEMS_PER_DOMAIN;
            estimatedMinutes += secTime;
            totalItems += secItems;
            sectionInfo[s.domain] = { estimatedMinutes: secTime, itemCount: secItems };
        }

        // Count practice items per domain
        if (domainList.length > 0) {
            const pracR = await pool.query(
                `SELECT domain, COUNT(*)::int as practice_count FROM items
                 WHERE domain = ANY($1) AND is_practice = true AND is_active = true
                 GROUP BY domain`,
                [domainList]
            );
            for (const row of pracR.rows) {
                if (sectionInfo[row.domain]) sectionInfo[row.domain].practiceCount = row.practice_count;
            }
        }

        // If battery has no sections, try to auto-repair by adding cognitive domains
        if (!domainList.length) {
            console.log(`Battery ${session.battery_id} has no sections — attempting auto-repair`);
            const activeDomains = await pool.query(`
                SELECT DISTINCT domain FROM items WHERE is_active = true AND is_practice = false
                  AND domain IN ('gf','gv','gq','gc','gs','gwm') ORDER BY domain
            `);
            const DOMAIN_ORDER = ['gf', 'gv', 'gq', 'gc', 'gs', 'gwm'];
            const DOMAIN_LABELS = { gf: 'Fluid Reasoning', gv: 'Visual Spatial', gq: 'Quantitative Reasoning', gc: 'Verbal Reasoning', gs: 'Processing Speed', gwm: 'Working Memory' };
            const sorted = activeDomains.rows.map(r => r.domain).sort((a, b) => DOMAIN_ORDER.indexOf(a) - DOMAIN_ORDER.indexOf(b));
            if (sorted.length > 0) {
                for (let i = 0; i < sorted.length; i++) {
                    await pool.query(
                        `INSERT INTO battery_sections (battery_id, name, domain, sort_order) VALUES ($1, $2, $3, $4)`,
                        [session.battery_id, DOMAIN_LABELS[sorted[i]] || sorted[i], sorted[i], i + 1]
                    );
                }
                domainList = sorted;
                console.log(`Auto-repaired battery ${session.battery_id} with ${sorted.length} sections`);
            } else {
                return res.status(400).json({ error: 'No test items uploaded yet. Please contact your teacher.' });
            }
        }

        const testType = detectTestType(domainList);

        let state;
        if (session.status === 'assigned') {
            // Initialize state based on test type, passing source-specific limits
            if (testType === 'personality') {
                state = personalityEngine.initializeState(undefined, sourceLimits.personality || {});
            } else if (testType === 'interest') {
                state = interestEngine.initializeState(undefined, sourceLimits.interest || {});
            } else {
                const ageBand = cognitiveEngine.getAgeBand(user);
                const cognitiveDomains = domainList.filter(d => COGNITIVE_DOMAINS.has(d));
                state = cognitiveEngine.initializeState(ageBand, cognitiveDomains, sourceLimits.cognitive || {});
            }
            await pool.query(`
                UPDATE test_sessions SET status='in_progress', started_at=NOW(),
                    user_agent=$2, ip_address=$3, adaptive_state=$4 WHERE id=$1
            `, [session.id, req.get('user-agent'), req.ip, JSON.stringify(state)]);
        } else {
            state = session.adaptive_state;
            if (!state) {
                return res.status(400).json({ error: 'Session state corrupted' });
            }
        }

        // Pick first item based on test type
        const result = await pickNextForType(state, testType);
        if (!result) {
            // NO items found at all — don't complete the session, return error
            // Reset to assigned so student can retry after admin uploads items
            if (session.status === 'assigned' || (state.servedItemIds && state.servedItemIds.length === 0)) {
                await pool.query(
                    'UPDATE test_sessions SET status=$2, adaptive_state=NULL WHERE id=$1',
                    [session.id, 'assigned']
                );
                return res.status(400).json({
                    error: 'No test items available for your age group. Please contact your teacher.',
                    code: 'NO_ITEMS'
                });
            }
            // If some items were already served, then it's a genuine completion
            await completeSession(session.id, state, testType);
            return res.json({ complete: true, testType });
        }

        state.servedItemIds.push(result.item.id || result.item._dbItemId);
        await pool.query('UPDATE test_sessions SET adaptive_state=$2 WHERE id=$1', [session.id, JSON.stringify(state)]);

        await req.audit('session.started', 'test_session', session.id, { testType });

        // ── Apply language translation to the item ──
        const sessionLang = session.language || user.preferred_language || 'en';
        const translatedItem = translateItem(result.item, sessionLang);

        res.json({
            sessionId: session.id,
            testType,
            language: sessionLang,
            item: formatForType(translatedItem, state, testType),
            progress: buildProgressForType(state, testType),
            complete: false,
            batteryInfo: {
                estimatedMinutes,
                sectionCount: domainList.length,
                totalItems,
                hasPracticeItems: true,
                hasBreaks: domainList.length > 1,
                sectionInfo,
            },
        });
    } catch (err) { console.error('Start error:', err); res.status(500).json({ error: 'Failed to start session' }); }
});

// ══════════════════════════════════════════════
// POST /api/sessions/:id/respond
// Routes response to correct engine for scoring
// ══════════════════════════════════════════════
router.post('/:id/respond', authenticate, async (req, res) => {
    const { itemId, selectedIndex, selectedValue, likertValue, reactionTimeMs, timedOut } = req.body;
    if (!itemId) return res.status(400).json({ error: 'itemId required' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const sr = await client.query(
            'SELECT * FROM test_sessions WHERE id=$1 AND user_id=$2 AND status=$3 FOR UPDATE',
            [req.params.id, req.user.id, 'in_progress']);
        if (!sr.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Active session not found' }); }
        const session = sr.rows[0];
        let state = session.adaptive_state;
        if (!state) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'No adaptive state' }); }

        const testType = state.type || 'cognitive';

        // Apply admin-configured items-per-section for this response cycle
        const ipsR2 = await client.query(
            `SELECT setting_value FROM platform_settings WHERE setting_key = 'items_per_section'`
        );
        const adminMaxItems2 = ipsR2.rows[0]?.setting_value?.value ?? cognitiveEngine.MAX_ITEMS_PER_DOMAIN;
        cognitiveEngine.setMaxItemsPerDomain(adminMaxItems2);

        const ir = await client.query('SELECT * FROM items WHERE id=$1', [itemId]);
        if (!ir.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Item not found' }); }
        const dbItem = ir.rows[0];
        const itemContent = dbItem.content || {};

        let serverCorrect = null;

        if (testType === 'personality') {
            // Personality: no correct answer, just Likert rating
            const lv = likertValue || selectedIndex || 3;
            const trait = itemContent.trait || itemContent.subdomain || 'openness';
            personalityEngine.processResponse(state, trait, lv, itemContent.isReversed || false);
            // Check if this trait section is done (per-trait cap, falls back to global)
            const ts = state.traits[trait];
            const traitCap = ts?.maxItems || state.maxItemsPerTrait;
            if (ts && ts.itemCount >= traitCap) {
                personalityEngine.markTraitDone(state, trait);
                state.currentTraitIndex++;
            }
            // Save response
            await client.query(`
                INSERT INTO responses (session_id,item_id,selected_index,selected_value,is_correct,reaction_time_ms,timed_out)
                VALUES ($1,$2,$3,$4,$5,$6,$7)
            `, [session.id, itemId, lv, JSON.stringify({ likertValue: lv }), null, reactionTimeMs || 0, false]);

        } else if (testType === 'interest') {
            // Interest: Likert rating for activity preference
            const lv = likertValue || selectedIndex || 3;
            const dim = itemContent.dimension || itemContent.subdomain || 'realistic';
            interestEngine.processResponse(state, dim, lv);
            const ds = state.dimensions[dim];
            const dimCap = ds?.maxItems || state.maxItemsPerDim;
            if (ds && ds.itemCount >= dimCap) {
                interestEngine.markDimDone(state, dim);
                state.currentDimIndex++;
            }
            await client.query(`
                INSERT INTO responses (session_id,item_id,selected_index,selected_value,is_correct,reaction_time_ms,timed_out)
                VALUES ($1,$2,$3,$4,$5,$6,$7)
            `, [session.id, itemId, lv, JSON.stringify({ likertValue: lv }), null, reactionTimeMs || 0, false]);

        } else {
            // Cognitive: has correct answer — server verifies
            // Resolve correct index: prefer correctAns letter (most reliable),
            // then fall back to stored correctIndex
            let resolvedCorrectIdx = itemContent.correctIndex ?? 0;
            if (itemContent.correctAns) {
                const letter = String(itemContent.correctAns).trim().toUpperCase();
                const letterMap = { A: 0, B: 1, C: 2, D: 3 };
                if (letterMap[letter] !== undefined) resolvedCorrectIdx = letterMap[letter];
            }
            serverCorrect = timedOut ? false : (selectedIndex === resolvedCorrectIdx);

            // ═══ IRT-CAT: pass item IRT parameters to the engine ═══
            const itemIrtParams = {
                a: dbItem.irt_a || 1.0,
                b: dbItem.irt_b || 0.0,
                c: dbItem.irt_c || 0.33,
            };
            cognitiveEngine.processResponse(
                state, dbItem.domain, itemIrtParams, serverCorrect,
                dbItem.item_code, reactionTimeMs || 0
            );

            await client.query(`
                INSERT INTO responses (session_id,item_id,selected_index,selected_value,is_correct,reaction_time_ms,timed_out)
                VALUES ($1,$2,$3,$4,$5,$6,$7)
            `, [session.id, itemId, timedOut ? null : selectedIndex,
                selectedValue ? JSON.stringify(selectedValue) : null,
                serverCorrect, reactionTimeMs || 0, timedOut || false]);
        }

        // Check completion
        const isComplete = testType === 'personality' ? personalityEngine.isComplete(state)
                         : testType === 'interest' ? interestEngine.isComplete(state)
                         : cognitiveEngine.isSessionComplete(state);

        if (isComplete) {
            await client.query('UPDATE test_sessions SET adaptive_state=$2, status=$3, completed_at=NOW() WHERE id=$1',
                [session.id, JSON.stringify(state), 'completed']);
            await client.query('COMMIT');

            // Auto-generate report on completion
            try { await autoGenerateReport(session.id, state, testType); } catch (e) { console.error('Auto-report error:', e); }

            return res.json({ complete: true, testType, serverCorrect });
        }

        // Pick next item
        const result = await pickNextForType(state, testType);
        if (!result) {
            await client.query('UPDATE test_sessions SET adaptive_state=$2, status=$3, completed_at=NOW() WHERE id=$1',
                [session.id, JSON.stringify(state), 'completed']);
            await client.query('COMMIT');
            try { await autoGenerateReport(session.id, state, testType); } catch (e) { console.error('Auto-report error:', e); }
            return res.json({ complete: true, testType, serverCorrect });
        }

        state.servedItemIds.push(result.item.id || result.item._dbItemId);
        await client.query('UPDATE test_sessions SET adaptive_state=$2, current_item=current_item+1 WHERE id=$1',
            [session.id, JSON.stringify(state)]);
        await client.query('COMMIT');

        // ── Apply language translation ──
        const respondLang = session.language || 'en';
        const respondTranslatedItem = translateItem(result.item, respondLang);

        res.json({
            item: formatForType(respondTranslatedItem, state, testType),
            progress: buildProgressForType(state, testType),
            complete: false,
            testType,
            language: respondLang,
            serverCorrect,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Respond error:', err);
        res.status(500).json({ error: 'Failed to process response' });
    } finally {
        client.release();
    }
});

// ══════════════════════════════════════════════
// HELPERS — Item picking per type
// ══════════════════════════════════════════════
// ── Complete a session (mark completed + save state) ──
async function completeSession(sessionId, state, testType) {
    await pool.query(
        'UPDATE test_sessions SET adaptive_state=$2, status=$3, completed_at=NOW() WHERE id=$1',
        [sessionId, JSON.stringify(state), 'completed']
    );
    // Auto-generate report
    try { await autoGenerateReport(sessionId, state, testType); } catch (e) { console.error('Auto-report error:', e); }
}

async function pickNextForType(state, testType) {
    if (testType === 'personality') {
        const trait = personalityEngine.getCurrentTrait(state);
        if (!trait) return null;
        const items = await pool.query(`
            SELECT * FROM items WHERE domain='personality' AND is_active=true
              AND content->>'trait' = $1 AND id != ALL($2)
            ORDER BY RANDOM() LIMIT 1
        `, [trait, state.servedItemIds || []]);
        if (!items.rows.length) { personalityEngine.markTraitDone(state, trait); return pickNextForType(state, testType); }
        return { item: items.rows[0] };
    }
    if (testType === 'interest') {
        const dim = interestEngine.getCurrentDimension(state);
        if (!dim) return null;
        const items = await pool.query(`
            SELECT * FROM items WHERE domain='interest' AND is_active=true
              AND content->>'dimension' = $1 AND id != ALL($2)
            ORDER BY RANDOM() LIMIT 1
        `, [dim, state.servedItemIds || []]);
        if (!items.rows.length) { interestEngine.markDimDone(state, dim); return pickNextForType(state, testType); }
        return { item: items.rows[0] };
    }
    // Cognitive — use adaptive engine
    return cognitiveEngine.pickNextItem(state);
}

function formatForType(dbItem, state, testType) {
    if (testType === 'personality') return personalityEngine.formatItemForClient(dbItem);
    if (testType === 'interest') return interestEngine.formatItemForClient(dbItem);
    const domainOrder = state.domainOrder || Object.keys(state.domains);
    const currentDomain = domainOrder[state.currentDomainIndex];
    const ds = state.domains[currentDomain];
    return cognitiveEngine.formatItemForClient(dbItem, ds);
}

function buildProgressForType(state, testType) {
    if (testType === 'personality') {
        const traits = Object.keys(state.traits);
        const done = traits.filter(t => state.traits[t].completed).length;
        const current = personalityEngine.getCurrentTrait(state) || traits[traits.length - 1];
        const ts = state.traits[current] || {};
        return {
            testType, section: current, sectionLabel: personalityEngine.BIG_FIVE_TRAITS[current]?.label || current,
            itemNumber: ts.itemCount + 1, maxItems: state.maxItemsPerTrait,
            sectionsTotal: traits.length, sectionsCompleted: done,
        };
    }
    if (testType === 'interest') {
        const dims = Object.keys(state.dimensions);
        const done = dims.filter(d => state.dimensions[d].completed).length;
        const current = interestEngine.getCurrentDimension(state) || dims[dims.length - 1];
        const ds = state.dimensions[current] || {};
        return {
            testType, section: current, sectionLabel: interestEngine.RIASEC_DIMENSIONS[current]?.label || current,
            itemNumber: ds.itemCount + 1, maxItems: state.maxItemsPerDim,
            sectionsTotal: dims.length, sectionsCompleted: done,
        };
    }
    // Cognitive (IRT-CAT)
    const domainOrder = state.domainOrder || Object.keys(state.domains);
    const currentDomain = domainOrder[state.currentDomainIndex];
    const ds = state.domains[currentDomain] || {};
    const labels = { gf: 'Pattern Reasoning', gv: 'Visual Spatial', gq: 'Quantitative Reasoning', gc: 'Verbal Reasoning', gs: 'Processing Speed', gwm: 'Working Memory' };
    return {
        testType: 'cognitive', domain: currentDomain, domainLabel: labels[currentDomain] || currentDomain,
        itemNumber: (ds.itemsServed || 0) + 1, maxItems: ds.maxItems || cognitiveEngine.MAX_ITEMS_PER_DOMAIN,
        theta: Math.round((ds.theta || 0) * 100) / 100,
        sem: Math.round((ds.sem || 1.0) * 1000) / 1000,
        domainsTotal: domainOrder.length,
        domainsCompleted: Object.values(state.domains).filter(d => d.completed).length,
    };
}

// ── Auto-generate report when session completes ──
async function autoGenerateReport(sessionId, state, testType) {
    const sess = await pool.query(`
        SELECT ts.*, u.first_name, u.last_name, u.age_band, u.grade, u.section, u.date_of_birth,
               u.batch_id as user_batch_id,
               tb.name as battery_name
        FROM test_sessions ts JOIN users u ON ts.user_id = u.id
        JOIN test_batteries tb ON ts.battery_id = tb.id
        WHERE ts.id = $1
    `, [sessionId]);
    if (!sess.rows.length) return;
    const s = sess.rows[0];

    // Check if report already exists
    const existing = await pool.query('SELECT id FROM reports WHERE session_id=$1', [sessionId]);
    if (existing.rows.length) return;

    const { generateAptitudeReport, generatePersonalityReport, generateInterestReport } = require('../engine/reportGenerator');
    let reportType, reportData;

    if (testType === 'personality') {
        reportType = 'personality';
        reportData = generatePersonalityReport(personalityEngine.computeResults(state), s);
    } else if (testType === 'interest') {
        reportType = 'interest';
        reportData = generateInterestReport(interestEngine.computeResults(state), s);
    } else {
        reportType = 'aptitude';
        reportData = generateAptitudeReport(state, s);
    }

    if (reportData) {
        reportData.batteryName = s.battery_name;
        reportData.sessionId = sessionId;
        // Copy batch_id from the session (falling back to user's batch_id) onto the report
        const resolvedBatchId = s.batch_id || s.user_batch_id || null;
        await pool.query(`
            INSERT INTO reports (session_id, user_id, project_id, source_id, batch_id, report_type, report_data, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
        `, [sessionId, s.user_id, s.project_id, s.source_id || null, resolvedBatchId, reportType, JSON.stringify(reportData)]);
    }
}

// ═══════════════════════════════════════
// PATCH /api/sessions/:id/toggle
// ═══════════════════════════════════════
router.patch('/:id/toggle', authenticate, requireRole('super_admin', 'psychologist', 'client_admin'), async (req, res) => {
    try {
        const r = await pool.query('UPDATE test_sessions SET is_open=$2 WHERE id=$1 RETURNING *', [req.params.id, req.body.isOpen]);
        if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
        await req.audit(req.body.isOpen ? 'session.opened' : 'session.closed', 'test_session', req.params.id, {});
        res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══════════════════════════════════════
// GET /api/sessions
// ═══════════════════════════════════════
router.get('/', authenticate, async (req, res) => {
    const { projectId, status, userId, mine, batchId, page = 1, limit = 50, sortBy = 'created_at', sortDir = 'desc' } = req.query;
    const user = req.user;
    let w = ' WHERE 1=1', p = [], pi = 0;
    if (mine === 'true' || user.role === 'student' || user.role === 'employee') { p.push(user.id); w += ` AND ts.user_id=$${++pi}`; }
    if (projectId) { p.push(projectId); w += ` AND ts.project_id=$${++pi}`; }
    if (status) { p.push(status); w += ` AND ts.status=$${++pi}`; }
    if (userId && user.role !== 'student') { p.push(userId); w += ` AND ts.user_id=$${++pi}`; }
    // ── Source scope — enforced for non-super-admin, optional for super admin ──
    const scopedSourceId = resolveSourceScope(req);
    if (scopedSourceId) {
        p.push(scopedSourceId);
        w += ` AND (ts.source_id = $${++pi} OR u.source_id = $${pi})`;
    }
    // ── Batch filter ── prefers session-level batch_id, falls back to user's batch_id
    if (batchId) { p.push(batchId); w += ` AND (ts.batch_id=$${++pi} OR u.batch_id=$${pi})`; }
    const base = `FROM test_sessions ts JOIN users u ON ts.user_id=u.id LEFT JOIN test_batteries tb ON ts.battery_id=tb.id LEFT JOIN sources src ON u.source_id=src.id LEFT JOIN batches b ON COALESCE(ts.batch_id, u.batch_id)=b.id ${w}`;
    try {
        const cr = await pool.query(`SELECT COUNT(*) ${base}`, p);
        const total = parseInt(cr.rows[0].count);
        const s = ['created_at', 'status', 'started_at'].includes(sortBy) ? `ts.${sortBy}` : 'ts.created_at';
        const off = (parseInt(page) - 1) * parseInt(limit);
        p.push(parseInt(limit), off);
        const r = await pool.query(`
            SELECT ts.*, u.first_name||' '||COALESCE(u.last_name,'') as user_name,
                   u.email as user_email, u.grade, u.section,
                   u.source_id, src.display_name as source_name, src.source_code,
                   COALESCE(ts.batch_id, u.batch_id) as effective_batch_id,
                   b.name as batch_name,
                   tb.name as battery_name, tb.config as battery_config
            ${base} ORDER BY ${s} ${sortDir === 'asc' ? 'ASC' : 'DESC'} LIMIT $${++pi} OFFSET $${++pi}`, p);

        // Compute battery_info for each session
        const batteryIds = [...new Set(r.rows.map(s => s.battery_id).filter(Boolean))];
        const sectionsByBattery = {};
        if (batteryIds.length > 0) {
            const secR = await pool.query(
                `SELECT battery_id, domain, config FROM battery_sections WHERE battery_id = ANY($1) ORDER BY sort_order`,
                [batteryIds]
            );
            for (const sec of secR.rows) {
                if (!sectionsByBattery[sec.battery_id]) sectionsByBattery[sec.battery_id] = [];
                sectionsByBattery[sec.battery_id].push(sec);
            }
        }

        const sessions = r.rows.map(session => {
            const sections = sectionsByBattery[session.battery_id] || [];
            const batteryConfig = session.battery_config || {};
            let estimatedMinutes = 0;
            let totalItems = 0;
            for (const sec of sections) {
                const sc = sec.config || {};
                if (sc.timeLimitTotal) estimatedMinutes += Math.ceil(sc.timeLimitTotal / 60);
                if (sc.count) totalItems += sc.count;
            }
            const sectionCount = sections.length;
            if (!estimatedMinutes && sectionCount > 0) estimatedMinutes = sectionCount * 7;

            // Compute progress from adaptive_state
            const as = session.adaptive_state || {};
            let answeredCount = 0;
            if (as.servedItemIds) answeredCount = as.servedItemIds.length;

            // Compute totalItems from adaptive state if not from section config
            if (!totalItems && as.domains) {
                const domainKeys = Object.keys(as.domains);
                totalItems = domainKeys.length * (cognitiveEngine?.MAX_ITEMS_PER_DOMAIN || 12);
            }
            if (!totalItems && as.traits) {
                totalItems = Object.keys(as.traits).length * (as.maxItemsPerTrait || 8);
            }
            if (!totalItems && as.dimensions) {
                totalItems = Object.keys(as.dimensions).length * (as.maxItemsPerDim || 6);
            }

            session.battery_info = {
                estimatedMinutes: estimatedMinutes || null,
                sectionCount: sectionCount || null,
                hasPracticeItems: true,
                hasBreaks: sectionCount > 1,
                totalItems: totalItems || null,
                answeredCount,
            };
            delete session.battery_config;
            return session;
        });

        res.json({ sessions, total });
    } catch (err) { console.error('List error:', err); res.status(500).json({ error: 'Failed' }); }
});

// ═══════════════════════════════════════
// GET /api/sessions/:id/scores
// ═══════════════════════════════════════
router.get('/:id/scores', authenticate, async (req, res) => {
    try {
        const sc = await pool.query('SELECT * FROM session_scores WHERE session_id=$1 ORDER BY domain', [req.params.id]);
        const ss = await pool.query('SELECT adaptive_state FROM test_sessions WHERE id=$1', [req.params.id]);
        res.json({ scores: sc.rows, adaptiveState: ss.rows[0]?.adaptive_state || null });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

function genToken() {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let t = '';
    for (let i = 0; i < 8; i++) t += c[Math.floor(Math.random() * c.length)]; return t;
}

// ══════════════════════════════════════════════════════════════
// GET /api/sessions/languages
// Returns the list of supported languages for the language picker
// ══════════════════════════════════════════════════════════════
router.get('/languages', async (req, res) => {
    res.json({ languages: LANGUAGES });
});

// ══════════════════════════════════════════════════════════════
// GET /api/sessions/i18n/:lang
// Returns all UI strings for a given language code
// Used by the frontend to render instructions, buttons, labels
// ══════════════════════════════════════════════════════════════
router.get('/i18n/:lang', async (req, res) => {
    const lang = req.params.lang;
    if (!SUPPORTED_CODES.includes(lang)) {
        return res.status(400).json({
            error: `Unsupported language. Supported: ${SUPPORTED_CODES.join(', ')}`
        });
    }
    res.json({ lang, strings: getAllStrings(lang) });
});

// ══════════════════════════════════════════════════════════════
// PUT /api/sessions/:id/language
// Student sets their preferred language before starting the test.
// Saves it on the session AND on the user's profile.
// Body: { language: "hi" | "mr" | "en" }
// ══════════════════════════════════════════════════════════════
router.put('/:id/language', authenticate, async (req, res) => {
    const { language } = req.body;

    if (!language || !SUPPORTED_CODES.includes(language)) {
        return res.status(400).json({
            error: `Invalid language. Supported: ${SUPPORTED_CODES.join(', ')}`,
            supported: LANGUAGES,
        });
    }

    try {
        // Verify the session belongs to this user (or caller is admin)
        const sessionR = await pool.query(
            'SELECT id, user_id, status FROM test_sessions WHERE id = $1',
            [req.params.id]
        );
        if (!sessionR.rows.length) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const session = sessionR.rows[0];
        const isAdmin = ['super_admin', 'psychologist', 'client_admin'].includes(req.user.role);

        if (!isAdmin && session.user_id !== req.user.id) {
            return res.status(403).json({ error: 'Not your session' });
        }

        if (session.status === 'completed') {
            return res.status(400).json({ error: 'Cannot change language of a completed session' });
        }

        // Update language on session
        await pool.query(
            'UPDATE test_sessions SET language = $1 WHERE id = $2',
            [language, req.params.id]
        );

        // Remember preference on user profile too
        await pool.query(
            'UPDATE users SET preferred_language = $1 WHERE id = $2',
            [language, session.user_id]
        ).catch(() => {}); // non-fatal if column not yet migrated

        // Return UI strings in the selected language so the frontend can
        // immediately switch without a second request
        res.json({
            success: true,
            language,
            strings: getAllStrings(language),
        });
    } catch (err) {
        console.error('Language set error:', err);
        res.status(500).json({ error: 'Failed to set language' });
    }
});

module.exports = router;