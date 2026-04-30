const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getSchedulerStatus, restartScheduler } = require('../services/scheduler');

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);

const ENV_KEYS = [
  'PORTAL_BASE_URL',
  'REFRESH_INTERVAL_MINUTES',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM',
  'VOIPMS_USERNAME', 'VOIPMS_PASSWORD', 'VOIPMS_DID',
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

// GET /api/admin/config
router.get('/config', (req, res) => {
  const config = {};
  for (const key of ENV_KEYS) config[key] = process.env[key] || '';
  res.json(config);
});

// POST /api/admin/config
router.post('/config', (req, res) => {
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

// GET /api/admin/deploy  (SSE stream)
router.get('/deploy', (req, res) => {
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

module.exports = router;
