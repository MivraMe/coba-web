const { Resend } = require('resend');

function getClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

async function sendNewGradeEmail(to, subject, { courseCode, courseName, assignment, score }) {
  const client = getClient();
  if (!client) {
    console.warn('RESEND_API_KEY non configuré, courriel non envoyé');
    return;
  }

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1e40af">Nouvelle note disponible</h2>
      <p><strong>Cours :</strong> ${courseCode} — ${courseName}</p>
      <p><strong>Évaluation :</strong> ${assignment.title}</p>
      ${assignment.category ? `<p><strong>Catégorie :</strong> ${assignment.category}</p>` : ''}
      <p><strong>Note :</strong> ${score.score_obtained} / ${score.score_max} (${score.percentage} %)</p>
      <p style="color:#64748b;font-size:0.875rem;margin-top:2rem">
        Vous recevez ce courriel car vous avez activé les notifications pour l'application NotesQC.
      </p>
    </div>
  `;

  const { error } = await client.emails.send({
    from: process.env.SMTP_FROM || 'NotesQC <noreply@notesqc.ca>',
    to,
    subject,
    html,
  });

  if (error) throw new Error(`Resend erreur: ${error.message}`);
}

async function sendAdminMessage(to, subject, body) {
  const client = getClient();
  if (!client) throw new Error('RESEND_API_KEY non configuré');
  const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
    <p style="font-size:15px">${body.replace(/\n/g, '<br>')}</p>
    <p style="color:#64748b;font-size:0.875rem;margin-top:2rem">
      Message envoyé depuis le panneau d'administration NotesQC.
    </p>
  </div>`;
  const { error } = await client.emails.send({
    from: process.env.SMTP_FROM || 'NotesQC <noreply@notesqc.ca>',
    to, subject, html, text: body,
  });
  if (error) throw new Error(`Resend erreur: ${error.message}`);
}

module.exports = { sendNewGradeEmail, sendAdminMessage };
