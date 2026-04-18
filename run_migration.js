// Run this once to apply DB fixes
// Usage: node run_migration.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     process.env.DB_PORT     || 5434,
    database: process.env.DB_NAME     || 'cognimaptest',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
});

const migrations = [
    // Fix exposure_control: revert to JSONB (was wrongly changed to NUMERIC)
    `ALTER TABLE items DROP COLUMN IF EXISTS exposure_control`,
    `ALTER TABLE items ADD  COLUMN  exposure_control JSONB`,

    // Fix enemy_items: revert to JSONB (was wrongly changed to TEXT[])
    `ALTER TABLE items DROP COLUMN IF EXISTS enemy_items`,
    `ALTER TABLE items ADD  COLUMN  enemy_items JSONB NOT NULL DEFAULT '[]'`,

    // Fix difficulty_level: change to INTEGER for correct ORDER BY
    `ALTER TABLE items ALTER COLUMN difficulty_level TYPE INTEGER
     USING CASE
       WHEN difficulty_level IS NULL THEN 1
       WHEN difficulty_level ~ '^\\d+$' THEN difficulty_level::integer
       WHEN LOWER(difficulty_level::text) = 'easy'   THEN 1
       WHEN LOWER(difficulty_level::text) = 'medium' THEN 2
       WHEN LOWER(difficulty_level::text) = 'hard'   THEN 3
       ELSE 1
     END`,
];

(async () => {
    const client = await pool.connect();
    try {
        for (const sql of migrations) {
            const short = sql.trim().split('\n')[0].substring(0, 60);
            process.stdout.write(`Running: ${short}... `);
            await client.query(sql);
            console.log('✓');
        }
        console.log('\nAll migrations applied successfully.');
    } catch (err) {
        console.error('\nMigration failed:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
})();
