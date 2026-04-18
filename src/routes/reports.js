const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { resolveSourceScope } = require('../utils/sourceScope');
const {
    generateFullReport, generateAptitudeReport,
    generatePersonalityReport, generateInterestReport,
    generateCompiledReport
} = require('../engine/reportGenerator');
const { generateCareerReport } = require('../engine/careerGuidance');
const personalityEngine = require('../engine/personality');
const interestEngine = require('../engine/interest');
const { getReportConfig, getCareerDatabase } = require('../engine/configLoader');

const router = express.Router();

// ═══════════════════════════════════════
// POST /api/reports/generate/:sessionId
// Generates individual report from a completed session
// ═══════════════════════════════════════
router.post('/generate/:sessionId', authenticate, requireRole('super_admin', 'psychologist', 'client_admin'), async (req, res) => {
    const { sessionId } = req.params;
    try {
        const session = await pool.query(`
            SELECT ts.*, u.first_name, u.last_name, u.age_band, u.grade, u.section, u.date_of_birth,
                   u.batch_id as user_batch_id, u.source_id as user_source_id,
                   tb.name as battery_name
            FROM test_sessions ts
            JOIN users u ON ts.user_id = u.id
            JOIN test_batteries tb ON ts.battery_id = tb.id
            WHERE ts.id = $1 AND ts.status = 'completed'
        `, [sessionId]);
        if (!session.rows.length) return res.status(404).json({ error: 'Completed session not found' });
        const sess = session.rows[0];

        const existing = await pool.query('SELECT id FROM reports WHERE session_id = $1', [sessionId]);
        if (existing.rows.length) return res.status(409).json({ error: 'Report already exists', reportId: existing.rows[0].id });

        const state = sess.adaptive_state;
        if (!state) return res.status(400).json({ error: 'No adaptive state' });

        // Load report config from DB
        const reportConfig = await getReportConfig();
        const careerDb = await getCareerDatabase();
        const engineConfig = {
            domainWeights: reportConfig.domain_weights || undefined,
            clusterFormulas: reportConfig.cluster_formulas || undefined,
            narrativeTemplates: reportConfig.narrative_templates || undefined,
            classificationThresholds: reportConfig.scoring_thresholds?.aptitudeClassification || undefined,
            interestStrengthBands: reportConfig.scoring_thresholds?.interestStrengthBands || undefined,
        };
        const personalityCutoffs = reportConfig.scoring_thresholds?.personalityCutoffs || undefined;
        const careerConfig = {
            weights: reportConfig.career_match_weights || undefined,
            careers: careerDb.length > 0 ? careerDb : undefined,
        };

        // Generate the base report
        let reportType = 'aptitude';
        let reportData;
        let aptitudeReport = null, personalityResults = null, interestResults = null;

        if (state.type === 'personality') {
            reportType = 'personality';
            personalityResults = personalityEngine.computeResults(state, personalityCutoffs);
            reportData = generatePersonalityReport(personalityResults, sess, engineConfig);
        } else if (state.type === 'interest') {
            reportType = 'interest';
            interestResults = interestEngine.computeResults(state);
            reportData = generateInterestReport(interestResults, sess, engineConfig);
        } else {
            aptitudeReport = generateAptitudeReport(state, sess, engineConfig);
            reportData = aptitudeReport;
        }

        if (!reportData) return res.status(400).json({ error: 'Could not generate report' });

        // Always generate career pathway data with whatever we have
        const careerReport = generateCareerReport(aptitudeReport, personalityResults, interestResults, sess, careerConfig);
        reportData.career = careerReport;
        reportData.summary = careerReport?.summary || reportData.summary;
        reportData.batteryName = sess.battery_name;
        reportData.sessionId = sessionId;

        // Copy batch_id/source_id from session (falling back to user's) onto the report
        const resolvedBatchId = sess.batch_id || sess.user_batch_id || null;
        const resolvedSourceId = sess.source_id || sess.user_source_id || null;
        const report = await pool.query(`
            INSERT INTO reports (session_id, user_id, project_id, source_id, batch_id, report_type, report_data, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft') RETURNING *
        `, [sessionId, sess.user_id, sess.project_id, resolvedSourceId, resolvedBatchId, reportType, JSON.stringify(reportData)]);

        await req.audit('report.generated', 'report', report.rows[0].id, {
            description: `Generated ${reportType} report for ${sess.first_name} ${sess.last_name || ''}`,
        });
        res.status(201).json(report.rows[0]);
    } catch (err) {
        console.error('Report generation error:', err);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// ═══════════════════════════════════════
// POST /api/reports/compile/:userId
// Compiles ALL assessment reports for a student into one career guidance report
// ═══════════════════════════════════════
router.post('/compile/:userId', authenticate, requireRole('super_admin', 'psychologist', 'client_admin'), async (req, res) => {
    const { userId } = req.params;
    try {
        const userR = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (!userR.rows.length) return res.status(404).json({ error: 'User not found' });
        const user = userR.rows[0];

        // Find all completed sessions for this user
        const sessionsR = await pool.query(`
            SELECT ts.*, ts.adaptive_state
            FROM test_sessions ts
            WHERE ts.user_id = $1 AND ts.status = 'completed'
            ORDER BY ts.completed_at DESC
        `, [userId]);

        let aptitudeState = null, personalityState = null, interestState = null;

        for (const sess of sessionsR.rows) {
            const state = sess.adaptive_state;
            if (!state) continue;
            if (state.type === 'personality' && !personalityState) personalityState = state;
            else if (state.type === 'interest' && !interestState) interestState = state;
            else if (!state.type && state.domains && !aptitudeState) aptitudeState = state;
        }

        if (!aptitudeState && !personalityState && !interestState) {
            return res.status(400).json({ error: 'No completed assessments found for this student' });
        }

        // Load report config from DB
        const reportConfig = await getReportConfig();
        const careerDb = await getCareerDatabase();
        const engineConfig = {
            domainWeights: reportConfig.domain_weights || undefined,
            clusterFormulas: reportConfig.cluster_formulas || undefined,
            narrativeTemplates: reportConfig.narrative_templates || undefined,
            classificationThresholds: reportConfig.scoring_thresholds?.aptitudeClassification || undefined,
            interestStrengthBands: reportConfig.scoring_thresholds?.interestStrengthBands || undefined,
            weights: reportConfig.career_match_weights || undefined,
            careers: careerDb.length > 0 ? careerDb : undefined,
        };
        const personalityCutoffs = reportConfig.scoring_thresholds?.personalityCutoffs || undefined;

        // Compute results from raw states
        const personalityResults = personalityState ? personalityEngine.computeResults(personalityState, personalityCutoffs) : null;
        const interestResults = interestState ? interestEngine.computeResults(interestState) : null;

        const compiledData = generateCompiledReport(aptitudeState, personalityResults, interestResults, user, engineConfig);
        compiledData.userId = userId;

        // Save as compiled report
        const report = await pool.query(`
            INSERT INTO reports (user_id, report_type, report_data, status)
            VALUES ($1, 'compiled', $2, 'draft') RETURNING *
        `, [userId, JSON.stringify(compiledData)]);

        await req.audit('report.compiled', 'report', report.rows[0].id, {
            description: `Compiled career guidance report for ${user.first_name} ${user.last_name || ''}`,
            hasAptitude: !!aptitudeState, hasPersonality: !!personalityState, hasInterest: !!interestState,
        });
        res.status(201).json(report.rows[0]);
    } catch (err) {
        console.error('Compile error:', err);
        res.status(500).json({ error: 'Failed to compile report' });
    }
});

// ═══════════════════════════════════════
// GET /api/reports/student/:userId
// Get all reports for a specific student (individual + compiled)
// ═══════════════════════════════════════
router.get('/student/:userId', authenticate, async (req, res) => {
    try {
        // Students can only see their own published reports
        if (['student', 'employee'].includes(req.user.role) && req.user.id !== req.params.userId) {
            return res.status(403).json({ error: 'Not authorized' });
        }
        // ── Source scope enforcement for admins: ensure target user is in same source ──
        if (['super_admin', 'psychologist', 'client_admin'].includes(req.user.role)) {
            const scopedSourceId = resolveSourceScope(req);
            if (scopedSourceId) {
                const tgt = await pool.query('SELECT source_id FROM users WHERE id = $1', [req.params.userId]);
                if (!tgt.rows.length) return res.status(404).json({ error: 'User not found' });
                if (tgt.rows[0].source_id && tgt.rows[0].source_id !== scopedSourceId) {
                    return res.status(403).json({ error: 'Not authorized for this source' });
                }
            }
        }
        let where = 'WHERE r.user_id = $1';
        if (['student', 'employee'].includes(req.user.role)) where += " AND r.status = 'published'";

        const { rows } = await pool.query(`
            SELECT r.*, u.first_name, u.last_name, u.grade, u.section
            FROM reports r JOIN users u ON r.user_id = u.id
            ${where} ORDER BY r.created_at DESC
        `, [req.params.userId]);
        res.json({ reports: rows });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch reports' });
    }
});

// ═══════════════════════════════════════
// PATCH /api/reports/:id/share
// Share report via email or make visible to counselor
// ═══════════════════════════════════════
router.patch('/:id/share', authenticate, requireRole('super_admin', 'psychologist', 'client_admin'), async (req, res) => {
    const { shareWith, shareMethod } = req.body;
    // shareWith: email address or 'counselor' or 'student'
    // shareMethod: 'email' or 'dashboard' or 'link'
    try {
        const shareToken = uuidv4().slice(0, 12);
        const shareExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

        // If publishing to student/counselor dashboard, set status to published
        const newStatus = shareMethod === 'dashboard' ? 'published' : undefined;

        const result = await pool.query(`
            UPDATE reports SET
                share_token = $2,
                share_expires = $3,
                shared_with = COALESCE(shared_with, '[]'::jsonb) || $4::jsonb,
                status = COALESCE($5, status),
                published_by = $6,
                published_at = CASE WHEN $5 IS NOT NULL THEN NOW() ELSE published_at END
            WHERE id = $1 RETURNING *
        `, [
            req.params.id, shareToken, shareExpires,
            JSON.stringify([{ email: shareWith, method: shareMethod, sharedAt: new Date().toISOString(), sharedBy: req.user.id }]),
            newStatus, req.user.id,
        ]);
        if (!result.rows.length) return res.status(404).json({ error: 'Report not found' });

        // If sharing via email, would send email here
        // For now, return the share link
        const shareLink = `/reports/share/${shareToken}`;

        await req.audit('report.shared', 'report', req.params.id, {
            description: `Shared report with ${shareWith} via ${shareMethod}`,
            shareWith, shareMethod,
        });

        res.json({
            ...result.rows[0],
            shareLink,
            message: shareMethod === 'email'
                ? `Report share link generated. Email sending will be configured during deployment.`
                : `Report published to ${shareWith}'s dashboard.`
        });
    } catch (err) {
        console.error('Share error:', err);
        res.status(500).json({ error: 'Failed to share report' });
    }
});

// ═══════════════════════════════════════
// GET /api/reports/:id — Get single report
// ═══════════════════════════════════════
router.get('/:id([0-9a-f-]{36})', authenticate, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT r.*, u.first_name, u.last_name, u.grade, u.section, u.email, u.date_of_birth,
                   u.source_id as user_source_id,
                   o.name as org_name
            FROM reports r JOIN users u ON r.user_id = u.id
            LEFT JOIN organizations o ON u.organization_id = o.id
            WHERE r.id = $1
        `, [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Report not found' });
        const report = rows[0];
        // ── Source scope enforcement for admins ──
        if (['super_admin', 'psychologist', 'client_admin'].includes(req.user.role)) {
            const scopedSourceId = resolveSourceScope(req);
            if (scopedSourceId) {
                const reportSourceId = report.source_id || report.user_source_id;
                if (reportSourceId && reportSourceId !== scopedSourceId) {
                    return res.status(403).json({ error: 'Not authorized for this source' });
                }
            }
        }
        if (['student', 'employee'].includes(req.user.role)) {
            if (report.user_id !== req.user.id || report.status !== 'published') return res.status(403).json({ error: 'Not authorized' });
            report.clinical_notes = null;
        }
        // Guardian/teacher: verify assignment + per-report access
        if (['guardian', 'teacher'].includes(req.user.role)) {
            const sg = await pool.query(
                `SELECT 1 FROM student_guardians WHERE guardian_id=$1 AND student_id=$2 AND can_view_reports=true`,
                [req.user.id, report.user_id]
            );
            if (!sg.rows.length) return res.status(403).json({ error: 'Not authorized' });
            const raCheck = await pool.query(`SELECT 1 FROM report_access WHERE report_id=$1 LIMIT 1`, [req.params.id]);
            if (raCheck.rows.length) {
                const ra = await pool.query(`SELECT 1 FROM report_access WHERE report_id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
                if (!ra.rows.length) return res.status(403).json({ error: 'Not authorized for this report' });
            }
            report.clinical_notes = null;
        }
        res.json(report);
    } catch (err) { res.status(500).json({ error: 'Failed to fetch report' }); }
});

