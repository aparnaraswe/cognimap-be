/**
 * CAT Engine — Computerized Adaptive Testing
 *
 * Implements 2PL/3PL IRT-based item selection with:
 * - Maximum Fisher Information item selection
 * - EAP (Expected A Posteriori) theta estimation
 * - Content balancing via template constraints
 * - Enemy item exclusion
 * - Exposure control (Sympson-Hetter style)
 * - WARM-UP RULE: first 2 items per domain must have irt_b < 0 (easy items first)
 */

const { pool } = require('../config/database');

// ═══ CONSTANTS ═══
let MAX_ITEMS_PER_DOMAIN = 15; // default, can be overridden by platform setting
const MIN_ITEMS_PER_DOMAIN = 8;

// Allow runtime override from platform_settings (called once at session start)
function setMaxItemsPerDomain(n) {
  if (n && Number.isFinite(n) && n >= MIN_ITEMS_PER_DOMAIN) MAX_ITEMS_PER_DOMAIN = n;
}
const SEM_THRESHOLD = 0.35;
const DOMAIN_ORDER = ['gf', 'gv', 'gq', 'gc', 'gs', 'gwm'];
const DOMAIN_WEIGHTS = { gf: 0.25, gv: 0.20, gq: 0.20, gc: 0.15, gs: 0.10, gwm: 0.10 };
const TIMER_MODES = { gf: 'soft', gv: 'soft', gq: 'soft', gc: 'soft', gs: 'hard', gwm: 'soft' };

const AGE_BANDS = {
    A: { min: 8, max: 11 },
    B: { min: 12, max: 14 },
    C: { min: 15, max: 18 },
};

const ESCALATION_THETA_B = 1.0;
const ESCALATION_THETA_C = 2.0;

// ═══ IRT MATH ═══

/** 3PL probability of correct response */
function prob3PL(theta, a, b, c) {
  const exp = Math.exp(-a * (theta - b));
  return c + (1 - c) / (1 + exp);
}

/** Fisher information for 3PL model */
function fisherInfo(theta, a, b, c) {
  const p = prob3PL(theta, a, b, c);
  const q = 1 - p;
  if (p <= 0 || q <= 0) return 0;
  const numerator = a * a * Math.pow(p - c, 2) * q;
  const denominator = (1 - c) * (1 - c) * p;
  return denominator > 0 ? numerator / denominator : 0;
}

/** EAP theta estimation with normal prior */
function estimateTheta(responses, prior = { mean: 0, sd: 1 }) {
  if (!responses || responses.length === 0) return prior.mean;

  const nQuad = 61;
  const lo = -4, hi = 4;
  const step = (hi - lo) / (nQuad - 1);
  let numerator = 0, denominator = 0;

  for (let qi = 0; qi < nQuad; qi++) {
    const theta = lo + qi * step;

    // Likelihood
    let logLik = 0;
    for (const r of responses) {
      const p = prob3PL(theta, r.a, r.b, r.c);
      const pClamped = Math.max(1e-10, Math.min(1 - 1e-10, p));
      logLik += r.correct ? Math.log(pClamped) : Math.log(1 - pClamped);
    }

    // Normal prior
    const priorDensity = Math.exp(-0.5 * Math.pow((theta - prior.mean) / prior.sd, 2)) / (prior.sd * Math.sqrt(2 * Math.PI));

    const posterior = Math.exp(logLik) * priorDensity;
    numerator += theta * posterior * step;
    denominator += posterior * step;
  }

  return denominator > 0 ? numerator / denominator : prior.mean;
}

/** Standard error of theta estimate */
function thetaSE(theta, responses) {
  if (!responses || responses.length === 0) return 1.0;
  let totalInfo = 0;
  for (const r of responses) {
    totalInfo += fisherInfo(theta, r.a, r.b, r.c);
  }
  return totalInfo > 0 ? 1 / Math.sqrt(totalInfo) : 1.0;
}

