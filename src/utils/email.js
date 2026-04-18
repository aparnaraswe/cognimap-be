// ═══════════════════════════════════════════════════════════
// EMAIL SERVICE — CogniMap Psychometric Platform
// Sender : rasweaparna8@gmail.com (Gmail + App Password)
//
// HOW TO SET UP GMAIL APP PASSWORD:
//  1. Go to myaccount.google.com → Security
//  2. Enable 2-Step Verification (if not already on)
//  3. Search for "App Passwords" → Generate one for "Mail"
//  4. Paste the 16-char password into .env as EMAIL_APP_PASSWORD
// ═══════════════════════════════════════════════════════════

// ── Thin wrapper: delegates to services/email.js sendMail ──
const { sendMail: _sendMail } = require('../services/email');

// ── Shared email styles ─────────────────────────────────────────────────────
const BRAND_COLOR = '#4F46E5';   // indigo-600
const FONT = 'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';

function baseTemplate(title, bodyHtml) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;${FONT}">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <!-- Header -->
        <tr>
          <td style="background:${BRAND_COLOR};padding:28px 40px;">
            <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">🧠 CogniMap</p>
            <p style="margin:4px 0 0;color:#C7D2FE;font-size:13px;">Psychometric Assessment Platform</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:36px 40px 28px;">
            ${bodyHtml}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#F9FAFB;padding:20px 40px;border-top:1px solid #E5E7EB;">
            <p style="margin:0;color:#6B7280;font-size:12px;line-height:1.6;">
              This email was sent by CogniMap. If you have questions, contact your school/organisation administrator.<br>
              Please do not reply to this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════
// 1. WELCOME EMAIL — sent to student/employee on account creation
// ═══════════════════════════════════════════════════════════
async function sendWelcomeEmail({ email, firstName, role, password }) {
    if (!email) return;

    const roleLabel = role === 'student' ? 'student' : role === 'employee' ? 'employee' : role;

    const body = `
        <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">Welcome to CogniMap, ${firstName}! 👋</h2>
        <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
          Your account has been created on the CogniMap Psychometric Assessment Platform.
          You are registered as a <strong>${roleLabel}</strong>.
        </p>

        <div style="background:#EEF2FF;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
          <p style="margin:0 0 12px;color:#374151;font-size:14px;font-weight:600;">Your Login Credentials</p>
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="color:#6B7280;font-size:14px;padding:4px 16px 4px 0;min-width:90px;">Email</td>
              <td style="color:#111827;font-size:14px;font-weight:600;">${email}</td>
            </tr>
            <tr>
              <td style="color:#6B7280;font-size:14px;padding:4px 16px 4px 0;">Password</td>
              <td style="color:#111827;font-size:14px;font-weight:600;">${password || 'As set during registration'}</td>
            </tr>
          </table>
        </div>

        ${password ? `<p style="color:#EF4444;font-size:13px;margin:0 0 20px;">⚠️ Please log in and change your password as soon as possible.</p>` : ''}

        <p style="color:#6B7280;font-size:14px;line-height:1.6;margin:0;">
          Your administrator will assign assessments to you. You will receive another email when a test is ready for you.
        </p>
    `;

    await _sendMail({
        to: email,
        subject: `Welcome to CogniMap — Your account is ready`,
        html: baseTemplate('Welcome to CogniMap', body),
    });
}

// ═══════════════════════════════════════════════════════════
// 2. PARENT NOTIFICATION — sent to parent when student is registered
// ═══════════════════════════════════════════════════════════
async function sendParentNotificationEmail({ parentEmail, parentName, studentFirstName, studentLastName, studentEmail, grade, section }) {
    if (!parentEmail) return;

    const studentName = `${studentFirstName} ${studentLastName || ''}`.trim();
    const gradeInfo = grade ? `Grade ${grade}${section ? ` – Section ${section}` : ''}` : null;

    const body = `
        <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">Hello ${parentName || 'Parent/Guardian'} 👋</h2>
        <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
          This is to inform you that a CogniMap psychometric assessment account has been created for your ward.
        </p>

        <div style="background:#F0FDF4;border-radius:8px;padding:20px 24px;margin-bottom:24px;border-left:4px solid #16A34A;">
          <p style="margin:0 0 12px;color:#374151;font-size:14px;font-weight:600;">Student Details</p>
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="color:#6B7280;font-size:14px;padding:4px 16px 4px 0;min-width:110px;">Name</td>
              <td style="color:#111827;font-size:14px;font-weight:600;">${studentName}</td>
            </tr>
            ${studentEmail ? `
            <tr>
              <td style="color:#6B7280;font-size:14px;padding:4px 16px 4px 0;">Login Email</td>
              <td style="color:#111827;font-size:14px;">${studentEmail}</td>
            </tr>` : ''}
            ${gradeInfo ? `
            <tr>
              <td style="color:#6B7280;font-size:14px;padding:4px 16px 4px 0;">Class</td>
              <td style="color:#111827;font-size:14px;">${gradeInfo}</td>
            </tr>` : ''}
          </table>
        </div>

        <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 16px;">
          CogniMap is a psychometric assessment platform that measures cognitive abilities, personality traits, and career interests to help guide academic and career decisions.
        </p>
        <p style="color:#6B7280;font-size:14px;line-height:1.6;margin:0;">
          You will receive a separate email when your ward's assessment results and report are available.
        </p>
    `;

    await _sendMail({
        to: parentEmail,
        subject: `CogniMap: Assessment account created for ${studentName}`,
        html: baseTemplate('Student Registration Notification', body),
    });
}

