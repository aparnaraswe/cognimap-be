// ══════════════════════════════════════════════════════
// REPORT GENERATOR — Produces separate reports per assessment
// type + compiled career guidance report
// ══════════════════════════════════════════════════════

const { BIG_FIVE_TRAITS } = require('./personality');
const { RIASEC_DIMENSIONS } = require('./interest');
const { generateCareerReport } = require('./careerGuidance');

const DOMAIN_NAMES = {
    gf: 'Fluid Reasoning', gv: 'Visual Spatial', gq: 'Quantitative Reasoning',
    gc: 'Verbal Reasoning', gs: 'Processing Speed'
};

const CLUSTER_NAMES = {
    analytical: 'Analytical Thinking', design: 'Design & Spatial Awareness',
    communication: 'Communication & Language', operational: 'Speed & Execution',
    strategic: 'Strategic Planning'
};

function classifyAbility(theta, thresholds) {
    const t = thresholds || { exceptional: 1.5, advanced: 0.5, age_appropriate: -1.5 };
    if (theta >= t.exceptional) return { level: 'exceptional', label: 'Exceptional', color: '#7C3AED' };
    if (theta >= t.advanced) return { level: 'advanced', label: 'Advanced', color: '#059669' };
    if (theta >= t.age_appropriate) return { level: 'age_appropriate', label: 'Age Appropriate', color: '#D97706' };
    return { level: 'developing', label: 'Developing', color: '#DC2626' };
}

// ═══════════════════════════════════════
// APTITUDE REPORT (cognitive abilities)
// ═══════════════════════════════════════
function generateAptitudeReport(adaptiveState, user, config) {
    const state = typeof adaptiveState === 'string' ? JSON.parse(adaptiveState) : adaptiveState;
    if (!state || !state.domains) return null;

    const ageBand = state.ageBand || 'A';
    const ageBandLabel = { A: '8-11', B: '12-14', C: '15-18' }[ageBand] || '8-11';

    // Use config-provided values or fall back to hardcoded defaults
    const classificationThresholds = config?.classificationThresholds || null;
    const cfgNarratives = config?.narrativeTemplates?.aptitude || null;

    const domainReports = [];
    const domainOrder = ['gf', 'gv', 'gq', 'gc', 'gs'];

    const defaultNarratives = {
        gf: {
            exceptional: `demonstrates outstanding pattern recognition and abstract reasoning ability, significantly above age expectations.`,
            advanced: `shows strong fluid reasoning skills, performing above typical expectations for this age group.`,
            age_appropriate: `demonstrates fluid reasoning skills on track for this age band.`,
            developing: `shows emerging fluid reasoning skills that may benefit from targeted support.`
        },
        gv: {
            exceptional: `displays exceptional visual-spatial processing and mental rotation abilities.`,
            advanced: `shows strong visual-spatial abilities above age expectations.`,
            age_appropriate: `demonstrates visual-spatial skills appropriate for this age.`,
            developing: `shows developing visual-spatial skills.`
        },
        gq: {
            exceptional: `exhibits outstanding quantitative reasoning and mathematical logic.`,
            advanced: `demonstrates strong quantitative abilities above age-level expectations.`,
            age_appropriate: `shows quantitative reasoning skills on track for this age band.`,
            developing: `demonstrates emerging quantitative skills.`
        },
        gc: {
            exceptional: `shows exceptional verbal reasoning, vocabulary depth, and analogical thinking.`,
            advanced: `demonstrates strong verbal reasoning above age expectations.`,
            age_appropriate: `shows verbal reasoning skills appropriate for this age band.`,
            developing: `shows developing verbal skills.`
        },
        gs: {
            exceptional: `demonstrates exceptional processing speed and rapid decision-making.`,
            advanced: `shows strong processing speed above typical expectations.`,
            age_appropriate: `demonstrates processing speed appropriate for this age group.`,
            developing: `shows developing processing speed.`
        }
    };

    const narratives = cfgNarratives || defaultNarratives;

    for (const dom of domainOrder) {
        const ds = state.domains[dom];
        if (!ds) continue;
        const theta = ds.theta || 0;
        const cls = classifyAbility(theta, classificationThresholds);
        const name = DOMAIN_NAMES[dom] || dom;
        domainReports.push({
            domain: dom, domainName: name,
            theta: Math.round(theta * 100) / 100,
            classification: cls,
            itemsServed: ds.itemsServed || 0,
            narrative: `The student ${(narratives[dom] || defaultNarratives.gf)[cls.level]}`
        });
    }

    // Global theta
    const weights = config?.domainWeights || { gf: 0.30, gv: 0.20, gq: 0.20, gc: 0.15, gs: 0.15 };
    let globalTheta = 0;
    for (const dom of domainOrder) {
        const ds = state.domains[dom];
        if (ds) globalTheta += (ds.theta || 0) * (weights[dom] || 0.20);
    }
    globalTheta = Math.round(globalTheta * 100) / 100;
    const globalClass = classifyAbility(globalTheta, classificationThresholds);

    // Clusters
    const clusterFormulas = config?.clusterFormulas || {
        analytical: { gf: 0.6, gq: 0.4 },
        design: { gv: 1.0 },
        communication: { gc: 1.0 },
        operational: { gs: 1.0 },
        strategic: { gf: 0.7, gv: 0.3 }
    };
    const t = {};
    for (const dom of domainOrder) t[dom] = state.domains[dom]?.theta || 0;
    const clusterScores = {};
    for (const [cluster, formula] of Object.entries(clusterFormulas)) {
        let score = 0;
        for (const [dom, weight] of Object.entries(formula)) {
            score += (t[dom] || 0) * weight;
        }
        clusterScores[cluster] = score;
    }

    const clusterReports = Object.entries(clusterScores)
        .map(([key, score]) => ({
            cluster: key,
            clusterName: CLUSTER_NAMES[key] || key,
            score: Math.round(score * 100) / 100,
            percentage: Math.round(((score + 3) / 6) * 100),
            classification: classifyAbility(score, classificationThresholds),
        }))
        .sort((a, b) => b.score - a.score);

    const sortedDomains = [...domainReports].sort((a, b) => b.theta - a.theta);
    const strengths = sortedDomains.slice(0, 2).map(d => d.domainName);
    const developmentAreas = sortedDomains.slice(-2).map(d => d.domainName);

    return {
        type: 'aptitude',
        studentName: user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Student',
        ageBand: ageBandLabel,
        grade: user?.grade || '',
        section: user?.section || '',
        testDate: new Date().toISOString(),
        globalTheta, globalClassification: globalClass,
        strengths, developmentAreas,
        domainReports, clusterReports,
        totalItemsServed: domainReports.reduce((s, d) => s + d.itemsServed, 0),
    };
}