// ═══ ITEM SELECTION ═══

/**
 * Select next item from pool using Maximum Fisher Information.
 */
function selectNextItem({ pool, theta, domainState, constraints = {} }) {
  if (!pool || pool.length === 0) return null;

  let candidates = [...pool];

  // ── WARM-UP RULE ──
  if (domainState && domainState.itemsServed < 2) {
    const easyItems = candidates.filter(item => (item.irt_b || 0) < 0);
    if (easyItems.length > 0) {
      candidates = easyItems;
    }
  }

  // ── ENEMY ITEM EXCLUSION ──
  if (domainState?.enemyIds && typeof domainState.enemyIds.has === 'function') {
    candidates = candidates.filter(item => !domainState.enemyIds.has(item.itemId));
  }

  // ── TEMPLATE/CONTENT BALANCING ──
  if (constraints.maxPerTemplate && domainState?.templateCounts) {
    candidates = candidates.filter(item => {
      const template = item.template || item.contentConstraint || 'default';
      const count = domainState.templateCounts[template] || 0;
      return count < (constraints.maxPerTemplate[template] || Infinity);
    });
  }

  // ── EXPOSURE CONTROL ──
  if (constraints.exposureRates) {
    candidates = candidates.filter(item => {
      const rate = constraints.exposureRates[item.itemId];
      if (rate === undefined) return true;
      return Math.random() < rate;
    });
  }

  // Fall back to full pool if all filters eliminated everything
  if (candidates.length === 0) {
    candidates = [...pool];
    if (domainState?.enemyIds && typeof domainState.enemyIds.has === 'function') {
      const nonEnemy = candidates.filter(item => !domainState.enemyIds.has(item.itemId));
      if (nonEnemy.length > 0) candidates = nonEnemy;
    }
  }

  // ── MAXIMUM INFORMATION SELECTION ──
  let bestItem = null;
  let bestInfo = -Infinity;

  for (const item of candidates) {
    const a = item.irt_a || 1.0;
    const b = item.irt_b || 0;
    const c = item.irt_c || 0.25;
    const info = fisherInfo(theta, a, b, c);

    const jitter = 1 + (Math.random() - 0.5) * 0.02;
    const adjustedInfo = info * jitter;

    if (adjustedInfo > bestInfo) {
      bestInfo = adjustedInfo;
      bestItem = item;
    }
  }

  return bestItem;
}

// ═══ SCORING / DESCRIPTORS ═══

function thetaDescriptor(theta) {
  if (theta >= 2.0) return 'Exceptionally High';
  if (theta >= 1.5) return 'Very High';
  if (theta >= 1.0) return 'High';
  if (theta >= 0.5) return 'Above Average';
  if (theta >= -0.5) return 'Average';
  if (theta >= -1.0) return 'Below Average';
  if (theta >= -1.5) return 'Low';
  if (theta >= -2.0) return 'Very Low';
  return 'Exceptionally Low';
}

function thetaToStandardScore(theta) {
  return Math.round(100 + 15 * theta);
}

// ═══ STATE MANAGEMENT ═══

function getAgeBand(user) {
  if (!user) return 'A';
  
  const age = user.date_of_birth
    ? Math.floor((Date.now() - new Date(user.date_of_birth).getTime()) / 31557600000)
    : parseInt(user.age_band?.split('-')[0]) || 8;
  if (age <= 11) return 'A';
  if (age <= 14) return 'B';
  return 'C';
}

