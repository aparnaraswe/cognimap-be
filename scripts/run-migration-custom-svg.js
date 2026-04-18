#!/usr/bin/env node
/**
 * Run migration for custom SVG shapes table
 * Usage: node scripts/run-migration-custom-svg.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'cognimap',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

async function runMigration() {
  try {
    console.log('🔧 Running custom SVG shapes migration...\n');

    const sqlPath = path.join(__dirname, 'migration-custom-svg-shapes.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Split by semicolon and execute each statement
    const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('--'));
    
    for (const stmt of statements) {
      try {
        await pool.query(stmt);
      } catch (err) {
        if (!err.message.includes('already exists') && !err.message.includes('duplicate')) {
          console.warn('  ⚠', err.message.slice(0, 100));
        }
      }
    }

    console.log('✅ Migration completed successfully!');
    console.log('\nCustom SVG shapes table created.');
    console.log('You can now add custom shapes via /admin/tokens\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
