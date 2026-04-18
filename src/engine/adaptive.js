/**
 * ADAPTIVE TEST ENGINE
 * 
 * Implements the Unified System Logic Specification:
 * - Theta scoring with difficulty weights
 * - Adaptive difficulty (streak-based)
 * - Anchor item scheduling
 * - Ceiling detection
 * - Cross-age band escalation
 * - Multi-domain sequencing
 * 
 * The engine is stateless per call — all state lives in session.adaptive_state JSONB
 */

const { pool } = require('../config/database');

// ── Constants from spec ──
const DIFFICULTY_WEIGHTS = { 1: 0.10, 2: 0.20, 3: 0.35, 4: 0.50 };
const INCORRECT_PENALTY_FACTOR = 0.6;
const ANCHOR_BONUS_CORRECT = 0.10;
const ANCHOR_BONUS_INCORRECT = -0.05;
const CEILING_BONUS = 0.60;
const CEILING_THETA_THRESHOLD = 1.20;
const CEILING_STREAK_REQUIRED = 3;
const ESCALATION_B_THRESHOLD = 0.80;
const ESCALATION_C_THRESHOLD = 1.60;
const RESTRICT_THRESHOLD = -0.80;
const ANCHOR_POSITIONS = [4, 8, 12, 16, 20];
const MAX_ITEMS_PER_DOMAIN = 15;
const STREAK_UP = 2;
const STREAK_DOWN = 2;

const DOMAIN_WEIGHTS = { gf: 0.30, gv: 0.20, gq: 0.20, gc: 0.15, gs: 0.15 };
const DOMAIN_ORDER = ['gf', 'gv', 'gq', 'gc', 'gs'];
const TIMER_MODES = { gf: 'soft', gv: 'soft', gq: 'soft', gc: 'soft', gs: 'hard' };

const AGE_BANDS = {
    A: { min: 8, max: 11, startDifficulty: 1 },
    B: { min: 12, max: 14, startDifficulty: 2 },
    C: { min: 15, max: 18, startDifficulty: 3 },
};

// ── Determine age band from user ──
function getAgeBand(user) {
    const age = user.date_of_birth
        ? Math.floor((Date.now() - new Date(user.date_of_birth).getTime()) / 31557600000)
        : parseInt(user.age_band?.split('-')[0]) || 8;
    if (age <= 11) return 'A';
    if (age <= 14) return 'B';
    return 'C';
}

// ── Initialize adaptive state for a new session ──
// `maxItemsPerDomain` (optional) — object like { gf: 10, gv: 8, ... } overriding the global default.
function initializeState(ageBand, domainList, maxItemsPerDomain = {}) {
    const startDiff = AGE_BANDS[ageBand].startDifficulty;
    const domains = {};
    for (const d of domainList) {
        const cap = parseInt(maxItemsPerDomain?.[d], 10);
        const maxItems = (Number.isFinite(cap) && cap > 0) ? cap : MAX_ITEMS_PER_DOMAIN;
        domains[d] = {
            theta: 0.0,
            correctStreak: 0,
            incorrectStreak: 0,
            itemsServed: 0,
            maxItems,                    // ← per-domain cap (configurable per source)
            currentDifficulty: startDiff,
            completed: false,
            timerMode: TIMER_MODES[d] || 'soft',
        };
    }
    return {
        ageBand,
        currentDomainIndex: 0,
        domainOrder: [...domainList],
        domains,
        servedItemIds: [],
        anchorSchedule: [...ANCHOR_POSITIONS],
        globalTheta: null,
    };
}