function initializeState(ageBand, domainList, maxItemsPerDomainMap = {}) {
  if (!domainList || !Array.isArray(domainList) || domainList.length === 0) {
    throw new Error('initializeState: domainList must be a non-empty array');
  }

  const domains = {};
  for (const d of domainList) {
    if (!d || typeof d !== 'string') continue;
    const cap = parseInt(maxItemsPerDomainMap?.[d], 10);
    const maxItems = (Number.isFinite(cap) && cap > 0) ? cap : MAX_ITEMS_PER_DOMAIN;
    domains[d] = {
      theta: 0.0,
      sem: 1.0,
      responses: [],
      itemsServed: 0,
      maxItems,                // ← per-domain configurable cap
      completed: false,
      timerMode: TIMER_MODES[d] || 'soft',
      templateCounts: {},
      enemyIds: new Set(),
    };
  }

  return {
    type: 'cognitive',
    ageBand: ageBand || 'A',
    currentDomainIndex: 0,
    domainOrder: [...domainList],
    domains,
    servedItemIds: [],
    globalTheta: null,
    globalSem: null,
  };
}

function processResponse(state, domain, itemParams, isCorrect, itemCode, responseTimeMs) {
  if (!state?.domains?.[domain]) {
    console.error('processResponse: Invalid state or domain', { domain, state });
    return;
  }

  const ds = state.domains[domain];

  // Ensure enemyIds is always a Set
  if (!ds.enemyIds || !(ds.enemyIds instanceof Set)) {
    ds.enemyIds = new Set();
  }

  // Record response
  ds.responses.push({
    itemCode,
    a: parseFloat(itemParams.a) || 1.0,
    b: parseFloat(itemParams.b) || 0.0,
    c: parseFloat(itemParams.c) || 0.25,
    correct: !!isCorrect,
    responseTimeMs: responseTimeMs || 0,
  });

  // Re-estimate theta using all responses
  ds.theta = estimateTheta(ds.responses);
  ds.sem = thetaSE(ds.theta, ds.responses);
  ds.itemsServed = ds.responses.length;

  // Check stopping rules
  if (shouldStopDomain(ds)) {
    ds.completed = true;
  }
}

function shouldStopDomain(ds) {
  if (!ds) return true;
  const cap = ds.maxItems || MAX_ITEMS_PER_DOMAIN;
  if ((ds.itemsServed || 0) >= cap) return true;
  if ((ds.itemsServed || 0) >= MIN_ITEMS_PER_DOMAIN && (ds.sem || 1.0) < SEM_THRESHOLD) return true;
  return false;
}

function isSessionComplete(state) {
  if (!state?.domains) return false;
  return Object.values(state.domains).every(ds => (ds?.completed || false));
}

