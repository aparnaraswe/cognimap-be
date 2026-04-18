const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { resolveSourceScope } = require('../utils/sourceScope');

const router = express.Router();

// ── Directory for item images extracted from Excel ──────────────────────────
const ITEM_IMAGES_DIR = path.join(__dirname, '../../public/item-images');
if (!fs.existsSync(ITEM_IMAGES_DIR)) fs.mkdirSync(ITEM_IMAGES_DIR, { recursive: true });

/**
 * Extract images embedded in an Excel (xlsx) file using XLSX's built-in
 * bookFiles feature (no extra zip library needed).
 *
 * xlsx files are ZIP archives. Images live in xl/media/.
 * xl/drawings/drawing*.xml maps each image to a cell anchor (0-indexed col, row).
 * xl/drawings/_rels/drawing*.xml.rels maps relationship IDs to media files.
 *
 * Returns a Map: `"${excelRow1Based}_${col1Based}" => { localPath, filename }`
 * excelRow/col are 1-based (same convention used by XLSX.js row numbers).
 *
 * @param {string} xlsxFilePath - Absolute path to the xlsx file.
 * @param {string} filePrefix   - Prefix for output PNG filenames (avoids collisions).
 */
function extractExcelImages(xlsxFilePath, filePrefix = 'img') {
    const result = new Map(); // "row_col" (1-based) => { localPath, filename }

    let wb;
    try {
        wb = XLSX.readFile(xlsxFilePath, { bookFiles: true, bookDeps: false });
    } catch (e) {
        console.warn('[extractExcelImages] Could not open xlsx:', e.message);
        return result;
    }

    const files = wb.files || {};
    const fileKeys = Object.keys(files);

    // Find all drawing XML files
    const drawingEntries = fileKeys.filter(k => /xl\/drawings\/drawing\d+\.xml$/.test(k));

    for (const drawingKey of drawingEntries) {
        const drawingNum = drawingKey.match(/drawing(\d+)\.xml$/)[1];
        const relsKey    = `xl/drawings/_rels/drawing${drawingNum}.xml.rels`;

        const drawingFile = files[drawingKey];
        const relsFile    = files[relsKey];
        if (!drawingFile || !relsFile) continue;

        const drawingXml = Buffer.from(drawingFile.content).toString('utf-8');
        const relsXml    = Buffer.from(relsFile.content).toString('utf-8');

        // Parse rels: rId → media path. Attributes may appear in any order, so we
        // extract Id and Target independently from each <Relationship> tag.
        const ridToMedia = {};
        for (const m of relsXml.matchAll(/<Relationship[^>]+>/g)) {
            const tag  = m[0];
            const idM  = tag.match(/Id="(rId\d+)"/);
            const tgtM = tag.match(/Target="([^"]+)"/);
            if (idM && tgtM) ridToMedia[idM[1]] = tgtM[1].replace(/^\//, '');
        }

        // Parse drawing anchors — handle BOTH anchor formats:
        //   oneCellAnchor  (openpyxl)  : <oneCellAnchor><from><col>N</col><row>R</row>…
        //   twoCellAnchor  (xlsxwriter): <xdr:twoCellAnchor><xdr:from><xdr:col>N</xdr:col>…
        // We use the FROM cell as the image position in both cases.
        const anchorRegex = /(?:<oneCellAnchor>[\s\S]*?<\/oneCellAnchor>|<(?:\w+:)?twoCellAnchor>[\s\S]*?<\/(?:\w+:)?twoCellAnchor>)/g;
        for (const anchor of (drawingXml.match(anchorRegex) || [])) {
            // Match <col>N</col> OR <xdr:col>N</xdr:col> (namespace-agnostic)
            const colMatch = anchor.match(/<(?:\w+:)?col>(\d+)<\/(?:\w+:)?col>/);
            const rowMatch = anchor.match(/<(?:\w+:)?row>(\d+)<\/(?:\w+:)?row>/);
            const ridMatch = anchor.match(/r:embed="(rId\d+)"/);
            if (!colMatch || !rowMatch || !ridMatch) continue;

            const col0 = parseInt(colMatch[1]); // 0-indexed in XML
            const row0 = parseInt(rowMatch[1]); // 0-indexed in XML
            const rId  = ridMatch[1];

            const mediaRelPath = ridToMedia[rId];
            if (!mediaRelPath) continue;

            // mediaRelPath is relative to xl/drawings/ (e.g. "../media/image1.png")
            // OR absolute from root (e.g. "xl/media/image1.png")
            let mediaKey = mediaRelPath;
            if (mediaRelPath.startsWith('../')) {
                mediaKey = 'xl/' + mediaRelPath.slice(3); // "../media/..." → "xl/media/..."
            }
            if (!mediaKey.startsWith('xl/')) mediaKey = 'xl/' + mediaKey;

            const mediaFile = files[mediaKey];
            if (!mediaFile) continue;

            const ext = path.extname(mediaKey) || '.png';
            const filename = `${filePrefix}_r${row0 + 1}_c${col0 + 1}${ext}`;
            const localPath = path.join(ITEM_IMAGES_DIR, filename);
            fs.writeFileSync(localPath, Buffer.from(mediaFile.content));

            const key = `${row0 + 1}_${col0 + 1}`; // 1-based
            result.set(key, { localPath, filename });
        }
    }

    console.log(`[extractExcelImages] Extracted ${result.size} images from ${path.basename(xlsxFilePath)}`);
    return result;
}

// File upload config
const upload = multer({
    dest: path.join(__dirname, '../../uploads/'),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.csv', '.xlsx', '.xls'].includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Only .csv, .xlsx, .xls files are allowed'));
        }
    }
});

