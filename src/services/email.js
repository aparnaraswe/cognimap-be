// ══════════════════════════════════════════════════════
// EMAIL SERVICE — CogniMap
//
// Uses Resend (resend.com) — free, no App Password needed.
//
// SETUP (2 minutes):
//   1. Go to resend.com → sign up (free)
//   2. Dashboard → API Keys → Create API Key
//   3. Add to .env:
//        RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
//        EMAIL_FROM=onboarding@resend.dev        ← works instantly, no domain needed
//
//   For production (send from your own domain):
//        EMAIL_FROM=noreply@yourdomain.com       ← after verifying domain in Resend dashboard
//
// Falls back to console-log if key is missing (dev/test mode).
// ══════════════════════════════════════════════════════

// ── Send a single email (Resend → SMTP → console fallback) ──
async function sendMail({ to, subject, html, text }) {
    const appName = process.env.APP_NAME || 'CogniMap';
    const fromAddr = process.env.EMAIL_FROM || 'rasweaparna8@gmail.com';
    const from = `${appName} <${fromAddr}>`;

    // ── Option 1: Resend API ─────────────────────────────────────
    if (process.env.RESEND_API_KEY) {
        try {
            const { Resend } = require('resend');
            const resend = new Resend(process.env.RESEND_API_KEY);
            const { data, error } = await resend.emails.send({
                from,
                to: Array.isArray(to) ? to : [to],
                subject, html, text,
            });
            if (error) throw new Error(error.message);
            console.log(`[email] ✓ Sent via Resend → ${to} (${data?.id})`);
            return { ok: true, id: data?.id };
        } catch (err) {
            console.error(`[email] Resend failed → ${to}:`, err.message);
            return { ok: false, error: err.message };
        }
    }

    // ── Option 2: SMTP (Brevo or any SMTP) ──────────────────────
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        try {
            const nodemailer = require('nodemailer');
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: parseInt(process.env.SMTP_PORT || '587', 10),
                secure: process.env.SMTP_PORT === '465',
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS,
                },
            });
            const info = await transporter.sendMail({ from, to, subject, html, text });
            console.log(`[email] ✓ Sent via SMTP → ${to} (${info.messageId})`);
            return { ok: true, messageId: info.messageId };
        } catch (err) {
            console.error(`[email] SMTP failed → ${to}:`, err.message);
            return { ok: false, error: err.message };
        }
    }

    // ── Option 3: No config — log to console (dev mode) ─────────
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📧 [email] No email provider configured — would have sent:');
    console.log('   To:     ', to);
    console.log('   Subject:', subject);
    if (text) console.log('   Body:\n', text.slice(0, 300));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return { ok: false, skipped: true, reason: 'No email provider configured' };
}

// ══════════════════════════════════════════════════════
// TEMPLATES
// ══════════════════════════════════════════════════════

const APP_NAME = process.env.APP_NAME || 'CogniMap';
const APP_URL  = process.env.APP_URL  || 'http://localhost:5173';

// Shared HTML wrapper — simple, responsive, paper-themed
function emailLayout({ title, body }) {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f5f2ed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a2332;">
  <div style="max-width:560px;margin:40px auto;padding:0 20px;">
    <div style="background:#ffffff;border:1px solid rgba(26,35,50,0.08);border-radius:14px;overflow:hidden;">
      <div style="padding:24px 32px 18px;border-bottom:1px solid rgba(26,35,50,0.08);">
        <div style="font-family:Georgia,serif;font-size:22px;color:#1a2332;letter-spacing:-0.3px;">
          Cogni<span style="color:#c97d5f;">Map</span>
        </div>
        <div style="font-size:10px;color:#8898aa;letter-spacing:1.5px;text-transform:uppercase;margin-top:4px;">
          Assessment Platform
        </div>
      </div>
      <div style="padding:30px 32px;font-size:14px;line-height:1.6;color:#4a5568;">
        ${body}
      </div>
      <div style="padding:18px 32px;background:#fdfaf5;border-top:1px solid rgba(26,35,50,0.08);font-size:11px;color:#8898aa;text-align:center;">
        © ${new Date().getFullYear()} ${APP_NAME}. This is an automated email — please do not reply.
      </div>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
        '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[c]));
}

