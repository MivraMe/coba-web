const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendInvitationEmail } = require('../services/notifications/email');

const router = express.Router();
const EXPIRY_DAYS = 7;

// POST /api/invitations — Créer une invitation
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
       WHERE inviter_id = $1 AND email = $2 AND used_at IS NULL AND expires_at > NOW()`,
      [req.user.id, normalizedEmail]
    );
    if (pending.length > 0) {
      return res.status(409).json({ error: 'Une invitation est déjà en attente pour ce courriel' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

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

// GET /api/invitations — Lister mes invitations envoyées
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, expires_at, used_at, created_at,
              CASE
                WHEN used_at IS NOT NULL THEN 'utilisée'
                WHEN expires_at < NOW() THEN 'expirée'
                ELSE 'en attente'
              END AS status
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

// DELETE /api/invitations/:id — Révoquer une invitation en attente
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM user_invitations WHERE id = $1 AND inviter_id = $2 AND used_at IS NULL RETURNING id',
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Invitation introuvable ou déjà utilisée' });
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
      `SELECT ui.id, ui.email, ui.expires_at, ui.used_at, u.email AS inviter_email
       FROM user_invitations ui
       JOIN users u ON u.id = ui.inviter_id
       WHERE ui.token = $1`,
      [req.params.token]
    );
    const inv = rows[0];
    if (!inv) return res.status(404).json({ error: 'Invitation introuvable' });
    if (inv.used_at) return res.status(410).json({ error: 'Cette invitation a déjà été utilisée' });
    if (new Date(inv.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Cette invitation a expiré' });
    }
    res.json({ email: inv.email, inviter_email: inv.inviter_email, expires_at: inv.expires_at });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