// ── GET /api/items ── Browse question bank with filters
router.get('/', authenticate, requireRole('super_admin', 'psychologist', 'client_admin'), async (req, res) => {
    const {
        domain, template, difficulty, audience, ageBandMin, ageBandMax,
        isActive, isPractice, search,
        page = 1, limit = 50, sortBy = 'item_code', sortDir = 'asc'
    } = req.query;

    // ── Source scope: super admin sees all by default, others locked to their source ──
    const effectiveSourceId = resolveSourceScope(req);

    // Use item_sources junction when filtering by source, else fall back to direct query
    let query;
    const params = [];
    let paramIdx = 0;

    if (effectiveSourceId) {
        params.push(effectiveSourceId);
        paramIdx = 1;
        query = `SELECT DISTINCT i.* FROM items i
                 INNER JOIN item_sources is_jt ON i.id = is_jt.item_id
                 WHERE is_jt.source_id = $1`;
    } else {
        query = `SELECT i.* FROM items i WHERE 1=1`;
    }

    const aliasPrefix = effectiveSourceId ? 'i.' : '';
    if (domain) { params.push(domain); query += ` AND ${aliasPrefix}domain = $${++paramIdx}`; }
    if (template) { params.push(template); query += ` AND ${aliasPrefix}template = $${++paramIdx}`; }
    if (difficulty) { params.push(parseInt(difficulty)); query += ` AND ${aliasPrefix}difficulty_level = $${++paramIdx}`; }
    if (audience) { params.push(audience); query += ` AND (${aliasPrefix}audience = $${++paramIdx} OR ${aliasPrefix}audience = 'both')`; }
    if (ageBandMin) { params.push(parseInt(ageBandMin)); query += ` AND ${aliasPrefix}age_band_max >= $${++paramIdx}`; }
    if (ageBandMax) { params.push(parseInt(ageBandMax)); query += ` AND ${aliasPrefix}age_band_min <= $${++paramIdx}`; }
    if (isActive !== undefined) { params.push(isActive === 'true'); query += ` AND ${aliasPrefix}is_active = $${++paramIdx}`; }
    if (isPractice !== undefined) { params.push(isPractice === 'true'); query += ` AND ${aliasPrefix}is_practice = $${++paramIdx}`; }
    if (search) { params.push(`%${search}%`); query += ` AND (${aliasPrefix}item_code ILIKE $${++paramIdx} OR ${aliasPrefix}template ILIKE $${paramIdx})`; }

    // Count total
    const countResult = await pool.query(`SELECT COUNT(*) FROM (${query}) sub`, params);
    const total = parseInt(countResult.rows[0].count);

    // Sort & paginate
    const allowedSorts = ['item_code', 'domain', 'template', 'difficulty_level', 'created_at'];
    const sort = allowedSorts.includes(sortBy) ? sortBy : 'item_code';
    const dir = sortDir === 'desc' ? 'DESC' : 'ASC';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    params.push(parseInt(limit));
    params.push(offset);
    query += ` ORDER BY ${aliasPrefix}${sort} ${dir} LIMIT $${++paramIdx} OFFSET $${++paramIdx}`;

    try {
        const result = await pool.query(query, params);
        res.json({
            items: result.rows,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (err) {
        console.error('Items fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch items' });
    }
});

// ── GET /api/items/stats ── Item counts per test type
router.get('/stats', authenticate, requireRole('super_admin', 'psychologist', 'client_admin'), async (req, res) => {
    try {
        // ── Source scope: super admin sees all, others scoped to their source ──
        const scopedSourceId = resolveSourceScope(req);
        const params = [];
        let query;
        if (scopedSourceId) {
            params.push(scopedSourceId);
            query = `
                SELECT i.domain, COUNT(*) as item_count,
                       COUNT(i.irt_a) as irt_ready,
                       COUNT(CASE WHEN i.irt_calibrated = true THEN 1 END) as calibrated,
                       ROUND(MIN(i.irt_b)::numeric, 2) as min_b,
                       ROUND(MAX(i.irt_b)::numeric, 2) as max_b,
                       ROUND(AVG(i.irt_a)::numeric, 2) as avg_a
                FROM items i
                INNER JOIN item_sources is_jt ON i.id = is_jt.item_id
                WHERE i.is_active = true AND i.is_practice = false
                  AND is_jt.source_id = $1
                GROUP BY i.domain
            `;
        } else {
            query = `
                SELECT domain, COUNT(*) as item_count,
                       COUNT(irt_a) as irt_ready,
                       COUNT(CASE WHEN irt_calibrated = true THEN 1 END) as calibrated,
                       ROUND(MIN(irt_b)::numeric, 2) as min_b,
                       ROUND(MAX(irt_b)::numeric, 2) as max_b,
                       ROUND(AVG(irt_a)::numeric, 2) as avg_a
                FROM items WHERE is_active = true AND is_practice = false
                GROUP BY domain
            `;
        }
        const result = await pool.query(query, params);
        const cogDomains = ['gf', 'gv', 'gq', 'gc', 'gs', 'gwm'];
        const stats = {
            cognitive: { total: 0, domains: {} },
            personality: { total: 0, domains: {} },
            interest: { total: 0, domains: {} },
        };
        for (const row of result.rows) {
            const d = row.domain;
            const count = parseInt(row.item_count);
            const irtInfo = {
                count,
                irtReady: parseInt(row.irt_ready || 0),
                calibrated: parseInt(row.calibrated || 0),
                bRange: row.min_b !== null ? [parseFloat(row.min_b), parseFloat(row.max_b)] : null,
                avgDiscrimination: row.avg_a ? parseFloat(row.avg_a) : null,
            };
            if (cogDomains.includes(d)) {
                stats.cognitive.total += count;
                stats.cognitive.domains[d] = irtInfo;
            } else if (d === 'personality') {
                stats.personality.total += count;
                stats.personality.domains[d] = irtInfo;
            } else if (d === 'interest') {
                stats.interest.total += count;
                stats.interest.domains[d] = irtInfo;
            }
        }
        res.json(stats);
    } catch (err) {
        console.error('Stats error:', err);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// ── GET /api/items/practice ── Practice items for a domain (all authenticated users)
// Returns up to 3 practice items for the given domain, accessible to students
// Falls back to easy regular items if no dedicated practice items exist
router.get('/practice', authenticate, async (req, res) => {
    const { domain } = req.query;
    if (!domain) return res.status(400).json({ error: 'domain query param required' });
    try {
        // First try dedicated practice items (is_practice = true)
        let result = await pool.query(
            `SELECT id, item_code, domain, template, content, time_limit_sec, is_practice
             FROM items
             WHERE domain = $1 AND is_practice = true AND is_active = true
             ORDER BY RANDOM()
             LIMIT 3`,
            [domain]
        );
        const fromPracticeBank = result.rows.length > 0;
        // Fallback: pick easiest regular items as practice
        if (!result.rows.length) {
            result = await pool.query(
                `SELECT id, item_code, domain, template, content, time_limit_sec, is_practice
                 FROM items
                 WHERE domain = $1 AND is_practice = false AND is_active = true
                 ORDER BY difficulty_level ASC, RANDOM()
                 LIMIT 3`,
                [domain]
            );
        }
        res.json({ items: result.rows, fromPracticeBank });
    } catch (err) {
        console.error('Practice items fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch practice items' });
    }
});

// ── GET /api/items/:id ── Single item detail
router.get('/:id', authenticate, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM items WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch item' });
    }
});

// ── PUT /api/items/:id ── Edit single item
router.put('/:id', authenticate, requireRole('super_admin', 'psychologist'), async (req, res) => {
    const { template, content, timeLimitSec, difficultyLevel, isActive, isPractice,
            irt_a, irt_b, irt_c, irt_calibrated, content_constraint, enemy_items, exposure_control } = req.body;

    try {
        const result = await pool.query(`
            UPDATE items SET
                template = COALESCE($2, template),
                content = COALESCE($3, content),
                time_limit_sec = COALESCE($4, time_limit_sec),
                difficulty_level = COALESCE($5, difficulty_level),
                is_active = COALESCE($6, is_active),
                is_practice = COALESCE($7, is_practice),
                irt_a = COALESCE($8, irt_a),
                irt_b = COALESCE($9, irt_b),
                irt_c = COALESCE($10, irt_c),
                irt_calibrated = COALESCE($11, irt_calibrated),
                content_constraint = COALESCE($12, content_constraint),
                enemy_items = COALESCE($13, enemy_items),
                exposure_control = COALESCE($14, exposure_control),
                version = version + 1
            WHERE id = $1
            RETURNING *
        `, [req.params.id, template, content ? JSON.stringify(content) : null,
            timeLimitSec, difficultyLevel, isActive, isPractice,
            irt_a !== undefined ? irt_a : null,
            irt_b !== undefined ? irt_b : null,
            irt_c !== undefined ? irt_c : null,
            irt_calibrated !== undefined ? irt_calibrated : null,
            content_constraint || null,
            enemy_items || null,
            exposure_control !== undefined ? exposure_control : null]);

        if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });

        await req.audit('item.updated', 'item', req.params.id, {
            description: `Updated item ${result.rows[0].item_code}`
        });

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Item update error:', err);
        res.status(500).json({ error: 'Failed to update item' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers for the new v2 Excel format
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map the Excel "Difficulty" string to a numeric difficulty_level for the DB.
 *   easy → 1 | medium → 2 | hard → 3
 */
function parseDifficultyLevel(val) {
    if (val === undefined || val === null || val === '') return 1;
    const s = String(val).toLowerCase().trim();
    if (s === 'easy')   return 1;
    if (s === 'medium') return 2;
    if (s === 'hard')   return 3;
    // Fallback: try a bare number
    const n = parseInt(s);
    return isNaN(n) ? 1 : n;
}

/**
 * Parse "Age Band" column (e.g. "8-10") into { min, max }.
 * Falls back to (8, 18) if missing or malformed.
 */
function parseAgeBand(val) {
    if (!val) return { min: 8, max: 18 };
    const parts = String(val).split('-').map(p => parseInt(p.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return { min: parts[0], max: parts[1] };
    }
    return { min: 8, max: 18 };
}

/**
 * Convert correct-answer info to a 0-based index.
 *
 * Priority:
 *   1. correctIdx   — "Correct Idx" column, 1-based (1=A, 2=B, 3=C) → subtract 1
 *   2. correctIdx0b — "Correct Idx (0b)" column, already 0-based    → use as-is
 *   3. correctAns   — "Correct Ans" column, letter (A/B/C/D)        → map to 0-based
 */
function parseCorrectIdx(correctIdx, correctIdx0b, correctAns) {
    // 1. "Correct Idx" — 1-based numeric
    if (correctIdx !== null && correctIdx !== undefined && correctIdx !== '') {
        const n = parseInt(correctIdx);
        if (!isNaN(n)) return n - 1;
    }
    // 2. "Correct Idx (0b)" — already 0-based numeric
    if (correctIdx0b !== null && correctIdx0b !== undefined && correctIdx0b !== '') {
        const n = parseInt(correctIdx0b);
        if (!isNaN(n)) return n;
    }
    // 3. "Correct Ans" — letter like A, B, C, D
    if (correctAns) {
        const letter = String(correctAns).trim().toUpperCase();
        const map = { A: 0, B: 1, C: 2, D: 3 };
        if (map[letter] !== undefined) return map[letter];
    }
    return 0;
}

/**
 * Read all item rows from the uploaded workbook.
 *
 * Auto-detection logic:
 *   - Scans each row from the top until it finds one whose cells contain
 *     "Item ID" (case-insensitive) — that row is the header row.  Any rows
 *     above it (title banners, sub-headers, instructions) are silently skipped.
 *   - Data rows below the header are parsed using whatever columns are
 *     present in that header row (fully dynamic via colMap).
 *   - Rows where the first non-null cell starts with "▸" are treated as
 *     section-label banners and skipped.
 *   - Rows that are entirely empty are skipped.
 *
 * Sheet names that are NOT item sheets are skipped (Summary_Distribution,
 * Metadata_Legend, and the old reference/readme/blank patterns).
 *
 * Domain is read directly from the "Domain" column when present; falls back
 * to inferring from the sheet name (e.g. "Gf_B1_Items" → "gf").
 */
function readRowsFromWorkbook(workbook) {
    const allRows = [];

    for (const sheetName of workbook.SheetNames) {
        const lower = sheetName.toLowerCase();

        // Skip non-item sheets
        if (
            lower.includes('reference') || lower.includes('image')   ||
            lower.includes('readme')    || lower.includes('blank')   ||
            lower.includes('column rules') || lower.includes('parameter guide') ||
            lower.includes('token')     || lower.includes('distribution') ||
            lower.includes('summary')   || lower.includes('metadata') ||
            lower.includes('legend')    || lower.includes('architecture') ||
            lower.includes('pipeline')  || lower.includes('registry')
        ) continue;

        const sheet = workbook.Sheets[sheetName];

        // ── Read all rows as raw arrays ──────────────────────────────────────
        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

        if (rawRows.length < 2) continue; // need at least header + 1 data row

        // ── Auto-detect header row ───────────────────────────────────────────
        // Scan from row 0 looking for the first row that contains "item id"
        // (case-insensitive) anywhere in its cells.  This gracefully handles
        // workbooks with 0, 1, or more title/banner rows before the header.
        let headerIdx = -1;
        for (let ri = 0; ri < rawRows.length; ri++) {
            const row = rawRows[ri];
            if (!row) continue;
            const hasItemId = row.some(
                v => v !== null && String(v).trim().toLowerCase() === 'item id'
            );
            if (hasItemId) { headerIdx = ri; break; }
        }
        if (headerIdx === -1) continue; // no header row found — not an item sheet

        const headerRow = rawRows[headerIdx];
        if (!headerRow || !headerRow.some(v => v !== null)) continue;

        // ── Build column-name → index map (dynamic — uses whatever columns exist)
        const colMap = {};
        headerRow.forEach((name, idx) => {
            if (name !== null) colMap[String(name).trim()] = idx;
        });

        // Must have at least "Item ID" to be an item sheet (already confirmed above)
        if (colMap['Item ID'] === undefined) continue;

        // Infer fallback domain from sheet name (e.g. "Gf_B1_Items" → "gf")
        let sheetDomain = null;
        const domainMatch = sheetName.match(/^(Gf|Gv|Gq|Gc|Gs|Gwm)/i);
        if (domainMatch) sheetDomain = domainMatch[1].toLowerCase();

        // Data rows start immediately after the header row
        for (let r = headerIdx + 1; r < rawRows.length; r++) {
            const raw = rawRows[r];
            if (!raw) continue;

            const get = (col) => {
                const idx = colMap[col];
                return idx !== undefined ? raw[idx] : undefined;
            };

            const itemId = get('Item ID');

            // Skip blank rows and section-label banner rows (e.g. "▸  PRACTICE ITEMS …")
            // A section-label row has a non-empty first cell starting with "▸",
            // or is a row where all non-null cells are in the first column only.
            if (!itemId || String(itemId).trim() === '') continue;
            const itemIdStr = String(itemId).trim();
            if (itemIdStr.startsWith('▸') || itemIdStr.startsWith('>')) continue;
            // Skip instructions/example rows (e.g. "Unique: Domain_Band_NNN")
            // These are documentation rows in multi-header templates; they contain
            // placeholder text describing the expected format, not actual item data.
            if (itemIdStr.startsWith('Unique:') || itemIdStr.includes('Domain_Band')) continue;

            // Build a normalised row object (supports both legacy v2 and new universal template)
            const row = {
                // ── Identity ──────────────────────────────────────────────
                itemId:       String(itemId).trim(),
                domain:       get('Domain')      || sheetDomain || null,
                ageBand:      get('Age Band')    || get('Age Range') || null,
                testSection:  get('Test Section') || null,
                itemType:     get('Item Type')   || null,
                cogDevStage:  get('Cog Dev Stage') || null,
                narrowAbility: get('Narrow Ability') || null,
                chcCode:      get('CHC Code')    || null,
                template:     get('Template')    || null,
                ruleType:     get('Rule Type')   || null,
                ruleDims:     get('Rule Dims')   || null,
                subtype:      get('Subtype')      || null,

                // ── Difficulty / IRT ───────────────────────────────────────
                difficulty:   get('Difficulty')  || null,
                // Support both universal template names and GWM production v5 names
                irtB:         get('b-prior')     ?? get('b (difficulty)'),
                irtA:         get('a (est.)')    ?? get('a (discrim)'),
                irtC:         get('c')           ?? get('c (guessing)'),
                calibrated:   get('Calibrated?'),

                // ── Presentation ──────────────────────────────────────────
                timeSec:      get('Time (s)'),
                display:      get('Display')     || null,
                displayMode:  get('Display Mode') || null,
                format:       get('Format')      || null,
                isPractice:   get('Practice?'),
                anchorGroup:  get('Anchor Group') || null,

                // ── Content ───────────────────────────────────────────────
                promptText:   get('Prompt Text') ? String(get('Prompt Text')).replace(/\bNaN\b/g, '').trim() || null : null,
                stimulusRow1: get('Stimulus Row 1') || null,
                stimulusRow2: get('Stimulus Row 2') || null,
                optionA:      get('Option A')    || null,
                optionB:      get('Option B')    || null,
                optionC:      get('Option C')    || null,
                optionD:      get('Option D')    || null,   // 4-choice support

                // ── Image columns (universal template: "Stim1 Image" / "OptA Image" etc.) ─
                // Also supports production v4 naming: "Stim1 Img Ref" / "OptA Img Ref"
                stim1Image:   get('Stim1 Image') || get('Stim1_Image') || get('Stim1 Img Ref') || null,
                stim2Image:   get('Stim2 Image') || get('Stim2_Image') || get('Stim2 Img Ref') || null,
                optAImage:    get('OptA Image')  || get('OptionA Image') || get('OptA Img Ref') || null,
                optBImage:    get('OptB Image')  || get('OptionB Image') || get('OptB Img Ref') || null,
                optCImage:    get('OptC Image')  || get('OptionC Image') || get('OptC Img Ref') || null,
                optDImage:    get('OptD Image')  || get('OptD Img Ref') || null,

                // ── Row/col tracking for image extraction ──────────────────
                _excelRow:    r + 1,

                // ── Answer ────────────────────────────────────────────────
                correctAns:   get('Correct Ans') || null,
                // Support both "Correct Idx" (1-based: universal template) and "Correct Idx (0b)" (0-based: production v4)
                correctIdx:       get('Correct Idx') ?? null,
                correctIdx0b:     get('Correct Idx (0b)') ?? null,

                // ── Per-option scoring (universal template) ────────────────
                // Base Score = max score for the item (default 1)
                baseScore:      get('Base Score'),
                // Score per option: how many points if student picks that option
                scoreA:         get('Score A'),
                scoreB:         get('Score B'),
                scoreC:         get('Score C'),
                scoreD:         get('Score D'),
                // If TRUE, base score is split equally among options with Score > 0
                equalDistribute: get('Equal Distribute'),

                // ── Age-band weightage ─────────────────────────────────────
                // Standard multipliers  — applied to raw score for each age group
                wtAge6_7:    get('Wt 6-7'),
                wtAge8_9:    get('Wt 8-9'),
                wtAge10_11:  get('Wt 10-11'),
                wtAge12_13:  get('Wt 12-13'),
                wtAge14_15:  get('Wt 14-15'),
                wtAge16p:    get('Wt 16+'),
                // Positive-age-weightage bonus multipliers
                posWtAge6_7:   get('PosWt 6-7'),
                posWtAge8_9:   get('PosWt 8-9'),
                posWtAge10_11: get('PosWt 10-11'),
                posWtAge12_13: get('PosWt 12-13'),
                posWtAge14_15: get('PosWt 14-15'),
                posWtAge16p:   get('PosWt 16+'),

                // ── CAT / psychometric metadata ───────────────────────────
                distractorRationale: get('Distractor Rationale') || null,
                enemyItems:   get('Enemy Items') || null,
                exposureMax:  get('Exposure Max'),
                contentConstraint: get('Content Constraint') || null,
                difSex:       get('DIF Sex')     || null,
                difSes:       get('DIF SES')     || null,
                pilotN:       get('Pilot N'),
                changeLog:    get('Change Log')  || null,
                notes:        get('Notes')       || null,
            };

            allRows.push(row);
        }
    }

    return allRows;
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// SERVER-SIDE TOKEN VALIDATOR
// Mirrors the client-side TokenValidator.jsx logic so the backend can
// independently decide which items to skip and store as pending.
// ─────────────────────────────────────────────────────────────────────────────
const RENDERABLE_SHAPES = [
    // Standard shapes (all domains)
    'triangle','circle','square','star','diamond','hexagon','pentagon',
    'arrow','octagon','cross','dot','heart','oval','rectangle','crescent',
    // Gs-specific complex shapes (rendered by GsSymbolSVG in GsTokenRenderer_additions)
    'hourglass','wavy','moon','nested','inner_square','shaded',
];

/** Returns true if the value is a visual template placeholder that needs an
 *  actual image asset rather than a shape token.
 *
 *  Catches two patterns:
 *  1. Gs-style:  "symbol_matching stimulus: exact_match"
 *                "perceptual_cancellation stimulus: target_cancel"
 *  2. Gv-style:  "Reflection: horizontal reflection"
 *                "Embedded figures: figure ground"
 *                "Spatial assembly: part whole"
 */
function isTemplatePlaceholder(val) {
    if (!val) return false;
    const s = String(val).trim();

    // ── Early-exit: these are always plain text sentences, never visual placeholders ──
    // GC prompts like "Which word does NOT belong: apple, banana, carrot, grape?"
    if (s.includes(',')) return false;        // comma-separated lists = text
    if (s.endsWith('?')) return false;         // question sentences = text
    if (s.length > 80) return false;           // full sentences are too long to be a placeholder
    if (/^(which|what|how|who|where|when|does|is|are|can|select|choose|find|identify|complete|fill|pick)\b/i.test(s)) return false;

    // Pattern 1: contains the word "stimulus:" (Gs-style)
    if (/\b\w+\s+stimulus:\s*\w+/i.test(s)) return true;
    // Pattern 2: "Word(s): description" — short category:subcategory (Gv/Gf-style visual token)
    // Must start with a capital letter word, have optional words, then ": " then more words
    if (/^[A-Za-z][A-Za-z\s_]+:\s+[A-Za-z]/.test(s)) return true;
    return false;
}

/** Validate a single token string.
 *  Returns { valid: true } or { valid: false, reason: string } */
function validateTokenServer(token) {
    if (!token || token === '?' || token === '') return { valid: true };
    const t = String(token).trim();

    // Pure number (Gq answers, Gs counts)
    if (/^-?\d+\.?\d*$/.test(t)) return { valid: true };

    // Template visual placeholder — needs an image asset
    if (isTemplatePlaceholder(t))
        return { valid: false, reason: `Visual asset required: "${t}" is a template placeholder` };

    // Ratio token ratio:A:B — validate each part
    if (t.startsWith('ratio:')) {
        const parts = t.slice(6).split(':').filter(Boolean);
        for (const p of parts) {
            const r = validateTokenServer(p);
            if (!r.valid) return { valid: false, reason: `ratio part "${p}": ${r.reason}` };
        }
        return { valid: true };
    }

    // Count token N_shape…
    if (/^\d+_/.test(t)) {
        const inner = t.replace(/^\d+_/, '');
        return validateShapePartServer(inner);
    }

    // pos_ token
    if (t.startsWith('pos_')) return { valid: true }; // pos tokens are always valid structure

    // img_ token
    if (t.startsWith('img_')) return { valid: true }; // img tokens accepted (asset may exist)

    // excel_img: token — image extracted from embedded Excel cell; always valid
    if (t.startsWith('excel_img:')) return { valid: true };

    // Plain text with spaces — always renderable as text
    if (t.includes(' ')) return { valid: true };

    // Underscore token — must contain a known shape name
    if (t.includes('_')) return validateShapePartServer(t);

    // Single word — if it's a shape name it renders, otherwise text
    return { valid: true };
}

function validateShapePartServer(t) {
    const lc = t.toLowerCase();
    const hasShape = RENDERABLE_SHAPES.some(s => lc.includes(s));
    if (!hasShape)
        return { valid: false, reason: `Unknown shape in token "${t}"` };
    return { valid: true };
}

/** Inspect all content fields of a row.
 *  knownTokens = Set of token names already registered (SVG shapes + sprite manifest).
 *  Any placeholder that matches a known token is considered resolved.
 *  Returns array of { field, token, reason } for anything unrenderable. */
function findUnresolvedTokens(row, knownTokens = new Set()) {
    const issues = [];

    /**
     * Detect [IMG: ...] placeholder text — this means the Excel cell has a text
     * description of an image that should be there but was never actually embedded.
     * Patterns: "[IMG: pos_circle_md_top_left]", "[IMG:some_token]", "IMG: token"
     */
    function isImgPlaceholderText(s) {
        if (!s) return false;
        // Matches: [IMG: ...], [IMG:...], IMG: ..., (IMG: ...)
        return /\[IMG\s*:/i.test(s) || /^\s*IMG\s*:/i.test(s);
    }

    function checkField(fieldName, val) {
        if (!val) return;
        const s = String(val).trim();

        // ── [IMG: ...] placeholder — image was never embedded in the Excel cell ──
        if (isImgPlaceholderText(s)) {
            // Extract the token name from inside the brackets for a helpful message
            const match = s.match(/\[?IMG\s*:\s*([^\]]+)\]?/i);
            const tokenHint = match ? match[1].trim() : s;
            issues.push({
                field: fieldName,
                token: s,
                reason: `Image not embedded: cell contains placeholder text "${s}" — please insert the actual image into the Excel cell`,
            });
            return;
        }

        let parts;
        if (s.includes('→'))       parts = s.split(/\s*→\s*/);
        else if (s.includes('::')) parts = s.split(/\s*::\s*/).flatMap(h => h.split(/\s*:\s*/));
        else if (s.includes('|'))  parts = s.split(/\s*\|\s*/);
        else                       parts = [s];

        for (const raw of parts) {
            const token = raw.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
            if (!token || token === '?') continue;

            // If this exact token string is registered in DB/manifest → always valid
            if (knownTokens.has(token) || knownTokens.has(token.toLowerCase())) continue;

            // Also check sanitized form — handles tokens like "Reflection: horizontal reflection"
            // that were uploaded as "reflection_horizontal_reflection" in the manifest
            const sanitizedToken = token.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
            if (knownTokens.has(sanitizedToken)) continue;

            const result = validateTokenServer(token);
            if (!result.valid) {
                issues.push({ field: fieldName, token, reason: result.reason });
            }
        }
    }

    checkField('Stimulus Row 1', row.stimulusRow1);
    checkField('Stimulus Row 2', row.stimulusRow2);
    checkField('Option A',       row.optionA);
    checkField('Option B',       row.optionB);
    checkField('Option C',       row.optionC);

    // ── Dedicated image columns: if they have text but no excel_img: token,
    //    the image was never embedded — flag it ──────────────────────────────
    const imgFields = [
        { field: 'Stim1 Image',   val: row.stim1Image },
        { field: 'Stim2 Image',   val: row.stim2Image },
        { field: 'OptionA Image', val: row.optAImage },
        { field: 'OptionB Image', val: row.optBImage },
        { field: 'OptionC Image', val: row.optCImage },
    ];
    for (const { field, val } of imgFields) {
        if (!val) continue;
        const s = String(val).trim();
        if (s && !s.startsWith('excel_img:')) {
            issues.push({
                field,
                token: s,
                reason: `Image not embedded: "${s}" is a text placeholder — insert the actual image into the Excel cell`,
            });
        }
    }

    return issues;
}

/**
 * checkMissingImages(row)
 *
 * After image-first rendering has resolved all stimulus/option fields to
 * excel_img: tokens, verify that every referenced file actually exists in
 * customDir.  Returns an array of missing-file descriptors:
 *   [{ field: 'Option A', filename: 'symbol_matching/Gs_B1_002_opt_A.svg' }, ...]
 *
 * Only checks tokens that start with "excel_img:".  Plain text options
 * (e.g. "Same" / "Different" in timed-comparison items) are ignored.
 */
function checkMissingImages(row) {
    const missing = [];
    const isGwm = (row.domain || '').toLowerCase().trim() === 'gwm';

    const fields = [
        { label: 'Stimulus',       val: row.stimulusRow1 },
        { label: 'Stimulus Row 2', val: row.stimulusRow2 },
        { label: 'Option A',       val: row.optionA },
        { label: 'Option B',       val: row.optionB },
        { label: 'Option C',       val: row.optionC },
        { label: 'Option D',       val: row.optionD },
    ];

    const IMAGE_EXT = /\.(svg|png|jpg|jpeg|webp)$/i;

    for (const { label, val } of fields) {
        if (!val) continue;
        const s = String(val).trim();

        if (s.startsWith('excel_img:')) {
            const filename = s.slice('excel_img:'.length);

            // GWM images live in gwm_svg/ subfolder.
            // If the token has no folder prefix yet, normalise it to gwm_svg/<filename>
            // so the error message tells the user exactly where to put the file.
            let checkFilename = filename;
            if (isGwm && !filename.includes('/') && !filename.includes('\\')) {
                checkFilename = `gwm_svg/${filename}`;
            }

            const fullPath = path.join(customDir, checkFilename);
            const exists = fs.existsSync(fullPath);
            // Check if alternate extension exists
            const ext = path.extname(checkFilename);
            const altExt = ext === '.svg' ? '.png' : '.svg';
            const altPath = fullPath.replace(new RegExp(ext.replace('.', '\\.') + '$'), altExt);
            const altExists = fs.existsSync(altPath);
            console.log(`[checkMissingImages] ${label}: ${fullPath} → ${exists ? 'FOUND ✓' : 'MISSING ✗'}`);
            if (!exists) {
                let hint;
                if (altExists) {
                    hint = `File not found as ${ext} but exists as ${altExt} at: ${altPath}. Rename or re-export.`;
                } else {
                    const folder = path.dirname(checkFilename);
                    hint = `File not found. Expected at: public/custom/${checkFilename}. Upload a ${ext.slice(1).toUpperCase()} or ${altExt.slice(1).toUpperCase()} file to the "${folder}/" folder.`;
                }
                missing.push({ field: label, filename: checkFilename, fullPath, hint });
            }

        } else if (s.startsWith('img_')) {
            // img_ token — must resolve to a .svg or .png in the custom folder
            const base = s.slice('img_'.length);
            const svgPath = path.join(customDir, base + '.svg');
            const pngPath = path.join(customDir, base + '.png');
            const svgOk = fs.existsSync(svgPath);
            const pngOk = fs.existsSync(pngPath);
            console.log(`[checkMissingImages] ${label}: checked ${svgPath} → ${svgOk ? 'FOUND ✓' : 'MISSING'}, ${pngPath} → ${pngOk ? 'FOUND ✓' : 'MISSING'}`);
            if (!svgOk && !pngOk) {
                missing.push({
                    field: label, filename: base + '.svg', fullPath: svgPath,
                    hint: `No .svg or .png found for token "${s}". Expected at: public/custom/${base}.svg or .png`,
                });
            }

        } else if (IMAGE_EXT.test(s) && (s.includes('/') || s.includes('\\'))) {
            // Explicit relative path with image extension
            const fullPath = path.join(customDir, s);
            const exists = fs.existsSync(fullPath);
            console.log(`[checkMissingImages] ${label}: ${fullPath} → ${exists ? 'FOUND ✓' : 'MISSING ✗'}`);
            if (!exists) {
                missing.push({
                    field: label, filename: s, fullPath,
                    hint: `File not found at: public/custom/${s}. Upload the file to this location.`,
                });
            }

        } else if (isGwm && IMAGE_EXT.test(s)) {
            // GWM bare image filename (no folder prefix) — check in gwm_svg/
            const checkFilename = `gwm_svg/${s}`;
            const fullPath = path.join(customDir, checkFilename);
            const exists = fs.existsSync(fullPath);
            console.log(`[checkMissingImages] ${label} (GWM bare): ${fullPath} → ${exists ? 'FOUND ✓' : 'MISSING ✗'}`);
            if (!exists) {
                missing.push({
                    field: label,
                    filename: checkFilename,
                    fullPath,
                    hint: `Upload to public/custom/gwm_svg/${s}`,
                });
            }
        }
        // plain text option (letters, digits, words) — skip
    }

    return missing;  // [] = all files present
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/items/upload  ── Excel bulk upload (v2 format)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/upload', authenticate, requireRole('super_admin', 'psychologist'), upload.single('file'), async (req, res) => {

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // ── Resolve target sources for this upload ──
    // Request can pass `sourceIds` as a JSON array string (multipart form-data),
    // OR a single `sourceId`. Super admins can target any sources;
    // others are locked to their own source.
    const isSuper = req.user.role === 'super_admin';
    const ownSource = req.user.organization_id || req.user.organizationId || null;
    let targetSourceIds = [];
    try {
        if (req.body.sourceIds) {
            targetSourceIds = typeof req.body.sourceIds === 'string'
                ? JSON.parse(req.body.sourceIds)
                : req.body.sourceIds;
        } else if (req.body.sourceId) {
            targetSourceIds = [req.body.sourceId];
        } else {
            // Fallback: honour the X-Source-Id header the frontend sends from the source selector
            const hdr = req.headers['x-source-id'];
            if (hdr && hdr !== 'all') targetSourceIds = [hdr];
        }
    } catch (_) { targetSourceIds = []; }

    if (!isSuper) {
        // Non-super admins can only upload to their own source — ignore any other selection
        targetSourceIds = ownSource ? [ownSource] : [];
    } else if (targetSourceIds.length === 0 && ownSource) {
        // Super admin with no selection: default to their own source
        targetSourceIds = [ownSource];
    }
    // If still empty (super admin with no organization), default to first source
    if (targetSourceIds.length === 0) {
        const firstSource = await pool.query('SELECT id FROM sources ORDER BY created_at ASC LIMIT 1');
        if (firstSource.rows.length) targetSourceIds = [firstSource.rows[0].id];
    }

    try {
        const workbook = XLSX.readFile(req.file.path);
        console.log('workbook.SheetNames', workbook.SheetNames);

        const rows = readRowsFromWorkbook(workbook);
        console.log(`Parsed ${rows.length} item rows from workbook`);

        // ── Extract embedded images (if any) from the xlsx ZIP ─────────────
        // Produces a Map: "row_col" (1-based) => { localPath, filename }
        const uploadBase = path.basename(req.file.originalname, path.extname(req.file.originalname))
            .replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 20);
        const imgFilePrefix = `${uploadBase}_${Date.now()}`;
        const embeddedImages = extractExcelImages(req.file.path, imgFilePrefix);

        // ── Determine which Excel columns correspond to image columns ───────
        // We need to map 'Stim1 Image', 'Stim2 Image', etc. to their 1-based column index.
        // Re-read the workbook sheet headers to get column index mapping.
        const imgColMap = {}; // colName → 1-based col index (across all sheets)
        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
            for (let ri = 0; ri < rawRows.length; ri++) {
                const hasItemId = (rawRows[ri] || []).some(v => v !== null && String(v).trim().toLowerCase() === 'item id');
                if (hasItemId) {
                    (rawRows[ri] || []).forEach((name, idx) => {
                        if (name) imgColMap[String(name).trim()] = idx + 1; // 1-based
                    });
                    break;
                }
            }
            if (Object.keys(imgColMap).length > 0) break;
        }

        // ── Attach image tokens to rows ────────────────────────────────────
        // Check BOTH dedicated image columns AND the direct content columns.
        // If an image is embedded in a Stimulus Row 1 / Option A / etc. cell directly,
        // it will be picked up here and the field set to "excel_img:{filename}".
        const IMG_FIELD_COLS = [
            // Universal template image columns
            { col: 'Stim1 Image',   contentField: 'stimulusRow1' },
            { col: 'Stim2 Image',   contentField: 'stimulusRow2' },
            { col: 'OptA Image',    contentField: 'optionA' },
            { col: 'OptB Image',    contentField: 'optionB' },
            { col: 'OptC Image',    contentField: 'optionC' },
            { col: 'OptD Image',    contentField: 'optionD' },
            // Legacy image column names (older uploads)
            { col: 'OptionA Image', contentField: 'optionA' },
            { col: 'OptionB Image', contentField: 'optionB' },
            { col: 'OptionC Image', contentField: 'optionC' },
            // Direct content columns — images embedded straight in the cell
            { col: 'Stimulus Row 1', contentField: 'stimulusRow1' },
            { col: 'Stimulus Row 2', contentField: 'stimulusRow2' },
            { col: 'Option A',       contentField: 'optionA' },
            { col: 'Option B',       contentField: 'optionB' },
            { col: 'Option C',       contentField: 'optionC' },
            { col: 'Option D',       contentField: 'optionD' },
        ];

        if (embeddedImages.size > 0) {
            for (const row of rows) {
                const excelRow = row._excelRow;
                for (const { col, contentField } of IMG_FIELD_COLS) {
                    const colIdx = imgColMap[col];
                    if (!colIdx) continue;
                    const key = `${excelRow}_${colIdx}`;
                    const imgInfo = embeddedImages.get(key);
                    if (imgInfo) {
                        row[contentField] = `excel_img:${imgInfo.filename}`;
                    }
                }
            }
            console.log(`[upload] Attached excel_img: tokens to rows from ${embeddedImages.size} extracted images`);
        }

        // ── Image-first rendering: resolve ALL stimulus & option fields to excel_img: tokens ────
        //
        // Design principle: shape/stimulus images always come from  public/custom/<filename>
        // in the frontend — NOT from SVG code or sprite sheets.
        //
        // Resolution priority per field:
        //   1. Explicit "Stim1 Img Ref" / "OptA Img Ref" column value  (excel_img:filename)
        //   2. Auto-generated from Item ID                              (excel_img:Gf_B1_001_stim.png)
        //   3. Token string from "Stimulus Row 1" / "Option A" columns → IGNORED (SVG-free)
        //
        // The token strings from the Stimulus Row 1 / Option A columns are intentionally
        // overridden — they were the old SVG/sprite-sheet rendering path.
        // The new path is always: excel_img:<filename>  →  /custom/<filename>  →  <img> tag.
        // ──────────────────────────────────────────────────────────────────────────────────────
        for (const row of rows) {
            const id = row.itemId;
            if (!id) continue;

            // Gc is fully text-based — no image files exist, skip all image resolution.
            // sequential displayMode (gwm digit/word/letter span) uses pipe-delimited text
            // sequences as stimuli and plain letter/digit options — no image files.
            // EXCEPTION: GWM items use sequential displayMode for ALL items (including
            // visual_memory_span and sequence_recall which DO have image files).
            // We let GWM through so explicit image-ref columns get resolved; the
            // auto-generate helpers already guard against text-only rows (they only
            // set excel_img: if the file exists on disk).
            const domainLower = (row.domain || '').toLowerCase().trim();
            const displayModeLower = (row.displayMode || '').toLowerCase().trim();
            // Practice items: resolve images if they have Stim1 Img Ref columns, skip only text-only practice
            const rowIsPractice = row.isPractice === true || row.isPractice === 'TRUE' || row.isPractice === 'true'
                || (row.itemType && String(row.itemType).toLowerCase().trim() === 'practice');
            if (rowIsPractice && !row.stim1Image && !row.optAImage) continue;
            if (domainLower === 'gc') continue;
            if (domainLower !== 'gwm' && (
                displayModeLower === 'text'
                || displayModeLower === 'text_passage'
                || displayModeLower === 'sequential')) continue;

            const base = id.trim(); // e.g. "Gf_B1_001"

            // Determine image subfolder:
            // - Gf items → gf/{template}/{itemNum}/  (nested: domain/template/item#/)
            // - Gq visual items → always use 'gq_visual/'
            // - Gwm visual items → always use 'gwm_svg/'
            // - All others → derive from Template column (lowercased, spaces→underscores)
            const templateSlug = row.template
                ? String(row.template).trim().toLowerCase().replace(/\s+/g, '_')
                : '';
            // Extract item sequence number from item ID (e.g. "Gf_B1_023" → "23")
            const itemNumMatch = base.match(/_(\d+)$/);
            const itemNum = itemNumMatch ? String(parseInt(itemNumMatch[1], 10)) : null;

            let dmFolder;
            let useSimpleNames = false; // true = stim.svg/optA.svg instead of Gf_B1_023_stim.svg
            if (domainLower === 'gf' && templateSlug) {
                dmFolder = `gf/${templateSlug}/`;
            } else if (domainLower === 'gq') {
                dmFolder = 'gq_visual/';
            } else if (domainLower === 'gwm') {
                dmFolder = 'gwm_svg/';
            } else {
                dmFolder = templateSlug ? templateSlug + '/' : '';
            }

            // Ensure the folder exists on disk
            const dmFolderAbs = path.join(customDir, dmFolder);
            if (dmFolder && !fs.existsSync(dmFolderAbs)) {
                fs.mkdirSync(dmFolderAbs, { recursive: true });
            }

            // Helper: pick explicit ref if it looks like an excel_img: token, else auto-generate.
            // For Gf items with useSimpleNames, filenames are just stim.svg, optA.svg etc.
            // For others, filenames are {base}_{suffix}.ext (e.g. Gs_B1_001_stim.svg)
            const OPT_ALT = { optA: 'opt_A', optB: 'opt_B', optC: 'opt_C' };
            const resolveRef = (imgField, suffix) => {
                const explicit = row[imgField];
                if (explicit && String(explicit).trim().startsWith('excel_img:')) {
                    const val = String(explicit).trim();
                    const filename = val.slice('excel_img:'.length);
                    if (dmFolder && !filename.includes('/')) {
                        return `excel_img:${dmFolder}${filename}`;
                    }
                    return val;
                }

                // Gf nested structure: check simple names first (stim.svg, optA.svg)
                if (useSimpleNames) {
                    for (const ext of ['.svg', '.png']) {
                        const simpleFile = path.join(customDir, dmFolder, `${suffix}${ext}`);
                        if (fs.existsSync(simpleFile)) return `excel_img:${dmFolder}${suffix}${ext}`;
                    }
                }

                // Legacy/other domains: check {base}_{suffix} naming
                const altSuffix = OPT_ALT[suffix];
                for (const ext of ['.png', '.svg']) {
                    if (altSuffix) {
                        const altFile = path.join(customDir, dmFolder, `${base}_${altSuffix}${ext}`);
                        if (fs.existsSync(altFile)) return `excel_img:${dmFolder}${base}_${altSuffix}${ext}`;
                    }
                    const canonFile = path.join(customDir, dmFolder, `${base}_${suffix}${ext}`);
                    if (fs.existsSync(canonFile)) return `excel_img:${dmFolder}${base}_${suffix}${ext}`;
                }

                // Default: use simple name for Gf, legacy name for others
                if (useSimpleNames) return `excel_img:${dmFolder}${suffix}.svg`;
                return `excel_img:${dmFolder}${base}_${suffix}.png`;
            };

            // Helper: if a content column (stimulusRow1, optionA, …) already holds an
            // excel_img: token as plain text, normalise it with the domain subfolder.
            const normaliseInlineToken = (fieldVal) => {
                if (!fieldVal) return fieldVal;
                const s = String(fieldVal).trim();
                if (!s.startsWith('excel_img:')) return fieldVal; // not an image token
                const filename = s.slice('excel_img:'.length);
                if (dmFolder && !filename.includes('/')) {
                    return `excel_img:${dmFolder}${filename}`;
                }
                return s;
            };

            // Stimulus row 1 — prefer explicit image-column ref; fall back to inline token
            // in the content cell; finally auto-generate (only if file exists on disk).
            // Never replace plain text sequences like "3 | 7" with a broken image ref.
            const stim1Explicit = row.stim1Image && String(row.stim1Image).trim().startsWith('excel_img:');
            const stim1InlineToken = row.stimulusRow1 && String(row.stimulusRow1).trim().startsWith('excel_img:');
            if (stim1Explicit) {
                row.stimulusRow1 = resolveRef('stim1Image', 'stim');
            } else if (stim1InlineToken) {
                // Cell itself contains excel_img: — normalise folder and use as-is
                row.stimulusRow1 = normaliseInlineToken(row.stimulusRow1);
            } else {
                // Auto-generated path: only use if the file actually exists on disk
                const resolvedStim1 = resolveRef('stim1Image', 'stim');
                const stim1Filename = resolvedStim1.slice('excel_img:'.length);
                const stim1Path = path.join(customDir, stim1Filename);
                const stim1Exists = fs.existsSync(stim1Path) ||
                    fs.existsSync(stim1Path.replace(/\.\w+$/, '.svg')) ||
                    fs.existsSync(stim1Path.replace(/\.\w+$/, '.png'));
                if (stim1Exists) {
                    row.stimulusRow1 = resolvedStim1;
                }
                // else: keep original text value from Excel (e.g. "3 | 7" for Gwm)
            }

            // Stimulus row 2 — same pattern
            const stim2Explicit = row.stim2Image && String(row.stim2Image).trim().startsWith('excel_img:');
            const stim2InlineToken = row.stimulusRow2 && String(row.stimulusRow2).trim().startsWith('excel_img:');
            if (stim2Explicit) {
                row.stimulusRow2 = String(row.stim2Image).trim();
            } else if (stim2InlineToken) {
                row.stimulusRow2 = normaliseInlineToken(row.stimulusRow2);
            }
            // else: keep original text value from Excel

            // Helper: resolve an option field.
            // Priority: explicit img-ref column → inline excel_img: in content cell → auto-generate.
            const resolveOptRef = (imgField, suffix, originalVal) => {
                const explicit = row[imgField];
                // Explicit image ref column → always use it
                if (explicit && String(explicit).trim().startsWith('excel_img:')) {
                    return resolveRef(imgField, suffix);
                }
                // Content cell itself already has an excel_img: token → normalise folder
                if (originalVal && String(originalVal).trim().startsWith('excel_img:')) {
                    return normaliseInlineToken(originalVal);
                }
                // Auto-generated path: check both .png and .svg variants
                const altSuffix = OPT_ALT[suffix];
                for (const ext of ['.png', '.svg']) {
                    if (altSuffix) {
                        const altFile = path.join(customDir, dmFolder, `${base}_${altSuffix}${ext}`);
                        if (fs.existsSync(altFile)) return `excel_img:${dmFolder}${base}_${altSuffix}${ext}`;
                    }
                    const canonFile = path.join(customDir, dmFolder, `${base}_${suffix}${ext}`);
                    if (fs.existsSync(canonFile)) return `excel_img:${dmFolder}${base}_${suffix}${ext}`;
                }
                // File doesn't exist — keep the original text/token value from the Excel
                // (the GWM shape-token sweep after this loop will catch any remaining
                //  obj:/shape tokens and force them to excel_img: for validation)
                return originalVal || null;
            };

            // Options A, B, C — use image if file exists, otherwise preserve text value
            row.optionA = resolveOptRef('optAImage', 'optA', row.optionA);
            row.optionB = resolveOptRef('optBImage', 'optB', row.optionB);
            row.optionC = resolveOptRef('optCImage', 'optC', row.optionC);

            // Option D — 4-choice items only; keep null if no ref and no existing token
            if (row.optDImage && String(row.optDImage).trim().startsWith('excel_img:')) {
                row.optionD = String(row.optDImage).trim();
            } else if (row.optionD && String(row.optionD).trim().startsWith('excel_img:')) {
                // already resolved (e.g. embedded image attached earlier)
            } else {
                row.optionD = null; // no image ref → not a 4-choice item
            }

            // ── LOG resolved filenames for cross-checking ──
            console.log(`[IMG-RESOLVE] ${row.itemId} | template="${row.template || '—'}" | folder="${dmFolder || '(root)'}"` +
                `\n    stim1: ${row.stimulusRow1}` +
                `\n    stim2: ${row.stimulusRow2 || '(none)'}` +
                `\n    optA:  ${row.optionA}` +
                `\n    optB:  ${row.optionB}` +
                `\n    optC:  ${row.optionC}` +
                (row.optionD ? `\n    optD:  ${row.optionD}` : ''));
        }

        // ── GWM: force all visual content to use image refs from custom folder ──
        // GWM visual items (visual_memory_span, sequence_recall) must render ALL
        // content from image files in public/custom/gwm_svg/ — never from
        // code-rendered shapes.  After the image-resolution loop above, any field
        // that still contains a shape/obj token (e.g. "obj:circle", "circle_md")
        // means the corresponding image file was NOT found.  Force these to
        // excel_img: tokens so downstream validation catches the missing file and
        // blocks the upload instead of silently storing a code-render token.
        //
        // Detection: shape tokens contain "obj:", "_md", "_lg", "_sm" suffixes,
        // or match known shape names.  Plain text (digits, words, letters,
        // pipe-delimited sequences like "3 | 7") is left untouched.
        const GWM_IMAGE_EXT   = /\.(svg|png|jpg|jpeg|webp)$/i;
        const GWM_SHAPE_TOKEN = /(?:^obj:|_md$|_lg$|_sm$|^circle$|^square$|^triangle$|^star$|^diamond$|^hexagon$|^pentagon$|^heart$|^oval$|^rectangle$|^cross$|^arrow$|^crescent$|^octagon$)/i;
        const GWM_FIELD_SUFFIX = {
            stimulusRow1: 'stim', stimulusRow2: 'stim2',
            optionA: 'optA', optionB: 'optB', optionC: 'optC', optionD: 'optD',
        };

        for (const row of rows) {
            const domLower = (row.domain || '').toLowerCase().trim();
            if (domLower !== 'gwm') continue;

            const base = String(row.itemId || '').trim();
            const contentFields = ['stimulusRow1', 'stimulusRow2', 'optionA', 'optionB', 'optionC', 'optionD'];
            for (const field of contentFields) {
                if (!row[field]) continue;
                const val = String(row[field]).trim();

                // Already resolved — nothing to do
                if (val.startsWith('excel_img:') || val.startsWith('img_')) continue;

                // Bare image filename (e.g. "Gwm_B1_045_stim.svg")
                if (GWM_IMAGE_EXT.test(val)) {
                    const filename = val.includes('/') || val.includes('\\') ? val : `gwm_svg/${val}`;
                    row[field] = `excel_img:${filename}`;
                    console.log(`[GWM-IMG-DETECT] ${row.itemId}.${field}: bare filename "${val}" → "excel_img:${filename}"`);
                    continue;
                }

                // Shape / obj token that should have been resolved to an image —
                // the image-resolution loop above didn't find a file on disk.
                // Check individual tokens (pipe-delimited stimuli may have multiple)
                const tokens = val.split('|').map(t => t.trim()).filter(Boolean);
                const hasShapeToken = tokens.some(t => GWM_SHAPE_TOKEN.test(t));
                if (hasShapeToken) {
                    // Force to excel_img: so validation catches the missing file
                    const suffix = GWM_FIELD_SUFFIX[field] || field;
                    const forced = `excel_img:gwm_svg/${base}_${suffix}.png`;
                    row[field] = forced;
                    console.log(`[GWM-IMG-FORCE] ${row.itemId}.${field}: shape token "${val}" → "${forced}" (image required, not code-render)`);
                }
            }
        }

        // ── Validate before inserting ──────────────────────────────────────
        const preview = { total: rows.length, valid: 0, errors: [], sample: [] };

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const errs = [];

            if (!row.itemId)    errs.push('Missing Item ID');
            if (!row.template)  errs.push('Missing Template');
            if (!row.optionA)   errs.push('Missing Option A');
            const hasCorrectInfo = (row.correctIdx !== undefined && row.correctIdx !== null && row.correctIdx !== '')
                || (row.correctIdx0b !== undefined && row.correctIdx0b !== null && row.correctIdx0b !== '')
                || (row.correctAns && String(row.correctAns).trim() !== '');
            if (!hasCorrectInfo)
                errs.push('Missing Correct Idx');

            // ── SVG / image file existence check ────────────────────────────
            // Every image reference (excel_img:, img_, or path) must resolve to a
            // file that actually exists in the custom folder.  Items with missing
            // files are rejected with a clear error so the user knows what to upload.
            // Skip only for genuinely text-only items (gc, or sequential displayMode).
            const previewDomain = (row.domain || '').toLowerCase().trim();
            const previewDisplay = (row.displayMode || '').toLowerCase().trim();
            const previewIsPractice = row.isPractice === true || row.isPractice === 'TRUE' || row.isPractice === 'true'
                || (row.itemType && String(row.itemType).toLowerCase().trim() === 'practice');
            // If any field contains an excel_img: token, always validate regardless of displayMode —
            // visual GWM items have displayMode=sequential but still reference real SVG files.
            const previewHasImgToken = [row.stimulusRow1, row.stimulusRow2, row.optionA, row.optionB, row.optionC, row.optionD]
                .some(v => v && String(v).trim().startsWith('excel_img:'));
            const skipPreviewImages = previewIsPractice || (!previewHasImgToken && (
                previewDomain === 'gc'
                || previewDisplay === 'text'
                || previewDisplay === 'text_passage'
                || previewDisplay === 'sequential'));
            const missingFiles = skipPreviewImages ? [] : checkMissingImages(row);
            for (const { field, filename, fullPath, hint } of missingFiles) {
                const where = hint || 'upload this SVG/image to the Shape Library first';
                errs.push(`Missing image file (${field}): "${filename}" — checked path: ${fullPath} — ${where}`);
            }

            if (errs.length > 0) {
                preview.errors.push({ row: i + 3, itemId: row.itemId, errors: errs }); // +3 because data starts at Excel row 3
            } else {
                preview.valid++;
            }

            if (i < 5) preview.sample.push(row);
        }

        // Return preview if confirm flag not set
        if (!req.body.confirm || req.body.confirm !== 'true') {
            return res.json({
                message: 'Preview — send with confirm=true to import',
                preview
            });
        }

        // ── Actually import ────────────────────────────────────────────────
        let inserted = 0, updated = 0, errors = 0, skipped = 0;
        const skippedItems = [];   // items stored as pending (unresolvable tokens)

        // ── Load all known tokens from DB + sprite manifest ────────────────
        // This lets us accept any token that has already been registered,
        // even if it looks like a template placeholder (e.g. "Spatial sequence: movement pattern"
        // mapped to a custom sprite PNG).
        const knownTokens = new Set();
        try {
            // 1. Custom SVG shapes from DB
            const svgRows = await pool.query(`SELECT shape_name FROM custom_svg_shapes WHERE is_active = true`);
            svgRows.rows.forEach(r => knownTokens.add(r.shape_name));

            // 2. Sprite manifest tokens (custom PNGs)
            const FE_PUBLIC     = path.join(__dirname, '../../../cognimap-fe-main/public');
            const MANIFEST_PATH = path.join(FE_PUBLIC, 'sprites/shapes-manifest.json');
            if (fs.existsSync(MANIFEST_PATH)) {
                const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
                Object.keys(manifest.tokens || {}).forEach(k => knownTokens.add(k));
            }
        } catch (e) {
            console.warn('Could not load known tokens for validation:', e.message);
        }

        for (const row of rows) {
            if (!row.itemId || !row.template) { errors++; continue; }

            // Skip image validation only for genuinely text-only items:
            //   gc       — always text/token based
            //   gwm sequential displayMode — digit/word/letter spans (text sequences)
            //   gwm visual_memory_span / sequence_recall — DO have image files, validate them
            const domainLower = (row.domain || '').toLowerCase().trim();
            const displayModeLower = (row.displayMode || '').toLowerCase().trim();
            const isTextOnlyDomain = domainLower === 'gc';
            const isTextOnlyDisplay = displayModeLower === 'text' || displayModeLower === 'text_passage' || displayModeLower === 'sequential';
            // Practice items use text options — skip all image validation
            const isPracticeItem = row.isPractice === true || row.isPractice === 'TRUE' || row.isPractice === 'true'
                || (row.itemType && String(row.itemType).toLowerCase().trim() === 'practice');
            // Override: if ANY field actually contains an excel_img: token after resolution,
            // always validate — visual GWM items use displayMode=sequential in the Excel
            // but still reference real SVG files that must exist.
            const hasExcelImgToken = [row.stimulusRow1, row.stimulusRow2, row.optionA, row.optionB, row.optionC, row.optionD]
                .some(v => v && String(v).trim().startsWith('excel_img:'));
            const skipImageValidation = isPracticeItem || (!hasExcelImgToken && (isTextOnlyDomain || isTextOnlyDisplay));

            // ── SVG / image file existence check ────────────────────────────
            // If ANY required image file is missing from the custom SVG directory,
            // treat the item as unresolved — do not insert it.
            const missingImages = skipImageValidation ? [] : checkMissingImages(row);
            if (missingImages.length > 0) {
                skipped++;
                const missingTokens = missingImages.map(m => ({
                    field: m.field,
                    token: `excel_img:${m.filename}`,
                    reason: m.hint
                        ? `File not found: "${m.filename}" — checked: ${m.fullPath} — ${m.hint}`
                        : `File not found: "${m.filename}" — checked: ${m.fullPath} — upload this file to the Shape Library before re-importing`,
                }));
                const skipReason = missingTokens.map(u => `${u.field}: ${u.reason}`).join('; ');
                skippedItems.push({ itemId: row.itemId, excelRow: row._excelRow, skipReason, unresolvedTokens: missingTokens });
                try {
                    await pool.query(`
                        INSERT INTO pending_items
                            (item_code, domain, source_file, raw_data, unresolved_tokens, skip_reason, status, created_by)
                        VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)
                        ON CONFLICT (item_code) DO UPDATE SET
                            unresolved_tokens = EXCLUDED.unresolved_tokens,
                            skip_reason       = EXCLUDED.skip_reason,
                            raw_data          = EXCLUDED.raw_data,
                            source_file       = EXCLUDED.source_file,
                            status            = 'pending',
                            updated_at        = NOW()
                    `, [
                        row.itemId,
                        (row.domain || '').toLowerCase(),
                        req.file.originalname,
                        JSON.stringify(row),
                        JSON.stringify(missingTokens),
                        skipReason,
                        req.user.id,
                    ]);
                } catch (pendErr) {
                    console.error(`pending_items insert error for missing-image item (${row.itemId}):`, pendErr.message);
                }
                continue;  // do NOT insert into items table
            }

            // ── Token validation: skip items whose visual content can't render ──
            const unresolvedTokens = skipImageValidation ? [] : findUnresolvedTokens(row, knownTokens);
            if (unresolvedTokens.length > 0) {
                skipped++;
                const skipReason = unresolvedTokens.map(u => `${u.field}: ${u.reason}`).join('; ');
                skippedItems.push({ itemId: row.itemId, excelRow: row.excelRow, skipReason, unresolvedTokens });
                // Upsert into pending_items so Token Manager can display them
                try {
                    await pool.query(`
                        INSERT INTO pending_items
                            (item_code, domain, source_file, raw_data, unresolved_tokens, skip_reason, status, created_by)
                        VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)
                        ON CONFLICT (item_code) DO UPDATE SET
                            unresolved_tokens = EXCLUDED.unresolved_tokens,
                            skip_reason       = EXCLUDED.skip_reason,
                            raw_data          = EXCLUDED.raw_data,
                            source_file       = EXCLUDED.source_file,
                            status            = 'pending',
                            updated_at        = NOW()
                    `, [
                        row.itemId,
                        (row.domain || '').toLowerCase(),
                        req.file.originalname,
                        JSON.stringify(row),
                        JSON.stringify(unresolvedTokens),
                        skipReason,
                        req.user.id,
                    ]);
                } catch (pendErr) {
                    console.error(`pending_items insert error (${row.itemId}):`, pendErr.message);
                }
                continue;  // do NOT insert into items table
            }

            try {
                // Convert to 0-based: handles 1-based "Correct Idx", 0-based "Correct Idx (0b)", or letter "Correct Ans"
                const correctIdx0 = parseCorrectIdx(row.correctIdx, row.correctIdx0b, row.correctAns);

                // ── Per-option scoring from universal template ─────────────
                const baseScore = (row.baseScore !== undefined && row.baseScore !== null && row.baseScore !== '')
                    ? parseFloat(row.baseScore) : 1;
                const rawOptionScores = [
                    row.scoreA !== undefined && row.scoreA !== null && row.scoreA !== '' ? parseFloat(row.scoreA) : null,
                    row.scoreB !== undefined && row.scoreB !== null && row.scoreB !== '' ? parseFloat(row.scoreB) : null,
                    row.scoreC !== undefined && row.scoreC !== null && row.scoreC !== '' ? parseFloat(row.scoreC) : null,
                    row.scoreD !== undefined && row.scoreD !== null && row.scoreD !== '' ? parseFloat(row.scoreD) : null,
                ];
                const equalDistribute =
                    row.equalDistribute === true ||
                    String(row.equalDistribute || '').toUpperCase() === 'TRUE';

                // ── Age-band weightage ─────────────────────────────────────
                const ageWeightage = {
                    standard: {
                        '6-7':   row.wtAge6_7   != null ? parseFloat(row.wtAge6_7)   : 1.0,
                        '8-9':   row.wtAge8_9   != null ? parseFloat(row.wtAge8_9)   : 1.0,
                        '10-11': row.wtAge10_11 != null ? parseFloat(row.wtAge10_11) : 1.0,
                        '12-13': row.wtAge12_13 != null ? parseFloat(row.wtAge12_13) : 1.0,
                        '14-15': row.wtAge14_15 != null ? parseFloat(row.wtAge14_15) : 1.0,
                        '16+':   row.wtAge16p   != null ? parseFloat(row.wtAge16p)   : 1.0,
                    },
                    positive: {
                        '6-7':   row.posWtAge6_7   != null ? parseFloat(row.posWtAge6_7)   : 1.0,
                        '8-9':   row.posWtAge8_9   != null ? parseFloat(row.posWtAge8_9)   : 1.0,
                        '10-11': row.posWtAge10_11 != null ? parseFloat(row.posWtAge10_11) : 1.0,
                        '12-13': row.posWtAge12_13 != null ? parseFloat(row.posWtAge12_13) : 1.0,
                        '14-15': row.posWtAge14_15 != null ? parseFloat(row.posWtAge14_15) : 1.0,
                        '16+':   row.posWtAge16p   != null ? parseFloat(row.posWtAge16p)   : 1.0,
                    },
                };

                // ── Build options array ────────────────────────────────────
                const rawOptions = [row.optionA, row.optionB, row.optionC, row.optionD];
                const options = rawOptions
                    .map((val, i) => {
                        if (val === null || val === undefined) return null;
                        const optScore = rawOptionScores[i] !== null ? rawOptionScores[i]
                            : (i === correctIdx0 ? baseScore : 0);
                        return {
                            value: String(val),
                            label: String(val),
                            tag:   i === correctIdx0 ? 'correct' : 'distractor',
                            score: optScore,
                        };
                    })
                    .filter(Boolean);

                // Age band: parse "8-10" → { min: 8, max: 10 }
                const ageBand = parseAgeBand(row.ageBand);

                // IRT parameters
                const irtA = (row.irtA !== undefined && row.irtA !== null && row.irtA !== '')
                    ? parseFloat(row.irtA) : null;
                const irtB = (row.irtB !== undefined && row.irtB !== null && row.irtB !== '')
                    ? parseFloat(row.irtB) : null;
                const irtC = (row.irtC !== undefined && row.irtC !== null && row.irtC !== '')
                    ? parseFloat(row.irtC) : 0.33;
                const irtCalibrated =
                    row.calibrated === true  ||
                    row.calibrated === 'TRUE' ||
                    row.calibrated === 'true';

                // CAT metadata
                const contentConstraint = row.contentConstraint || null;
                const enemyItems = row.enemyItems
                    ? String(row.enemyItems).split(',').map(s => s.trim()).filter(Boolean)
                    : [];
                // exposure_control is NUMERIC — extract plain number even if Excel cell has JSON like {"maxRate":0.2}
                let exposureControl = 1.0;
                if (row.exposureMax !== undefined && row.exposureMax !== null && row.exposureMax !== '') {
                    const raw = String(row.exposureMax).trim();
                    if (raw.startsWith('{')) {
                        try {
                            const obj = JSON.parse(raw);
                            const val = parseFloat(obj.maxRate ?? obj.max_rate ?? obj.rate);
                            if (!isNaN(val)) exposureControl = val;
                        } catch { /* not valid JSON, keep default */ }
                    } else {
                        const f = parseFloat(raw);
                        if (!isNaN(f)) exposureControl = f;
                    }
                }

                // Difficulty: map 'easy'/'medium'/'hard' → 1/2/3
                const difficultyLevel = parseDifficultyLevel(row.difficulty);

                // Domain: normalise to lowercase (e.g. 'Gf' → 'gf')
                const domain = (row.domain || req.body.domain || 'gf').toLowerCase();

                // Time limit
                const timeLim = row.timeSec ? parseInt(row.timeSec) : 20;

                // Timer mode: processing-speed domain uses hard timer
                const timerMode = domain === 'gs' ? 'hard' : 'soft';

                // Practice flag — set if "Practice?" column is true OR if "Item Type" column is "practice"
                const isPractice =
                    row.isPractice === true  ||
                    row.isPractice === 'TRUE' ||
                    row.isPractice === 'true' ||
                    (row.itemType && String(row.itemType).toLowerCase().trim() === 'practice');

                // Content JSON — carries all stimulus/option data + scoring for the render engine
                const content = {
                    // Stimulus fields
                    promptText:   row.promptText ? String(row.promptText).replace(/\bNaN\b/g, '').trim() || null : null,
                    stimulusRow1: row.stimulusRow1 || null,
                    stimulusRow2: row.stimulusRow2 || null,

                    // Presentation hints
                    display:      row.display     || null,
                    displayMode:  row.displayMode || null,
                    format:       row.format      || null,

                    // CHC / taxonomy metadata
                    narrowAbility: row.narrowAbility || null,
                    chcCode:       row.chcCode       || null,
                    ruleType:      row.ruleType      || null,
                    ruleDims:      row.ruleDims !== null && row.ruleDims !== undefined
                                       ? parseInt(row.ruleDims) : null,
                    subtype:       row.subtype       || null,
                    cogDevStage:   row.cogDevStage   || null,

                    // Options and answer
                    options,
                    correctIndex: correctIdx0,
                    correctAns:   row.correctAns || null,

                    // ── Universal scoring fields ────────────────────────────
                    baseScore,          // max score for the item
                    equalDistribute,    // whether to split base score equally
                    ageWeightage,       // { standard: {band: mult}, positive: {band: mult} }

                    // Diagnostic
                    distractorRationale: row.distractorRationale || null,
                };

                const result = await pool.query(`
                    INSERT INTO items (
                        item_code, domain, audience, difficulty_level,
                        age_band_min, age_band_max,
                        role, anchor_group, template, content,
                        time_limit_sec, timer_mode, is_practice,
                        irt_a, irt_b, irt_c, irt_calibrated,
                        content_constraint, enemy_items, exposure_control,
                        is_active, created_by
                    )
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                            $14,$15,$16,$17,$18,$19,$20,
                            true,$21)
                    ON CONFLICT (item_code)
                    DO UPDATE SET
                        template           = EXCLUDED.template,
                        content            = EXCLUDED.content,
                        time_limit_sec     = EXCLUDED.time_limit_sec,
                        timer_mode         = EXCLUDED.timer_mode,
                        difficulty_level   = EXCLUDED.difficulty_level,
                        age_band_min       = EXCLUDED.age_band_min,
                        age_band_max       = EXCLUDED.age_band_max,
                        is_practice        = EXCLUDED.is_practice,
                        irt_a              = EXCLUDED.irt_a,
                        irt_b              = EXCLUDED.irt_b,
                        irt_c              = EXCLUDED.irt_c,
                        irt_calibrated     = EXCLUDED.irt_calibrated,
                        content_constraint = EXCLUDED.content_constraint,
                        enemy_items        = EXCLUDED.enemy_items,
                        exposure_control   = EXCLUDED.exposure_control,
                        version            = items.version + 1
                    RETURNING id, (xmax = 0) AS is_insert
                `, [
                    row.itemId,
                    domain,
                    'student',           // audience — not in v2 sheet, default to student
                    difficultyLevel,
                    ageBand.min,
                    ageBand.max,
                    'core',              // role — not in v2 sheet, default to core
                    row.anchorGroup || null,
                    row.template,
                    JSON.stringify(content),
                    timeLim,
                    timerMode,
                    isPractice,
                    irtA, irtB, irtC, irtCalibrated,
                    contentConstraint,
                    enemyItems,
                    exposureControl,
                    req.user.id
                ]);

                if (result.rows[0].is_insert) inserted++;
                else updated++;

                // ── Link this item to all selected sources (multi-source) ──
                const itemId = result.rows[0].id;
                if (itemId && targetSourceIds.length > 0) {
                    for (const srcId of targetSourceIds) {
                        try {
                            await pool.query(
                                `INSERT INTO item_sources (item_id, source_id, added_by)
                                 VALUES ($1, $2, $3)
                                 ON CONFLICT (item_id, source_id) DO NOTHING`,
                                [itemId, srcId, req.user.id]
                            );
                        } catch (linkErr) {
                            console.warn(`item_sources link failed for item ${itemId} → source ${srcId}:`, linkErr.message);
                        }
                    }
                    // Also set the primary source_id on the item if it's not already set
                    try {
                        await pool.query(
                            `UPDATE items SET source_id = $1 WHERE id = $2 AND source_id IS NULL`,
                            [targetSourceIds[0], itemId]
                        );
                    } catch (_) {}
                }

                // Clean up any stale pending_items record for this item_code
                try {
                    await pool.query(
                        `DELETE FROM pending_items WHERE item_code = $1`,
                        [row.itemId]
                    );
                } catch (cleanErr) {
                    // Non-fatal: log but don't fail the upload
                    console.warn(`pending_items cleanup warning (${row.itemId}):`, cleanErr.message);
                }
            } catch (err) {
                console.error(`Row error (${row.itemId}):`, err.message);
                if (err.message.includes('invalid input syntax for type json')) {
                    // Log the actual content to diagnose the JSON issue
                    try {
                        const contentStr = JSON.stringify(content);
                        console.error(`  → content JSON length: ${contentStr.length}, starts: ${contentStr.substring(0, 200)}`);
                    } catch (jsonErr) {
                        console.error(`  → JSON.stringify itself failed:`, jsonErr.message);
                    }
                    console.error(`  → exposureControl type: ${typeof exposureControl}, value:`, exposureControl);
                    console.error(`  → enemyItems type: ${typeof enemyItems}, value:`, enemyItems);
                }
                errors++;
            }
        }

        await req.audit('item.bulk_upload', 'item', null, {
            description: `Bulk uploaded ${inserted + updated} items from ${req.file.originalname}`,
            inserted, updated, errors, filename: req.file.originalname
        });

        // ── Auto-create / refresh batteries ───────────────────────────────
        let batteryInfo = null;
        try {
            const domResult = await pool.query(`
                SELECT DISTINCT domain, MIN(age_band_min) as age_min, MAX(age_band_max) as age_max, COUNT(*) as item_count
                FROM items WHERE is_active = true AND is_practice = false
                GROUP BY domain ORDER BY domain
            `);
            const domains = domResult.rows;
            if (domains.length > 0) {
                const cogDomains  = domains.filter(d => ['gf','gv','gq','gc','gs','gwm'].includes(d.domain));
                const persDomains = domains.filter(d => d.domain === 'personality');
                const intDomains  = domains.filter(d => d.domain === 'interest');

                const batches = [];
                if (cogDomains.length > 0)  batches.push({ name: 'Cognitive Aptitude Assessment',       type: 'cognitive',    domains: cogDomains });
                if (persDomains.length > 0) batches.push({ name: 'Personality Assessment (Big Five)',   type: 'personality',  domains: persDomains });
                if (intDomains.length > 0)  batches.push({ name: 'Career Interest Assessment (RIASEC)', type: 'interest',     domains: intDomains });

                const DOMAIN_ORDER  = ['gf','gv','gq','gc','gs','gwm','personality','interest'];
                const DOMAIN_LABELS = { gf: 'Fluid Reasoning', gv: 'Visual Spatial', gq: 'Quantitative Reasoning', gc: 'Verbal Reasoning', gs: 'Processing Speed', gwm: 'Working Memory', personality: 'Personality', interest: 'Career Interest' };

                const createdBatteries = [];
                for (const batch of batches) {
                    const existing = await pool.query('SELECT id FROM test_batteries WHERE name = $1', [batch.name]);
                    let batteryId;
                    if (existing.rows.length) {
                        batteryId = existing.rows[0].id;
                        await pool.query('DELETE FROM battery_sections WHERE battery_id = $1', [batteryId]);
                    } else {
                        const br = await pool.query(
                            `INSERT INTO test_batteries (name, description, type, audience, is_active, created_by)
                             VALUES ($1, $2, 'preset', 'student', true, $3) RETURNING id`,
                            [batch.name, `Auto-generated from item upload (${batch.domains.map(d => d.domain).join(', ')})`, req.user.id]
                        );
                        batteryId = br.rows[0].id;
                    }
                    const sorted = batch.domains.sort((a, b) => DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain));
                    for (let i = 0; i < sorted.length; i++) {
                        await pool.query(
                            `INSERT INTO battery_sections (battery_id, name, domain, sort_order) VALUES ($1,$2,$3,$4)`,
                            [batteryId, DOMAIN_LABELS[sorted[i].domain] || sorted[i].domain, sorted[i].domain, i + 1]
                        );
                    }
                    createdBatteries.push({ id: batteryId, name: batch.name, sections: sorted.length });
                }
                batteryInfo = createdBatteries;
            }
        } catch (batErr) {
            console.error('Auto-battery creation error:', batErr);
            batteryInfo = { error: batErr.message };
        }

        // Patch orphan batteries that have no sections
        try {
            const orphanBatteries = await pool.query(`
                SELECT tb.id, tb.name FROM test_batteries tb
                WHERE tb.is_active = true
                  AND NOT EXISTS (SELECT 1 FROM battery_sections bs WHERE bs.battery_id = tb.id)
            `);
            if (orphanBatteries.rows.length > 0) {
                const activeDomains = await pool.query(`
                    SELECT DISTINCT domain FROM items WHERE is_active = true AND is_practice = false
                      AND domain IN ('gf','gv','gq','gc','gs','gwm') ORDER BY domain
                `);
                const DOMAIN_ORDER  = ['gf','gv','gq','gc','gs','gwm'];
                const DOMAIN_LABELS = { gf: 'Fluid Reasoning', gv: 'Visual Spatial', gq: 'Quantitative Reasoning', gc: 'Verbal Reasoning', gs: 'Processing Speed', gwm: 'Working Memory' };
                const sortedDomains = activeDomains.rows.map(r => r.domain)
                    .sort((a, b) => DOMAIN_ORDER.indexOf(a) - DOMAIN_ORDER.indexOf(b));

                if (sortedDomains.length > 0) {
                    for (const ob of orphanBatteries.rows) {
                        for (let i = 0; i < sortedDomains.length; i++) {
                            await pool.query(
                                `INSERT INTO battery_sections (battery_id, name, domain, sort_order) VALUES ($1,$2,$3,$4)`,
                                [ob.id, DOMAIN_LABELS[sortedDomains[i]] || sortedDomains[i], sortedDomains[i], i + 1]
                            );
                        }
                    }
                }
            }
        } catch (cleanErr) {
            console.error('Battery cleanup error:', cleanErr);
        }

        // Return rows in v2 format so the client-side TokenValidator can run
        const itemsForValidation = rows.map(r => ({
            itemId:       r.itemId,
            domain:       (r.domain || '').toLowerCase(),
            stimulusRow1: r.stimulusRow1 || null,
            stimulusRow2: r.stimulusRow2 || null,
            optionA:      r.optionA      || null,
            optionB:      r.optionB      || null,
            optionC:      r.optionC      || null,
        }));

        res.json({
            inserted, updated, errors, skipped,
            total: rows.length,
            batteries: batteryInfo,
            items: itemsForValidation,
            skippedItems,   // items that need visual assets before they can be uploaded
        });

    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ error: 'File processing failed' });
    } finally {
        if (req.file && req.file.path) {
            fs.unlink(req.file.path, () => {});
        }
    }
});