// ═══════════════════════════════════════
// PERSONALITY REPORT (Big Five)
// ═══════════════════════════════════════
function generatePersonalityReport(personalityResults, user, config) {
    if (!personalityResults) return null;
    const cfgPersonalityNarratives = config?.narrativeTemplates?.personality || null;
    const traits = {};
    for (const [key, data] of Object.entries(personalityResults)) {
        if (!data.percentage && data.percentage !== 0) continue;
        traits[key] = {
            ...data,
            narrative: getPersonalityNarrative(key, data.level, cfgPersonalityNarratives),
        };
    }
    return {
        type: 'personality',
        studentName: user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Student',
        testDate: new Date().toISOString(),
        traits,
    };
}

function getPersonalityNarrative(trait, level, customNarratives) {
    if (customNarratives && customNarratives[trait] && customNarratives[trait][level]) {
        return customNarratives[trait][level];
    }
    const narratives = {
        openness: {
            high: 'Shows strong curiosity, creativity, and willingness to explore new ideas and experiences.',
            moderate: 'Demonstrates a balanced approach to new experiences — open but also values familiarity.',
            low: 'Prefers established routines and concrete, practical approaches over abstract ideas.',
        },
        conscientiousness: {
            high: 'Highly organized, dependable, and goal-oriented. Strong self-discipline and follow-through.',
            moderate: 'Generally organized with occasional flexibility. Balances structure with adaptability.',
            low: 'Prefers spontaneity and flexibility over rigid structure. May benefit from planning support.',
        },
        extraversion: {
            high: 'Energized by social interaction. Naturally outgoing, expressive, and leadership-oriented.',
            moderate: 'Comfortable in both social and solitary settings. Adaptable communication style.',
            low: 'Draws energy from solitude and reflection. Prefers deep one-on-one connections.',
        },
        agreeableness: {
            high: 'Naturally empathetic, cooperative, and concerned with others\' wellbeing.',
            moderate: 'Balances cooperation with healthy assertiveness. Team-oriented but can stand firm.',
            low: 'Values direct communication and independent thinking over social harmony.',
        },
        neuroticism: {
            high: 'May experience heightened emotional sensitivity. Could benefit from stress management strategies.',
            moderate: 'Generally stable with normal emotional responses to challenging situations.',
            low: 'Demonstrates exceptional emotional resilience and composure under pressure.',
        },
    };
    return (narratives[trait] || {})[level] || '';
}

