// ══════════════════════════════════════════════════════
// DATABASE INITIALIZATION — FIX #8: Random passwords in production
// ══════════════════════════════════════════════════════

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
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

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function randomPassword() {
  return crypto.randomBytes(12).toString('base64url').slice(0, 16);
}

async function init() {
  console.log('🧠 CogniMap — Database Initialization');
  console.log('═'.repeat(50));
  try {
    // 1. Run schema
    console.log('\n📋 Creating schema...');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    const statements = schema.split(';').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('--'));
    for (const stmt of statements) {
      try { await pool.query(stmt); } catch (err) {
        if (!err.message.includes('already exists') && !err.message.includes('duplicate')) {
          console.warn('  ⚠', err.message.slice(0, 100));
        }
      }
    }
    console.log('  ✓ Schema created');

    // 2. Seed users — FIX #8: Random passwords in production, fixed in dev
    console.log('\n👤 Seeding default users...');
    const creds = [];
    const seeds = [
      { email: 'admin@cognimap.com', fn: 'Super', ln: 'Admin', role: 'super_admin' },
      { email: 'psychologist@cognimap.com', fn: 'Demo', ln: 'Psychologist', role: 'psychologist' },
      { email: 'student@cognimap.com', fn: 'Demo', ln: 'Student', role: 'student',
        ageBand: '12-14', grade: 'Grade 8', dob: '2012-06-15' },
    ];

    // Fixed dev passwords (only for development)
    const devPasswords = { 'super_admin': 'admin123', 'psychologist': 'psych123', 'student': 'student123' };

    for (const s of seeds) {
      const ex = await pool.query('SELECT id FROM users WHERE email=$1', [s.email]);
      if (ex.rows.length === 0) {
        const pw = IS_PRODUCTION ? randomPassword() : devPasswords[s.role];
        const hash = await bcrypt.hash(pw, 12);
        await pool.query(`INSERT INTO users (email,password_hash,first_name,last_name,role,age_band,grade,date_of_birth)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [s.email, hash, s.fn, s.ln, s.role, s.ageBand||null, s.grade||null, s.dob||null]);
        creds.push({ role: s.role, email: s.email, password: pw });
        console.log(`  ✓ ${s.role}: ${s.email}`);
      } else {
        console.log(`  ✓ ${s.role} already exists`);
      }
    }

    // 3. Seed scoring profiles
    const spCount = await pool.query('SELECT COUNT(*) FROM scoring_profiles');
    if (parseInt(spCount.rows[0].count) === 0) {
      console.log('\n📊 Seeding scoring profiles...');
      for (const [d,n] of [['gf','Fluid'],['gv','Visual Spatial'],['gq','Quantitative'],['gc','Verbal'],['gs','Processing Speed']]) {
        await pool.query('INSERT INTO scoring_profiles (domain,name,method,config) VALUES ($1,$2,$3,$4)',
          [d, `${n} - IRT Theta`, 'irt_theta', JSON.stringify({maxItems:15})]);
      }
      console.log('  ✓ Scoring profiles created');
    }

    console.log('\n' + '═'.repeat(50));
    console.log('✅ Database ready!');
    if (creds.length > 0) {
      console.log('\n🔐 Login credentials:');
      for (const c of creds) {
        console.log(`  ${c.role}: ${c.email} / ${c.password}`);
      }
      if (IS_PRODUCTION) {
        console.log('\n⚠️  PRODUCTION: Save these passwords now — they won\'t be shown again!');
        // Write to a temp file that should be deleted after first login
        const credFile = path.join(__dirname, '..', '.credentials');
        fs.writeFileSync(credFile, creds.map(c => `${c.role}: ${c.email} / ${c.password}`).join('\n'));
        console.log(`  Credentials also saved to: ${credFile}`);
        console.log('  DELETE this file after you\'ve saved the passwords!\n');
      }
    }
  } catch (err) {
    console.error('❌ Init failed:', err.message);
    process.exit(1);
  } finally { await pool.end(); }
}
init();