// ── GET /api/items/templates/list ── List all unique templates
router.get('/templates/list', authenticate, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT template, domain, COUNT(*) as item_count
            FROM items WHERE is_active = true
            GROUP BY template, domain
            ORDER BY domain, template
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// SHAPE LIBRARY ROUTES
//
// Shapes / stimulus PNGs are stored in  public/custom/  and served at  /custom/
// by express.static in server.js.  The frontend resolves  excel_img:filename.png
// to  /custom/filename.png  — so uploading a file here is all that's needed for
// it to appear in tests.
// ─────────────────────────────────────────────────────────────────────────────

// Use CUSTOM_SVG_DIR env var if set, otherwise use backend's own public/custom
const customDir = process.env.CUSTOM_SVG_DIR
  || path.join(__dirname, '../../public/custom');
if (!fs.existsSync(customDir)) fs.mkdirSync(customDir, { recursive: true });
// GWM SVGs live in their own subfolder
const gwmSvgDir = path.join(customDir, 'gwm_svg');
if (!fs.existsSync(gwmSvgDir)) fs.mkdirSync(gwmSvgDir, { recursive: true });
// Always keep _tmp inside the backend's own public/ to avoid polluting the FE source tree
const customTmpDir = path.join(__dirname, '../../public/_tmp');
if (!fs.existsSync(customTmpDir)) fs.mkdirSync(customTmpDir, { recursive: true });

// Multer config for shape uploads — accept PNG / JPG / SVG, save directly to custom/
const shapeUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, customDir),
        filename:    (_req, file, cb) => cb(null, file.originalname),
    }),
    fileFilter: (_req, file, cb) => {
        const ok = /\.(png|jpg|jpeg|svg|gif|webp)$/i.test(file.originalname);
        cb(ok ? null : new Error('Only image files are allowed'), ok);
    },
    limits: { fileSize: 10 * 1024 * 1024, files: 200 }, // 10 MB each, up to 200 at a time
});