// ═══════════════════════════════════════
// INTEREST REPORT (Holland RIASEC)
// ═══════════════════════════════════════
function generateInterestReport(interestResults, user, config) {
    if (!interestResults) return null;
    const cfgInterestNarratives = config?.narrativeTemplates?.interest || null;
    const cfgStrengthBands = config?.interestStrengthBands || null;
    const dims = {};
    if (interestResults.dimensions) {
        for (const [key, data] of Object.entries(interestResults.dimensions)) {
            dims[key] = {
                ...data,
                narrative: getInterestNarrative(key, data.percentage, cfgStrengthBands, cfgInterestNarratives),
            };
        }
    }
    return {
        type: 'interest',
        studentName: user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Student',
        testDate: new Date().toISOString(),
        hollandCode: interestResults.hollandCode || '',
        topThree: interestResults.topThree || [],
        dimensions: dims,
    };
}

function getInterestNarrative(dim, pct, strengthBands, customNarratives) {
    const bands = strengthBands || { strong: 70, moderate: 45 };
    const strength = pct >= bands.strong ? 'strong' : pct >= bands.moderate ? 'moderate' : 'low';
    if (customNarratives && customNarratives[dim] && customNarratives[dim][strength]) {
        return customNarratives[dim][strength];
    }
    const narratives = {
        realistic: { strong: 'Shows strong interest in hands-on, practical work with tools, machines, and the physical world.', moderate: 'Has some interest in practical, hands-on activities alongside other areas.', low: 'Less drawn to hands-on physical activities; prefers other types of work.' },
        investigative: { strong: 'Strongly drawn to research, analysis, and intellectual problem-solving.', moderate: 'Shows balanced interest in analytical work and other domains.', low: 'Less drawn to pure research and analysis; prefers more applied or social work.' },
        artistic: { strong: 'Strongly drawn to creative expression, design, and unstructured problem-solving.', moderate: 'Appreciates creativity while also valuing structure in some areas.', low: 'Prefers structured environments over open-ended creative work.' },
        social: { strong: 'Strongly motivated by helping, teaching, and working closely with others.', moderate: 'Values working with people while also enjoying independent tasks.', low: 'Prefers independent work over highly collaborative or helping-oriented roles.' },
        enterprising: { strong: 'Strongly drawn to leadership, persuasion, and business/organizational challenges.', moderate: 'Shows interest in leadership opportunities while valuing other work styles too.', low: 'Prefers collaborative or technical roles over leadership-focused positions.' },
        conventional: { strong: 'Naturally inclined toward organized, structured, data-oriented work.', moderate: 'Appreciates structure and order while maintaining flexibility.', low: 'Prefers variety and flexibility over highly structured, routine-based work.' },
    };
    return (narratives[dim] || {})[strength] || '';
}

// ═══════════════════════════════════════
// COMPILED REPORT (everything combined)
// ═══════════════════════════════════════
function generateCompiledReport(aptitudeState, personalityResults, interestResults, user, config) {
    const aptitudeReport = generateAptitudeReport(aptitudeState, user, config);
    const personalityReport = generatePersonalityReport(personalityResults, user, config);
    const interestReport = generateInterestReport(interestResults, user, config);
    const careerReport = generateCareerReport(aptitudeReport, personalityResults, interestResults, user, config);

    return {
        type: 'compiled',
        studentName: user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Student',
        generatedAt: new Date().toISOString(),
        grade: user?.grade || '',
        section: user?.section || '',
        sections: {
            aptitude: aptitudeReport,
            personality: personalityReport,
            interest: interestReport,
            career: careerReport,
        },
        summary: careerReport?.summary || null,
    };
}

// Legacy support — old generateFullReport still works
function generateFullReport(adaptiveState, user) {
    return generateAptitudeReport(adaptiveState, user);
}

module.exports = {
    generateFullReport,
    generateAptitudeReport,
    generatePersonalityReport,
    generateInterestReport,
    generateCompiledReport,
    classifyAbility,
    DOMAIN_NAMES,
    CLUSTER_NAMES,
};
