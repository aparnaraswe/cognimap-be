const { Pool } = require('pg');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'psychometric_platform',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
});

// ── Map CSV row to database item ──
function mapGfItem(row) {
    const options = [];
    const correctIdx = parseInt(row.correctIndex) - 1; // CSV is 1-based, we use 0-based

    ['option1', 'option2', 'option3'].forEach((key, i) => {
        if (row[key]) {
            options.push({
                value: row[key],
                tag: i === correctIdx ? 'correct' : guessDistractorTag(row[key], row, correctIdx, i)
            });
        }
    });

    // Parse age band
    const ageBand = row.ageBand || '11-Aug';
    let ageMin = 8, ageMax = 11;
    if (ageBand.includes('8') || ageBand.includes('Aug')) { ageMin = 8; ageMax = 11; }
    if (ageBand.includes('12')) { ageMin = 12; ageMax = 14; }
    if (ageBand.includes('15')) { ageMin = 15; ageMax = 18; }

    return {
        item_code: row.itemId,
        domain: 'gf',
        audience: 'student',
        difficulty_level: parseInt(row.difficultyLevel) || 1,
        age_band_min: ageMin,
        age_band_max: ageMax,
        role: row.role || 'core',
        anchor_group: row.anchorGroup || null,
        template: row.template,
        content: {
            shapeA: row.shapeA || null,
            shapeB: row.shapeB || null,
            positionA: row.positionA || null,
            positionB: row.positionB || null,
            countStart: row.countStart ? parseInt(row.countStart) : null,
            step: row.step ? parseInt(row.step) : null,
            options: options,
            correctIndex: correctIdx
        },
        time_limit_sec: parseInt(row.TimeLimitSec) || 20,
        is_practice: false,
        is_active: true,
    };
}

function guessDistractorTag(value, row, correctIdx, currentIdx) {
    // Basic heuristic for distractor classification
    if (value.includes(row.shapeA) || value.includes(row.shapeB)) {
        return 'distractor_partial_match';
    }
    return 'distractor_novel';
}

async function seedFromFile(filePath) {
    // Read file (supports .csv, .xlsx, .xls)
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    console.log(`Found ${rows.length} rows in ${path.basename(filePath)}`);

    let inserted = 0;
    let updated = 0;
    let errors = 0;

    for (const row of rows) {
        try {
            const item = mapGfItem(row);

            // Upsert: insert or update if item_code already exists
            const result = await pool.query(`
                INSERT INTO items (item_code, domain, audience, difficulty_level, age_band_min, age_band_max,
                                   role, anchor_group, template, content, time_limit_sec, is_practice, is_active)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                ON CONFLICT (item_code)
                DO UPDATE SET
                    domain = EXCLUDED.domain,
                    difficulty_level = EXCLUDED.difficulty_level,
                    template = EXCLUDED.template,
                    content = EXCLUDED.content,
                    time_limit_sec = EXCLUDED.time_limit_sec,
                    is_active = EXCLUDED.is_active,
                    version = items.version + 1,
                    updated_at = NOW()
                RETURNING (xmax = 0) AS is_insert
            `, [
                item.item_code, item.domain, item.audience, item.difficulty_level,
                item.age_band_min, item.age_band_max, item.role, item.anchor_group,
                item.template, JSON.stringify(item.content), item.time_limit_sec,
                item.is_practice, item.is_active
            ]);

            if (result.rows[0].is_insert) {
                inserted++;
            } else {
                updated++;
            }
        } catch (err) {
            errors++;
            console.error(`  ✗ Error on row "${row.itemId}": ${err.message}`);
        }
    }

    console.log(`\nResults:`);
    console.log(`  ✓ ${inserted} new items inserted`);
    console.log(`  ↻ ${updated} existing items updated`);
    if (errors > 0) console.log(`  ✗ ${errors} errors`);
}

async function main() {
    // Accept file path as argument, or use default
    const filePath = process.argv[2] || path.join(__dirname, '..', 'uploads', 'GF_csv.csv');

    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        console.log('Usage: node scripts/seed-from-csv.js [path/to/file.csv]');
        process.exit(1);
    }

    try {
        await seedFromFile(filePath);
    } catch (err) {
        console.error('Seed failed:', err.message);
    } finally {
        await pool.end();
    }
}

main();