// ── POST /api/items/shapes/upload ── Upload one or more shape PNGs
//    Accepts multipart/form-data with field name "shapes"
router.post('/shapes/upload',
    authenticate,
    requireRole('super_admin', 'psychologist'),
    shapeUpload.array('shapes', 200),
    async (req, res) => {
        try {
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ error: 'No files uploaded' });
            }
            const uploaded = req.files.map(f => ({
                filename: f.originalname,
                size:     f.size,
                url:      `/custom/${f.originalname}`,
            }));
            await req.audit('shapes.upload', 'shape', null, {
                description: `Uploaded ${uploaded.length} shape image(s)`,
                files: uploaded.map(f => f.filename),
            }).catch(() => {});
            res.json({ uploaded, total: uploaded.length });
        } catch (err) {
            console.error('Shape upload error:', err);
            res.status(500).json({ error: 'Shape upload failed' });
        }
    }
);

// ── GET /api/items/shapes ── List all shapes in public/custom/
router.get('/shapes', authenticate, async (req, res) => {
    try {
        const files = fs.readdirSync(customDir)
            .filter(f => /\.(png|jpg|jpeg|svg|gif|webp)$/i.test(f))
            .sort()
            .map(f => ({
                filename: f,
                url:      `/custom/${f}`,
                size:     fs.statSync(path.join(customDir, f)).size,
            }));
        res.json({ shapes: files, total: files.length });
    } catch (err) {
        console.error('Shape list error:', err);
        res.status(500).json({ error: 'Failed to list shapes' });
    }
});

