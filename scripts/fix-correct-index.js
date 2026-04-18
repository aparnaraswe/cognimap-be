/**
 * fix-correct-index.js
 *
 * One-time migration: fixes items whose content.correctIndex was stored
 * incorrectly because "Correct Idx (0b)" (0-based) was treated as 1-based
 * and had 1 subtracted from it.
 *
 * For every item that has content.correctAns (a letter like "A","B","C","D"),
 * this script:
 *   1. Derives the correct 0-based index from the letter
 *   2. Compares it to the stored correctIndex
 *   3. If they disagree, updates correctIndex AND fixes option tags/scores
 *
 * Usage:
 *   node scripts/fix-correct-index.js          # dry-run (default)
 *   node scripts/fix-correct-index.js --apply  # actually write to DB
 */

const { Pool } = require('pg');

const pool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     process.env.DB_PORT     || 5432,
    database: process.env.DB_NAME     || 'psychometric_platform',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
});

const LETTER_MAP = { A: 0, B: 1, C: 2, D: 3 };

async function run() {
    const dryRun = !process.argv.includes('--apply');
    if (dryRun) console.log('=== DRY RUN (pass --apply to write changes) ===\n');

    const client = await pool.connect();
    try {
        // Fetch all items that have a correctAns letter in their content
        const { rows } = await client.query(`
            SELECT id, item_code, content
            FROM items
            WHERE content->>'correctAns' IS NOT NULL
              AND content->>'correctAns' != ''
        `);

        console.log(`Found ${rows.length} items with correctAns field.\n`);

        let fixedCount = 0;
        let skippedCount = 0;

        for (const row of rows) {
            const c = row.content || {};
            const letter = String(c.correctAns).trim().toUpperCase();
            const expectedIdx = LETTER_MAP[letter];

            if (expectedIdx === undefined) {
                console.log(`  SKIP ${row.item_code}: unrecognised correctAns "${c.correctAns}"`);
                skippedCount++;
                continue;
            }

            const storedIdx = c.correctIndex ?? null;

            if (storedIdx === expectedIdx) {
                // Already correct — no fix needed
                continue;
            }

            console.log(`  FIX  ${row.item_code}: correctAns="${letter}" → expected idx=${expectedIdx}, stored idx=${storedIdx}`);

            // Build corrected content
            const fixed = { ...c, correctIndex: expectedIdx };

            // Fix option tags and default scores
            if (Array.isArray(fixed.options)) {
                fixed.options = fixed.options.map((opt, i) => {
                    const isCorrect = i === expectedIdx;
                    return {
                        ...opt,
                        tag: isCorrect ? 'correct' : 'distractor',
                    };
                });
            }

            if (!dryRun) {
                await client.query(
                    'UPDATE items SET content = $1 WHERE id = $2',
                    [JSON.stringify(fixed), row.id]
                );
            }
            fixedCount++;
        }

        console.log(`\n--- Summary ---`);
        console.log(`  Items scanned:  ${rows.length}`);
        console.log(`  Items fixed:    ${fixedCount}`);
        console.log(`  Items skipped:  ${skippedCount}`);
        console.log(`  Items OK:       ${rows.length - fixedCount - skippedCount}`);
        if (dryRun && fixedCount > 0) {
            console.log(`\nRe-run with --apply to write these changes to the database.`);
        }
    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(err => { console.error('Migration failed:', err); process.exit(1); });
