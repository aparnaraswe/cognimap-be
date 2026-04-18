// ══════════════════════════════════════════════════════
// RUN MIGRATION — applies any *.sql migration file to the database
// Usage: node scripts/run-migration.js migration-batches.sql
// ══════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'cognimap',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
});

async function run() {
    const fileArg = process.argv[2];
    if (!fileArg) {
        console.error('Usage: node scripts/run-migration.js <filename.sql>');
        console.error('Example: node scripts/run-migration.js migration-batches.sql');
        process.exit(1);
    }

    const filePath = path.isAbsolute(fileArg)
        ? fileArg
        : path.join(__dirname, fileArg);

    if (!fs.existsSync(filePath)) {
        console.error(`❌ File not found: ${filePath}`);
        process.exit(1);
    }

    console.log(`📄 Running migration: ${path.basename(filePath)}`);
    console.log('═'.repeat(60));

    const sql = fs.readFileSync(filePath, 'utf8');

    try {
        await pool.query(sql);
        console.log('✅ Migration applied successfully');
    } catch (err) {
        console.error('❌ Migration failed:');
        console.error(`   ${err.message}`);
        if (err.position) console.error(`   Position: ${err.position}`);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

run();