// ═══════════════════════════════════════════════════════════
// 3. ACCESS TOKEN EMAIL — sent to student when a test is assigned via token
// ═══════════════════════════════════════════════════════════
async function sendAccessTokenEmail({ email, firstName, token, testType, expiresAt }) {
    if (!email) return;

    const testLabel = {
        cognitive:   'Cognitive Aptitude Assessment',
        personality: 'Personality Assessment (Big Five)',
        interest:    'Career Interest Assessment (RIASEC)',
    }[testType] || testType || 'Psychometric Assessment';

    const expiryStr = expiresAt
        ? new Date(expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
        : null;

    const body = `
        <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">Hi ${firstName}, your assessment is ready! 📝</h2>
        <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
          You have been assigned the <strong>${testLabel}</strong>. Use the access token below to start your test.
        </p>

        <div style="background:#EEF2FF;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px;">
          <p style="margin:0 0 8px;color:#4338CA;font-size:13px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">Your Access Token</p>
          <p style="margin:0;color:#111827;font-size:32px;font-weight:700;letter-spacing:4px;font-family:monospace;">${token}</p>
          ${expiryStr ? `<p style="margin:8px 0 0;color:#6B7280;font-size:13px;">Valid until ${expiryStr}</p>` : ''}
        </div>

        <div style="background:#FFFBEB;border-radius:8px;padding:16px 20px;margin-bottom:20px;border-left:4px solid #F59E0B;">
          <p style="margin:0;color:#92400E;font-size:13px;font-weight:600;">How to take your test:</p>
          <ol style="margin:8px 0 0;padding-left:18px;color:#78350F;font-size:13px;line-height:1.8;">
            <li>Open the CogniMap assessment portal</li>
            <li>Click <strong>"Access with Token"</strong></li>
            <li>Enter the token shown above</li>
            <li>Follow the on-screen instructions</li>
          </ol>
        </div>

        <p style="color:#6B7280;font-size:13px;line-height:1.6;margin:0;">
          ⚠️ This token is <strong>single-use</strong> and will expire after use${expiryStr ? ` or on ${expiryStr}` : ''}. Do not share it with anyone.
        </p>
    `;

    await _sendMail({
        to: email,
        subject: `Your CogniMap access token — ${testLabel}`,
        html: baseTemplate('Assessment Token', body),
    });
}

// ═══════════════════════════════════════════════════════════
// 4. ACCESS TOKEN TO PARENT — copy of student's test token for parent
// ═══════════════════════════════════════════════════════════
async function sendTokenToParent({ parentEmail, parentName, studentFirstName, studentLastName, token, testType, expiresAt }) {
    if (!parentEmail) return;

    const studentName = `${studentFirstName} ${studentLastName || ''}`.trim();
    const testLabel = {
        cognitive:   'Cognitive Aptitude Assessment',
        personality: 'Personality Assessment (Big Five)',
        interest:    'Career Interest Assessment (RIASEC)',
    }[testType] || testType || 'Psychometric Assessment';

    const expiryStr = expiresAt
        ? new Date(expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
        : null;

    const body = `
        <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">Hello ${parentName || 'Parent/Guardian'} 👋</h2>
        <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
          A <strong>${testLabel}</strong> has been assigned to <strong>${studentName}</strong>.
          Please share the access token below with your ward so they can take the assessment.
        </p>

        <div style="background:#EEF2FF;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px;">
          <p style="margin:0 0 8px;color:#4338CA;font-size:13px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">Access Token for ${studentName}</p>
          <p style="margin:0;color:#111827;font-size:32px;font-weight:700;letter-spacing:4px;font-family:monospace;">${token}</p>
          ${expiryStr ? `<p style="margin:8px 0 0;color:#6B7280;font-size:13px;">Valid until ${expiryStr}</p>` : ''}
        </div>

        <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 16px;">
          Your ward should enter this token on the CogniMap assessment portal to begin their test.
          You will receive another email once the report is ready.
        </p>
        <p style="color:#6B7280;font-size:13px;line-height:1.6;margin:0;">
          ⚠️ This token is <strong>single-use</strong> — once your ward uses it, it cannot be used again.
        </p>
    `;

    await _sendMail({
        to: parentEmail,
        subject: `CogniMap: Test token for ${studentName} — ${testLabel}`,
        html: baseTemplate('Assessment Token for Your Ward', body),
    });
}

// ═══════════════════════════════════════════════════════════
// 5. REPORT READY — notify student and parent when report is published
// ═══════════════════════════════════════════════════════════
async function sendReportReadyEmail({ email, firstName, reportType, shareToken }) {
    if (!email) return;

    const reportLabel = {
        compiled:     'Career Guidance Report',
        aptitude:     'Cognitive Aptitude Report',
        personality:  'Personality Profile Report',
        interest:     'Career Interest Report',
        comprehensive:'Comprehensive Assessment Report',
        screening_result: 'Screening Result Report',
    }[reportType] || 'Assessment Report';

    const reportLink = shareToken
        ? `${process.env.FRONTEND_URL || 'http://localhost:5173'}/report/shared/${shareToken}`
        : null;

    const body = `
        <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">Your report is ready, ${firstName}! 🎉</h2>
        <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
          Your <strong>${reportLabel}</strong> has been reviewed and published by the assessment team.
        </p>

        ${reportLink ? `
        <div style="text-align:center;margin:28px 0;">
          <a href="${reportLink}" style="display:inline-block;background:${BRAND_COLOR};color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">
            View Your Report →
          </a>
        </div>` : `
        <div style="background:#F0FDF4;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
          <p style="margin:0;color:#166534;font-size:14px;">Log in to the CogniMap portal to view and download your complete report.</p>
        </div>`}

        <p style="color:#6B7280;font-size:13px;line-height:1.6;margin:0;">
          Your report provides insights into your cognitive strengths, personality, and career interests.
          Discuss the findings with your school counsellor for best guidance.
        </p>
    `;

    await _sendMail({
        to: email,
        subject: `Your ${reportLabel} is ready on CogniMap`,
        html: baseTemplate('Report Ready', body),
    });
}

async function sendReportReadyToParent({ parentEmail, parentName, studentFirstName, studentLastName, reportType, shareToken }) {
    if (!parentEmail) return;

    const studentName = `${studentFirstName} ${studentLastName || ''}`.trim();
    const reportLabel = {
        compiled:     'Career Guidance Report',
        aptitude:     'Cognitive Aptitude Report',
        personality:  'Personality Profile Report',
        interest:     'Career Interest Report',
        comprehensive:'Comprehensive Assessment Report',
        screening_result: 'Screening Result Report',
    }[reportType] || 'Assessment Report';

    const reportLink = shareToken
        ? `${process.env.FRONTEND_URL || 'http://localhost:5173'}/report/shared/${shareToken}`
        : null;

    const body = `
        <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">Hello ${parentName || 'Parent/Guardian'} 👋</h2>
        <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
          The <strong>${reportLabel}</strong> for <strong>${studentName}</strong> has been published.
        </p>

        ${reportLink ? `
        <div style="text-align:center;margin:28px 0;">
          <a href="${reportLink}" style="display:inline-block;background:${BRAND_COLOR};color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">
            View ${studentName}'s Report →
          </a>
        </div>` : `
        <div style="background:#F0FDF4;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
          <p style="margin:0;color:#166534;font-size:14px;">Log in to the CogniMap guardian portal to view the complete report for ${studentName}.</p>
        </div>`}

        <p style="color:#6B7280;font-size:13px;line-height:1.6;margin:0;">
          We recommend discussing this report with your ward's school counsellor for personalised career guidance.
        </p>
    `;

    await _sendMail({
        to: parentEmail,
        subject: `CogniMap: ${studentName}'s ${reportLabel} is ready`,
        html: baseTemplate('Report Ready for Your Ward', body),
    });
}

// ═══════════════════════════════════════════════════════════
// SAFE WRAPPER — logs errors without crashing the main request
// ═══════════════════════════════════════════════════════════
async function safeSend(fn, label) {
    try {
        await fn();
        console.log(`[email] ✓ ${label}`);
    } catch (err) {
        console.error(`[email] ✗ ${label}:`, err.message);
    }
}

module.exports = {
    sendWelcomeEmail,
    sendParentNotificationEmail,
    sendAccessTokenEmail,
    sendTokenToParent,
    sendReportReadyEmail,
    sendReportReadyToParent,
    safeSend,
};
