// ══════════════════════════════════════════════════════
// CAREER GUIDANCE ENGINE v2 — Profile-to-Pathway
// Generates career fits, degree pathways, and institutions
// matching cognimap_pathway_prototype.html structure
// ══════════════════════════════════════════════════════

const { classifyAbility, DOMAIN_NAMES, CLUSTER_NAMES } = require('./reportGenerator');
const { BIG_FIVE_TRAITS } = require('./personality');
const { RIASEC_DIMENSIONS } = require('./interest');

// ── Career database with degrees and institutions ──
const CAREER_DATABASE = [
    {
        career: 'Data Science & AI', field: 'Technology',
        aptitudeCluster: 'analytical', minAptitude: 70, riasec: 'IRC',
        traits: { openness: 'high', conscientiousness: 'high' },
        degrees: [
            { name: 'B.Tech Computer Science (AI/ML)', match: '97%', sub: '4-year engineering with AI/ML specialisation' },
            { name: 'B.Sc Data Science', match: '94%', sub: '3-year programme with statistics and programming core' },
            { name: 'B.Sc Computer Science', match: '88%', sub: 'Broader CS with elective specialisation in AI' },
        ],
        institutions: [
            { name: 'IIT Bombay', loc: 'Mumbai, India', type: 'india', tags: [['JEE Advanced','it-blue'],['Research-strong','it-purple'],['Top AI/ML','it-teal']], note: 'Strongest AI/ML programme in India.' },
            { name: 'IIT Madras', loc: 'Chennai, India', type: 'india', tags: [['JEE Advanced','it-blue'],['Dedicated DS Dept.','it-purple'],['Strong placement','it-teal']], note: 'Dedicated Data Science & AI department.' },
            { name: 'IIIT Hyderabad', loc: 'Hyderabad, India', type: 'india', tags: [['UGEE','it-blue'],['AI Research','it-purple'],['High quality','it-teal']], note: 'Research-oriented culture with undergrad AI publications.' },
            { name: 'MIT', loc: 'Cambridge, USA', type: 'global', tags: [['SAT/ACT','it-blue'],['Research-first','it-purple'],['Need-blind aid','it-teal']], note: 'Top global AI programme with need-blind admissions.' },
            { name: 'NUS Singapore', loc: 'Singapore', type: 'global', tags: [['A-Levels/IB','it-blue'],['Data Science track','it-purple'],['Scholarship avail.','it-teal']], note: 'Strong Data Science programme with proximity and scholarships.' },
        ],
    },
    {
        career: 'Software Engineer', field: 'Technology',
        aptitudeCluster: 'analytical', minAptitude: 60, riasec: 'IRC',
        traits: { openness: 'high', conscientiousness: 'high' },
        degrees: [
            { name: 'B.Tech Computer Science', match: '96%', sub: '4-year core engineering programme' },
            { name: 'B.Sc Computer Science', match: '90%', sub: '3-year science track with theory orientation' },
            { name: 'B.Tech Information Technology', match: '84%', sub: 'Applied variant with system design emphasis' },
        ],
        institutions: [
            { name: 'IIT Bombay', loc: 'Mumbai, India', type: 'india', tags: [['JEE Advanced','it-blue'],['Top CSE India','it-purple'],['Strong placement','it-teal']], note: 'Consistent top placement in CS across India.' },
            { name: 'IIT Delhi', loc: 'Delhi, India', type: 'india', tags: [['JEE Advanced','it-blue'],['CS Research','it-purple'],['Startup ecosystem','it-teal']], note: 'Strong CS and entrepreneurship ecosystem.' },
            { name: 'BITS Pilani', loc: 'Pilani, India', type: 'india', tags: [['BITSAT','it-blue'],['Dual-degree','it-teal'],['Flexible curriculum','it-purple']], note: 'Autonomous self-paced academic structure.' },
            { name: 'CMU', loc: 'Pittsburgh, USA', type: 'global', tags: [['SAT/ACT','it-blue'],['#1 CS globally','it-purple'],['Very selective','it-amber']], note: 'World\'s top CS programme.' },
            { name: 'Imperial College London', loc: 'London, UK', type: 'global', tags: [['A-Levels/IB','it-blue'],['Strong CS','it-purple'],['Industry links','it-teal']], note: 'Top UK CS with strong industry placement.' },
        ],
    },
    {
        career: 'Research Scientist', field: 'Science',
        aptitudeCluster: 'analytical', minAptitude: 75, riasec: 'IRC',
        traits: { openness: 'high', conscientiousness: 'moderate' },
        degrees: [
            { name: 'B.Sc Physics (Honours)', match: '92%', sub: '3-year honours programme for graduate research' },
            { name: 'B.Sc Mathematics', match: '91%', sub: 'Pure mathematics — highest Gf demand' },
            { name: 'BS-MS Dual 5-year (IISER)', match: '87%', sub: 'Integrated research training across 5 years' },
        ],
        institutions: [
            { name: 'IISc Bangalore', loc: 'Bangalore, India', type: 'india', tags: [['KVPY/JEE','it-blue'],['Research-first','it-purple'],['BS programme','it-teal']], note: 'India\'s top research institution.' },
            { name: 'IISER (any campus)', loc: 'Multiple, India', type: 'india', tags: [['IISER Aptitude/JEE','it-blue'],['BS-MS dual','it-teal'],['Research-funded','it-purple']], note: 'Guaranteed research exposure from undergrad.' },
            { name: 'University of Cambridge', loc: 'Cambridge, UK', type: 'global', tags: [['A-Levels/IB','it-blue'],['Natural Sciences','it-purple'],['Top global','it-teal']], note: 'One of the most rigorous science programmes globally.' },
            { name: 'ETH Zurich', loc: 'Zurich, Switzerland', type: 'global', tags: [['Entrance exam','it-blue'],['Near-free tuition','it-teal'],['Research-strong','it-purple']], note: 'World-class research with near-free tuition.' },
        ],
    },
    {
        career: 'Medical Doctor', field: 'Healthcare',
        aptitudeCluster: 'analytical', minAptitude: 70, riasec: 'ISR',
        traits: { conscientiousness: 'high', agreeableness: 'high' },
        degrees: [
            { name: 'MBBS', match: '95%', sub: '5.5-year programme including internship' },
            { name: 'B.Sc Biomedical Sciences', match: '82%', sub: '3-year programme for graduate medical entry' },
        ],
        institutions: [
            { name: 'AIIMS Delhi', loc: 'Delhi, India', type: 'india', tags: [['NEET','it-blue'],['Top medical India','it-purple'],['Research-strong','it-teal']], note: 'India\'s premier medical institute.' },
            { name: 'CMC Vellore', loc: 'Vellore, India', type: 'india', tags: [['NEET','it-blue'],['Clinical excellence','it-purple'],['Community medicine','it-teal']], note: 'Renowned for clinical training and service orientation.' },
            { name: 'Johns Hopkins', loc: 'Baltimore, USA', type: 'global', tags: [['MCAT','it-blue'],['Top medical globally','it-purple'],['Research-first','it-teal']], note: 'World leader in medical education and research.' },
        ],
    },
    {
        career: 'Quantitative Finance', field: 'Finance',
        aptitudeCluster: 'analytical', minAptitude: 70, riasec: 'ICE',
        traits: { conscientiousness: 'high', openness: 'moderate' },
        flagCondition: { trait: 'extraversion', level: 'low', message: 'Low Extraversion may limit client-facing advisory roles. Quant-focused tracks (trading, risk, modelling) are better fits.' },
        degrees: [
            { name: 'B.Sc Economics (Quantitative)', match: '94%', sub: '3-year programme with econometrics focus' },
            { name: 'B.Tech CS with Finance Minor', match: '90%', sub: 'Engineering pathway into FinTech / Quant Finance' },
            { name: 'B.Sc Mathematics & Statistics', match: '88%', sub: 'Strong theoretical base for actuarial or quant roles' },
        ],
        institutions: [
            { name: 'Delhi School of Economics', loc: 'Delhi, India', type: 'india', tags: [['DSE Entrance','it-blue'],['Theory-strong','it-purple'],['Economics research','it-teal']], note: 'India\'s top economics programme.' },
            { name: 'IIT Bombay (IEOR)', loc: 'Mumbai, India', type: 'india', tags: [['JEE Advanced','it-blue'],['Quant-heavy','it-purple'],['Industry placement','it-teal']], note: 'Best quant finance engineering pathway in India.' },
            { name: 'LSE', loc: 'London, UK', type: 'global', tags: [['A-Levels/IB','it-blue'],['Economics powerhouse','it-purple'],['High cost','it-amber']], note: 'Global leader for quantitative economics.' },
            { name: 'Princeton (ORFE)', loc: 'New Jersey, USA', type: 'global', tags: [['SAT/ACT','it-blue'],['Need-blind aid','it-teal'],['ORFE Dept.','it-purple']], note: 'Ideal programme for quantitative + investigative profile.' },
        ],
    },
    {
        career: 'Architect', field: 'Design',
        aptitudeCluster: 'design', minAptitude: 65, riasec: 'AIR',
        traits: { openness: 'high' },
        degrees: [
            { name: 'B.Arch (Architecture)', match: '95%', sub: '5-year professional degree' },
            { name: 'B.Des (Industrial Design)', match: '80%', sub: '4-year programme with spatial focus' },
        ],
        institutions: [
            { name: 'IIT Kharagpur', loc: 'Kharagpur, India', type: 'india', tags: [['JEE Advanced','it-blue'],['Architecture Dept.','it-purple'],['Strong programme','it-teal']], note: 'One of the oldest architecture programmes in India.' },
            { name: 'SPA Delhi', loc: 'Delhi, India', type: 'india', tags: [['NATA/JEE','it-blue'],['Architecture focus','it-purple'],['Urban planning','it-teal']], note: 'Premier architecture school in India.' },
            { name: 'AA School London', loc: 'London, UK', type: 'global', tags: [['Portfolio','it-blue'],['Experimental','it-purple'],['Top global','it-teal']], note: 'World\'s most progressive architecture school.' },
        ],
    },
    {
        career: 'Lawyer', field: 'Law',
        aptitudeCluster: 'communication', minAptitude: 65, riasec: 'EIS',
        traits: { conscientiousness: 'high', extraversion: 'moderate' },
        degrees: [
            { name: 'BA LLB (Integrated Law)', match: '95%', sub: '5-year integrated law programme' },
            { name: 'BBA LLB', match: '88%', sub: '5-year programme for corporate/business law track' },
        ],
        institutions: [
            { name: 'NLSIU Bangalore', loc: 'Bangalore, India', type: 'india', tags: [['CLAT','it-blue'],['Top law India','it-purple'],['Placement strong','it-teal']], note: 'India\'s #1 law school consistently.' },
            { name: 'NALSAR Hyderabad', loc: 'Hyderabad, India', type: 'india', tags: [['CLAT','it-blue'],['Research focus','it-purple'],['Top 3 law','it-teal']], note: 'Strong legal research orientation.' },
            { name: 'University of Oxford', loc: 'Oxford, UK', type: 'global', tags: [['LNAT','it-blue'],['Top global law','it-purple'],['Tutorial system','it-teal']], note: 'Oldest English-speaking law programme.' },
        ],
    },
    {
        career: 'Clinical Psychologist', field: 'Healthcare',
        aptitudeCluster: 'communication', minAptitude: 60, riasec: 'SIA',
        traits: { agreeableness: 'high', openness: 'high' },
        degrees: [
            { name: 'B.A Psychology (Honours)', match: '90%', sub: '3-year foundation for clinical specialisation' },
            { name: 'B.Sc Applied Psychology', match: '85%', sub: '3-year programme with practical orientation' },
        ],
        institutions: [
            { name: 'Christ University', loc: 'Bangalore, India', type: 'india', tags: [['Entrance exam','it-blue'],['Psychology dept.','it-purple'],['Strong programme','it-teal']], note: 'Excellent psychology department with clinical focus.' },
            { name: 'TISS Mumbai', loc: 'Mumbai, India', type: 'india', tags: [['TISS NET','it-blue'],['Social science','it-purple'],['Applied focus','it-teal']], note: 'Strong applied psychology and social work programmes.' },
            { name: 'UCL', loc: 'London, UK', type: 'global', tags: [['A-Levels/IB','it-blue'],['Clinical psychology','it-purple'],['Research-strong','it-teal']], note: 'Top clinical psychology programme in the UK.' },
        ],
    },
    {
        career: 'Management Consultant', field: 'Business',
        aptitudeCluster: 'strategic', minAptitude: 70, riasec: 'EIC',
        traits: { extraversion: 'high', conscientiousness: 'high' },
        degrees: [
            { name: 'BBA / B.Com (Honours)', match: '90%', sub: '3-year business programme' },
            { name: 'B.Tech + MBA pathway', match: '88%', sub: 'Engineering followed by management' },
        ],
        institutions: [
            { name: 'SRCC Delhi', loc: 'Delhi, India', type: 'india', tags: [['DU entrance','it-blue'],['Top commerce','it-purple'],['Placement strong','it-teal']], note: 'India\'s premier commerce college.' },
            { name: 'IIM Ahmedabad (IPM)', loc: 'Ahmedabad, India', type: 'india', tags: [['IPMAT','it-blue'],['5-year integrated','it-purple'],['Top management','it-teal']], note: 'Integrated programme at India\'s top B-school.' },
            { name: 'Wharton (UPenn)', loc: 'Philadelphia, USA', type: 'global', tags: [['SAT/ACT','it-blue'],['Top business globally','it-purple'],['Need-blind aid','it-teal']], note: 'World\'s top undergraduate business programme.' },
        ],
    },
    {
        career: 'Teacher / Educator', field: 'Education',
        aptitudeCluster: 'communication', minAptitude: 45, riasec: 'SAE',
        traits: { agreeableness: 'high', extraversion: 'moderate' },
        degrees: [
            { name: 'B.Ed (Education)', match: '92%', sub: '2-year professional teaching degree' },
            { name: 'BA + B.Ed Integrated', match: '90%', sub: '4-year integrated programme' },
        ],
        institutions: [
            { name: 'Lady Irwin College', loc: 'Delhi, India', type: 'india', tags: [['DU entrance','it-blue'],['Education focus','it-purple'],['Practical training','it-teal']], note: 'Renowned education programme in India.' },
            { name: 'Azim Premji University', loc: 'Bangalore, India', type: 'india', tags: [['Application','it-blue'],['Social focus','it-purple'],['Scholarship avail.','it-teal']], note: 'Focus on education and social change.' },
        ],
    },
    {
        career: 'Chartered Accountant', field: 'Finance',
        aptitudeCluster: 'analytical', minAptitude: 55, riasec: 'CEI',
        traits: { conscientiousness: 'high' },
        degrees: [
            { name: 'B.Com + CA', match: '95%', sub: 'Commerce degree with CA articleship' },
            { name: 'B.Com (Honours)', match: '88%', sub: '3-year programme with accounting specialisation' },
        ],
        institutions: [
            { name: 'SRCC Delhi', loc: 'Delhi, India', type: 'india', tags: [['DU entrance','it-blue'],['Top commerce','it-purple'],['CA pathway','it-teal']], note: 'Excellent CA preparation ecosystem.' },
            { name: 'Loyola College', loc: 'Chennai, India', type: 'india', tags: [['Merit','it-blue'],['B.Com strong','it-purple'],['Good placement','it-teal']], note: 'Strong commerce programme in south India.' },
        ],
    },
    {
        career: 'Graphic Designer', field: 'Design',
        aptitudeCluster: 'design', minAptitude: 40, riasec: 'AER',
        traits: { openness: 'high' },
        degrees: [
            { name: 'B.Des Communication Design', match: '95%', sub: '4-year design programme' },
            { name: 'BFA (Fine Arts)', match: '80%', sub: '4-year programme with visual arts focus' },
        ],
        institutions: [
            { name: 'NID Ahmedabad', loc: 'Ahmedabad, India', type: 'india', tags: [['NID entrance','it-blue'],['Top design India','it-purple'],['Communication design','it-teal']], note: 'India\'s premier design institute.' },
            { name: 'Srishti Manipal', loc: 'Bangalore, India', type: 'india', tags: [['Portfolio+test','it-blue'],['Design thinking','it-purple'],['Flexible','it-teal']], note: 'Progressive design education with interdisciplinary focus.' },
            { name: 'Parsons NYC', loc: 'New York, USA', type: 'global', tags: [['Portfolio','it-blue'],['Top design globally','it-purple'],['Industry ties','it-teal']], note: 'World-renowned design school.' },
        ],
    },
    {
        career: 'Civil Engineer', field: 'Engineering',
        aptitudeCluster: 'design', minAptitude: 60, riasec: 'RIC',
        traits: { conscientiousness: 'high' },
        degrees: [
            { name: 'B.Tech Civil Engineering', match: '95%', sub: '4-year core engineering programme' },
        ],
        institutions: [
            { name: 'IIT Roorkee', loc: 'Roorkee, India', type: 'india', tags: [['JEE Advanced','it-blue'],['Top civil India','it-purple'],['Heritage','it-teal']], note: 'India\'s oldest and strongest civil engineering programme.' },
            { name: 'NIT Trichy', loc: 'Trichy, India', type: 'india', tags: [['JEE Mains','it-blue'],['Top NIT','it-teal'],['Civil strong','it-purple']], note: 'Excellent civil engineering with strong placement.' },
        ],
    },
    {
        career: 'Journalist / Content Creator', field: 'Media',
        aptitudeCluster: 'communication', minAptitude: 55, riasec: 'AIE',
        traits: { openness: 'high', extraversion: 'moderate' },
        degrees: [
            { name: 'BA Journalism & Mass Communication', match: '92%', sub: '3-year professional programme' },
            { name: 'BA English (Honours)', match: '85%', sub: '3-year literature programme with media electives' },
        ],
        institutions: [
            { name: 'IIMC Delhi', loc: 'Delhi, India', type: 'india', tags: [['Entrance exam','it-blue'],['Top journalism India','it-purple'],['Media industry','it-teal']], note: 'India\'s premier journalism institute.' },
            { name: 'Xavier\'s Mumbai', loc: 'Mumbai, India', type: 'india', tags: [['Merit','it-blue'],['Mass media','it-purple'],['Strong alumni','it-teal']], note: 'Strong mass media and communication programme.' },
        ],
    },
    {
        career: 'Electrical Engineer', field: 'Engineering',
        aptitudeCluster: 'design', minAptitude: 55, riasec: 'RIC',
        traits: { conscientiousness: 'moderate' },
        degrees: [
            { name: 'B.Tech Electrical Engineering', match: '92%', sub: '4-year programme in power, signals, and systems' },
            { name: 'B.Tech Electronics & Communication', match: '89%', sub: 'ECE programme — circuits, signals, communication' },
        ],
        institutions: [
            { name: 'IIT Madras', loc: 'Chennai, India', type: 'india', tags: [['JEE Advanced','it-blue'],['Top ECE India','it-purple'],['Research-strong','it-teal']], note: 'Top-ranked ECE in India.' },
            { name: 'IIT Kharagpur', loc: 'Kharagpur, India', type: 'india', tags: [['JEE Advanced','it-blue'],['Strong EE','it-purple'],['Oldest IIT','it-teal']], note: 'Strongest EE programme among IITs.' },
            { name: 'TU Munich', loc: 'Munich, Germany', type: 'global', tags: [['Numerus Clausus','it-blue'],['Free tuition','it-teal'],['EE + CS','it-purple']], note: 'Top global EE with free tuition.' },
        ],
    },
    {
        career: 'Entrepreneur / Startup Founder', field: 'Business',
        aptitudeCluster: 'strategic', minAptitude: 65, riasec: 'ECS',
        traits: { extraversion: 'high', openness: 'high' },
        degrees: [
            { name: 'BBA / B.Com', match: '85%', sub: 'Business foundation with entrepreneurship focus' },
            { name: 'B.Tech (any branch)', match: '80%', sub: 'Technical skills + startup ecosystems at top IITs' },
        ],
        institutions: [
            { name: 'IIT Bombay', loc: 'Mumbai, India', type: 'india', tags: [['JEE Advanced','it-blue'],['E-Cell','it-purple'],['Startup hub','it-teal']], note: 'One of India\'s strongest startup ecosystems.' },
            { name: 'Stanford', loc: 'California, USA', type: 'global', tags: [['SAT/ACT','it-blue'],['Silicon Valley','it-purple'],['Entrepreneurship culture','it-teal']], note: 'Global epicentre of startup culture.' },
        ],
    },
    {
        career: 'Nurse', field: 'Healthcare',
        aptitudeCluster: 'operational', minAptitude: 40, riasec: 'SIR',
        traits: { agreeableness: 'high', conscientiousness: 'high' },
        degrees: [
            { name: 'B.Sc Nursing', match: '95%', sub: '4-year professional nursing programme' },
        ],
        institutions: [
            { name: 'CMC Vellore', loc: 'Vellore, India', type: 'india', tags: [['Entrance','it-blue'],['Top nursing India','it-purple'],['Clinical training','it-teal']], note: 'Premier nursing programme in India.' },
            { name: 'AIIMS Delhi', loc: 'Delhi, India', type: 'india', tags: [['AIIMS entrance','it-blue'],['Nursing dept.','it-purple'],['Government institute','it-teal']], note: 'Excellent government-funded nursing education.' },
        ],
    },
    {
        career: 'Cybersecurity Analyst', field: 'Technology',
        aptitudeCluster: 'analytical', minAptitude: 60, riasec: 'IRC',
        traits: { conscientiousness: 'high' },
        degrees: [
            { name: 'B.Tech Computer Science', match: '92%', sub: 'CS programme with cybersecurity specialisation' },
            { name: 'B.Sc IT / Information Security', match: '85%', sub: 'Focused information security programme' },
        ],
        institutions: [
            { name: 'IIT Kanpur', loc: 'Kanpur, India', type: 'india', tags: [['JEE Advanced','it-blue'],['C3i Centre','it-purple'],['Cybersecurity research','it-teal']], note: 'Leading cybersecurity research centre in India.' },
            { name: 'IIIT Delhi', loc: 'Delhi, India', type: 'india', tags: [['JAC Delhi','it-blue'],['Infosec programme','it-purple'],['Industry links','it-teal']], note: 'Strong information security programme with industry connections.' },
        ],
    },
];