// ── Welcome email for a newly created student ──
async function sendStudentWelcome({ email, firstName, lastName, password, sourceName }) {
    const name = `${firstName || ''} ${lastName || ''}`.trim() || 'Student';
    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safePass = escapeHtml(password);
    const safeSource = escapeHtml(sourceName || '');

    const html = emailLayout({
        title: `Welcome to ${APP_NAME}`,
        body: `
            <h1 style="font-family:Georgia,serif;font-size:22px;color:#1a2332;margin:0 0 6px;font-weight:400;">
                Welcome, ${safeName}
            </h1>
            <p style="margin:0 0 22px;color:#8898aa;font-size:13px;">
                Your ${APP_NAME} student account has been created${safeSource ? ` for <strong style="color:#1a2332;">${safeSource}</strong>` : ''}.
            </p>

            <div style="background:#fdfaf5;border:1px solid rgba(26,35,50,0.08);border-radius:10px;padding:18px 22px;margin-bottom:22px;">
                <div style="font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#8898aa;margin-bottom:10px;">
                    Your login credentials
                </div>
                <div style="margin-bottom:8px;">
                    <span style="display:inline-block;width:80px;font-size:12px;color:#8898aa;">Email</span>
                    <strong style="font-size:13px;color:#1a2332;">${safeEmail}</strong>
                </div>
                <div>
                    <span style="display:inline-block;width:80px;font-size:12px;color:#8898aa;">Password</span>
                    <code style="font-size:13px;color:#1a2332;background:#ffffff;padding:3px 8px;border-radius:5px;border:1px solid rgba(26,35,50,0.08);">${safePass}</code>
                </div>
            </div>

            <p style="margin:0 0 22px;font-size:13px;">
                Sign in to take your assessments and view your reports.
            </p>

            <div style="text-align:center;margin:0 0 18px;">
                <a href="${APP_URL}/login" style="display:inline-block;background:#1a2332;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:11px 26px;border-radius:8px;letter-spacing:0.2px;">
                    Sign in to ${APP_NAME}
                </a>
            </div>

            <p style="margin:18px 0 0;font-size:11px;color:#8898aa;">
                For security, please change your password after your first login.
                If you didn't expect this email, you can safely ignore it.
            </p>
        `,
    });

    const text =
`Welcome to ${APP_NAME}, ${name}

Your student account has been created${sourceName ? ` for ${sourceName}` : ''}.

Login credentials:
  Email:    ${email}
  Password: ${password}

Sign in: ${APP_URL}/login

For security, please change your password after your first login.`;

    return sendMail({
        to: email,
        subject: `Welcome to ${APP_NAME} — your login details`,
        html,
        text,
    });
}

