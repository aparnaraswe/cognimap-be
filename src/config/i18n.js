// ═══════════════════════════════════════════════════════════
// INTERNATIONALISATION (i18n) — CogniMap
// Supported languages: en (English), hi (Hindi), mr (Marathi)
//
// Usage:
//   const { t, LANGUAGES } = require('../config/i18n');
//   t('test.start', 'hi')  → "परीक्षा शुरू करें"
//   t('test.start', 'en')  → "Start Test"
// ═══════════════════════════════════════════════════════════

const LANGUAGES = [
    { code: 'en', label: 'English',  nativeLabel: 'English' },
    { code: 'hi', label: 'Hindi',    nativeLabel: 'हिन्दी'  },
    { code: 'mr', label: 'Marathi',  nativeLabel: 'मराठी'   },
];

const SUPPORTED_CODES = LANGUAGES.map(l => l.code);

// ── All UI strings ───────────────────────────────────────────────────────────
const strings = {

    // ── Language selection screen ──────────────────────────────
    'language.select.title': {
        en: 'Select Your Language',
        hi: 'अपनी भाषा चुनें',
        mr: 'तुमची भाषा निवडा',
    },
    'language.select.subtitle': {
        en: 'Choose the language you are most comfortable with',
        hi: 'वह भाषा चुनें जिसमें आप सबसे अधिक सहज हों',
        mr: 'तुम्हाला ज्या भाषेत सर्वात जास्त सोयीचे वाटते ती निवडा',
    },
    'language.select.continue': {
        en: 'Continue',
        hi: 'आगे बढ़ें',
        mr: 'पुढे जा',
    },

    // ── Test instructions ──────────────────────────────────────
    'test.instructions.title': {
        en: 'Instructions',
        hi: 'निर्देश',
        mr: 'सूचना',
    },
    'test.instructions.read': {
        en: 'Please read each question carefully before answering.',
        hi: 'कृपया प्रत्येक प्रश्न को ध्यान से पढ़ें और फिर उत्तर दें।',
        mr: 'कृपया प्रत्येक प्रश्न काळजीपूर्वक वाचा आणि नंतर उत्तर द्या.',
    },
    'test.instructions.time': {
        en: 'Each question has a time limit. Answer as quickly and accurately as possible.',
        hi: 'प्रत्येक प्रश्न के लिए समय सीमा है। जितना हो सके उतनी जल्दी और सटीक उत्तर दें।',
        mr: 'प्रत्येक प्रश्नासाठी वेळ मर्यादा आहे. शक्य तितक्या लवकर आणि अचूकपणे उत्तर द्या.',
    },
    'test.instructions.no_back': {
        en: 'You cannot go back to a previous question.',
        hi: 'आप पिछले प्रश्न पर वापस नहीं जा सकते।',
        mr: 'तुम्ही मागील प्रश्नावर परत जाऊ शकत नाही.',
    },
    'test.instructions.honest': {
        en: 'There are no right or wrong answers for personality questions. Answer honestly.',
        hi: 'व्यक्तित्व प्रश्नों के लिए कोई सही या गलत उत्तर नहीं है। ईमानदारी से उत्तर दें।',
        mr: 'व्यक्तिमत्व प्रश्नांसाठी कोणतेही बरोबर किंवा चुकीचे उत्तर नाही. प्रामाणिकपणे उत्तर द्या.',
    },
    'test.instructions.start': {
        en: 'Start Test',
        hi: 'परीक्षा शुरू करें',
        mr: 'चाचणी सुरू करा',
    },

    // ── Test navigation ────────────────────────────────────────
    'test.next': {
        en: 'Next',
        hi: 'अगला',
        mr: 'पुढे',
    },
    'test.submit': {
        en: 'Submit',
        hi: 'जमा करें',
        mr: 'सबमिट करा',
    },
    'test.skip': {
        en: 'Skip',
        hi: 'छोड़ें',
        mr: 'वगळा',
    },
    'test.time_left': {
        en: 'Time left',
        hi: 'शेष समय',
        mr: 'उरलेला वेळ',
    },
    'test.question': {
        en: 'Question',
        hi: 'प्रश्न',
        mr: 'प्रश्न',
    },
    'test.of': {
        en: 'of',
        hi: 'में से',
        mr: 'पैकी',
    },
    'test.section': {
        en: 'Section',
        hi: 'खंड',
        mr: 'विभाग',
    },

    // ── Practice items ─────────────────────────────────────────
    'practice.title': {
        en: 'Practice Round',
        hi: 'अभ्यास दौर',
        mr: 'सराव फेरी',
    },
    'practice.subtitle': {
        en: 'These questions are just for practice. Your answers will not be scored.',
        hi: 'ये प्रश्न केवल अभ्यास के लिए हैं। आपके उत्तर स्कोर नहीं होंगे।',
        mr: 'हे प्रश्न फक्त सरावासाठी आहेत. तुमच्या उत्तरांना गुण दिले जाणार नाहीत.',
    },
    'practice.correct': {
        en: 'Correct! Well done.',
        hi: 'सही! शाबाश।',
        mr: 'बरोबर! शाब्बास.',
    },
    'practice.incorrect': {
        en: 'Not quite. The correct answer was:',
        hi: 'सही नहीं। सही उत्तर था:',
        mr: 'बरोबर नाही. बरोबर उत्तर होते:',
    },

    // ── Section transitions ────────────────────────────────────
    'section.complete': {
        en: 'Section Complete',
        hi: 'खंड पूर्ण',
        mr: 'विभाग पूर्ण',
    },
    'section.next_up': {
        en: 'Next up:',
        hi: 'अगला खंड:',
        mr: 'पुढील विभाग:',
    },
    'section.continue': {
        en: 'Continue to Next Section',
        hi: 'अगले खंड पर जाएं',
        mr: 'पुढील विभागाकडे जा',
    },
    'section.break': {
        en: 'Take a short break if needed before continuing.',
        hi: 'आगे बढ़ने से पहले यदि आवश्यक हो तो थोड़ा आराम करें।',
        mr: 'पुढे जाण्यापूर्वी आवश्यक असल्यास थोडी विश्रांती घ्या.',
    },

    // ── Test complete ──────────────────────────────────────────
    'test.complete.title': {
        en: 'Test Complete!',
        hi: 'परीक्षा पूर्ण!',
        mr: 'चाचणी पूर्ण!',
    },
    'test.complete.message': {
        en: 'Thank you for completing the assessment. Your results are being processed.',
        hi: 'मूल्यांकन पूरा करने के लिए धन्यवाद। आपके परिणाम तैयार किए जा रहे हैं।',
        mr: 'मूल्यांकन पूर्ण केल्याबद्दल धन्यवाद. तुमचे निकाल तयार केले जात आहेत.',
    },
    'test.complete.report': {
        en: 'Your report will be shared with you once it is reviewed by our team.',
        hi: 'हमारी टीम द्वारा समीक्षा के बाद आपकी रिपोर्ट आपके साथ साझा की जाएगी।',
        mr: 'आमच्या टीमने पुनरावलोकन केल्यानंतर तुमचा अहवाल तुमच्याशी शेअर केला जाईल.',
    },

    // ── Timer warnings ─────────────────────────────────────────
    'timer.warning': {
        en: 'Time is almost up!',
        hi: 'समय लगभग समाप्त हो गया!',
        mr: 'वेळ जवळजवळ संपला!',
    },
    'timer.expired': {
        en: 'Time is up. Moving to the next question.',
        hi: 'समय समाप्त। अगले प्रश्न पर जा रहे हैं।',
        mr: 'वेळ संपला. पुढील प्रश्नाकडे जात आहे.',
    },

    // ── Interest test ──────────────────────────────────────────
    'interest.prompt': {
        en: 'How interested are you in this activity?',
        hi: 'आप इस गतिविधि में कितने रुचि रखते हैं?',
        mr: 'या क्रियाकलापात तुम्हाला किती रस आहे?',
    },
    'interest.scale.1': { en: 'Not at all',      hi: 'बिल्कुल नहीं',   mr: 'अजिबात नाही' },
    'interest.scale.2': { en: 'A little',         hi: 'थोड़ा',           mr: 'थोडा'         },
    'interest.scale.3': { en: 'Moderately',       hi: 'मध्यम रूप से',   mr: 'मध्यम प्रमाणात'},
    'interest.scale.4': { en: 'Very interested',  hi: 'बहुत रुचि',      mr: 'खूप रस'       },
    'interest.scale.5': { en: 'Extremely',        hi: 'अत्यंत रुचि',    mr: 'अत्यंत'       },

    // ── Personality test ───────────────────────────────────────
    'personality.prompt': {
        en: 'What would you most likely do?',
        hi: 'आप सबसे अधिक क्या करेंगे?',
        mr: 'तुम्ही सर्वात जास्त काय कराल?',
    },

    // ── Errors ────────────────────────────────────────────────
    'error.generic': {
        en: 'Something went wrong. Please try again.',
        hi: 'कुछ गलत हो गया। कृपया पुनः प्रयास करें।',
        mr: 'काहीतरी चूक झाली. कृपया पुन्हा प्रयत्न करा.',
    },
    'error.session_closed': {
        en: 'This test session is not currently available.',
        hi: 'यह परीक्षा सत्र अभी उपलब्ध नहीं है।',
        mr: 'ही चाचणी सत्र सध्या उपलब्ध नाही.',
    },
    'error.token_invalid': {
        en: 'Invalid or expired access token.',
        hi: 'अमान्य या समाप्त हो चुका एक्सेस टोकन।',
        mr: 'अवैध किंवा कालबाह्य झालेला ऍक्सेस टोकन.',
    },
};

