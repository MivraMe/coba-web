const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { encrypt } = require('../services/crypto');
const { fetchNotes, fetchProfile, fetchProfileForUser } = require('../services/portalApi');
const { processAssignments } = require('../services/dataSync');

const router = express.Router();
router.use(requireAuth);
const SALT_ROUNDS = 12;

// PUT /api/compte/profil
router.put('/profil', async (req, res) => {
  const { email, recovery_email } = req.body;
  try {
    const fields = [];
    const params = [];

    if (email) {
      params.push(email.toLowerCase().trim());
      fields.push(`email = $${params.length}`);
    }
    if (recovery_email !== undefined) {
      params.push(recovery_email || null);
      fields.push(`recovery_email = $${params.length}`);
    }

    if (fields.length === 0) return res.status(400).json({ error: 'Aucune donnée à modifier' });

    params.push(req.user.id);
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ce courriel est déjà utilisé' });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/compte/mot-de-passe
router.put('/mot-de-passe', async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Mot de passe actuel et nouveau requis' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'Le nouveau mot de passe doit comporter au moins 8 caractères' });
  }

  try {
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const match = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });

    const hash = await bcrypt.hash(new_password, SALT_ROUNDS);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/compte/portail-photo — fetch live photo from portal
router.get('/portail-photo', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT portal_username, portal_password_encrypted FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = rows[0];
    if (!user?.portal_username || !user?.portal_password_encrypted) {
      return res.status(400).json({ error: 'Identifiants du portail non configurés' });
    }
    const profile = await fetchProfileForUser(user);
    res.json({ photo_base64: profile.photo_base64 || null });
  } catch (err) {
    if (err.code) return res.status(503).json({ error: err.message, code: err.code });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/compte/photo
router.get('/photo', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT photo_base64 FROM users WHERE id = $1', [req.user.id]);
    res.json({ photo_base64: rows[0]?.photo_base64 || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/compte/photo
router.put('/photo', async (req, res) => {
  const { photo_base64, clear } = req.body;
  try {
    if (clear) {
      await pool.query('UPDATE users SET photo_base64 = NULL WHERE id = $1', [req.user.id]);
    } else if (photo_base64) {
      // Strip data URL prefix if present, store raw base64
      const raw = photo_base64.replace(/^data:image\/[a-z]+;base64,/, '');
      await pool.query('UPDATE users SET photo_base64 = $1 WHERE id = $2', [raw, req.user.id]);
    } else {
      return res.status(400).json({ error: 'Aucune donnée de photo fournie' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/compte/portail
router.put('/portail', async (req, res) => {
  const { portal_username, portal_password } = req.body;
  if (!portal_username || !portal_password) {
    return res.status(400).json({ error: 'Identifiant et mot de passe du portail requis' });
  }

  try {
    const data = await fetchNotes(portal_username, portal_password);
    const encrypted = encrypt(portal_password);

    await pool.query(
      'UPDATE users SET portal_username = $1, portal_password_encrypted = $2 WHERE id = $3',
      [portal_username, encrypted, req.user.id]
    );

    // Refresh profile data from portal
    try {
      const profile = await fetchProfile(portal_username, portal_password);
      if (profile.full_name || profile.permanent_code) {
        await pool.query(
          'UPDATE users SET full_name = COALESCE($1, full_name), permanent_code = COALESCE($2, permanent_code) WHERE id = $3',
          [profile.full_name || null, profile.permanent_code || null, req.user.id]
        );
      }
    } catch { /* ignore profile fetch failures */ }

    await processAssignments(req.user.id, data.assignments || []);
    res.json({ ok: true });
  } catch (err) {
    if (err.code) return res.status(503).json({ error: err.message, code: err.code });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/compte/notifications
router.put('/notifications', async (req, res) => {
  const { phone, notify_email, notify_sms } = req.body;
  try {
    await pool.query(
      'UPDATE users SET phone = COALESCE($1, phone), notify_email = $2, notify_sms = $3 WHERE id = $4',
      [phone || null, !!notify_email, !!notify_sms, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/compte — delete account
router.delete('/', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Mot de passe requis pour confirmer' });

  try {
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const match = await bcrypt.compare(password, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Mot de passe incorrect' });

    // Transfer admin role to oldest member for each group
    const adminGroups = await pool.query(
      'SELECT id FROM groups WHERE admin_user_id = $1',
      [req.user.id]
    );
    for (const { id: groupId } of adminGroups.rows) {
      const next = await pool.query(
        `SELECT user_id FROM group_members
         WHERE group_id = $1 AND user_id != $2
         ORDER BY joined_at ASC LIMIT 1`,
        [groupId, req.user.id]
      );
      if (next.rows.length > 0) {
        await pool.query('UPDATE groups SET admin_user_id = $1 WHERE id = $2', [next.rows[0].user_id, groupId]);
      } else {
        await pool.query('UPDATE groups SET admin_user_id = NULL WHERE id = $1', [groupId]);
      }
    }

    await pool.query('DELETE FROM users WHERE id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