// ── Welcome email for a parent / guardian ──
async function sendParentWelcome({ email, parentName, studentName, password }) {
    const safeParent = escapeHtml(parentName || 'Parent');
    const safeStudent = escapeHtml(studentName || 'your child');
    const safeEmail = escapeHtml(email);
    const safePass = escapeHtml(password);

    const html = emailLayout({
        title: `Parent access to ${APP_NAME}`,
        body: `
            <h1 style="font-family:Georgia,serif;font-size:22px;color:#1a2332;margin:0 0 6px;font-weight:400;">
                Hello, ${safeParent}
            </h1>
            <p style="margin:0 0 22px;color:#8898aa;font-size:13px;">
                A parent account has been created for you on ${APP_NAME}, linked to your child <strong style="color:#1a2332;">${safeStudent}</strong>.
                You can sign in to view their assessment progress and reports.
            </p>

            <div style="background:#fdfaf5;border:1px solid rgba(26,35,50,0.08);border-radius:10px;padding:18px 22px;margin-bottom:22px;">
                <div style="font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#8898aa;margin-bottom:10px;">
                    Your login credentials
                </div>
                <div style="margin-bottom:8px;">
                    <span style="display:inline-block;width:80px;font-size:12px;color:#8898aa;">Email</span>
                    <strong style="font-size:13px;color:#1a2332;">${safeEmail}</strong>
                </div>
                <div>
                    <span style="display:inline-block;width:80px;font-size:12px;color:#8898aa;">Password</span>
                    <code style="font-size:13px;color:#1a2332;background:#ffffff;padding:3px 8px;border-radius:5px;border:1px solid rgba(26,35,50,0.08);">${safePass}</code>
                </div>
            </div>

            <p style="margin:0 0 22px;font-size:13px;">
                As a parent, you'll be able to track ${safeStudent}'s test progress, view results, and download reports once they are released.
            </p>

            <div style="text-align:center;margin:0 0 18px;">
                <a href="${APP_URL}/login" style="display:inline-block;background:#1a2332;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:11px 26px;border-radius:8px;letter-spacing:0.2px;">
                    Sign in to ${APP_NAME}
                </a>
            </div>

            <p style="margin:18px 0 0;font-size:11px;color:#8898aa;">
                For security, please change your password after your first login.
                If you didn't expect this email, you can safely ignore it.
            </p>
        `,
    });

    const text =
`Hello ${parentName || 'Parent'},

A parent account has been created for you on ${APP_NAME}, linked to your child ${studentName || 'your child'}.

Login credentials:
  Email:    ${email}
  Password: ${password}

Sign in: ${APP_URL}/login

You can track your child's test progress, view results, and download reports once they are released.`;

    return sendMail({
        to: email,
        subject: `Parent access to ${APP_NAME}`,
        html,
        text,
    });
}

