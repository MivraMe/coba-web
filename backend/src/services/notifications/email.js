const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');

const BANNER_PATH = path.join(__dirname, '../../public/logo/banner_whitetxt_blueback.png');

function getClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

function appUrl() {
  return (process.env.APP_URL || '').replace(/\/$/, '');
}

// Returns { bannerHtml, attachments } — banner embedded as CID when file exists,
// falling back to a plain blue header.
function bannerBlock(linkUrl) {
  let bannerHtml;
  let attachments = [];

  if (fs.existsSync(BANNER_PATH)) {
    const content = fs.readFileSync(BANNER_PATH).toString('base64');
    attachments = [{
      filename: 'banner.png',
      content,
      content_type: 'image/png',
      content_id: 'notesqc-banner',
      inline: true,
    }];
    const imgTag = `<img src="cid:notesqc-banner" alt="NotesQC" width="600"
         style="width:100%;max-width:600px;height:auto;display:block" />`;
    bannerHtml = linkUrl
      ? `<a href="${linkUrl}" style="display:block;text-decoration:none">${imgTag}</a>`
      : imgTag;
  } else {
    bannerHtml = `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr><td bgcolor="#1e40af" style="padding:24px 32px">
        <span style="color:#ffffff;font-size:1.5rem;font-weight:700;letter-spacing:.05em;
                     font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">NotesQC</span>
      </td></tr>
    </table>`;
  }

  return { bannerHtml, attachments };
}

function emailWrapper(bodyHtml, extraAttachments = []) {
  const base = appUrl();
  const { bannerHtml, attachments } = bannerBlock(base || null);

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;
             font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
         style="background:#f1f5f9;padding:32px 16px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" role="presentation"
             style="max-width:600px;width:100%;background:#ffffff;
                    box-shadow:0 1px 3px rgba(0,0,0,.1)">
        <tr><td style="padding:0">${bannerHtml}</td></tr>
        <tr><td style="padding:32px 40px">${bodyHtml}</td></tr>
        <tr><td bgcolor="#f8fafc" style="padding:20px 40px;border-top:1px solid #e2e8f0">
          <p style="margin:0;color:#94a3b8;font-size:.8125rem;text-align:center">
            Vous recevez ce courriel car vous avez activé les notifications pour NotesQC.<br>
            ${base
              ? `<a href="${base}/compte.html" style="color:#64748b;text-decoration:underline">Gérer mes préférences</a>`
              : 'Connectez-vous pour gérer vos préférences.'}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { html, attachments: [...attachments, ...extraAttachments] };
}

function ctaButton(text, url) {
  return `<table cellpadding="0" cellspacing="0" role="presentation" style="margin-top:28px">
    <tr>
      <td bgcolor="#1e40af" style="border-radius:6px;padding:0">
        <a href="${url}" style="display:inline-block;padding:.875rem 2rem;color:#ffffff;
           text-decoration:none;font-weight:600;font-size:.9375rem;letter-spacing:.01em;
           font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${text}</a>
      </td>
    </tr>
  </table>`;
}

