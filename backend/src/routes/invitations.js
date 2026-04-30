const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendInvitationEmail } = require('../services/notifications/email');

const router = express.Router();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function expiresAtFromDays(days) {
  if (!days) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// POST /api/invitations — Invitation par courriel (ciblée, usage unique)
router.post('/', requireAuth, async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Courriel invalide' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  if (normalizedEmail === req.user.email) {
    return res.status(400).json({ error: 'Tu ne peux pas t\'inviter toi-même' });
  }

  try {
    const { rows: existing } = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [normalizedEmail]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Cet étudiant a déjà un compte NotesQC' });
    }

    const { rows: pending } = await pool.query(
      `SELECT id FROM user_invitations
       WHERE inviter_id = $1 AND email = $2 AND used_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())`,
      [req.user.id, normalizedEmail]
    );
    if (pending.length > 0) {
      return res.status(409).json({ error: 'Une invitation est déjà en attente pour ce courriel' });
    }

    const token = generateToken();
    const expiresAt = expiresAtFromDays(7);

    const { rows } = await pool.query(
      `INSERT INTO user_invitations (inviter_id, email, token, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, token, expires_at, created_at`,
      [req.user.id, normalizedEmail, token, expiresAt]
    );
    const invitation = rows[0];

    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const inviteUrl = `${baseUrl}/rejoindre?token=${token}`;

    sendInvitationEmail(normalizedEmail, {
      inviterEmail: req.user.email,
      inviteUrl,
      expiresAt,
    }).catch(err => console.error('Erreur envoi courriel invitation:', err.message));

    res.status(201).json({ ...invitation, invite_url: inviteUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/invitations/link — Lien de partage (ouvert, multi-usage)
router.post('/link', requireAuth, async (req, res) => {
  const { expires_in_days, max_uses } = req.body;

  const days = expires_in_days ? parseInt(expires_in_days) : null;
  if (days !== null && (isNaN(days) || days < 1)) {
    return res.status(400).json({ error: 'Durée de validité invalide' });
  }

  const maxUses = max_uses ? parseInt(max_uses) : null;
  if (maxUses !== null && (isNaN(maxUses) || maxUses < 1)) {
    return res.status(400).json({ error: 'Nombre d\'utilisations invalide' });
  }

  try {
    const token = generateToken();
    const expiresAt = expiresAtFromDays(days);

    const { rows } = await pool.query(
      `INSERT INTO user_invitations (inviter_id, token, expires_at, max_uses)
       VALUES ($1, $2, $3, $4)
       RETURNING id, token, expires_at, max_uses, use_count, created_at`,
      [req.user.id, token, expiresAt, maxUses]
    );
    const link = rows[0];

    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    res.status(201).json({ ...link, invite_url: `${baseUrl}/rejoindre?token=${token}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/invitations — Lister mes invitations et liens de partage
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, expires_at, used_at, use_count, max_uses, created_at
       FROM user_invitations
       WHERE inviter_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/invitations/:id — Supprimer une invitation ou révoquer un lien
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM user_invitations WHERE id = $1 AND inviter_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Invitation introuvable' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/invitations/check/:token — Valider un token (public)
router.get('/check/:token', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ui.id, ui.email, ui.expires_at, ui.used_at, ui.use_count, ui.max_uses,
              u.email AS inviter_email
       FROM user_invitations ui
       JOIN users u ON u.id = ui.inviter_id
       WHERE ui.token = $1`,
      [req.params.token]
    );
    const inv = rows[0];
    if (!inv) return res.status(404).json({ error: 'Invitation introuvable' });

    if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Cette invitation a expiré' });
    }

    if (inv.email !== null) {
      // Invitation ciblée : usage unique
      if (inv.used_at) return res.status(410).json({ error: 'Cette invitation a déjà été utilisée' });
      return res.json({
        type: 'email',
        email: inv.email,
        inviter_email: inv.inviter_email,
        expires_at: inv.expires_at,
      });
    } else {
      // Lien de partage : multi-usage
      if (inv.max_uses !== null && inv.use_count >= inv.max_uses) {
        return res.status(410).json({ error: 'Ce lien a atteint son nombre maximum d\'utilisations' });
      }
      return res.json({
        type: 'link',
        inviter_email: inv.inviter_email,
        expires_at: inv.expires_at,
        use_count: inv.use_count,
        max_uses: inv.max_uses,
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