// ── Access token email to student ──
async function sendTokenEmail({ email, firstName, token, testType, expiresAt }) {
    if (!email || !token) return { ok: false, reason: 'missing email or token' };

    const testLabel = {
        cognitive:   'Cognitive Aptitude Assessment',
        personality: 'Personality Assessment (Big Five)',
        interest:    'Career Interest Assessment (RIASEC)',
    }[testType] || testType || 'Psychometric Assessment';

    const expiryStr = expiresAt
        ? new Date(expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
        : null;

    const html = emailLayout({
        title: `Your ${APP_NAME} assessment token`,
        body: `
            <h1 style="font-family:Georgia,serif;font-size:22px;color:#1a2332;margin:0 0 6px;font-weight:400;">
                Hi ${escapeHtml(firstName || 'there')} — your test is ready
            </h1>
            <p style="margin:0 0 22px;color:#8898aa;font-size:13px;">
                You've been assigned the <strong style="color:#1a2332;">${escapeHtml(testLabel)}</strong>.
                Use the token below to begin.
            </p>

            <div style="background:#fdfaf5;border:1px solid rgba(26,35,50,0.08);border-radius:10px;padding:22px;text-align:center;margin-bottom:22px;">
                <div style="font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#8898aa;margin-bottom:12px;">
                    Your access token
                </div>
                <div style="font-family:monospace;font-size:30px;font-weight:700;letter-spacing:6px;color:#1a2332;">
                    ${escapeHtml(token)}
                </div>
                ${expiryStr ? `<div style="margin-top:10px;font-size:11px;color:#8898aa;">Valid until ${expiryStr}</div>` : ''}
            </div>

            <div style="background:#fff8ee;border-left:3px solid #c97d5f;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:20px;">
                <div style="font-size:12px;font-weight:600;color:#7d4a2a;margin-bottom:6px;">How to take your test:</div>
                <ol style="margin:0;padding-left:18px;font-size:12px;color:#7d4a2a;line-height:1.8;">
                    <li>Open the ${APP_NAME} assessment portal</li>
                    <li>Click <strong>"Access with Token"</strong></li>
                    <li>Enter the token above and follow the instructions</li>
                </ol>
            </div>

            <p style="margin:0;font-size:11px;color:#8898aa;">
                ⚠️ This token is <strong>single-use</strong> and will be invalidated after use${expiryStr ? ` or on ${expiryStr}` : ''}.
                Do not share it with anyone else.
            </p>
        `,
    });

    const text =
`Hi ${firstName || 'there'},

You've been assigned the ${testLabel} on ${APP_NAME}.

Your access token: ${token}
${expiryStr ? `Valid until: ${expiryStr}` : ''}

How to take the test:
1. Open the ${APP_NAME} assessment portal (${APP_URL})
2. Click "Access with Token"
3. Enter the token above

This token is single-use — do not share it.`;

    return sendMail({ to: email, subject: `Your ${APP_NAME} assessment token — ${testLabel}`, html, text });
}

// ── Access token copy to parent ──
async function sendTokenToParentEmail({ parentEmail, parentName, studentFirstName, studentLastName, token, testType, expiresAt }) {
    if (!parentEmail || !token) return { ok: false, reason: 'missing parentEmail or token' };

    const studentName = `${studentFirstName || ''} ${studentLastName || ''}`.trim();
    const testLabel = {
        cognitive:   'Cognitive Aptitude Assessment',
        personality: 'Personality Assessment (Big Five)',
        interest:    'Career Interest Assessment (RIASEC)',
    }[testType] || testType || 'Psychometric Assessment';

    const expiryStr = expiresAt
        ? new Date(expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
        : null;

    const html = emailLayout({
        title: `Assessment token for ${studentName} — ${APP_NAME}`,
        body: `
            <h1 style="font-family:Georgia,serif;font-size:22px;color:#1a2332;margin:0 0 6px;font-weight:400;">
                Hello ${escapeHtml(parentName || 'Parent/Guardian')}
            </h1>
            <p style="margin:0 0 22px;color:#8898aa;font-size:13px;">
                The <strong style="color:#1a2332;">${escapeHtml(testLabel)}</strong> has been assigned to
                <strong style="color:#1a2332;">${escapeHtml(studentName)}</strong>.
                Please share the token below with your ward.
            </p>

            <div style="background:#fdfaf5;border:1px solid rgba(26,35,50,0.08);border-radius:10px;padding:22px;text-align:center;margin-bottom:22px;">
                <div style="font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#8898aa;margin-bottom:6px;">
                    Token for ${escapeHtml(studentName)}
                </div>
                <div style="font-family:monospace;font-size:30px;font-weight:700;letter-spacing:6px;color:#1a2332;">
                    ${escapeHtml(token)}
                </div>
                ${expiryStr ? `<div style="margin-top:10px;font-size:11px;color:#8898aa;">Valid until ${expiryStr}</div>` : ''}
            </div>

            <p style="margin:0 0 16px;font-size:13px;">
                Your ward should enter this token on the ${APP_NAME} portal to begin their test.
                You will receive another notification once results are ready.
            </p>
            <p style="margin:0;font-size:11px;color:#8898aa;">
                ⚠️ This token is <strong>single-use</strong> — once entered, it cannot be used again.
            </p>
        `,
    });

    const text =
`Hello ${parentName || 'Parent/Guardian'},

The ${testLabel} has been assigned to ${studentName}.

Their access token: ${token}
${expiryStr ? `Valid until: ${expiryStr}` : ''}

They should enter this on the ${APP_NAME} portal (${APP_URL}) to begin.
You will be notified when results are ready.`;

    return sendMail({ to: parentEmail, subject: `${APP_NAME}: Test token for ${studentName} — ${testLabel}`, html, text });
}

// ── Report published — notify student and/or parent ──
async function notifyReportReady({ studentEmail, studentFirstName, parentEmail, parentName, studentLastName, reportType, shareToken }) {
    const studentName = `${studentFirstName || ''} ${studentLastName || ''}`.trim();
    const reportLabel = {
        compiled:         'Career Guidance Report',
        aptitude:         'Cognitive Aptitude Report',
        personality:      'Personality Profile Report',
        interest:         'Career Interest Report',
        comprehensive:    'Comprehensive Assessment Report',
        screening_result: 'Screening Result Report',
    }[reportType] || 'Assessment Report';

    const reportLink = shareToken ? `${APP_URL}/report/shared/${shareToken}` : `${APP_URL}/dashboard`;

    const studentHtml = emailLayout({
        title: `Your ${reportLabel} is ready — ${APP_NAME}`,
        body: `
            <h1 style="font-family:Georgia,serif;font-size:22px;color:#1a2332;margin:0 0 6px;font-weight:400;">
                Your report is ready 🎉
            </h1>
            <p style="margin:0 0 22px;color:#8898aa;font-size:13px;">
                Your <strong style="color:#1a2332;">${escapeHtml(reportLabel)}</strong> has been reviewed
                and published by the assessment team.
            </p>
            <div style="text-align:center;margin:0 0 24px;">
                <a href="${reportLink}" style="display:inline-block;background:#1a2332;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:12px 28px;border-radius:8px;">
                    View Your Report →
                </a>
            </div>
            <p style="margin:0;font-size:11px;color:#8898aa;">
                Discuss these results with your school counsellor for personalised guidance.
            </p>
        `,
    });

    const parentHtml = emailLayout({
        title: `${studentName}'s ${reportLabel} — ${APP_NAME}`,
        body: `
            <h1 style="font-family:Georgia,serif;font-size:22px;color:#1a2332;margin:0 0 6px;font-weight:400;">
                Hello ${escapeHtml(parentName || 'Parent/Guardian')}
            </h1>
            <p style="margin:0 0 22px;color:#8898aa;font-size:13px;">
                The <strong style="color:#1a2332;">${escapeHtml(reportLabel)}</strong> for
                <strong style="color:#1a2332;">${escapeHtml(studentName)}</strong> has been published.
            </p>
            <div style="text-align:center;margin:0 0 24px;">
                <a href="${reportLink}" style="display:inline-block;background:#1a2332;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:12px 28px;border-radius:8px;">
                    View ${escapeHtml(studentName)}'s Report →
                </a>
            </div>
            <p style="margin:0;font-size:11px;color:#8898aa;">
                We recommend discussing the report with your ward's school counsellor for best guidance.
            </p>
        `,
    });

    const results = await Promise.allSettled([
        studentEmail
            ? sendMail({ to: studentEmail, subject: `Your ${reportLabel} is ready — ${APP_NAME}`, html: studentHtml })
            : Promise.resolve({ ok: false, skipped: true }),
        parentEmail
            ? sendMail({ to: parentEmail, subject: `${APP_NAME}: ${studentName}'s ${reportLabel} is ready`, html: parentHtml })
            : Promise.resolve({ ok: false, skipped: true }),
    ]);

    return {
        student: results[0].value,
        parent:  results[1].value,
    };
}

// ── Test assigned notification — sent for ALL assignments (with or without token) ──
async function sendTestAssignedEmail({ email, firstName, testType, token, expiresAt, opensAt, closesAt }) {
    if (!email) return { ok: false, reason: 'missing email' };

    const testLabel = {
        cognitive:   'Cognitive Aptitude Assessment',
        personality: 'Personality Assessment (Big Five)',
        interest:    'Career Interest Assessment (RIASEC)',
    }[testType] || testType || 'Psychometric Assessment';

    const expiryStr = expiresAt
        ? new Date(expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
        : null;

    const opensStr = opensAt
        ? new Date(opensAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : null;

    const closesStr = closesAt
        ? new Date(closesAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : null;

    const html = emailLayout({
        title: `${testLabel} assigned — ${APP_NAME}`,
        body: `
            <h1 style="font-family:Georgia,serif;font-size:22px;color:#1a2332;margin:0 0 6px;font-weight:400;">
                Hi ${escapeHtml(firstName || 'there')} — you have a new assessment 📋
            </h1>
            <p style="margin:0 0 22px;color:#8898aa;font-size:13px;">
                A <strong style="color:#1a2332;">${escapeHtml(testLabel)}</strong> has been assigned to you
                on ${APP_NAME}. Please complete it before the deadline.
            </p>

            ${(opensStr || closesStr) ? `
            <div style="background:#fdfaf5;border:1px solid rgba(26,35,50,0.08);border-radius:10px;padding:18px 22px;margin-bottom:22px;">
                <div style="font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#8898aa;margin-bottom:10px;">
                    Test Window
                </div>
                ${opensStr ? `
                <div style="margin-bottom:8px;">
                    <span style="display:inline-block;width:90px;font-size:12px;color:#8898aa;">Opens</span>
                    <strong style="font-size:13px;color:#1a2332;">${opensStr}</strong>
                </div>` : ''}
                ${closesStr ? `
                <div>
                    <span style="display:inline-block;width:90px;font-size:12px;color:#8898aa;">Deadline</span>
                    <strong style="font-size:13px;color:#c0392b;">${closesStr}</strong>
                </div>` : ''}
            </div>` : ''}

            ${token ? `
            <div style="background:#fdfaf5;border:1px solid rgba(26,35,50,0.08);border-radius:10px;padding:22px;text-align:center;margin-bottom:22px;">
                <div style="font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#8898aa;margin-bottom:12px;">
                    Your access token
                </div>
                <div style="font-family:monospace;font-size:30px;font-weight:700;letter-spacing:6px;color:#1a2332;">
                    ${escapeHtml(token)}
                </div>
                ${expiryStr ? `<div style="margin-top:10px;font-size:11px;color:#8898aa;">Valid until ${expiryStr}</div>` : ''}
            </div>
            <div style="background:#fff8ee;border-left:3px solid #c97d5f;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:20px;">
                <div style="font-size:12px;font-weight:600;color:#7d4a2a;margin-bottom:6px;">How to take your test:</div>
                <ol style="margin:0;padding-left:18px;font-size:12px;color:#7d4a2a;line-height:1.8;">
                    <li>Open the ${APP_NAME} portal (${APP_URL})</li>
                    <li>Click <strong>"Access with Token"</strong></li>
                    <li>Enter the token above and follow the instructions</li>
                </ol>
            </div>
            <p style="margin:0;font-size:11px;color:#8898aa;">⚠️ This token is <strong>single-use</strong>. Do not share it.</p>
            ` : `
            <div style="text-align:center;margin:0 0 22px;">
                <a href="${APP_URL}/login" style="display:inline-block;background:#1a2332;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:12px 28px;border-radius:8px;">
                    Sign in to take your test →
                </a>
            </div>
            <p style="margin:0;font-size:11px;color:#8898aa;">
                Log in to your ${APP_NAME} account to start the assessment.
            </p>
            `}
        `,
    });

    const text = token
        ? `Hi ${firstName},\n\nYou have been assigned the ${testLabel} on ${APP_NAME}.\n\nYour access token: ${token}\n${expiryStr ? `Valid until: ${expiryStr}\n` : ''}${closesStr ? `Deadline: ${closesStr}\n` : ''}\nGo to ${APP_URL} → "Access with Token" → enter the token above.`
        : `Hi ${firstName},\n\nYou have been assigned the ${testLabel} on ${APP_NAME}.\n${closesStr ? `Deadline: ${closesStr}\n` : ''}\nSign in at ${APP_URL}/login to start.`;

    return sendMail({
        to: email,
        subject: `📋 ${testLabel} assigned to you — ${APP_NAME}`,
        html,
        text,
    });
}

// ── Parent notification when a test is assigned to their child ──
// Doesn't show the access token (single-use, meant for the student) — instead
// asks the parent to remind / encourage their child to complete it.
async function sendParentTestAssignedEmail({ parentEmail, parentName, studentName, testType, opensAt, closesAt }) {
    if (!parentEmail) return { ok: false, reason: 'missing parent email' };

    const testLabel = {
        cognitive:   'Cognitive Aptitude Assessment',
        personality: 'Personality Assessment (Big Five)',
        interest:    'Career Interest Assessment (RIASEC)',
    }[testType] || testType || 'Psychometric Assessment';

    const opensStr = opensAt
        ? new Date(opensAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : null;
    const closesStr = closesAt
        ? new Date(closesAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : null;

    const safeParent  = escapeHtml(parentName  || 'Parent');
    const safeStudent = escapeHtml(studentName || 'your child');
    const safeTest    = escapeHtml(testLabel);

    const html = emailLayout({
        title: `${testLabel} assigned to ${studentName} — ${APP_NAME}`,
        body: `
            <h1 style="font-family:Georgia,serif;font-size:22px;color:#1a2332;margin:0 0 6px;font-weight:400;">
                Hello, ${safeParent}
            </h1>
            <p style="margin:0 0 22px;color:#8898aa;font-size:13px;">
                A new <strong style="color:#1a2332;">${safeTest}</strong> has been assigned to
                <strong style="color:#1a2332;">${safeStudent}</strong> on ${APP_NAME}.
                Please encourage them to complete it before the deadline.
            </p>

            ${(opensStr || closesStr) ? `
            <div style="background:#fdfaf5;border:1px solid rgba(26,35,50,0.08);border-radius:10px;padding:18px 22px;margin-bottom:22px;">
                <div style="font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#8898aa;margin-bottom:10px;">
                    Test Window
                </div>
                ${opensStr ? `
                <div style="margin-bottom:8px;">
                    <span style="display:inline-block;width:90px;font-size:12px;color:#8898aa;">Opens</span>
                    <strong style="font-size:13px;color:#1a2332;">${opensStr}</strong>
                </div>` : ''}
                ${closesStr ? `
                <div>
                    <span style="display:inline-block;width:90px;font-size:12px;color:#8898aa;">Deadline</span>
                    <strong style="font-size:13px;color:#c0392b;">${closesStr}</strong>
                </div>` : ''}
            </div>` : ''}

            <p style="margin:0 0 18px;font-size:13px;">
                ${safeStudent} can sign in to ${APP_NAME} to take the assessment.
                You can also log in to your parent account to track their progress and view the results when released.
            </p>

            <div style="text-align:center;margin:0 0 18px;">
                <a href="${APP_URL}/login" style="display:inline-block;background:#1a2332;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:11px 26px;border-radius:8px;letter-spacing:0.2px;">
                    Sign in to ${APP_NAME}
                </a>
            </div>

            <p style="margin:18px 0 0;font-size:11px;color:#8898aa;">
                If you didn't expect this email, you can safely ignore it.
            </p>
        `,
    });

    const text =
`Hello ${parentName || 'Parent'},

A new ${testLabel} has been assigned to ${studentName || 'your child'} on ${APP_NAME}.
${opensStr ? `Opens:    ${opensStr}\n` : ''}${closesStr ? `Deadline: ${closesStr}\n` : ''}
Please encourage them to complete it before the deadline.

You can sign in to your parent account at ${APP_URL}/login to track their progress and view results when released.`;

    return sendMail({
        to: parentEmail,
        subject: `📋 ${testLabel} assigned to ${studentName || 'your child'} — ${APP_NAME}`,
        html,
        text,
    });
}

// ── Random password generator ──
function generatePassword(len = 10) {
    const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let p = '';
    for (let i = 0; i < len; i++) p += charset[Math.floor(Math.random() * charset.length)];
    return p;
}

module.exports = {
    sendMail,
    sendStudentWelcome,
    sendParentWelcome,
    sendTokenEmail,
    sendTokenToParentEmail,
    sendTestAssignedEmail,
    sendParentTestAssignedEmail,
    notifyReportReady,
    generatePassword,
};