// Table-based progress bar — bgcolor works in all email clients.
function gradeBar(percentage) {
  const pct = Math.min(100, Math.max(0, Math.round(percentage)));
  const filledColor = pct >= 75 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626';
  const empty = 100 - pct;

  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation"
          style="margin:16px 0 4px;border-radius:999px;overflow:hidden;height:10px">
    <tr>
      ${pct > 0 ? `<td width="${pct}%" bgcolor="${filledColor}" style="height:10px;line-height:10px;font-size:1px">&nbsp;</td>` : ''}
      ${empty > 0 ? `<td width="${empty}%" bgcolor="#e2e8f0" style="height:10px;line-height:10px;font-size:1px">&nbsp;</td>` : ''}
    </tr>
  </table>
  <p style="margin:4px 0 0;color:#64748b;font-size:.8125rem;text-align:right">${pct}&thinsp;%</p>`;
}

async function sendNewGradeEmail(to, subject, { courseCode, courseName, assignment, score }) {
  const client = getClient();
  if (!client) {
    console.warn('RESEND_API_KEY non configuré, courriel non envoyé');
    return;
  }

  const base = appUrl();
  const dashboardUrl = base ? `${base}/dashboard.html` : null;
  const pct = score.percentage != null ? parseFloat(score.percentage) : null;

  const body = `
    <h2 style="margin:0 0 4px;color:#0f172a;font-size:1.25rem;font-weight:700">
      Nouvelle note disponible
    </h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:.9375rem">Votre résultat vient d'être mis à jour.</p>

    <table cellpadding="0" cellspacing="0" width="100%"
           style="border:1px solid #e2e8f0;border-collapse:collapse">
      <tr>
        <td bgcolor="#f8fafc" style="padding:16px 20px;border-bottom:1px solid #e2e8f0">
          <span style="color:#64748b;font-size:.75rem;text-transform:uppercase;
                       letter-spacing:.08em;font-weight:600">Cours</span>
          <p style="margin:4px 0 0;color:#0f172a;font-size:1rem;font-weight:600">
            ${courseCode} — ${courseName}
          </p>
        </td>
      </tr>
      <tr>
        <td bgcolor="#f8fafc" style="padding:16px 20px;border-bottom:1px solid #e2e8f0">
          <span style="color:#64748b;font-size:.75rem;text-transform:uppercase;
                       letter-spacing:.08em;font-weight:600">Évaluation</span>
          <p style="margin:4px 0 0;color:#0f172a;font-size:1rem;font-weight:600">
            ${assignment.title}
          </p>
          ${assignment.category
            ? `<p style="margin:2px 0 0;color:#64748b;font-size:.875rem">${assignment.category}</p>`
            : ''}
        </td>
      </tr>
      <tr>
        <td bgcolor="#ffffff" style="padding:16px 20px">
          <span style="color:#64748b;font-size:.75rem;text-transform:uppercase;
                       letter-spacing:.08em;font-weight:600">Résultat</span>
          <p style="margin:4px 0 0;color:#0f172a;font-size:1.5rem;font-weight:700">
            ${score.score_obtained}&thinsp;/&thinsp;${score.score_max}
          </p>
          ${pct !== null ? gradeBar(pct) : ''}
        </td>
      </tr>
    </table>

    ${dashboardUrl ? ctaButton('Voir mon tableau de bord', dashboardUrl) : ''}
  `;

  const { html, attachments } = emailWrapper(body);
  const { error } = await client.emails.send({
    from: process.env.SMTP_FROM || 'NotesQC <noreply@notesqc.ca>',
    to,
    subject,
    html,
    attachments,
  });

  if (error) throw new Error(`Resend erreur: ${error.message}`);
}

async function sendInvitationEmail(to, { inviterEmail, inviteUrl, expiresAt }) {
  const client = getClient();
  if (!client) {
    console.warn('RESEND_API_KEY non configuré, courriel d\'invitation non envoyé');
    return;
  }

  const expiryDate = new Date(expiresAt).toLocaleDateString('fr-CA', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const body = `
    <h2 style="margin:0 0 4px;color:#0f172a;font-size:1.25rem;font-weight:700">
      Tu as été invité(e) à rejoindre NotesQC
    </h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:.9375rem">
      <strong style="color:#0f172a">${inviterEmail}</strong>
      t'invite à créer un compte pour suivre tes notes de cours.
    </p>
    ${ctaButton('Créer mon compte', inviteUrl)}
    <p style="margin:16px 0 0;color:#94a3b8;font-size:.8125rem">
      Ce lien expire le ${expiryDate}. Si tu ne souhaites pas créer de compte, ignore ce message.
    </p>
  `;

  const { html, attachments } = emailWrapper(body);
  const { error } = await client.emails.send({
    from: process.env.SMTP_FROM || 'NotesQC <noreply@notesqc.ca>',
    to,
    subject: `${inviterEmail} t'invite à rejoindre NotesQC`,
    html,
    attachments,
  });

  if (error) throw new Error(`Resend erreur: ${error.message}`);
}

async function sendAdminMessage(to, subject, body) {
  const client = getClient();
  if (!client) throw new Error('RESEND_API_KEY non configuré');

  const bodyHtml = `
    <h2 style="margin:0 0 20px;color:#0f172a;font-size:1.125rem;font-weight:700">
      Message de l'administration
    </h2>
    <p style="color:#334155;font-size:.9375rem;line-height:1.6;margin:0">
      ${body.replace(/\n/g, '<br>')}
    </p>
  `;

  const { html, attachments } = emailWrapper(bodyHtml);
  const { error } = await client.emails.send({
    from: process.env.SMTP_FROM || 'NotesQC <noreply@notesqc.ca>',
    to, subject,
    html,
    attachments,
    text: body,
  });
  if (error) throw new Error(`Resend erreur: ${error.message}`);
}

async function sendPasswordResetEmail(to, code) {
  const client = getClient();
  if (!client) throw new Error('RESEND_API_KEY non configuré');

  const body = `
    <h2 style="margin:0 0 4px;color:#0f172a;font-size:1.25rem;font-weight:700">
      Réinitialisation de mot de passe
    </h2>
    <p style="margin:0 0 28px;color:#64748b;font-size:.9375rem">
      Voici votre code de réinitialisation :
    </p>
    <table cellpadding="0" cellspacing="0" role="presentation" width="100%">
      <tr><td align="center">
        <table cellpadding="0" cellspacing="0" role="presentation"
               style="border:2px solid #bfdbfe;border-radius:6px">
          <tr><td bgcolor="#eff6ff" style="padding:24px 40px;text-align:center">
            <span style="font-size:2.25rem;font-weight:700;letter-spacing:.4em;color:#1e40af;
                         font-family:monospace">${code}</span>
          </td></tr>
        </table>
      </td></tr>
    </table>
    <p style="margin:20px 0 0;color:#64748b;font-size:.875rem">
      Ce code est valide pendant <strong>15 minutes</strong>.
      Si vous n'avez pas demandé cette réinitialisation, ignorez ce message.
    </p>
  `;

  const { html, attachments } = emailWrapper(body);
  const { error } = await client.emails.send({
    from: process.env.SMTP_FROM || 'NotesQC <noreply@notesqc.ca>',
    to,
    subject: 'Code de réinitialisation — NotesQC',
    html,
    attachments,
  });

  if (error) throw new Error(`Resend erreur: ${error.message}`);
}

module.exports = { sendNewGradeEmail, sendInvitationEmail, sendAdminMessage, sendPasswordResetEmail };