// ═══════════════════════════════════════
// PATCH /api/reports/:id/review
// ═══════════════════════════════════════
router.patch('/:id/review', authenticate, requireRole('super_admin', 'psychologist'), async (req, res) => {
    const { clinicalNotes, status } = req.body;
    try {
        const result = await pool.query(`
            UPDATE reports SET clinical_notes = COALESCE($2, clinical_notes),
                status = COALESCE($3, 'in_review'), reviewed_by = $4
            WHERE id = $1 RETURNING *
        `, [req.params.id, clinicalNotes, status, req.user.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Report not found' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Failed to update report' }); }
});

// ═══════════════════════════════════════
// ═══════════════════════════════════════
// POST /api/reports/regenerate/:reportId
// Re-generates report data using latest engine (keeps same report row)
// ═══════════════════════════════════════
router.post('/regenerate/:reportId', authenticate, requireRole('super_admin', 'psychologist', 'client_admin'), async (req, res) => {
    try {
        const { reportId } = req.params;
        const reportR = await pool.query('SELECT * FROM reports WHERE id = $1', [reportId]);
        if (!reportR.rows.length) return res.status(404).json({ error: 'Report not found' });
        const report = reportR.rows[0];

        const session = await pool.query(`
            SELECT ts.*, u.first_name, u.last_name, u.age_band, u.grade, u.section, u.date_of_birth,
                   tb.name as battery_name
            FROM test_sessions ts
            JOIN users u ON ts.user_id = u.id
            JOIN test_batteries tb ON ts.battery_id = tb.id
            WHERE ts.id = $1
        `, [report.session_id]);
        if (!session.rows.length) return res.status(404).json({ error: 'Original session not found' });
        const sess = session.rows[0];
        const state = sess.adaptive_state;
        if (!state) return res.status(400).json({ error: 'No adaptive state in session' });

        // Load report config from DB
        const reportConfig = await getReportConfig();
        const careerDb = await getCareerDatabase();
        const engineConfig = {
            domainWeights: reportConfig.domain_weights || undefined,
            clusterFormulas: reportConfig.cluster_formulas || undefined,
            narrativeTemplates: reportConfig.narrative_templates || undefined,
            classificationThresholds: reportConfig.scoring_thresholds?.aptitudeClassification || undefined,
            interestStrengthBands: reportConfig.scoring_thresholds?.interestStrengthBands || undefined,
        };
        const personalityCutoffs = reportConfig.scoring_thresholds?.personalityCutoffs || undefined;
        const careerConfig = {
            weights: reportConfig.career_match_weights || undefined,
            careers: careerDb.length > 0 ? careerDb : undefined,
        };

        let reportType = report.report_type;
        let reportData;
        let aptitudeReport = null, personalityResults = null, interestResults = null;

        if (state.type === 'personality') {
            reportType = 'personality';
            personalityResults = personalityEngine.computeResults(state, personalityCutoffs);
            reportData = generatePersonalityReport(personalityResults, sess, engineConfig);
        } else if (state.type === 'interest') {
            reportType = 'interest';
            interestResults = interestEngine.computeResults(state);
            reportData = generateInterestReport(interestResults, sess, engineConfig);
        } else {
            aptitudeReport = generateAptitudeReport(state, sess, engineConfig);
            reportData = aptitudeReport;
        }

        if (!reportData) return res.status(400).json({ error: 'Could not regenerate report' });

        // Always generate career pathway data with whatever we have
        const careerReport = generateCareerReport(aptitudeReport, personalityResults, interestResults, sess, careerConfig);
        reportData.career = careerReport;
        reportData.summary = careerReport?.summary || reportData.summary;
        reportData.batteryName = sess.battery_name;
        reportData.sessionId = report.session_id;
        reportData.regeneratedAt = new Date().toISOString();

        const updated = await pool.query(`
            UPDATE reports SET report_data = $2, report_type = $3, updated_at = NOW()
            WHERE id = $1 RETURNING *
        `, [reportId, JSON.stringify(reportData), reportType]);

        await req.audit('report.regenerated', 'report', reportId, {
            description: `Regenerated ${reportType} report for ${sess.first_name} ${sess.last_name || ''}`,
        });
        res.json(updated.rows[0]);
    } catch (err) {
        console.error('Report regeneration error:', err);
        res.status(500).json({ error: 'Failed to regenerate report' });
    }
});