async function pickNextItem(state) {
  // Defensive validation - FAIL FAST
  if (!state || typeof state !== 'object') {
    console.error('pickNextItem: Invalid state object');
    return null;
  }

  if (!state.domains || typeof state.domains !== 'object' || Object.keys(state.domains).length === 0) {
    console.error('pickNextItem: State missing or empty domains');
    return null;
  }

  const domainList = state.domainOrder || Object.keys(state.domains);
  if (!domainList || !Array.isArray(domainList) || domainList.length === 0) {
    console.error('pickNextItem: No domains available');
    return null;
  }

  // Find current active domain
  let domIdx = Number(state.currentDomainIndex) || 0;
  while (domIdx < domainList.length) {
    const domain = domainList[domIdx];
    const ds = state.domains[domain];
    
    if (!ds || ds.completed) {
      domIdx++;
      continue;
    }
    break;
  }

  if (domIdx >= domainList.length) {
    return null; // All domains done
  }

  state.currentDomainIndex = domIdx;
  const domain = domainList[domIdx];
  const ds = state.domains[domain];

  if (!ds) {
    console.error(`pickNextItem: Domain state missing for ${domain}`);
    return null;
  }

  // Ensure domain state has required properties
  if (!ds.enemyIds || !(ds.enemyIds instanceof Set)) {
    ds.enemyIds = new Set();
  }
  if (!ds.templateCounts) {
    ds.templateCounts = {};
  }

  // Determine age band access with escalation
  const ab = AGE_BANDS[state.ageBand];
  if (!ab) {
    console.error(`pickNextItem: Invalid ageBand: ${state.ageBand}`);
    ds.completed = true;
    return pickNextItem(state);
  }

  let ageMin = ab.min;
  let ageMax = ab.max;

  if (ds.theta >= ESCALATION_THETA_C) {
    ageMax = 18;
  } else if (ds.theta >= ESCALATION_THETA_B) {
    ageMax = 14;
  }

  // Ensure servedItemIds is array
  if (!Array.isArray(state.servedItemIds)) {
    state.servedItemIds = [];
  }
  
  const excludeIds = state.servedItemIds;
  
  try {
    let result = await pool.query(`
      SELECT *,
        COALESCE(irt_a, 1.0) AS irt_a,
        COALESCE(irt_b, 0.0) AS irt_b,
        COALESCE(irt_c, 0.25) AS irt_c
      FROM items
      WHERE domain = $1
        AND is_active = true
        AND is_practice = false
        AND age_band_min <= $2
        AND age_band_max >= $3
        AND item_code != ALL($4::text[])
      ORDER BY RANDOM()
    `, [domain, ageMax, ageMin, excludeIds.length ? excludeIds : ['NONE']]);

    // Fallback: if no items match the age band, serve any active items for this domain
    if (!result?.rows || result.rows.length === 0) {
      console.log(`[CAT] No items for domain=${domain} ageBand=[${ageMin}-${ageMax}], falling back to all active items`);
      result = await pool.query(`
        SELECT *,
          COALESCE(irt_a, 1.0) AS irt_a,
          COALESCE(irt_b, 0.0) AS irt_b,
          COALESCE(irt_c, 0.25) AS irt_c
        FROM items
        WHERE domain = $1
          AND is_active = true
          AND is_practice = false
          AND item_code != ALL($2::text[])
        ORDER BY RANDOM()
      `, [domain, excludeIds.length ? excludeIds : ['NONE']]);
    }

    if (!result?.rows || result.rows.length === 0) {
      ds.completed = true;
      return pickNextItem(state);
    }

    // Convert DB items to pool format
    const itemPool = result.rows.map(item => ({
      ...item,
      itemId: item.item_code,
      irt_a: parseFloat(item.irt_a) || 1.0,
      irt_b: parseFloat(item.irt_b) || 0.0,
      irt_c: parseFloat(item.irt_c) || 0.25,
    }));

    // Select best item using Maximum Information
    const selectedItem = selectNextItem({
      pool: itemPool,
      theta: ds.theta,
      domainState: ds,
      constraints: {},
    });

    if (!selectedItem) {
      ds.completed = true;
      return pickNextItem(state);
    }

    // Track served items
    state.servedItemIds.push(selectedItem.item_code);

    // Track enemy items - SAFE VERSION
    if (selectedItem.enemy_items && Array.isArray(selectedItem.enemy_items)) {
      for (const enemyCode of selectedItem.enemy_items) {
        if (enemyCode && typeof enemyCode === 'string') {
          ds.enemyIds.add(enemyCode);
        }
      }
    }

    // Track template/content constraint
    const template = selectedItem.template || selectedItem.content_constraint || 'default';
    ds.templateCounts[template] = (ds.templateCounts[template] || 0) + 1;

    return { item: selectedItem, domain };

  } catch (error) {
    console.error(`pickNextItem: Database error for domain ${domain}:`, error);
    ds.completed = true;
    return pickNextItem(state);
  }
}

