const nodemailer = require('nodemailer');

function createTransport() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: parseInt(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });
}

async function sendNewGradeEmail(to, subject, { courseCode, courseName, assignment, score }) {
  const transport = createTransport();
  if (!transport) {
    console.warn('SMTP non configuré, courriel non envoyé');
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
        Vous recevez ce courriel car vous avez activé les notifications pour l'application Notes Esther-Blondin.
      </p>
    </div>
  `;

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
  });
}

module.exports = { sendNewGradeEmail };