// PATCH /api/reports/:id/publish
// ═══════════════════════════════════════
router.patch('/:id/publish', authenticate, requireRole('super_admin', 'psychologist', 'client_admin'), async (req, res) => {
    try {
        const shareToken = uuidv4().slice(0, 12);
        const result = await pool.query(`
            UPDATE reports SET status = 'published', published_by = $2, published_at = NOW(), share_token = $3
            WHERE id = $1 AND status IN ('draft', 'in_review', 'revision') RETURNING *
        `, [req.params.id, req.user.id, shareToken]);
        if (!result.rows.length) return res.status(404).json({ error: 'Report not found or already published' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Failed to publish report' }); }
});

// ═══════════════════════════════════════
// GET /api/reports — List all reports
// ═══════════════════════════════════════
router.get('/', authenticate, async (req, res) => {
    const { status, reportType, batchId, page = 1, limit = 50 } = req.query;
    const user = req.user;
    let where = ' WHERE 1=1'; const params = []; let idx = 0;
    if (['student', 'employee'].includes(user.role)) {
        params.push(user.id); where += ` AND r.user_id = $${++idx} AND r.status = 'published'`;
    }
    if (status) { params.push(status); where += ` AND r.status = $${++idx}`; }
    if (reportType) { params.push(reportType); where += ` AND r.report_type = $${++idx}`; }
    // ── Source scope — enforced for non-super-admin, optional for super admin ──
    const scopedSourceId = resolveSourceScope(req);
    if (scopedSourceId) {
        params.push(scopedSourceId);
        where += ` AND (r.source_id = $${++idx} OR u.source_id = $${idx})`;
    }
    // ── Batch filter ── prefers report-level batch_id, falls back to user's batch_id
    if (batchId) { params.push(batchId); where += ` AND (r.batch_id = $${++idx} OR u.batch_id = $${idx})`; }
    try {
        const countR = await pool.query(`SELECT COUNT(*) as total FROM reports r JOIN users u ON r.user_id = u.id LEFT JOIN organizations o ON u.organization_id = o.id LEFT JOIN batches b ON COALESCE(r.batch_id, u.batch_id) = b.id ${where}`, params);
        const total = parseInt(countR.rows[0]?.total || 0);
        const offset = (parseInt(page) - 1) * parseInt(limit);
        params.push(parseInt(limit)); params.push(offset);
        const { rows } = await pool.query(`
            SELECT r.*, u.first_name, u.last_name, u.grade, u.section,
                   u.source_id, o.name as org_name,
                   s.display_name as source_name, s.source_code,
                   COALESCE(r.batch_id, u.batch_id) as effective_batch_id,
                   b.name as batch_name
            FROM reports r
            JOIN users u ON r.user_id = u.id
            LEFT JOIN organizations o ON u.organization_id = o.id
            LEFT JOIN sources s ON u.source_id = s.id
            LEFT JOIN batches b ON COALESCE(r.batch_id, u.batch_id) = b.id
            ${where} ORDER BY r.created_at DESC LIMIT $${++idx} OFFSET $${++idx}
        `, params);
        if (['student', 'employee'].includes(user.role)) rows.forEach(r => { r.clinical_notes = null; });
        res.json({ reports: rows, total, page: parseInt(page), limit: parseInt(limit) });
    } catch (err) {
        console.error('Reports fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch reports' });
    }
});

// ═══════════════════════════════════════
// GET /api/reports/share/:token — Public share link
// ═══════════════════════════════════════
router.get('/share/:token', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT r.report_type, r.report_data, r.published_at, u.first_name, u.last_name
            FROM reports r JOIN users u ON r.user_id = u.id
            WHERE r.share_token = $1 AND r.status = 'published'
              AND (r.share_expires IS NULL OR r.share_expires > NOW())
        `, [req.params.token]);
        if (!rows.length) return res.status(404).json({ error: 'Report not found or expired' });
        res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: 'Failed to fetch shared report' }); }
});

module.exports = router;