// ── DELETE /api/items/shapes/:filename ── Remove a shape PNG
router.delete('/shapes/:filename',
    authenticate,
    requireRole('super_admin'),
    async (req, res) => {
        try {
            const safe = path.basename(req.params.filename); // prevent path traversal
            const target = path.join(customDir, safe);
            if (!fs.existsSync(target)) return res.status(404).json({ error: 'File not found' });
            fs.unlinkSync(target);
            res.json({ deleted: safe });
        } catch (err) {
            res.status(500).json({ error: 'Failed to delete shape' });
        }
    }
);

// ── DELETE /api/items/shapes/folder/*/filename ── Remove a file from a nested subfolder
router.delete('/shapes/folder/*',
    authenticate,
    requireRole('super_admin', 'psychologist'),
    (req, res) => {
        try {
            const fullPath = req.params[0].replace(/\.\./g, '').replace(/^\//, '');
            const target = path.join(customDir, fullPath);
            if (!fs.existsSync(target)) return res.status(404).json({ error: 'File not found' });
            if (!fs.statSync(target).isFile()) return res.status(400).json({ error: 'Not a file' });
            fs.unlinkSync(target);
            res.json({ deleted: fullPath });
        } catch (err) {
            res.status(500).json({ error: 'Failed to delete file' });
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// Subfolder-aware custom shape routes
// Files live in  public/custom/<folder>/<file>.svg
// ─────────────────────────────────────────────────────────────────────────────

// Multer for subfolder uploads — destination resolved per-request
const subfolderUpload = multer({
    storage: multer.diskStorage({
        destination: (req, _file, cb) => {
            const folder = (req.body.folder || '').replace(/[^a-z0-9_/-]/gi, '_').replace(/\.+/g, '').slice(0, 80);
            if (!folder) return cb(new Error('folder is required'), null);
            const dest = path.join(customDir, folder);
            fs.mkdirSync(dest, { recursive: true });
            cb(null, dest);
        },
        filename: (_req, file, cb) => cb(null, file.originalname),
    }),
    fileFilter: (_req, file, cb) => {
        const ok = /\.(svg|png|jpg|jpeg|gif|webp)$/i.test(file.originalname);
        cb(ok ? null : new Error('Only image files allowed'), ok);
    },
    limits: { fileSize: 10 * 1024 * 1024, files: 500 },
});

// ── GET /api/items/shapes/folders ── List all subfolders in custom/ (supports nested)
router.get('/shapes/folders', authenticate, (req, res) => {
    try {
        const IMG_EXT = /\.(svg|png|jpg|jpeg|gif|webp)$/i;
        const folders = [];

        // Recursively walk the custom directory to find all folders with images
        const walk = (dir, prefix) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            const imgFiles = entries.filter(e => e.isFile() && IMG_EXT.test(e.name));
            const subDirs  = entries.filter(e => e.isDirectory() && !e.name.startsWith('_'));

            // If this folder has images, include it
            if (imgFiles.length > 0) {
                folders.push({ name: prefix, count: imgFiles.length });
            }

            // Recurse into subdirectories
            for (const sub of subDirs) {
                const subPath = prefix ? `${prefix}/${sub.name}` : sub.name;
                walk(path.join(dir, sub.name), subPath);
            }
        };

        walk(customDir, '');
        folders.sort((a, b) => a.name.localeCompare(b.name));
        res.json({ folders });
    } catch (err) {
        res.status(500).json({ error: 'Failed to list folders' });
    }
});

// ── POST /api/items/shapes/folders ── Create a new empty subfolder
router.post('/shapes/folders', authenticate, requireRole('super_admin', 'psychologist'), (req, res) => {
    try {
        const raw = (req.body.folder || '').trim();
        if (!raw) return res.status(400).json({ error: 'folder name required' });
        const safe = raw.toLowerCase().replace(/[^a-z0-9_/-]/g, '_').replace(/\.+/g, '').slice(0, 80);
        const dest = path.join(customDir, safe);
        fs.mkdirSync(dest, { recursive: true });
        res.json({ created: safe });
    } catch (err) {
        res.status(500).json({ error: 'Could not create folder' });
    }
});

// ── GET /api/items/shapes/folder/:name(*) ── List files in a subfolder (supports nested paths)
router.get('/shapes/folder/*', authenticate, (req, res) => {
    try {
        const safe = req.params[0].replace(/\.\./g, '').replace(/^\//, '');
        const dir  = path.join(customDir, safe);
        if (!fs.existsSync(dir)) return res.json({ files: [] });
        const files = fs.readdirSync(dir)
            .filter(f => /\.(svg|png|jpg|jpeg|gif|webp)$/i.test(f))
            .sort();
        res.json({ files, folder: safe });
    } catch (err) {
        res.status(500).json({ error: 'Failed to list folder' });
    }
});

// ── POST /api/items/shapes/upload-folder ── Upload SVGs to a named subfolder
//    FormData: field "shapes" (files) + "folder" (text)
router.post('/shapes/upload-folder',
    authenticate,
    requireRole('super_admin', 'psychologist'),
    subfolderUpload.array('shapes', 500),
    async (req, res) => {
        try {
            if (!req.files || !req.files.length)
                return res.status(400).json({ error: 'No files uploaded' });
            const uploaded = req.files.map(f => f.originalname);
            res.json({ uploaded, count: uploaded.length, folder: req.body.folder });
        } catch (err) {
            res.status(500).json({ error: err.message || 'Upload failed' });
        }
    }
);

// ── POST /api/items/shapes/upload-zip ── Upload a ZIP, extract SVGs into subfolder
//    FormData: field "zipfile" + "folder" (folder name, usually derived from zip filename)
router.post('/shapes/upload-zip',
    authenticate,
    requireRole('super_admin', 'psychologist'),
    multer({ dest: customTmpDir, limits: { fileSize: 100 * 1024 * 1024 } }).single('zipfile'),
    async (req, res) => {
        const tmpFile = req.file?.path;
        try {
            if (!req.file) return res.status(400).json({ error: 'No zip file uploaded' });
            const folder = (req.body.folder || '').replace(/[^a-z0-9_/-]/gi, '_').replace(/\.+/g, '').slice(0, 80);
            if (!folder) return res.status(400).json({ error: 'folder name is required' });

            const destDir = path.join(customDir, folder);
            fs.mkdirSync(destDir, { recursive: true });

            // Use built-in zlib/unzip via child_process unzip, or fallback to manual zip read
            // Node.js doesn't have a built-in zip library — use the system unzip command
            const { execSync } = require('child_process');
            execSync(`unzip -o "${tmpFile}" -d "${destDir}"`, { stdio: 'pipe' });

            // Count SVG/image files (flatten nested dirs)
            const countFiles = (dir) => {
                let n = 0;
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    if (entry.isDirectory()) n += countFiles(path.join(dir, entry.name));
                    else if (/\.(svg|png|jpg|jpeg|gif|webp)$/i.test(entry.name)) n++;
                }
                return n;
            };
            const count = countFiles(destDir);

            res.json({ count, folder });
        } catch (err) {
            console.error('ZIP extract error:', err);
            res.status(500).json({ error: err.message || 'ZIP extraction failed' });
        } finally {
            // Clean up temp file regardless of outcome
            if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch (_) {} }
        }
    }
);

// ── DELETE /api/items/:id ── Soft-delete an item (scoped to source for non-super-admin)
router.delete('/:id', authenticate, requireRole('super_admin', 'psychologist', 'client_admin'), async (req, res) => {
    try {
        const isSuper = req.user.role === 'super_admin';
        // Super admin can delete any item (full soft delete)
        if (isSuper) {
            const result = await pool.query(
                'UPDATE items SET is_active = false WHERE id = $1 RETURNING item_code',
                [req.params.id]
            );
            if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
            return res.json({ success: true, item_code: result.rows[0].item_code });
        }

        // Non-super admin: can only remove the item from their own source (item_sources junction)
        const scopedSourceId = resolveSourceScope(req);
        if (!scopedSourceId) {
            return res.status(403).json({ error: 'No source assigned' });
        }

        // Verify the item belongs to this source
        const link = await pool.query(
            'SELECT 1 FROM item_sources WHERE item_id = $1 AND source_id = $2',
            [req.params.id, scopedSourceId]
        );
        if (!link.rows.length) {
            return res.status(404).json({ error: 'Item not found in your source' });
        }

        // Count remaining sources for this item
        const otherSources = await pool.query(
            'SELECT COUNT(*)::int AS cnt FROM item_sources WHERE item_id = $1',
            [req.params.id]
        );

        if (otherSources.rows[0].cnt > 1) {
            // Soft-delete: just unlink from this source
            await pool.query(
                'DELETE FROM item_sources WHERE item_id = $1 AND source_id = $2',
                [req.params.id, scopedSourceId]
            );
            const it = await pool.query('SELECT item_code FROM items WHERE id = $1', [req.params.id]);
            return res.json({ success: true, item_code: it.rows[0]?.item_code, scope: 'source-only' });
        }

        // Item belongs only to this source → full soft-delete and unlink
        const result = await pool.query(
            'UPDATE items SET is_active = false WHERE id = $1 RETURNING item_code',
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
        await pool.query(
            'DELETE FROM item_sources WHERE item_id = $1 AND source_id = $2',
            [req.params.id, scopedSourceId]
        );
        return res.json({ success: true, item_code: result.rows[0].item_code, scope: 'full' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete item' });
    }
});

module.exports = router;