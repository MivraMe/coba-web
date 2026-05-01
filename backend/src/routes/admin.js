const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { requireAuth, requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const { getSchedulerStatus, restartScheduler } = require('../services/scheduler');
const { syncUserData, runScheduledRefresh } = require('../services/dataSync');
const { sendNewGradeEmail, sendAdminMessage } = require('../services/notifications/email');
const { sendSms } = require('../services/notifications/sms');
const { fetchNotes } = require('../services/portalApi');
const { encrypt } = require('../services/crypto');

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);

const ENV_KEYS = [
  'PORTAL_BASE_URL',
  'REFRESH_INTERVAL_MINUTES',
  'RESEND_API_KEY', 'SMTP_FROM',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
];

const WORKSPACE_ENV = '/workspace/.env';

function updateEnvFile(updates) {
  let content = '';
  try { content = fs.readFileSync(WORKSPACE_ENV, 'utf8'); } catch { /* file may not exist yet */ }

  const lines = content.split('\n');
  const touched = new Set();

  const newLines = lines.map(line => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && Object.prototype.hasOwnProperty.call(updates, m[1])) {
      touched.add(m[1]);
      return `${m[1]}=${updates[m[1]]}`;
    }
    return line;
  });

  for (const [k, v] of Object.entries(updates)) {
    if (!touched.has(k)) newLines.push(`${k}=${v}`);
  }

  fs.writeFileSync(WORKSPACE_ENV, newLines.join('\n'));
}

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const [usersRes, groupsRes, assignRes, notifRes, errorsRes] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM groups'),
      pool.query('SELECT COUNT(*) FROM assignments'),
      pool.query(`
        SELECT type, COUNT(*) AS cnt
        FROM notification_log
        WHERE sent_at > NOW() - INTERVAL '7 days'
        GROUP BY type
      `),
      pool.query(`
        SELECT COUNT(*) FROM sync_log
        WHERE success = false AND started_at > NOW() - INTERVAL '24 hours'
      `),
    ]);

    const notifications = { email_7d: 0, sms_7d: 0 };
    for (const row of notifRes.rows) {
      if (row.type === 'email') notifications.email_7d = parseInt(row.cnt);
      if (row.type === 'sms') notifications.sms_7d = parseInt(row.cnt);
    }

    res.json({
      user_count: parseInt(usersRes.rows[0].count),
      group_count: parseInt(groupsRes.rows[0].count),
      assignment_count: parseInt(assignRes.rows[0].count),
      notifications,
      sync_errors_24h: parseInt(errorsRes.rows[0].count),
      scheduler: getSchedulerStatus(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/admin/sync-log
router.get('/sync-log', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        sl.id, sl.group_id, sl.group_course_code, sl.started_at, sl.finished_at,
        sl.success, sl.error_message, sl.new_scores,
        u.email AS user_email,
        g.course_name
      FROM sync_log sl
      LEFT JOIN users u ON u.id = sl.user_id
      LEFT JOIN groups g ON g.id = sl.group_id
      ORDER BY sl.started_at DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/admin/config  (superadmin only)
router.get('/config', requireSuperAdmin, (req, res) => {
  const config = {};
  for (const key of ENV_KEYS) config[key] = process.env[key] || '';
  res.json(config);
});

// POST /api/admin/config  (superadmin only)
router.post('/config', requireSuperAdmin, (req, res) => {
  const updates = {};
  const oldInterval = process.env.REFRESH_INTERVAL_MINUTES;

  for (const key of ENV_KEYS) {
    if (req.body[key] !== undefined) {
      updates[key] = String(req.body[key]);
      process.env[key] = updates[key];
    }
  }

  try {
    updateEnvFile(updates);
  } catch (err) {
    console.warn('Impossible d\'écrire dans /workspace/.env:', err.message);
  }

  if (updates.REFRESH_INTERVAL_MINUTES && updates.REFRESH_INTERVAL_MINUTES !== oldInterval) {
    restartScheduler();
  }

  res.json({ ok: true });
});

// GET /api/admin/deploy  (superadmin only — SSE stream)
router.get('/deploy', requireSuperAdmin, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type, text) => {
    try { res.write(`data: ${JSON.stringify({ type, text })}\n\n`); } catch {}
  };

  if (!fs.existsSync('/workspace')) {
    send('error', '/workspace non monté — vérifiez docker-compose.yml (volume /opt/stacks/coba-web:/workspace)');
    send('done', '');
    return res.end();
  }

  send('log', '$ cd /workspace && git pull && docker-compose up -d --build\n');

  const proc = spawn('sh', ['-c', 'cd /workspace && git pull && docker-compose up -d --build'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout.on('data', d => send('log', d.toString()));
  proc.stderr.on('data', d => send('log', d.toString()));

  proc.on('close', code => {
    send('done', code === 0 ? 'Déploiement terminé avec succès.' : `Échec (code de sortie : ${code})`);
    res.end();
  });

  proc.on('error', err => {
    send('error', `Impossible de lancer le processus : ${err.message}`);
    send('done', '');
    res.end();
  });

  req.on('close', () => { try { proc.kill(); } catch {} });
});

// ── USERS ──────────────────────────────────────────────────────────────────────

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const { rows: users } = await pool.query(`
      SELECT u.id, u.email, u.full_name, u.permanent_code, u.created_at, u.is_admin, u.role,
             u.notify_email, u.notify_sms, u.phone, u.portal_username,
             (SELECT email FROM users WHERE id = u.invited_by_user_id) AS invited_by_email,
             MAX(gm.refreshed_at) AS last_synced
      FROM users u
      LEFT JOIN group_members gm ON gm.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at ASC
    `);

    const { rows: memberships } = await pool.query(`
      SELECT gm.user_id, g.course_code, g.course_name, g.school_year
      FROM group_members gm
      JOIN groups g ON g.id = gm.group_id
    `);

    const groupsByUser = new Map();
    for (const m of memberships) {
      if (!groupsByUser.has(m.user_id)) groupsByUser.set(m.user_id, []);
      groupsByUser.get(m.user_id).push({ course_code: m.course_code, course_name: m.course_name, school_year: m.school_year });
    }

    res.json(users.map(u => ({
      ...u,
      groups: groupsByUser.get(u.id) || [],
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/admin/users/:id/photo  (superadmin only)
router.get('/users/:id/photo', requireSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT photo_base64 FROM users WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json({ photo_base64: rows[0].photo_base64 || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/admin/users/:id/toggle-admin
router.post('/users/:id/toggle-admin', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const newVal = !rows[0].is_admin;
    await pool.query('UPDATE users SET is_admin = $1 WHERE id = $2', [newVal, req.params.id]);
    res.json({ ok: true, is_admin: newVal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/admin/users/:id/sync
router.post('/users/:id/sync', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const result = await syncUserData(parseInt(req.params.id));
    res.json({ ok: true, new_grades: result.newGrades.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  try {
    const myId = req.user?.id;
    if (String(myId) === String(req.params.id)) {
      return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
    }
    const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/admin/users/:id/reset-password
router.post('/users/:id/reset-password', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, phone, notify_sms FROM users WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const user = rows[0];
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const hash = await bcrypt.hash(tempPassword, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);

    let sms_sent = false;
    if (user.notify_sms && user.phone) {
      const msg = `NotesQC - Votre mot de passe temporaire est : ${tempPassword}. Connectez-vous et changez-le immediatement.`;
      try {
        await sendSms(user.phone, msg);
        sms_sent = true;
      } catch (err) {
        console.error('Erreur SMS reset-password:', err.message);
      }
    }

    res.json({ ok: true, temp_password: tempPassword, sms_sent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/admin/users/:id/contact
router.post('/users/:id/contact', async (req, res) => {
  const { message, channel } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message requis' });
  if (!['email', 'sms', 'both'].includes(channel)) return res.status(400).json({ error: 'Canal invalide' });
  try {
    const { rows } = await pool.query('SELECT id, email, phone FROM users WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const target = rows[0];
    const results = {};
    if (channel === 'email' || channel === 'both') {
      try {
        await sendAdminMessage(target.email, 'Message de l\'administration — NotesQC', message.trim());
        results.email = 'ok';
      } catch (err) { results.email = err.message; }
    }
    if (channel === 'sms' || channel === 'both') {
      if (!target.phone) { results.sms = 'Aucun numéro configuré'; }
      else {
        try { await sendSms(target.phone, `[NotesQC] ${message.trim()}`); results.sms = 'ok'; }
        catch (err) { results.sms = err.message; }
      }
    }
    res.json({ ok: true, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/admin/users/:id  (superadmin only)
router.patch('/users/:id', requireSuperAdmin, async (req, res) => {
  const { email, password, phone, notify_email, notify_sms, role, portal_username, portal_password, full_name, photo_base64 } = req.body;

  try {
    const fields = [];
    const params = [];

    if (email) {
      params.push(email.toLowerCase().trim());
      fields.push(`email = $${params.length}`);
    }
    if (password) {
      if (password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit comporter au moins 8 caractères' });
      const hash = await bcrypt.hash(password, 12);
      params.push(hash);
      fields.push(`password_hash = $${params.length}`);
    }
    if (phone !== undefined) {
      params.push(phone || null);
      fields.push(`phone = $${params.length}`);
    }
    if (notify_email !== undefined) {
      params.push(!!notify_email);
      fields.push(`notify_email = $${params.length}`);
    }
    if (notify_sms !== undefined) {
      params.push(!!notify_sms);
      fields.push(`notify_sms = $${params.length}`);
    }
    if (role !== undefined && ['user', 'superadmin'].includes(role)) {
      params.push(role);
      fields.push(`role = $${params.length}`);
    }
    if (portal_username !== undefined) {
      params.push(portal_username || null);
      fields.push(`portal_username = $${params.length}`);
    }
    if (portal_password) {
      const encrypted = encrypt(portal_password);
      params.push(encrypted);
      fields.push(`portal_password_encrypted = $${params.length}`);
    }
    if (full_name !== undefined) {
      params.push(full_name || null);
      fields.push(`full_name = $${params.length}`);
    }
    if (photo_base64 === null) {
      params.push(null);
      fields.push(`photo_base64 = $${params.length}`);
    } else if (photo_base64) {
      const raw = photo_base64.replace(/^data:image\/[a-z]+;base64,/, '');
      params.push(raw);
      fields.push(`photo_base64 = $${params.length}`);
    }

    if (fields.length === 0) return res.status(400).json({ error: 'Aucune modification à effectuer' });

    params.push(req.params.id);
    const { rowCount } = await pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${params.length}`,
      params
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ce courriel est déjà utilisé' });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── TESTS ──────────────────────────────────────────────────────────────────────

// POST /api/admin/test/notification
router.post('/test/notification', async (req, res) => {
  const { user_id, type, message } = req.body;
  if (!user_id || !type) return res.status(400).json({ error: 'user_id et type requis' });

  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [user_id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const user = rows[0];
    const testMsg = message || 'Ceci est un message de test envoyé depuis le panneau admin de NotesQC.';

    const results = {};

    if (type === 'email' || type === 'both') {
      try {
        await sendNewGradeEmail(user.email, 'Test de notification — NotesQC', {
          courseCode: 'TEST',
          courseName: 'Test de notification',
          assignment: { title: testMsg },
          score: { score_obtained: 10, score_max: 10, percentage: 100 },
        });
        results.email = 'ok';
      } catch (err) {
        results.email = err.message;
      }
    }

    if (type === 'sms' || type === 'both') {
      if (!user.phone) {
        results.sms = 'Aucun numéro de téléphone configuré';
      } else {
        try {
          await sendSms(user.phone, `[NotesQC TEST] ${testMsg}`);
          results.sms = 'ok';
        } catch (err) {
          results.sms = err.message;
        }
      }
    }

    res.json({ ok: true, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/admin/test/sync
router.post('/test/sync', async (req, res) => {
  const { group_id } = req.body;
  try {
    if (group_id && group_id !== 'all') {
      const { rows } = await pool.query(
        `SELECT u.id FROM users u JOIN group_members gm ON u.id = gm.user_id WHERE gm.group_id = $1 AND u.portal_username IS NOT NULL`,
        [group_id]
      );
      let totalNew = 0;
      const errors = [];
      for (const row of rows) {
        try {
          const r = await syncUserData(row.id);
          totalNew += r.newGrades.length;
        } catch (err) {
          errors.push(err.message);
        }
      }
      res.json({ ok: true, new_grades: totalNew, errors });
    } else {
      await runScheduledRefresh();
      res.json({ ok: true, message: 'Synchronisation complète effectuée.' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

// POST /api/admin/test/portal
router.post('/test/portal', async (req, res) => {
  const { portal_username, portal_password } = req.body;
  if (!portal_username || !portal_password) {
    return res.status(400).json({ error: 'portal_username et portal_password requis' });
  }
  try {
    const data = await fetchNotes(portal_username, portal_password);
    res.json({ ok: true, data });
  } catch (err) {
    res.json({ ok: false, error: err.message, code: err.code });
  }
});

// ── TODO ITEMS ────────────────────────────────────────────────────────────────

// GET /api/admin/todo
router.get('/todo', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM todo_items
      ORDER BY CASE priority WHEN 'Haute' THEN 1 WHEN 'Normale' THEN 2 WHEN 'Basse' THEN 3 ELSE 4 END, id ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/admin/todo  (superadmin only)
router.post('/todo', requireSuperAdmin, async (req, res) => {
  const { title, description, status, priority } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Titre requis' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO todo_items (title, description, status, priority)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [title.trim(), description || '', status || 'Planifié', priority || 'Normale']
    );
    res.json({ ok: true, item: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un élément avec ce titre existe déjà' });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/admin/todo/:id  (superadmin only)
router.patch('/todo/:id', requireSuperAdmin, async (req, res) => {
  const { title, description, status, priority } = req.body;
  try {
    const fields = [], params = [];
    if (title !== undefined) { params.push(title.trim()); fields.push(`title = $${params.length}`); }
    if (description !== undefined) { params.push(description); fields.push(`description = $${params.length}`); }
    if (status !== undefined) { params.push(status); fields.push(`status = $${params.length}`); }
    if (priority !== undefined) { params.push(priority); fields.push(`priority = $${params.length}`); }
    if (fields.length === 0) return res.status(400).json({ error: 'Aucune modification' });
    params.push(new Date()); fields.push(`updated_at = $${params.length}`);
    params.push(req.params.id);
    const { rowCount, rows } = await pool.query(
      `UPDATE todo_items SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Élément introuvable' });
    res.json({ ok: true, item: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un élément avec ce titre existe déjà' });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/admin/todo/:id  (superadmin only)
router.delete('/todo/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM todo_items WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Élément introuvable' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