// ── Pick the next item to serve ──
async function pickNextItem(state) {
    const domainList = state.domainOrder || Object.keys(state.domains);
    
    // Find current active domain
    let domIdx = state.currentDomainIndex;
    while (domIdx < domainList.length && state.domains[domainList[domIdx]].completed) {
        domIdx++;
    }
    if (domIdx >= domainList.length) return null; // All domains done
    state.currentDomainIndex = domIdx;

    const domain = domainList[domIdx];
    const ds = state.domains[domain];
    const nextItemNum = ds.itemsServed + 1;
    const cap = ds.maxItems || MAX_ITEMS_PER_DOMAIN;

    if (nextItemNum > cap) {
        ds.completed = true;
        return pickNextItem(state); // recurse to next domain
    }

    // Determine what role to serve
    let targetRole = 'core';
    if (state.anchorSchedule.includes(nextItemNum)) {
        targetRole = 'anchor';
    } else if (ds.theta >= CEILING_THETA_THRESHOLD && ds.correctStreak >= CEILING_STREAK_REQUIRED) {
        targetRole = 'ceiling';
    } else if (ds.currentDifficulty >= 3) {
        targetRole = 'transitional';
    }

    // Determine age band pool access (escalation)
    let ageBandFilter = state.ageBand;
    const ab = AGE_BANDS[state.ageBand];
    let ageMin = ab.min;
    let ageMax = ab.max;

    if (ds.theta >= ESCALATION_C_THRESHOLD) {
        ageMax = 18; // unlock all
    } else if (ds.theta >= ESCALATION_B_THRESHOLD) {
        ageMax = 14; // unlock B pool
    }

    // Build query to pick an item
    const excludeIds = state.servedItemIds;
    const diff = ds.currentDifficulty;

    // Try to find an item matching target role + difficulty
    // Fallback: any role at current difficulty
    // Fallback: any difficulty
    const queries = [
        // Exact match: right role + right difficulty + age band
        { role: targetRole, diffMin: diff, diffMax: diff, useAge: true },
        // Fallback: right difficulty, any role, age band
        { role: null, diffMin: diff, diffMax: diff, useAge: true },
        // Fallback: nearby difficulty, age band
        { role: null, diffMin: Math.max(1, diff - 1), diffMax: Math.min(4, diff + 1), useAge: true },
        // Fallback: anything in this domain, age band
        { role: null, diffMin: 1, diffMax: 10, useAge: true },
        // Last resort: anything in this domain, NO age filter
        { role: null, diffMin: 1, diffMax: 10, useAge: false },
    ];

    for (const q of queries) {
        let sql = `
            SELECT * FROM items
            WHERE domain = $1
              AND is_active = true
              AND is_practice = false
        `;
        const params = [domain];
        let pi = 1;

        if (q.useAge) {
            params.push(ageMax, ageMin);
            sql += ` AND age_band_min <= $${++pi} AND age_band_max >= $${++pi}`;
        }

        params.push(q.diffMin, q.diffMax);
        sql += ` AND difficulty_level BETWEEN $${++pi} AND $${++pi}`;

        if (q.role) {
            params.push(q.role);
            sql += ` AND role = $${++pi}`;
        }

        if (excludeIds.length > 0) {
            params.push(excludeIds);
            sql += ` AND id != ALL($${++pi})`;
        }

        sql += ` ORDER BY RANDOM() LIMIT 1`;

        const result = await pool.query(sql, params);
        if (result.rows.length > 0) {
            return { item: result.rows[0], domain, role: targetRole };
        }
    }

    // No more items available for this domain
    ds.completed = true;
    return pickNextItem(state);
}

// ── Process a response and update theta ──
function processResponse(state, domain, itemRole, difficultyLevel, isCorrect) {
    const ds = state.domains[domain];
    if (!ds) return;

    const diffWeight = DIFFICULTY_WEIGHTS[difficultyLevel] || 0.20;

    // Update theta
    if (isCorrect) {
        ds.theta += diffWeight;
        ds.correctStreak++;
        ds.incorrectStreak = 0;

        // Anchor bonus
        if (itemRole === 'anchor') ds.theta += ANCHOR_BONUS_CORRECT;
        // Ceiling bonus
        if (itemRole === 'ceiling') ds.theta += CEILING_BONUS;
    } else {
        ds.theta -= diffWeight * INCORRECT_PENALTY_FACTOR;
        ds.incorrectStreak++;
        ds.correctStreak = 0;

        // Anchor penalty
        if (itemRole === 'anchor') ds.theta += ANCHOR_BONUS_INCORRECT;
    }

    // Clamp theta
    ds.theta = Math.max(-3.0, Math.min(3.0, ds.theta));

    // Adaptive difficulty adjustment
    if (ds.correctStreak >= STREAK_UP) {
        ds.currentDifficulty = Math.min(4, ds.currentDifficulty + 1);
        ds.correctStreak = 0; // reset after escalation
    }
    if (ds.incorrectStreak >= STREAK_DOWN) {
        ds.currentDifficulty = Math.max(1, ds.currentDifficulty - 1);
        ds.incorrectStreak = 0; // reset after de-escalation
    }

    // Restrict if theta too low
    if (ds.theta <= RESTRICT_THRESHOLD) {
        ds.currentDifficulty = Math.max(1, ds.currentDifficulty - 1);
    }

    ds.itemsServed++;

    // Check domain completion (per-domain configurable cap)
    const cap = ds.maxItems || MAX_ITEMS_PER_DOMAIN;
    if (ds.itemsServed >= cap) {
        ds.completed = true;
    }
}

