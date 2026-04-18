// ══════════════════════════════════════════════════════
// PERSONALITY ENGINE — Big Five (OCEAN) trait scoring
// ══════════════════════════════════════════════════════
// Unlike adaptive.js, personality has NO correct answers.
// Students rate statements on a 1-5 Likert scale.
// Score = trait sums, not theta.

const BIG_FIVE_TRAITS = {
    openness:          { label: 'Openness to Experience', abbr: 'O', color: '#8B5CF6', icon: '🎨' },
    conscientiousness: { label: 'Conscientiousness',      abbr: 'C', color: '#059669', icon: '📋' },
    extraversion:      { label: 'Extraversion',            abbr: 'E', color: '#F59E0B', icon: '🗣️' },
    agreeableness:     { label: 'Agreeableness',           abbr: 'A', color: '#EC4899', icon: '🤝' },
    neuroticism:       { label: 'Emotional Stability',     abbr: 'N', color: '#6366F1', icon: '🧘' },
};

const LIKERT_LABELS = [
    { value: 1, label: 'Strongly Disagree' },
    { value: 2, label: 'Disagree' },
    { value: 3, label: 'Neutral' },
    { value: 4, label: 'Agree' },
    { value: 5, label: 'Strongly Agree' },
];

function initializeState(traits = Object.keys(BIG_FIVE_TRAITS), maxItemsPerTraitMap = {}) {
    const traitState = {};
    for (const t of traits) {
        const cap = parseInt(maxItemsPerTraitMap?.[t], 10);
        const maxItems = (Number.isFinite(cap) && cap > 0) ? cap : 10;
        traitState[t] = {
            rawSum: 0,
            itemCount: 0,
            maxItems,
            responses: [],
            completed: false,
        };
    }
    // Backward-compat global cap (uses the first trait's value or default 10)
    const firstCap = parseInt(maxItemsPerTraitMap?.[traits[0]], 10);
    return {
        type: 'personality',
        traits: traitState,
        currentTraitIndex: 0,
        traitOrder: [...traits],
        servedItemIds: [],
        maxItemsPerTrait: (Number.isFinite(firstCap) && firstCap > 0) ? firstCap : 10,
    };
}

function processResponse(state, trait, likertValue, isReversed) {
    const ts = state.traits[trait];
    if (!ts) return;
    // Reverse-scored items: 1→5, 2→4, 3→3, 4→2, 5→1
    const score = isReversed ? (6 - likertValue) : likertValue;
    ts.rawSum += score;
    ts.itemCount += 1;
    ts.responses.push({ value: likertValue, scored: score, isReversed });
}

function markTraitDone(state, trait) {
    if (state.traits[trait]) state.traits[trait].completed = true;
}

function getCurrentTrait(state) {
    while (state.currentTraitIndex < state.traitOrder.length) {
        const t = state.traitOrder[state.currentTraitIndex];
        if (!state.traits[t].completed) return t;
        state.currentTraitIndex++;
    }
    return null;
}

function isComplete(state) {
    return Object.values(state.traits).every(t => t.completed);
}

function computeResults(state, cutoffs) {
    const c = cutoffs || { high: 75, moderate: 45 };
    const results = {};
    for (const [trait, ts] of Object.entries(state.traits)) {
        const maxPossible = ts.itemCount * 5;
        const percentage = maxPossible > 0 ? Math.round((ts.rawSum / maxPossible) * 100) : 0;
        const mean = ts.itemCount > 0 ? Math.round((ts.rawSum / ts.itemCount) * 100) / 100 : 0;
        let level, label;
        if (percentage >= c.high) { level = 'high'; label = 'High'; }
        else if (percentage >= c.moderate) { level = 'moderate'; label = 'Moderate'; }
        else { level = 'low'; label = 'Low'; }
        results[trait] = {
            ...BIG_FIVE_TRAITS[trait],
            rawSum: ts.rawSum,
            itemCount: ts.itemCount,
            maxPossible,
            percentage,
            mean,
            level, label,
        };
    }
    return results;
}

function formatItemForClient(dbItem) {
    const c = dbItem.content || {};
    return {
        _dbItemId: dbItem.id,
        itemId: dbItem.item_code,
        domain: dbItem.domain,
        subdomain: c.trait || c.subdomain || '',
        type: 'personality',
        statement: c.statement || c.prompt || '',
        isReversed: c.isReversed || false,
        likertLabels: LIKERT_LABELS,
    };
}

module.exports = {
    BIG_FIVE_TRAITS,
    LIKERT_LABELS,
    initializeState,
    processResponse,
    markTraitDone,
    getCurrentTrait,
    isComplete,
    computeResults,
    formatItemForClient,
};