// ── Translate a key ──────────────────────────────────────────────────────────
function t(key, lang = 'en') {
    const resolvedLang = SUPPORTED_CODES.includes(lang) ? lang : 'en';
    const entry = strings[key];
    if (!entry) {
        console.warn(`[i18n] Missing key: "${key}"`);
        return key;
    }
    return entry[resolvedLang] || entry['en'] || key;
}

// ── Get all strings for a language (for sending to frontend) ────────────────
function getAllStrings(lang = 'en') {
    const resolvedLang = SUPPORTED_CODES.includes(lang) ? lang : 'en';
    const result = {};
    for (const [key, translations] of Object.entries(strings)) {
        result[key] = translations[resolvedLang] || translations['en'] || key;
    }
    return result;
}

// ── Apply translation to an item's content ───────────────────────────────────
// Takes an item row from DB, returns content in the requested language.
// Falls back to English if translation is missing.
function translateItem(item, lang = 'en') {
    if (!item) return item;
    if (lang === 'en' || !item.translations) return item;

    const tr = item.translations[lang];
    if (!tr) return item; // no translation available, return original

    const translated = { ...item };
    const content    = { ...item.content };

    // Translate narration (personality items)
    if (tr.narration) content.narration = tr.narration;

    // Translate prompt (interest items)
    if (tr.prompt) content.prompt = tr.prompt;

    // Translate options text
    if (tr.options && Array.isArray(content.options)) {
        content.options = content.options.map((opt, i) => ({
            ...opt,
            text: (tr.options[i] && tr.options[i].text) ? tr.options[i].text : opt.text,
        }));
    }

    // Translate sequence labels if present (Gf items sometimes have text)
    if (tr.question) content.question = tr.question;

    translated.content = content;
    return translated;
}

module.exports = {
    LANGUAGES,
    SUPPORTED_CODES,
    t,
    getAllStrings,
    translateItem,
};
