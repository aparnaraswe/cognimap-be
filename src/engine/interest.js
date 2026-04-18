// ══════════════════════════════════════════════════════
// INTEREST ENGINE — Holland RIASEC career interest profiling
// ══════════════════════════════════════════════════════
// Students rate how much they'd enjoy different activities (1-5)
// or make forced-choice preference pairs.
// Score = dimension sums mapped to Holland codes.

const RIASEC_DIMENSIONS = {
    realistic:      { label: 'Realistic',      abbr: 'R', color: '#DC2626', icon: '🔧',
                      desc: 'Hands-on, practical activities — building, fixing, outdoors' },
    investigative:  { label: 'Investigative',  abbr: 'I', color: '#6366F1', icon: '🔬',
                      desc: 'Research, analysis, problem-solving — science, math, data' },
    artistic:       { label: 'Artistic',       abbr: 'A', color: '#EC4899', icon: '🎨',
                      desc: 'Creative expression — writing, design, music, visual arts' },
    social:         { label: 'Social',         abbr: 'S', color: '#F59E0B', icon: '👥',
                      desc: 'Helping, teaching, counseling — working with people' },
    enterprising:   { label: 'Enterprising',   abbr: 'E', color: '#059669', icon: '📊',
                      desc: 'Leading, persuading, managing — business, sales, politics' },
    conventional:   { label: 'Conventional',   abbr: 'C', color: '#0891B2', icon: '📁',
                      desc: 'Organizing, data management — finance, administration, systems' },
};

function initializeState(dimensions = Object.keys(RIASEC_DIMENSIONS), maxItemsPerDimMap = {}) {
    const dimState = {};
    for (const d of dimensions) {
        const cap = parseInt(maxItemsPerDimMap?.[d], 10);
        const maxItems = (Number.isFinite(cap) && cap > 0) ? cap : 8;
        dimState[d] = { rawSum: 0, itemCount: 0, maxItems, responses: [], completed: false };
    }
    const firstCap = parseInt(maxItemsPerDimMap?.[dimensions[0]], 10);
    return {
        type: 'interest',
        dimensions: dimState,
        currentDimIndex: 0,
        dimOrder: [...dimensions],
        servedItemIds: [],
        maxItemsPerDim: (Number.isFinite(firstCap) && firstCap > 0) ? firstCap : 8,
    };
}

function processResponse(state, dimension, likertValue) {
    const ds = state.dimensions[dimension];
    if (!ds) return;
    ds.rawSum += likertValue;
    ds.itemCount += 1;
    ds.responses.push(likertValue);
}

function markDimDone(state, dim) {
    if (state.dimensions[dim]) state.dimensions[dim].completed = true;
}

function getCurrentDimension(state) {
    while (state.currentDimIndex < state.dimOrder.length) {
        const d = state.dimOrder[state.currentDimIndex];
        if (!state.dimensions[d].completed) return d;
        state.currentDimIndex++;
    }
    return null;
}

function isComplete(state) {
    return Object.values(state.dimensions).every(d => d.completed);
}

function computeResults(state, strengthBands) {
    // strengthBands parameter is accepted for API consistency;
    // narrative generation uses it in reportGenerator.js
    // Core computation (scores, Holland code) remains unchanged.
    const results = {};
    const scores = [];
    for (const [dim, ds] of Object.entries(state.dimensions)) {
        const maxPossible = ds.itemCount * 5;
        const percentage = maxPossible > 0 ? Math.round((ds.rawSum / maxPossible) * 100) : 0;
        results[dim] = {
            ...RIASEC_DIMENSIONS[dim],
            rawSum: ds.rawSum,
            itemCount: ds.itemCount,
            percentage,
        };
        scores.push({ dim, percentage });
    }
    // Top 3 Holland code
    scores.sort((a, b) => b.percentage - a.percentage);
    const hollandCode = scores.slice(0, 3).map(s => RIASEC_DIMENSIONS[s.dim].abbr).join('');
    return { dimensions: results, hollandCode, topThree: scores.slice(0, 3).map(s => s.dim) };
}

function formatItemForClient(dbItem) {
    const c = dbItem.content || {};
    return {
        _dbItemId: dbItem.id,
        itemId: dbItem.item_code,
        domain: dbItem.domain,
        subdomain: c.dimension || c.subdomain || '',
        type: 'interest',
        activity: c.activity || c.statement || c.prompt || '',
        likertLabels: [
            { value: 1, label: 'Not at all' },
            { value: 2, label: 'A little' },
            { value: 3, label: 'Somewhat' },
            { value: 4, label: 'Quite a lot' },
            { value: 5, label: 'Very much' },
        ],
    };
}

module.exports = {
    RIASEC_DIMENSIONS,
    initializeState,
    processResponse,
    markDimDone,
    getCurrentDimension,
    isComplete,
    computeResults,
    formatItemForClient,
};