// ═══════════════════════════════════════════════════════════════
// formatItemForClient — updated for v2 Excel format
//
// v2 content object fields (set by items.js upload route):
//   promptText    — the question prompt  (was: prompt)
//   stimulusRow1  — first stimulus line  (was: sequence array built from shapeA/shapeB)
//   stimulusRow2  — second stimulus line (new in v2)
//   display       — 'image' | 'text'     (was: displayMode)
//   format        — '3-choice' etc.      (was: not stored)
//   options       — array of {value, label, tag}  ✓ unchanged
//   correctIndex  — 0-based int                   ✓ unchanged
//   narrowAbility, chcCode, ruleType, ruleDims, subtype, cogDevStage  — new metadata
//   distractorRationale — new in v2
//
// The frontend (TestRunner) reads:
//   item.prompt        → must be a string (renders via dangerouslySetInnerHTML)
//   item.sequence      → array used by SequenceDisplay (null entries = '?')
//   item.displayMode   → controls SequenceDisplay layout ('matrix','linear', etc.)
//   item.options       → array of {value, label, tag}
//   item.correctIndex  → 0-based
//   item.timeLimitSec  → timer
//   item.domain        → domain key
//   item.difficulty    → shown as "Lv.X" in header
//   item.itemId        → shown top-right
// ═══════════════════════════════════════════════════════════════
function formatItemForClient(dbItem, domainState) {
  if (!dbItem) return null;
  
  const c = dbItem.content || {};

  // ── prompt ────────────────────────────────────────────────────
  // v2 stores the full prompt in c.promptText; fall back to the
  // old c.prompt field for backwards compatibility with any items
  // uploaded before this migration.
  const prompt = (c.promptText || c.prompt || 'Which comes <hl>next</hl>?')
    .replace(/\bNaN\b/g, '')   // strip NaN artifacts from Excel formula cells
    .trim();

  // ── sequence ──────────────────────────────────────────────────
  // v2 stimulus strings come in several formats:
  //
  //   Series / linear:
  //     "circle_xs → circle_sm → circle_md → circle_lg → ?"
  //
  //   Matrix (2×2):
  //     stimulusRow1 = "Row 1: triangle_lg | triangle_sm"
  //     stimulusRow2 = "Row 2: circle_lg | ?"
  //
  //   Analogy (A : B :: C : ?):
  //     "circle_lg : circle_sm :: square_lg : ?"
  //
  //   Odd-one-out (flat | separated, no row prefix):
  //     "circle_md | circle_md | circle_md | square_md"
  //
  //   Legacy bracket notation (pre-migration):
  //     "[small circle] → [large circle] → ?"
  //
  // The frontend SequenceDisplay expects an array where null = the
  // blank ('?') position.  Each token string is kept as-is so
  // TokenRenderer on the frontend can decide how to render it.
  //
  // Rules:
  //   1. If old c.sequence array is present → use it directly (legacy).
  //   2. Otherwise parse stimulusRow1 (and stimulusRow2 when present).
  //   3. Strip any [bracket] wrappers from individual tokens.
  //   4. Replace bare "?" or "[?]" tokens with null.

  /**
   * Parse a single stimulus string into an array of token strings (null = '?').
   * Handles →, Row N: … |, plain |, and : :: analogy separators.
   */
  function parseStimulus(str) {
    if (!str || typeof str !== 'string') return [];
    let s = str.trim();

    // Strip "Row N: " prefix (matrix items)
    s = s.replace(/^Row\s*\d+\s*:\s*/i, '');

    // Determine separator and split
    let parts;
    if (s.includes('→')) {
      parts = s.split(/\s*→\s*/);
    } else if (s.includes('::')) {
      // Analogy: "A : B :: C : ?" — split on '::' first, then ':'
      parts = s.split(/\s*::\s*/).flatMap(half => half.split(/\s*:\s*/));
    } else if (s.includes('|')) {
      parts = s.split(/\s*\|\s*/);
    } else {
      parts = [s];
    }

    return parts.map(raw => {
      // Strip outer [ ] brackets (legacy bracket notation)
      const clean = raw.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
      return (clean === '?' || clean === '') ? null : clean;
    });
  }

  let sequence = [];

  if (c.sequence && Array.isArray(c.sequence) && c.sequence.length > 0) {
    // Legacy items uploaded before v2 migration — keep as-is
    sequence = c.sequence;
  } else if (c.stimulusRow1) {
    sequence = parseStimulus(c.stimulusRow1);

    // For matrix items stimulusRow2 exists — append so SequenceDisplay
    // can lay them out in a 2×2 grid when displayMode === 'matrix'
    if (c.stimulusRow2) {
      sequence = [...sequence, ...parseStimulus(c.stimulusRow2)];
    }
  }

  // ── displayMode ───────────────────────────────────────────────
  // Priority:
  //   1. content.displayMode (saved from Excel "Display Mode" column)
  //   2. Infer from template name (fallback for legacy items)
  let displayMode = c.displayMode || '';
  if (!displayMode && dbItem.template) {
    const t = dbItem.template.toLowerCase();
    if (t.includes('matrix'))       displayMode = 'matrix';
    else if (t.includes('analogy')) displayMode = 'analogy';
    else if (t.includes('odd'))     displayMode = 'odd_one_out';
    else if (t.includes('reflect')) displayMode = 'reflection';
    else                            displayMode = 'linear';
  }

  // ── options ───────────────────────────────────────────────────
  // Always stored as [{value, label, tag}] in c.options.
  // Strip any legacy [bracket] notation from values/labels so
  // TokenRenderer receives clean token strings.
  const stripBrackets = (s) =>
    s ? String(s).trim().replace(/^\[/, '').replace(/\]$/, '').trim() : s;

  const options = (c.options || []).map(o => {
    const val = stripBrackets(o.value);
    return {
      value: val,
      label: stripBrackets(o.label) || val,
      tag:   o.tag || 'distractor',
      score: o.score ?? null,
    };
  });

  // ── Resolve correct answer index ─────────────────────────────
  // Priority: correctAns letter (most reliable) → stored correctIndex → fallback 0
  let correctIndex = c.correctIndex ?? 0;
  if (c.correctAns) {
    const letter = String(c.correctAns).trim().toUpperCase();
    const letterMap = { A: 0, B: 1, C: 2, D: 3 };
    if (letterMap[letter] !== undefined && letterMap[letter] < options.length) {
      correctIndex = letterMap[letter];
    }
  }
  // Fix option tags to match the resolved correctIndex
  options.forEach((o, i) => {
    o.tag = i === correctIndex ? 'correct' : (o.tag === 'correct' ? 'distractor' : o.tag);
  });

  return {
    // Identity
    _dbItemId:   dbItem.id,
    itemId:      dbItem.item_code,
    domain:      dbItem.domain,
    template:    dbItem.template,
    difficulty:  dbItem.difficulty_level,

    // Rendered content
    prompt,
    sequence,
    displayMode,
    options,
    correctIndex,

    // Stimulus strings kept for reference / future rich renderer
    stimulusRow1: c.stimulusRow1 || null,
    stimulusRow2: c.stimulusRow2 || null,

    // Presentation
    display:      c.display      || 'image',
    format:       c.format       || '3-choice',

    // Timer
    timeLimitSec: dbItem.time_limit_sec || 20,
    timerMode:    dbItem.timer_mode || domainState?.timerMode || 'soft',

    // Extra metadata (available to frontend if needed)
    narrowAbility:       c.narrowAbility       || null,
    chcCode:             c.chcCode             || null,
    ruleType:            c.ruleType            || null,
    ruleDims:            c.ruleDims            ?? null,
    subtype:             c.subtype             || null,
    cogDevStage:         c.cogDevStage         || null,
    distractorRationale: c.distractorRationale || null,
  };
}

// ═══ EXPORTS ═══
module.exports = {
  // IRT Math
  prob3PL,
  fisherInfo,
  estimateTheta,
  thetaSE,
  
  // Item Selection
  selectNextItem,
  
  // Scoring
  thetaDescriptor,
  thetaToStandardScore,
  
  // State Management
  getAgeBand,
  initializeState,
  processResponse,
  isSessionComplete,
  pickNextItem,
  formatItemForClient,
  
  // Constants & config
  get MAX_ITEMS_PER_DOMAIN() { return MAX_ITEMS_PER_DOMAIN; },
  setMaxItemsPerDomain,
  DOMAIN_ORDER,
  DOMAIN_WEIGHTS,
};