// ── Compute global theta after all domains complete ──
function computeGlobalTheta(state) {
    let total = 0;
    let weightSum = 0;
    for (const [domain, ds] of Object.entries(state.domains)) {
        const w = DOMAIN_WEIGHTS[domain] || 0.15;
        total += ds.theta * w;
        weightSum += w;
    }
    state.globalTheta = weightSum > 0 ? Math.round((total / weightSum) * 100) / 100 : 0;
    return state.globalTheta;
}

// ── Classify ability level ──
function classifyAbility(theta) {
    if (theta <= -1.5) return 'Developing';
    if (theta < 0.5) return 'Age Appropriate';
    if (theta < 1.5) return 'Advanced';
    return 'Exceptional';
}

// ── Compute career aptitude clusters ──
function computeClusters(state) {
    const d = state.domains;
    const gf = d.gf?.theta || 0;
    const gv = d.gv?.theta || 0;
    const gq = d.gq?.theta || 0;
    const gc = d.gc?.theta || 0;
    const gs = d.gs?.theta || 0;

    return {
        analytical: Math.round((gf * 0.6 + gq * 0.4) * 100) / 100,
        design: Math.round(gv * 100) / 100,
        communication: Math.round(gc * 100) / 100,
        operational: Math.round(gs * 100) / 100,
        strategic: Math.round((gf * 0.7 + gv * 0.3) * 100) / 100,
    };
}

// ── Format a DB item into the payload the frontend expects ──
function formatItemForClient(dbItem, domainState) {
    const c = dbItem.content || {};
    return {
        _dbItemId: dbItem.id,
        itemId: dbItem.item_code,
        domain: dbItem.domain,
        template: dbItem.template,
        difficulty: dbItem.difficulty_level,
        role: dbItem.role,
        displayMode: c.displayMode || '',
        prompt: c.prompt || 'Which comes <hl>next</hl>?',
        sequence: c.sequence || [],
        options: (c.options || []).map(o => ({
            value: o.value,
            label: o.label || o.value,
            tag: o.tag || 'distractor',
        })),
        correctIndex: c.correctIndex ?? 0,
        timeLimitSec: dbItem.time_limit_sec || 20,
        timerMode: dbItem.timer_mode || domainState?.timerMode || 'soft',
    };
}

// ── Check if all domains are complete ──
function isSessionComplete(state) {
    return Object.values(state.domains).every(ds => ds.completed);
}

// ── Compute final scores and save to DB ──
async function finalizeSession(sessionId, state) {
    const globalTheta = computeGlobalTheta(state);
    const clusters = computeClusters(state);

    // Save per-domain scores
    for (const [domain, ds] of Object.entries(state.domains)) {
        await pool.query(`
            INSERT INTO session_scores (session_id, domain, trait_or_dim, raw_score, standard_score, descriptor)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [sessionId, domain, `${domain}_theta`, ds.theta,
            ds.theta, classifyAbility(ds.theta)]);
    }

    // Save global theta
    await pool.query(`
        INSERT INTO session_scores (session_id, domain, trait_or_dim, raw_score, standard_score, descriptor)
        VALUES ($1, 'global', 'global_theta', $2, $3, $4)
    `, [sessionId, globalTheta, globalTheta, classifyAbility(globalTheta)]);

    // Save clusters
    for (const [name, val] of Object.entries(clusters)) {
        await pool.query(`
            INSERT INTO session_scores (session_id, domain, trait_or_dim, raw_score, descriptor)
            VALUES ($1, 'cluster', $2, $3, $4)
        `, [sessionId, name, val, classifyAbility(val)]);
    }

    // Mark session complete
    await pool.query(`
        UPDATE test_sessions SET status = 'completed', completed_at = NOW(),
               adaptive_state = $2
        WHERE id = $1
    `, [sessionId, JSON.stringify(state)]);

    // Query back the saved scores for the frontend
    const savedScores = await pool.query(
        'SELECT * FROM session_scores WHERE session_id = $1 ORDER BY domain', [sessionId]
    );

    return { globalTheta, clusters, domainScores: state.domains, scores: savedScores.rows };
}

module.exports = {
    initializeState,
    getAgeBand,
    pickNextItem,
    processResponse,
    computeGlobalTheta,
    computeClusters,
    classifyAbility,
    formatItemForClient,
    isSessionComplete,
    finalizeSession,
    DOMAIN_ORDER,
    DOMAIN_WEIGHTS,
    MAX_ITEMS_PER_DOMAIN,
};