// ── Scoring ──
function traitLevelToScore(level) { return level === 'high' ? 3 : level === 'moderate' ? 2 : 1; }

function riasecOverlap(studentCode, careerCode) {
    if (!studentCode || !careerCode) return 0;
    let match = 0;
    for (const letter of studentCode) { if (careerCode.includes(letter)) match++; }
    return match / 3;
}

function personalityFit(studentTraits, careerTraits) {
    if (!careerTraits || !studentTraits) return 0.5;
    let totalWeight = 0, totalScore = 0;
    for (const [trait, required] of Object.entries(careerTraits)) {
        const studentLevel = studentTraits[trait]?.level || 'moderate';
        const diff = Math.abs(traitLevelToScore(required) - traitLevelToScore(studentLevel));
        totalWeight += 1;
        totalScore += diff === 0 ? 1.0 : diff === 1 ? 0.6 : 0.2;
    }
    return totalWeight > 0 ? totalScore / totalWeight : 0.5;
}

// ── Build driver tags from student data ──
function buildDrivers(career, clusterScores, hollandCode, personalityData, aptitudeData) {
    const drivers = [];
    // Add relevant aptitude scores
    if (aptitudeData?.domainReports) {
        const relevant = aptitudeData.domainReports
            .filter(d => d.theta > 0)
            .sort((a, b) => b.theta - a.theta)
            .slice(0, 2);
        for (const d of relevant) {
            const pct = Math.round(((d.theta + 3) / 6) * 100);
            drivers.push(`${d.domainName?.split(' ')[0] || d.domain}:${pct}p`);
        }
    }
    // Add RIASEC match
    if (hollandCode) {
        for (const letter of career.riasec) {
            if (hollandCode.includes(letter)) {
                const dimName = { R: 'Realistic', I: 'Investigative', A: 'Artistic', S: 'Social', E: 'Enterprising', C: 'Conventional' }[letter];
                if (dimName) drivers.push(`Interest-${letter}`);
            }
        }
    }
    // Add personality
    if (personalityData) {
        for (const [trait, req] of Object.entries(career.traits || {})) {
            const student = personalityData[trait];
            if (student?.level === req || (req === 'moderate' && student?.level)) {
                const label = trait.charAt(0).toUpperCase() + trait.slice(1);
                drivers.push(`${label}:${student.percentage || ''}${student.percentage ? '' : student.level}`);
            }
        }
    }
    return drivers;
}

