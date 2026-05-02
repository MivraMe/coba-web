const { Resend } = require('resend');

function getClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

function appUrl() {
  return (process.env.APP_URL || '').replace(/\/$/, '');
}

function emailWrapper(bodyHtml) {
  const base = appUrl();
  const bannerHtml = base
    ? `<a href="${base}" style="display:block;text-decoration:none">
        <img src="${base}/logo/banner_whitetxt_blueback.png" alt="NotesQC" width="600"
             style="width:100%;max-width:600px;height:auto;display:block;border-radius:8px 8px 0 0" />
       </a>`
    : `<div style="background:#1e40af;padding:24px 32px;border-radius:8px 8px 0 0">
        <span style="color:#fff;font-size:1.5rem;font-weight:700;letter-spacing:.05em">NotesQC</span>
       </div>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
         style="background:#f1f5f9;padding:32px 16px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" role="presentation"
             style="max-width:600px;width:100%;background:#fff;border-radius:8px;
                    box-shadow:0 1px 3px rgba(0,0,0,.1);overflow:hidden">
        <tr><td>${bannerHtml}</td></tr>
        <tr><td style="padding:32px 40px">${bodyHtml}</td></tr>
        <tr><td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;
                        border-radius:0 0 8px 8px">
          <p style="margin:0;color:#94a3b8;font-size:.8125rem;text-align:center">
            Vous recevez ce courriel car vous avez activé les notifications pour NotesQC.<br>
            ${base ? `<a href="${base}/compte.html" style="color:#64748b;text-decoration:underline">Gérer mes préférences</a>` : 'Connectez-vous pour gérer vos préférences.'}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function ctaButton(text, url) {
  return `<p style="margin:28px 0 0">
    <a href="${url}" style="display:inline-block;background:#1e40af;color:#fff;
       padding:.875rem 2rem;border-radius:.5rem;text-decoration:none;font-weight:600;
       font-size:.9375rem;letter-spacing:.01em">${text}</a>
  </p>`;
}

function gradeBar(percentage) {
  const pct = Math.min(100, Math.max(0, Math.round(percentage)));
  const color = pct >= 75 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626';
  return `<div style="margin:20px 0;background:#f1f5f9;border-radius:999px;height:10px;overflow:hidden">
    <div style="width:${pct}%;height:100%;background:${color};border-radius:999px"></div>
  </div>
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
           style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:.5rem;
                  border-collapse:separate;overflow:hidden">
      <tr>
        <td style="padding:16px 20px;border-bottom:1px solid #e2e8f0">
          <span style="color:#64748b;font-size:.8125rem;text-transform:uppercase;
                       letter-spacing:.06em;font-weight:600">Cours</span>
          <p style="margin:4px 0 0;color:#0f172a;font-size:1rem;font-weight:600">
            ${courseCode} — ${courseName}
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 20px;border-bottom:1px solid #e2e8f0">
          <span style="color:#64748b;font-size:.8125rem;text-transform:uppercase;
                       letter-spacing:.06em;font-weight:600">Évaluation</span>
          <p style="margin:4px 0 0;color:#0f172a;font-size:1rem;font-weight:600">
            ${assignment.title}
          </p>
          ${assignment.category ? `<p style="margin:2px 0 0;color:#64748b;font-size:.875rem">${assignment.category}</p>` : ''}
        </td>
      </tr>
      <tr>
        <td style="padding:16px 20px">
          <span style="color:#64748b;font-size:.8125rem;text-transform:uppercase;
                       letter-spacing:.06em;font-weight:600">Résultat</span>
          <p style="margin:4px 0 0;color:#0f172a;font-size:1.5rem;font-weight:700">
            ${score.score_obtained}&thinsp;/&thinsp;${score.score_max}
          </p>
          ${pct !== null ? gradeBar(pct) : ''}
        </td>
      </tr>
    </table>

    ${dashboardUrl ? ctaButton('Voir mon tableau de bord', dashboardUrl) : ''}
  `;

  const { error } = await client.emails.send({
    from: process.env.SMTP_FROM || 'NotesQC <noreply@notesqc.ca>',
    to,
    subject,
    html: emailWrapper(body),
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

  const { error } = await client.emails.send({
    from: process.env.SMTP_FROM || 'NotesQC <noreply@notesqc.ca>',
    to,
    subject: `${inviterEmail} t'invite à rejoindre NotesQC`,
    html: emailWrapper(body),
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

  const { error } = await client.emails.send({
    from: process.env.SMTP_FROM || 'NotesQC <noreply@notesqc.ca>',
    to, subject,
    html: emailWrapper(bodyHtml),
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
    <div style="background:#eff6ff;border:2px solid #bfdbfe;border-radius:.5rem;
                padding:24px;text-align:center">
      <span style="font-size:2.25rem;font-weight:700;letter-spacing:.4em;color:#1e40af;
                   font-family:monospace">${code}</span>
    </div>
    <p style="margin:20px 0 0;color:#64748b;font-size:.875rem">
      Ce code est valide pendant <strong>15 minutes</strong>.
      Si vous n'avez pas demandé cette réinitialisation, ignorez ce message.
    </p>
  `;

  const { error } = await client.emails.send({
    from: process.env.SMTP_FROM || 'NotesQC <noreply@notesqc.ca>',
    to,
    subject: 'Code de réinitialisation — NotesQC',
    html: emailWrapper(body),
  });

  if (error) throw new Error(`Resend erreur: ${error.message}`);
}

module.exports = { sendNewGradeEmail, sendInvitationEmail, sendAdminMessage, sendPasswordResetEmail };
