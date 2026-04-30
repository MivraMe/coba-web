const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendPasswordResetEmail } = require('../services/notifications/email');
const { sendSms } = require('../services/notifications/sms');

const router = express.Router();
const SALT_ROUNDS = 12;

function signToken(userId, email, isAdmin = false, role = 'user') {
  return jwt.sign({ id: userId, email, is_admin: isAdmin, role }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password, invitation_token } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Courriel et mot de passe requis' });
  if (password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit comporter au moins 8 caractères' });

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const { rows } = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, onboarding_step, onboarding_completed, is_admin, role',
      [normalizedEmail, hash]
    );
    const user = rows[0];

    if (invitation_token) {
      const { rows: invRows } = await pool.query(
        'SELECT id, email, inviter_id FROM user_invitations WHERE token = $1',
        [invitation_token]
      ).catch(() => ({ rows: [] }));
      const inv = invRows[0];
      if (inv) {
        if (inv.email !== null) {
          // Invitation ciblée : marquer comme utilisée
          await pool.query(
            `UPDATE user_invitations SET used_at = NOW()
             WHERE id = $1 AND used_at IS NULL AND email = $2
             AND (expires_at IS NULL OR expires_at > NOW())`,
            [inv.id, normalizedEmail]
          ).catch(() => {});
        } else {
          // Lien de partage : incrémenter le compteur
          await pool.query(
            `UPDATE user_invitations SET use_count = use_count + 1
             WHERE id = $1
             AND (expires_at IS NULL OR expires_at > NOW())
             AND (max_uses IS NULL OR use_count < max_uses)`,
            [inv.id]
          ).catch(() => {});
        }
        // Enregistrer l'inviteur sur le nouveau compte
        await pool.query(
          'UPDATE users SET invited_by_user_id = $1 WHERE id = $2',
          [inv.inviter_id, user.id]
        ).catch(() => {});
      }
    }

    res.status(201).json({ token: signToken(user.id, user.email, user.is_admin, user.role), user });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ce courriel est déjà utilisé' });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Courriel et mot de passe requis' });

  try {
    const { rows } = await pool.query(
      'SELECT id, email, password_hash, onboarding_step, onboarding_completed, is_admin, role FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Identifiants incorrects' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Identifiants incorrects' });

    const { password_hash, ...safeUser } = user;
    res.json({ token: signToken(user.id, user.email, user.is_admin, user.role), user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, recovery_email, phone, notify_email, notify_sms, onboarding_step, onboarding_completed, is_admin, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

function maskEmail(email) {
  const at = email.indexOf('@');
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local[0]}***${domain}`;
  return `${local[0]}${'*'.repeat(Math.min(local.length - 1, 4))}${domain}`;
}

function maskPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  return `+${'*'.repeat(Math.max(digits.length - 2, 4))}${digits.slice(-2)}`;
}

// POST /api/auth/forgot-password
// { email } → returns { channels, email_masked, sms_masked }
// { email, channel } → sends OTP, returns { ok, masked_to }
router.post('/forgot-password', async (req, res) => {
  const { email, channel } = req.body;
  if (!email) return res.status(400).json({ error: 'Courriel requis' });

  const normalized = email.toLowerCase().trim();

  try {
    const { rows } = await pool.query(
      'SELECT id, email, phone FROM users WHERE email = $1',
      [normalized]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Aucun compte trouvé avec ce courriel' });
    }

    const user = rows[0];

    if (!channel) {
      const channels = ['email'];
      const smsAvailable = !!(process.env.TWILIO_ACCOUNT_SID && user.phone);
      if (smsAvailable) channels.push('sms');
      return res.json({
        channels,
        email_masked: maskEmail(user.email),
        sms_masked: user.phone ? maskPhone(user.phone) : null,
      });
    }

    if (!['email', 'sms'].includes(channel)) {
      return res.status(400).json({ error: 'Canal invalide' });
    }
    if (channel === 'sms' && (!user.phone || !process.env.TWILIO_ACCOUNT_SID)) {
      return res.status(400).json({ error: 'SMS non disponible pour ce compte' });
    }

    // Rate limit: refuse si un token a été créé il y a moins de 2 minutes
    const { rows: recent } = await pool.query(
      `SELECT id FROM password_reset_tokens
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '2 minutes' AND used_at IS NULL`,
      [user.id]
    );
    if (recent.length > 0) {
      return res.status(429).json({ error: 'Veuillez attendre avant de demander un nouveau code' });
    }

    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);

    const code = String(Math.floor(100000 + Math.random() * 900000));

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, code, channel, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '15 minutes')`,
      [user.id, code, channel]
    );

    if (channel === 'email') {
      await sendPasswordResetEmail(user.email, code);
      return res.json({ ok: true, masked_to: maskEmail(user.email) });
    } else {
      await sendSms(user.phone, `[NotesQC] Code de réinitialisation : ${code}. Valide 15 minutes.`);
      return res.json({ ok: true, masked_to: maskPhone(user.phone) });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { email, code, new_password } = req.body;
  if (!email || !code || !new_password) {
    return res.status(400).json({ error: 'Tous les champs sont requis' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit comporter au moins 8 caractères' });
  }

  try {
    const normalized = email.toLowerCase().trim();
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [normalized]);
    if (rows.length === 0) return res.status(400).json({ error: 'Code invalide ou expiré' });

    const userId = rows[0].id;

    const { rows: tokens } = await pool.query(
      `SELECT id FROM password_reset_tokens
       WHERE user_id = $1 AND code = $2 AND expires_at > NOW() AND used_at IS NULL`,
      [userId, code.trim()]
    );

    if (tokens.length === 0) {
      return res.status(400).json({ error: 'Code invalide ou expiré' });
    }

    const hash = await bcrypt.hash(new_password, SALT_ROUNDS);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
    await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [tokens[0].id]);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
