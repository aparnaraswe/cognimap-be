const express = require('express');
const { pool } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ══════════════════════════════════════════════════════════
// DYNAMIC CONFIG SYSTEM
// Super admin can configure:
//   1. Test requirements (which domains, min items, passing criteria)
//   2. Student form fields (onboarding fields — dynamic, no code changes)
//   3. Report visibility (what students/parents see)
//   4. Validation rules (required fields, formats)
//   5. Static passing requirements
// All stored as JSONB in platform_settings with category='access_control'
// ══════════════════════════════════════════════════════════

// ── GET /api/config/all ── Get complete config (grouped)
router.get('/all', authenticate, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT * FROM platform_settings ORDER BY category, setting_key`
        );
        const grouped = {};
        for (const row of rows) {
            if (!grouped[row.category]) grouped[row.category] = [];
            grouped[row.category].push({
                key: row.setting_key,
                value: row.setting_value?.value ?? row.setting_value,
                label: row.label,
                description: row.description,
                category: row.category,
            });
        }
        res.json({ config: grouped });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ── GET /api/config/student-visible ── What students can see (public)
router.get('/student-visible', authenticate, async (req, res) => {
    try {
        const keys = [
            'show_scores_to_student', 'show_clusters_to_student', 'show_report_to_student',
            'show_timer', 'show_progress', 'org_name', 'org_logo_url',
            'student_form_fields', 'report_sections_visible', 'domain_instructions'
        ];
        const { rows } = await pool.query(
            `SELECT setting_key, setting_value FROM platform_settings WHERE setting_key = ANY($1)`, [keys]
        );
        const config = {};
        for (const r of rows) config[r.setting_key] = r.setting_value?.value ?? r.setting_value;
        res.json({ config });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ── PUT /api/config/:key ── Update a single config value (super admin only)
router.put('/:key', authenticate, requireRole('super_admin'), async (req, res) => {
    const { value, label, description, category } = req.body;
    try {
        // UPSERT
        const { rows } = await pool.query(`
            INSERT INTO platform_settings (setting_key, setting_value, category, label, description, updated_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (setting_key) DO UPDATE SET
                setting_value = $2, label = COALESCE($4, platform_settings.label),
                description = COALESCE($5, platform_settings.description),
                updated_by = $6, updated_at = NOW()
            RETURNING *
        `, [req.params.key, JSON.stringify({ value }), category || 'access_control', label, description, req.user.id]);
        await req.audit('config.updated', 'platform_settings', rows[0]?.id, { key: req.params.key, newValue: value });
        res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: `Failed: ${err.message}` }); }
});

// ── POST /api/config/bulk ── Update multiple configs at once
router.post('/bulk', authenticate, requireRole('super_admin'), async (req, res) => {
    const { updates } = req.body;
    if (!Array.isArray(updates)) return res.status(400).json({ error: 'updates[] required' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const { key, value, label, description, category } of updates) {
            await client.query(`
                INSERT INTO platform_settings (setting_key, setting_value, category, label, description, updated_by)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (setting_key) DO UPDATE SET
                    setting_value = $2, updated_by = $6, updated_at = NOW()
            `, [key, JSON.stringify({ value }), category || 'access_control', label || key, description || '', req.user.id]);
        }
        await client.query('COMMIT');
        res.json({ updated: updates.length });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
});

// ══════════════════════════════════════════════════════════
// DYNAMIC FORM FIELDS (onboarding-style)
// Super admin creates custom fields that appear on student forms,
// test configuration, or report output — no code changes needed.
// ══════════════════════════════════════════════════════════

// ── GET /api/config/form-fields/:formType ──
// formType: 'student_registration', 'test_config', 'report_output', 'battery_creation'
router.get('/form-fields/:formType', authenticate, async (req, res) => {
    try {
        const key = `form_fields_${req.params.formType}`;
        const { rows } = await pool.query(
            `SELECT setting_value FROM platform_settings WHERE setting_key = $1`, [key]
        );
        const fields = rows[0]?.setting_value?.value || [];
        res.json({ formType: req.params.formType, fields });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ── PUT /api/config/form-fields/:formType ──
// Save form field definitions
router.put('/form-fields/:formType', authenticate, requireRole('super_admin'), async (req, res) => {
    const { fields } = req.body;
    /*
      fields = [
        { id: 'parent_phone', label: 'Parent Phone', type: 'text', required: true, validation: 'phone', placeholder: '+91...', group: 'parent_info' },
        { id: 'blood_group', label: 'Blood Group', type: 'select', required: false, options: ['A+','A-','B+','B-','O+','O-','AB+','AB-'], group: 'medical' },
        { id: 'medical_conditions', label: 'Medical Conditions', type: 'textarea', required: false, group: 'medical' },
        { id: 'consent_form', label: 'Parental Consent', type: 'checkbox', required: true, group: 'consent' },
      ]
    */
    if (!Array.isArray(fields)) return res.status(400).json({ error: 'fields must be an array' });

    const key = `form_fields_${req.params.formType}`;
    try {
        await pool.query(`
            INSERT INTO platform_settings (setting_key, setting_value, category, label, description, updated_by)
            VALUES ($1, $2, 'forms', $3, $4, $5)
            ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2, updated_by = $5, updated_at = NOW()
        `, [key, JSON.stringify({ value: fields }), `${req.params.formType} Form Fields`,
            `Dynamic form fields for ${req.params.formType}`, req.user.id]);
        await req.audit('config.form_fields', 'platform_settings', null, {
            formType: req.params.formType, fieldCount: fields.length
        });
        res.json({ success: true, formType: req.params.formType, fieldCount: fields.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════
// PASSING CRITERIA & VALIDATION RULES
// ══════════════════════════════════════════════════════════

// ── GET /api/config/passing-criteria ──
router.get('/passing-criteria', authenticate, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT setting_value FROM platform_settings WHERE setting_key = 'passing_criteria'`
        );
        const criteria = rows[0]?.setting_value?.value || {
            globalThetaMin: 0.0,
            domainThetaMin: { gf: -0.5, gv: -0.5, gq: -0.5, gc: -0.5, gs: -0.5 },
            minDomainsAboveThreshold: 3,
            flagForReview: { thetaBelow: -1.0, consecutiveTimeouts: 3, totalTimeUnder: 120 },
            classifications: {
                exceptional: { min: 1.5, label: 'Exceptional', color: '#7C3AED' },
                advanced: { min: 0.5, label: 'Advanced', color: '#059669' },
                age_appropriate: { min: -1.5, label: 'Age Appropriate', color: '#D97706' },
                developing: { min: -Infinity, label: 'Developing', color: '#DC2626' },
            }
        };
        res.json({ criteria });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ── PUT /api/config/passing-criteria ──
router.put('/passing-criteria', authenticate, requireRole('super_admin'), async (req, res) => {
    const { criteria } = req.body;
    try {
        await pool.query(`
            INSERT INTO platform_settings (setting_key, setting_value, category, label, description, updated_by)
            VALUES ('passing_criteria', $1, 'scoring', 'Passing Criteria', 'Defines pass/fail thresholds and classification bands', $2)
            ON CONFLICT (setting_key) DO UPDATE SET setting_value = $1, updated_by = $2, updated_at = NOW()
        `, [JSON.stringify({ value: criteria }), req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════
// TEST TYPE DEFINITIONS (for multi-test support)
// Super admin can define new test types with their domains,
// so when future Excel files are uploaded they auto-map.
// ══════════════════════════════════════════════════════════

// ── GET /api/config/test-types ──
router.get('/test-types', authenticate, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT setting_value FROM platform_settings WHERE setting_key = 'test_types'`
        );
        const types = rows[0]?.setting_value?.value || [
            {
                id: 'aptitude_cognitive',
                name: 'Cognitive Aptitude Test',
                domains: ['gf', 'gv', 'gq', 'gc', 'gs'],
                domainLabels: { gf: 'Fluid Reasoning', gv: 'Visual Spatial', gq: 'Quantitative', gc: 'Verbal Reasoning', gs: 'Processing Speed' },
                ageBands: ['8-11', '12-14', '15-18'],
                itemsPerDomain: 6,
                hasAdaptiveEngine: true,
                reportType: 'comprehensive',
                excelSheetPattern: '{domain_label} ({age_band})',
                active: true,
            },
            {
                id: 'personality_big5',
                name: 'Big Five Personality',
                domains: ['personality'],
                domainLabels: { personality: 'Personality Assessment' },
                ageBands: ['8-11', '12-14', '15-18'],
                itemsPerDomain: 40,
                hasAdaptiveEngine: false,
                reportType: 'personality_profile',
                active: false,
            },
            {
                id: 'interest_riasec',
                name: 'Career Interest (RIASEC)',
                domains: ['interest'],
                domainLabels: { interest: 'Career Interest' },
                ageBands: ['15-18'],
                itemsPerDomain: 48,
                hasAdaptiveEngine: false,
                reportType: 'career_guidance',
                active: false,
            }
        ];
        res.json({ testTypes: types });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ── PUT /api/config/test-types ──
router.put('/test-types', authenticate, requireRole('super_admin'), async (req, res) => {
    const { testTypes } = req.body;
    try {
        await pool.query(`
            INSERT INTO platform_settings (setting_key, setting_value, category, label, description, updated_by)
            VALUES ('test_types', $1, 'tests', 'Test Type Definitions', 'Available test types and their domain configurations', $2)
            ON CONFLICT (setting_key) DO UPDATE SET setting_value = $1, updated_by = $2, updated_at = NOW()
        `, [JSON.stringify({ value: testTypes }), req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
