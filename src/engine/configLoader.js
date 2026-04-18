// ══════════════════════════════════════════════════════
// CONFIG LOADER — Loads report engine config from DB
// with in-memory caching (60s TTL)
// ══════════════════════════════════════════════════════

const { pool } = require('../config/database');

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 60000;

async function getReportConfig() {
    if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;
    const { rows } = await pool.query(
        `SELECT setting_key, setting_value FROM platform_settings WHERE category = 'report_engine'`
    );
    const config = {};
    for (const r of rows) config[r.setting_key] = r.setting_value?.value ?? r.setting_value;
    _cache = config;
    _cacheTime = Date.now();
    return config;
}

async function getCareerDatabase() {
    const { rows } = await pool.query(
        `SELECT * FROM career_database WHERE is_active = true ORDER BY sort_order, career`
    );
    return rows.map(r => ({
        career: r.career, field: r.field, aptitudeCluster: r.aptitude_cluster,
        minAptitude: r.min_aptitude, riasec: r.riasec, traits: r.traits,
        flagCondition: r.flag_condition, degrees: r.degrees, institutions: r.institutions,
    }));
}

function invalidateCache() { _cache = null; }

module.exports = { getReportConfig, getCareerDatabase, invalidateCache };