// ── Generate career insight narrative ──
function generateInsight(career, matchScore, aptFit, intFit, perFit, flag) {
    const strength = matchScore >= 80 ? 'Strongest' : matchScore >= 60 ? 'Strong' : 'Moderate';
    let text = `${strength} profile match. `;
    if (aptFit >= 0.8) text += `Exceptional aptitude alignment for ${career.field.toLowerCase()} roles. `;
    else if (aptFit >= 0.5) text += `Good aptitude fit for ${career.field.toLowerCase()} work. `;
    if (intFit >= 0.8) text += `Interest profile strongly supports this pathway. `;
    else if (intFit >= 0.5) text += `Interest alignment is moderate — genuine curiosity about this field matters. `;
    if (perFit >= 0.8) text += `Personality traits are well-suited for this career track. `;
    if (flag) text += `Note: ${flag}`;
    return text;
}

// ── Main report generator ──
function generateCareerReport(aptitudeData, personalityData, interestData, user, config) {
    const recommendations = [];
    const clusterScores = {};
    if (aptitudeData?.clusterReports) {
        for (const cr of aptitudeData.clusterReports) {
            clusterScores[cr.cluster] = Math.round(((cr.score + 3) / 6) * 100);
        }
    }
    const hollandCode = interestData?.hollandCode || '';

    // Use config-provided values or fall back to hardcoded defaults
    const careers = config?.careers || CAREER_DATABASE;
    const weights = config?.weights || { aptitude: 0.40, interest: 0.35, personality: 0.25 };

    for (const career of careers) {
        const aptPct = clusterScores[career.aptitudeCluster] || 50;
        const aptFit = aptPct >= career.minAptitude ? 1.0 : aptPct >= career.minAptitude - 15 ? 0.6 : 0.2;
        const intFit = riasecOverlap(hollandCode, career.riasec);
        const perFit = personalityFit(personalityData, career.traits);
        const matchScore = Math.round((aptFit * weights.aptitude + intFit * weights.interest + perFit * weights.personality) * 100);

        // Check for flags
        let flag = null;
        if (career.flagCondition && personalityData) {
            const { trait, level, message } = career.flagCondition;
            if (personalityData[trait]?.level === level) flag = message;
        }

        const drivers = buildDrivers(career, clusterScores, hollandCode, personalityData, aptitudeData);
        const insight = generateInsight(career, matchScore, aptFit, intFit, perFit, flag);

        recommendations.push({
            career: career.career,
            field: career.field,
            matchPercentage: matchScore,
            fit: matchScore,
            aptitudeFit: Math.round(aptFit * 100),
            interestFit: Math.round(intFit * 100),
            personalityFit: Math.round(perFit * 100),
            drivers,
            insight,
            flag,
            degrees: career.degrees || [],
            institutions: career.institutions || [],
            requiredCluster: career.aptitudeCluster,
            requiredRIASEC: career.riasec,
        });
    }

    recommendations.sort((a, b) => b.matchPercentage - a.matchPercentage);

    const topCareers = recommendations.slice(0, 10);
    const fieldGroups = {};
    for (const r of recommendations.filter(r => r.matchPercentage >= 50)) {
        if (!fieldGroups[r.field]) fieldGroups[r.field] = [];
        fieldGroups[r.field].push(r);
    }

    const topField = topCareers[0]?.field || 'Unknown';
    const topMatch = topCareers[0]?.matchPercentage || 0;
    const strongestCluster = aptitudeData?.clusterReports?.[0]?.clusterName || 'Unknown';
    const dominantTrait = personalityData ? Object.entries(personalityData)
        .filter(([k, v]) => v.percentage)
        .sort((a, b) => b[1].percentage - a[1].percentage)[0]?.[0] : null;
    const dominantTraitLabel = dominantTrait ? (BIG_FIVE_TRAITS[dominantTrait]?.label || dominantTrait) : 'Unknown';

    // Build rich profile narrative
    const aptDomains = (aptitudeData?.domainReports || []).sort((a, b) => b.theta - a.theta);
    const topDomains = aptDomains.slice(0, 2).map(d => `${d.domainName} (${Math.round(((d.theta + 3) / 6) * 100)}th percentile)`).join(' and ');
    const riasecTop = hollandCode ? `a strongly ${hollandCode[0] === 'R' ? 'Realistic' : hollandCode[0] === 'I' ? 'Investigative' : hollandCode[0] === 'A' ? 'Artistic' : hollandCode[0] === 'S' ? 'Social' : hollandCode[0] === 'E' ? 'Enterprising' : 'Conventional'} RIASEC profile` : '';
    const persNote = dominantTrait ? `${dominantTraitLabel}-dominant personality traits` : '';

    const profileParts = [];
    if (topDomains) profileParts.push(`shows strong ${topDomains}`);
    if (riasecTop) profileParts.push(riasecTop);
    if (persNote) profileParts.push(persNote);

    const studentName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'The student';
    const profileStatement = profileParts.length > 0
        ? `${studentName} ${profileParts.join(', ')}. This combination creates ${topMatch >= 80 ? 'high-confidence' : 'solid'} matches for ${topField.toLowerCase()} and related fields. Career choices will be most sustainable when driven by genuine interest rather than external pressure.`
        : `Based on the combined assessment, this student shows strongest alignment with careers in ${topField}.`;

    return {
        type: 'career_guidance',
        generatedAt: new Date().toISOString(),
        student: {
            name: studentName,
            age: user?.date_of_birth ? Math.floor((Date.now() - new Date(user.date_of_birth).getTime()) / 31557600000) : null,
            grade: user?.grade || '',
        },
        summary: {
            bestField: topField,
            bestMatch: topMatch,
            strongestAptitude: strongestCluster,
            hollandCode,
            dominantPersonalityTrait: dominantTraitLabel,
            profileStatement,
        },
        topCareers,
        allRecommendations: recommendations,
        fieldGroups,
        assessmentSources: {
            hasAptitude: !!aptitudeData,
            hasPersonality: !!personalityData,
            hasInterest: !!interestData,
        },
    };
}

module.exports = {
    CAREER_DATABASE,
    generateCareerReport,
    riasecOverlap,
    personalityFit,
};
