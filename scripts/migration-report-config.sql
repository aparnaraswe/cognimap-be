-- ══════════════════════════════════════════════════════
-- Migration: Report Configuration System
-- Creates career_database table and seeds report config
-- ══════════════════════════════════════════════════════

-- ── 1. Career Database Table ──
CREATE TABLE IF NOT EXISTS career_database (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    career VARCHAR(200) NOT NULL,
    field VARCHAR(100) NOT NULL,
    aptitude_cluster VARCHAR(50) NOT NULL,
    min_aptitude INTEGER NOT NULL DEFAULT 50,
    riasec VARCHAR(6) NOT NULL,
    traits JSONB NOT NULL DEFAULT '{}',
    flag_condition JSONB,
    degrees JSONB NOT NULL DEFAULT '[]',
    institutions JSONB NOT NULL DEFAULT '[]',
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_career_database_field ON career_database(field);
CREATE INDEX IF NOT EXISTS idx_career_database_cluster ON career_database(aptitude_cluster);
CREATE INDEX IF NOT EXISTS idx_career_database_active ON career_database(is_active);

-- ── 2. Seed Report Engine Config into platform_settings ──

INSERT INTO platform_settings (setting_key, setting_value, category, label, description)
VALUES (
    'career_match_weights',
    '{"value":{"aptitude":0.40,"interest":0.35,"personality":0.25}}',
    'report_engine',
    'Career Match Weights',
    'Weights for aptitude, interest, and personality when computing career match scores'
) ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO platform_settings (setting_key, setting_value, category, label, description)
VALUES (
    'scoring_thresholds',
    '{"value":{"aptitudeClassification":{"exceptional":1.5,"advanced":0.5,"age_appropriate":-1.5},"personalityCutoffs":{"high":75,"moderate":45},"interestStrengthBands":{"strong":70,"moderate":45},"fitLevels":{"high":80,"mid":60}}}',
    'report_engine',
    'Scoring Thresholds',
    'Thresholds for aptitude classification, personality cutoffs, interest strength bands, and fit levels'
) ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO platform_settings (setting_key, setting_value, category, label, description)
VALUES (
    'report_sections',
    '{"value":{"aptitude":true,"personality":true,"interest":true,"career":true,"summary":true}}',
    'report_engine',
    'Report Sections',
    'Toggle which sections appear in generated reports'
) ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO platform_settings (setting_key, setting_value, category, label, description)
VALUES (
    'cluster_formulas',
    '{"value":{"analytical":{"gf":0.6,"gq":0.4},"design":{"gv":1.0},"communication":{"gc":1.0},"operational":{"gs":1.0},"strategic":{"gf":0.7,"gv":0.3}}}',
    'report_engine',
    'Cluster Formulas',
    'Domain weight formulas for computing aptitude cluster scores'
) ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO platform_settings (setting_key, setting_value, category, label, description)
VALUES (
    'domain_weights',
    '{"value":{"gf":0.30,"gv":0.20,"gq":0.20,"gc":0.15,"gs":0.15}}',
    'report_engine',
    'Domain Weights',
    'Weights for computing the global aptitude theta from individual domain thetas'
) ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO platform_settings (setting_key, setting_value, category, label, description)
VALUES (
    'narrative_templates',
    '{"value":{"aptitude":{"gf":{"exceptional":"demonstrates outstanding pattern recognition and abstract reasoning ability, significantly above age expectations.","advanced":"shows strong fluid reasoning skills, performing above typical expectations for this age group.","age_appropriate":"demonstrates fluid reasoning skills on track for this age band.","developing":"shows emerging fluid reasoning skills that may benefit from targeted support."},"gv":{"exceptional":"displays exceptional visual-spatial processing and mental rotation abilities.","advanced":"shows strong visual-spatial abilities above age expectations.","age_appropriate":"demonstrates visual-spatial skills appropriate for this age.","developing":"shows developing visual-spatial skills."},"gq":{"exceptional":"exhibits outstanding quantitative reasoning and mathematical logic.","advanced":"demonstrates strong quantitative abilities above age-level expectations.","age_appropriate":"shows quantitative reasoning skills on track for this age band.","developing":"demonstrates emerging quantitative skills."},"gc":{"exceptional":"shows exceptional verbal reasoning, vocabulary depth, and analogical thinking.","advanced":"demonstrates strong verbal reasoning above age expectations.","age_appropriate":"shows verbal reasoning skills appropriate for this age band.","developing":"shows developing verbal skills."},"gs":{"exceptional":"demonstrates exceptional processing speed and rapid decision-making.","advanced":"shows strong processing speed above typical expectations.","age_appropriate":"demonstrates processing speed appropriate for this age group.","developing":"shows developing processing speed."}},"personality":{"openness":{"high":"Shows strong curiosity, creativity, and willingness to explore new ideas and experiences.","moderate":"Demonstrates a balanced approach to new experiences — open but also values familiarity.","low":"Prefers established routines and concrete, practical approaches over abstract ideas."},"conscientiousness":{"high":"Highly organized, dependable, and goal-oriented. Strong self-discipline and follow-through.","moderate":"Generally organized with occasional flexibility. Balances structure with adaptability.","low":"Prefers spontaneity and flexibility over rigid structure. May benefit from planning support."},"extraversion":{"high":"Energized by social interaction. Naturally outgoing, expressive, and leadership-oriented.","moderate":"Comfortable in both social and solitary settings. Adaptable communication style.","low":"Draws energy from solitude and reflection. Prefers deep one-on-one connections."},"agreeableness":{"high":"Naturally empathetic, cooperative, and concerned with others'' wellbeing.","moderate":"Balances cooperation with healthy assertiveness. Team-oriented but can stand firm.","low":"Values direct communication and independent thinking over social harmony."},"neuroticism":{"high":"May experience heightened emotional sensitivity. Could benefit from stress management strategies.","moderate":"Generally stable with normal emotional responses to challenging situations.","low":"Demonstrates exceptional emotional resilience and composure under pressure."}},"interest":{"realistic":{"strong":"Shows strong interest in hands-on, practical work with tools, machines, and the physical world.","moderate":"Has some interest in practical, hands-on activities alongside other areas.","low":"Less drawn to hands-on physical activities; prefers other types of work."},"investigative":{"strong":"Strongly drawn to research, analysis, and intellectual problem-solving.","moderate":"Shows balanced interest in analytical work and other domains.","low":"Less drawn to pure research and analysis; prefers more applied or social work."},"artistic":{"strong":"Strongly drawn to creative expression, design, and unstructured problem-solving.","moderate":"Appreciates creativity while also valuing structure in some areas.","low":"Prefers structured environments over open-ended creative work."},"social":{"strong":"Strongly motivated by helping, teaching, and working closely with others.","moderate":"Values working with people while also enjoying independent tasks.","low":"Prefers independent work over highly collaborative or helping-oriented roles."},"enterprising":{"strong":"Strongly drawn to leadership, persuasion, and business/organizational challenges.","moderate":"Shows interest in leadership opportunities while valuing other work styles too.","low":"Prefers collaborative or technical roles over leadership-focused positions."},"conventional":{"strong":"Naturally inclined toward organized, structured, data-oriented work.","moderate":"Appreciates structure and order while maintaining flexibility.","low":"Prefers variety and flexibility over highly structured, routine-based work."}}}}',
    'report_engine',
    'Narrative Templates',
    'Text templates for aptitude domain narratives (5 domains x 4 levels), personality trait narratives (5 traits x 3 levels), and interest dimension narratives (6 dims x 3 levels)'
) ON CONFLICT (setting_key) DO NOTHING;

-- ── 3. Seed Career Database from existing CAREER_DATABASE ──

INSERT INTO career_database (career, field, aptitude_cluster, min_aptitude, riasec, traits, flag_condition, degrees, institutions, sort_order)
VALUES
(
    'Data Science & AI', 'Technology', 'analytical', 70, 'IRC',
    '{"openness":"high","conscientiousness":"high"}',
    NULL,
    '[{"name":"B.Tech Computer Science (AI/ML)","match":"97%","sub":"4-year engineering with AI/ML specialisation"},{"name":"B.Sc Data Science","match":"94%","sub":"3-year programme with statistics and programming core"},{"name":"B.Sc Computer Science","match":"88%","sub":"Broader CS with elective specialisation in AI"}]',
    '[{"name":"IIT Bombay","loc":"Mumbai, India","type":"india","tags":[["JEE Advanced","it-blue"],["Research-strong","it-purple"],["Top AI/ML","it-teal"]],"note":"Strongest AI/ML programme in India."},{"name":"IIT Madras","loc":"Chennai, India","type":"india","tags":[["JEE Advanced","it-blue"],["Dedicated DS Dept.","it-purple"],["Strong placement","it-teal"]],"note":"Dedicated Data Science & AI department."},{"name":"IIIT Hyderabad","loc":"Hyderabad, India","type":"india","tags":[["UGEE","it-blue"],["AI Research","it-purple"],["High quality","it-teal"]],"note":"Research-oriented culture with undergrad AI publications."},{"name":"MIT","loc":"Cambridge, USA","type":"global","tags":[["SAT/ACT","it-blue"],["Research-first","it-purple"],["Need-blind aid","it-teal"]],"note":"Top global AI programme with need-blind admissions."},{"name":"NUS Singapore","loc":"Singapore","type":"global","tags":[["A-Levels/IB","it-blue"],["Data Science track","it-purple"],["Scholarship avail.","it-teal"]],"note":"Strong Data Science programme with proximity and scholarships."}]',
    1
),
(
    'Software Engineer', 'Technology', 'analytical', 60, 'IRC',
    '{"openness":"high","conscientiousness":"high"}',
    NULL,
    '[{"name":"B.Tech Computer Science","match":"96%","sub":"4-year core engineering programme"},{"name":"B.Sc Computer Science","match":"90%","sub":"3-year science track with theory orientation"},{"name":"B.Tech Information Technology","match":"84%","sub":"Applied variant with system design emphasis"}]',
    '[{"name":"IIT Bombay","loc":"Mumbai, India","type":"india","tags":[["JEE Advanced","it-blue"],["Top CSE India","it-purple"],["Strong placement","it-teal"]],"note":"Consistent top placement in CS across India."},{"name":"IIT Delhi","loc":"Delhi, India","type":"india","tags":[["JEE Advanced","it-blue"],["CS Research","it-purple"],["Startup ecosystem","it-teal"]],"note":"Strong CS and entrepreneurship ecosystem."},{"name":"BITS Pilani","loc":"Pilani, India","type":"india","tags":[["BITSAT","it-blue"],["Dual-degree","it-teal"],["Flexible curriculum","it-purple"]],"note":"Autonomous self-paced academic structure."},{"name":"CMU","loc":"Pittsburgh, USA","type":"global","tags":[["SAT/ACT","it-blue"],["#1 CS globally","it-purple"],["Very selective","it-amber"]],"note":"World''s top CS programme."},{"name":"Imperial College London","loc":"London, UK","type":"global","tags":[["A-Levels/IB","it-blue"],["Strong CS","it-purple"],["Industry links","it-teal"]],"note":"Top UK CS with strong industry placement."}]',
    2
),
(
    'Research Scientist', 'Science', 'analytical', 75, 'IRC',
    '{"openness":"high","conscientiousness":"moderate"}',
    NULL,
    '[{"name":"B.Sc Physics (Honours)","match":"92%","sub":"3-year honours programme for graduate research"},{"name":"B.Sc Mathematics","match":"91%","sub":"Pure mathematics — highest Gf demand"},{"name":"BS-MS Dual 5-year (IISER)","match":"87%","sub":"Integrated research training across 5 years"}]',
    '[{"name":"IISc Bangalore","loc":"Bangalore, India","type":"india","tags":[["KVPY/JEE","it-blue"],["Research-first","it-purple"],["BS programme","it-teal"]],"note":"India''s top research institution."},{"name":"IISER (any campus)","loc":"Multiple, India","type":"india","tags":[["IISER Aptitude/JEE","it-blue"],["BS-MS dual","it-teal"],["Research-funded","it-purple"]],"note":"Guaranteed research exposure from undergrad."},{"name":"University of Cambridge","loc":"Cambridge, UK","type":"global","tags":[["A-Levels/IB","it-blue"],["Natural Sciences","it-purple"],["Top global","it-teal"]],"note":"One of the most rigorous science programmes globally."},{"name":"ETH Zurich","loc":"Zurich, Switzerland","type":"global","tags":[["Entrance exam","it-blue"],["Near-free tuition","it-teal"],["Research-strong","it-purple"]],"note":"World-class research with near-free tuition."}]',
    3
),
(
    'Medical Doctor', 'Healthcare', 'analytical', 70, 'ISR',
    '{"conscientiousness":"high","agreeableness":"high"}',
    NULL,
    '[{"name":"MBBS","match":"95%","sub":"5.5-year programme including internship"},{"name":"B.Sc Biomedical Sciences","match":"82%","sub":"3-year programme for graduate medical entry"}]',
    '[{"name":"AIIMS Delhi","loc":"Delhi, India","type":"india","tags":[["NEET","it-blue"],["Top medical India","it-purple"],["Research-strong","it-teal"]],"note":"India''s premier medical institute."},{"name":"CMC Vellore","loc":"Vellore, India","type":"india","tags":[["NEET","it-blue"],["Clinical excellence","it-purple"],["Community medicine","it-teal"]],"note":"Renowned for clinical training and service orientation."},{"name":"Johns Hopkins","loc":"Baltimore, USA","type":"global","tags":[["MCAT","it-blue"],["Top medical globally","it-purple"],["Research-first","it-teal"]],"note":"World leader in medical education and research."}]',
    4
),
(
    'Quantitative Finance', 'Finance', 'analytical', 70, 'ICE',
    '{"conscientiousness":"high","openness":"moderate"}',
    '{"trait":"extraversion","level":"low","message":"Low Extraversion may limit client-facing advisory roles. Quant-focused tracks (trading, risk, modelling) are better fits."}',
    '[{"name":"B.Sc Economics (Quantitative)","match":"94%","sub":"3-year programme with econometrics focus"},{"name":"B.Tech CS with Finance Minor","match":"90%","sub":"Engineering pathway into FinTech / Quant Finance"},{"name":"B.Sc Mathematics & Statistics","match":"88%","sub":"Strong theoretical base for actuarial or quant roles"}]',
    '[{"name":"Delhi School of Economics","loc":"Delhi, India","type":"india","tags":[["DSE Entrance","it-blue"],["Theory-strong","it-purple"],["Economics research","it-teal"]],"note":"India''s top economics programme."},{"name":"IIT Bombay (IEOR)","loc":"Mumbai, India","type":"india","tags":[["JEE Advanced","it-blue"],["Quant-heavy","it-purple"],["Industry placement","it-teal"]],"note":"Best quant finance engineering pathway in India."},{"name":"LSE","loc":"London, UK","type":"global","tags":[["A-Levels/IB","it-blue"],["Economics powerhouse","it-purple"],["High cost","it-amber"]],"note":"Global leader for quantitative economics."},{"name":"Princeton (ORFE)","loc":"New Jersey, USA","type":"global","tags":[["SAT/ACT","it-blue"],["Need-blind aid","it-teal"],["ORFE Dept.","it-purple"]],"note":"Ideal programme for quantitative + investigative profile."}]',
    5
),
(
    'Architect', 'Design', 'design', 65, 'AIR',
    '{"openness":"high"}',
    NULL,
    '[{"name":"B.Arch (Architecture)","match":"95%","sub":"5-year professional degree"},{"name":"B.Des (Industrial Design)","match":"80%","sub":"4-year programme with spatial focus"}]',
    '[{"name":"IIT Kharagpur","loc":"Kharagpur, India","type":"india","tags":[["JEE Advanced","it-blue"],["Architecture Dept.","it-purple"],["Strong programme","it-teal"]],"note":"One of the oldest architecture programmes in India."},{"name":"SPA Delhi","loc":"Delhi, India","type":"india","tags":[["NATA/JEE","it-blue"],["Architecture focus","it-purple"],["Urban planning","it-teal"]],"note":"Premier architecture school in India."},{"name":"AA School London","loc":"London, UK","type":"global","tags":[["Portfolio","it-blue"],["Experimental","it-purple"],["Top global","it-teal"]],"note":"World''s most progressive architecture school."}]',
    6
),
(
    'Lawyer', 'Law', 'communication', 65, 'EIS',
    '{"conscientiousness":"high","extraversion":"moderate"}',
    NULL,
    '[{"name":"BA LLB (Integrated Law)","match":"95%","sub":"5-year integrated law programme"},{"name":"BBA LLB","match":"88%","sub":"5-year programme for corporate/business law track"}]',
    '[{"name":"NLSIU Bangalore","loc":"Bangalore, India","type":"india","tags":[["CLAT","it-blue"],["Top law India","it-purple"],["Placement strong","it-teal"]],"note":"India''s #1 law school consistently."},{"name":"NALSAR Hyderabad","loc":"Hyderabad, India","type":"india","tags":[["CLAT","it-blue"],["Research focus","it-purple"],["Top 3 law","it-teal"]],"note":"Strong legal research orientation."},{"name":"University of Oxford","loc":"Oxford, UK","type":"global","tags":[["LNAT","it-blue"],["Top global law","it-purple"],["Tutorial system","it-teal"]],"note":"Oldest English-speaking law programme."}]',
    7
),
(
    'Clinical Psychologist', 'Healthcare', 'communication', 60, 'SIA',
    '{"agreeableness":"high","openness":"high"}',
    NULL,
    '[{"name":"B.A Psychology (Honours)","match":"90%","sub":"3-year foundation for clinical specialisation"},{"name":"B.Sc Applied Psychology","match":"85%","sub":"3-year programme with practical orientation"}]',
    '[{"name":"Christ University","loc":"Bangalore, India","type":"india","tags":[["Entrance exam","it-blue"],["Psychology dept.","it-purple"],["Strong programme","it-teal"]],"note":"Excellent psychology department with clinical focus."},{"name":"TISS Mumbai","loc":"Mumbai, India","type":"india","tags":[["TISS NET","it-blue"],["Social science","it-purple"],["Applied focus","it-teal"]],"note":"Strong applied psychology and social work programmes."},{"name":"UCL","loc":"London, UK","type":"global","tags":[["A-Levels/IB","it-blue"],["Clinical psychology","it-purple"],["Research-strong","it-teal"]],"note":"Top clinical psychology programme in the UK."}]',
    8
),
(
    'Management Consultant', 'Business', 'strategic', 70, 'EIC',
    '{"extraversion":"high","conscientiousness":"high"}',
    NULL,
    '[{"name":"BBA / B.Com (Honours)","match":"90%","sub":"3-year business programme"},{"name":"B.Tech + MBA pathway","match":"88%","sub":"Engineering followed by management"}]',
    '[{"name":"SRCC Delhi","loc":"Delhi, India","type":"india","tags":[["DU entrance","it-blue"],["Top commerce","it-purple"],["Placement strong","it-teal"]],"note":"India''s premier commerce college."},{"name":"IIM Ahmedabad (IPM)","loc":"Ahmedabad, India","type":"india","tags":[["IPMAT","it-blue"],["5-year integrated","it-purple"],["Top management","it-teal"]],"note":"Integrated programme at India''s top B-school."},{"name":"Wharton (UPenn)","loc":"Philadelphia, USA","type":"global","tags":[["SAT/ACT","it-blue"],["Top business globally","it-purple"],["Need-blind aid","it-teal"]],"note":"World''s top undergraduate business programme."}]',
    9
),
(
    'Teacher / Educator', 'Education', 'communication', 45, 'SAE',
    '{"agreeableness":"high","extraversion":"moderate"}',
    NULL,
    '[{"name":"B.Ed (Education)","match":"92%","sub":"2-year professional teaching degree"},{"name":"BA + B.Ed Integrated","match":"90%","sub":"4-year integrated programme"}]',
    '[{"name":"Lady Irwin College","loc":"Delhi, India","type":"india","tags":[["DU entrance","it-blue"],["Education focus","it-purple"],["Practical training","it-teal"]],"note":"Renowned education programme in India."},{"name":"Azim Premji University","loc":"Bangalore, India","type":"india","tags":[["Application","it-blue"],["Social focus","it-purple"],["Scholarship avail.","it-teal"]],"note":"Focus on education and social change."}]',
    10
),
(
    'Chartered Accountant', 'Finance', 'analytical', 55, 'CEI',
    '{"conscientiousness":"high"}',
    NULL,
    '[{"name":"B.Com + CA","match":"95%","sub":"Commerce degree with CA articleship"},{"name":"B.Com (Honours)","match":"88%","sub":"3-year programme with accounting specialisation"}]',
    '[{"name":"SRCC Delhi","loc":"Delhi, India","type":"india","tags":[["DU entrance","it-blue"],["Top commerce","it-purple"],["CA pathway","it-teal"]],"note":"Excellent CA preparation ecosystem."},{"name":"Loyola College","loc":"Chennai, India","type":"india","tags":[["Merit","it-blue"],["B.Com strong","it-purple"],["Good placement","it-teal"]],"note":"Strong commerce programme in south India."}]',
    11
),
(
    'Graphic Designer', 'Design', 'design', 40, 'AER',
    '{"openness":"high"}',
    NULL,
    '[{"name":"B.Des Communication Design","match":"95%","sub":"4-year design programme"},{"name":"BFA (Fine Arts)","match":"80%","sub":"4-year programme with visual arts focus"}]',
    '[{"name":"NID Ahmedabad","loc":"Ahmedabad, India","type":"india","tags":[["NID entrance","it-blue"],["Top design India","it-purple"],["Communication design","it-teal"]],"note":"India''s premier design institute."},{"name":"Srishti Manipal","loc":"Bangalore, India","type":"india","tags":[["Portfolio+test","it-blue"],["Design thinking","it-purple"],["Flexible","it-teal"]],"note":"Progressive design education with interdisciplinary focus."},{"name":"Parsons NYC","loc":"New York, USA","type":"global","tags":[["Portfolio","it-blue"],["Top design globally","it-purple"],["Industry ties","it-teal"]],"note":"World-renowned design school."}]',
    12
),
(
    'Civil Engineer', 'Engineering', 'design', 60, 'RIC',
    '{"conscientiousness":"high"}',
    NULL,
    '[{"name":"B.Tech Civil Engineering","match":"95%","sub":"4-year core engineering programme"}]',
    '[{"name":"IIT Roorkee","loc":"Roorkee, India","type":"india","tags":[["JEE Advanced","it-blue"],["Top civil India","it-purple"],["Heritage","it-teal"]],"note":"India''s oldest and strongest civil engineering programme."},{"name":"NIT Trichy","loc":"Trichy, India","type":"india","tags":[["JEE Mains","it-blue"],["Top NIT","it-teal"],["Civil strong","it-purple"]],"note":"Excellent civil engineering with strong placement."}]',
    13
),
(
    'Journalist / Content Creator', 'Media', 'communication', 55, 'AIE',
    '{"openness":"high","extraversion":"moderate"}',
    NULL,
    '[{"name":"BA Journalism & Mass Communication","match":"92%","sub":"3-year professional programme"},{"name":"BA English (Honours)","match":"85%","sub":"3-year literature programme with media electives"}]',
    '[{"name":"IIMC Delhi","loc":"Delhi, India","type":"india","tags":[["Entrance exam","it-blue"],["Top journalism India","it-purple"],["Media industry","it-teal"]],"note":"India''s premier journalism institute."},{"name":"Xavier''s Mumbai","loc":"Mumbai, India","type":"india","tags":[["Merit","it-blue"],["Mass media","it-purple"],["Strong alumni","it-teal"]],"note":"Strong mass media and communication programme."}]',
    14
),
(
    'Electrical Engineer', 'Engineering', 'design', 55, 'RIC',
    '{"conscientiousness":"moderate"}',
    NULL,
    '[{"name":"B.Tech Electrical Engineering","match":"92%","sub":"4-year programme in power, signals, and systems"},{"name":"B.Tech Electronics & Communication","match":"89%","sub":"ECE programme — circuits, signals, communication"}]',
    '[{"name":"IIT Madras","loc":"Chennai, India","type":"india","tags":[["JEE Advanced","it-blue"],["Top ECE India","it-purple"],["Research-strong","it-teal"]],"note":"Top-ranked ECE in India."},{"name":"IIT Kharagpur","loc":"Kharagpur, India","type":"india","tags":[["JEE Advanced","it-blue"],["Strong EE","it-purple"],["Oldest IIT","it-teal"]],"note":"Strongest EE programme among IITs."},{"name":"TU Munich","loc":"Munich, Germany","type":"global","tags":[["Numerus Clausus","it-blue"],["Free tuition","it-teal"],["EE + CS","it-purple"]],"note":"Top global EE with free tuition."}]',
    15
),
(
    'Entrepreneur / Startup Founder', 'Business', 'strategic', 65, 'ECS',
    '{"extraversion":"high","openness":"high"}',
    NULL,
    '[{"name":"BBA / B.Com","match":"85%","sub":"Business foundation with entrepreneurship focus"},{"name":"B.Tech (any branch)","match":"80%","sub":"Technical skills + startup ecosystems at top IITs"}]',
    '[{"name":"IIT Bombay","loc":"Mumbai, India","type":"india","tags":[["JEE Advanced","it-blue"],["E-Cell","it-purple"],["Startup hub","it-teal"]],"note":"One of India''s strongest startup ecosystems."},{"name":"Stanford","loc":"California, USA","type":"global","tags":[["SAT/ACT","it-blue"],["Silicon Valley","it-purple"],["Entrepreneurship culture","it-teal"]],"note":"Global epicentre of startup culture."}]',
    16
),
(
    'Nurse', 'Healthcare', 'operational', 40, 'SIR',
    '{"agreeableness":"high","conscientiousness":"high"}',
    NULL,
    '[{"name":"B.Sc Nursing","match":"95%","sub":"4-year professional nursing programme"}]',
    '[{"name":"CMC Vellore","loc":"Vellore, India","type":"india","tags":[["Entrance","it-blue"],["Top nursing India","it-purple"],["Clinical training","it-teal"]],"note":"Premier nursing programme in India."},{"name":"AIIMS Delhi","loc":"Delhi, India","type":"india","tags":[["AIIMS entrance","it-blue"],["Nursing dept.","it-purple"],["Government institute","it-teal"]],"note":"Excellent government-funded nursing education."}]',
    17
),
(
    'Cybersecurity Analyst', 'Technology', 'analytical', 60, 'IRC',
    '{"conscientiousness":"high"}',
    NULL,
    '[{"name":"B.Tech Computer Science","match":"92%","sub":"CS programme with cybersecurity specialisation"},{"name":"B.Sc IT / Information Security","match":"85%","sub":"Focused information security programme"}]',
    '[{"name":"IIT Kanpur","loc":"Kanpur, India","type":"india","tags":[["JEE Advanced","it-blue"],["C3i Centre","it-purple"],["Cybersecurity research","it-teal"]],"note":"Leading cybersecurity research centre in India."},{"name":"IIIT Delhi","loc":"Delhi, India","type":"india","tags":[["JAC Delhi","it-blue"],["Infosec programme","it-purple"],["Industry links","it-teal"]],"note":"Strong information security programme with industry connections."}]',
    18
)
ON CONFLICT DO NOTHING;
