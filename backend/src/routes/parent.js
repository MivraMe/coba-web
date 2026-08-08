const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../db');
const { requireParent } = require('../middleware/auth');
const { encrypt } = require('../services/crypto');
const { fetchNotes, fetchProfile, parseAssignment, getCanonicalSchoolYear } = require('../services/portalApi');
const { processAssignments } = require('../services/dataSync');
const { sendChildInvitationEmail } = require('../services/notifications/email');

const router = express.Router();
const SALT_ROUNDS = 12;

function signParentToken(parentId, email) {
  return jwt.sign({ id: parentId, email, role: 'parent' }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// ─── ROUTES PUBLIQUES ─────────────────────────────────────────────────────────

// GET /api/parent/lookup-student?code=XXXX
router.get('/lookup-student', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Code permanent requis' });

  try {
    const { rows } = await pool.query(
      'SELECT id, full_name, permanent_code FROM users WHERE permanent_code = $1 AND onboarding_completed = true',
      [code.trim().toUpperCase()]
    );
    if (rows.length === 0) return res.json({ found: false });
    return res.json({
      found: true,
      child: { id: rows[0].id, full_name: rows[0].full_name, permanent_code: rows[0].permanent_code },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/parent/create-child — crée un compte enfant via les identifiants du portail
router.post('/create-child', async (req, res) => {
  const { portal_username, portal_password } = req.body;
  if (!portal_username || !portal_password) {
    return res.status(400).json({ error: 'Identifiant et mot de passe du portail requis' });
  }

  try {
    const data = await fetchNotes(portal_username, portal_password);
    const rawAssignments = data.assignments || [];

    let profile = {};
    try {
      profile = await fetchProfile(portal_username, portal_password);
    } catch { /* ignore */ }

    if (!profile.permanent_code) {
      return res.status(400).json({ error: 'Impossible de récupérer le code permanent depuis le portail' });
    }

    // Vérifier si l'étudiant existe déjà
    const existing = await pool.query(
      'SELECT id, full_name, permanent_code FROM users WHERE permanent_code = $1',
      [profile.permanent_code]
    );
    if (existing.rows.length > 0) {
      const child = existing.rows[0];
      return res.json({ found: true, child: { id: child.id, full_name: child.full_name, permanent_code: child.permanent_code } });
    }

    // Créer un compte temporaire
    const placeholderEmail = `child-${profile.permanent_code.toLowerCase()}@notesqc.invalid`;
    const tempPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), SALT_ROUNDS);
    const encrypted = encrypt(portal_password);

    const userRes = await pool.query(
      `INSERT INTO users (email, password_hash, portal_username, portal_password_encrypted, full_name, permanent_code, photo_base64, onboarding_completed, onboarding_step)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, 5)
       ON CONFLICT (email) DO UPDATE SET
         portal_username = EXCLUDED.portal_username,
         portal_password_encrypted = EXCLUDED.portal_password_encrypted,
         full_name = COALESCE(EXCLUDED.full_name, users.full_name),
         photo_base64 = COALESCE(EXCLUDED.photo_base64, users.photo_base64)
       RETURNING id, full_name, permanent_code`,
      [placeholderEmail, tempPasswordHash, portal_username, encrypted, profile.full_name || null, profile.permanent_code, profile.photo_base64 || null]
    );
    const child = userRes.rows[0];

    await processAssignments(child.id, rawAssignments);

    res.json({ found: false, created: true, child: { id: child.id, full_name: child.full_name, permanent_code: child.permanent_code } });
  } catch (err) {
    if (err.code === 'INVALID_CREDENTIALS') return res.status(401).json({ error: 'Identifiants du portail invalides', code: err.code });
    if (err.code === 'PORTAL_SLOW') return res.status(503).json({ error: err.message, code: err.code });
    if (err.code === 'PORTAL_UNREACHABLE') return res.status(503).json({ error: err.message, code: err.code });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/parent/register
// Accepts either child_user_id (found/created child) OR permanent_code (pending — child not yet registered)
router.post('/register', async (req, res) => {
  const { first_name, last_name, email, password, phone, child_user_id, permanent_code } = req.body;
  if (!first_name || !last_name || !email || !password) {
    return res.status(400).json({ error: 'Tous les champs obligatoires doivent être remplis' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit comporter au moins 8 caractères' });
  if (!child_user_id && !permanent_code) return res.status(400).json({ error: 'Enfant non spécifié' });

  try {
    let finalChildId = child_user_id || null;
    let isPending = false;

    if (!finalChildId && permanent_code) {
      // Chercher si l'enfant existe déjà avec ce code permanent
      const existing = await pool.query(
        'SELECT id FROM users WHERE permanent_code = $1 AND onboarding_completed = true',
        [permanent_code.trim().toUpperCase()]
      );
      if (existing.rows.length > 0) {
        finalChildId = existing.rows[0].id;
      } else {
        isPending = true;
      }
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const normalizedEmail = email.toLowerCase().trim();

    const parentRes = await pool.query(
      `INSERT INTO parents (first_name, last_name, email, password_hash, phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, first_name, last_name, email, phone, notify_email, notify_sms, created_at`,
      [first_name.trim(), last_name.trim(), normalizedEmail, hash, phone || null]
    );
    const parent = parentRes.rows[0];

    if (finalChildId) {
      await pool.query(
        `INSERT INTO parent_child_links (parent_id, child_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [parent.id, finalChildId]
      );
    }

    if (isPending && permanent_code) {
      await pool.query(
        `INSERT INTO parent_pending_links (parent_id, permanent_code)
         VALUES ($1, $2) ON CONFLICT (parent_id, permanent_code) DO NOTHING`,
        [parent.id, permanent_code.trim().toUpperCase()]
      );
    }

    res.status(201).json({ token: signParentToken(parent.id, parent.email), parent, pending: isPending });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ce courriel est déjà utilisé pour un compte parent' });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/parent/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Courriel et mot de passe requis' });

  try {
    const { rows } = await pool.query(
      'SELECT id, first_name, last_name, email, password_hash, phone FROM parents WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Identifiants incorrects' });

    const parent = rows[0];
    const match = await bcrypt.compare(password, parent.password_hash);
    if (!match) return res.status(401).json({ error: 'Identifiants incorrects' });

    const { password_hash, ...safeParent } = parent;
    res.json({ token: signParentToken(parent.id, parent.email), parent: safeParent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── ROUTES AUTHENTIFIÉES ─────────────────────────────────────────────────────

// GET /api/parent/me
router.get('/me', requireParent, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, first_name, last_name, email, phone, notify_email, notify_sms, created_at FROM parents WHERE id = $1',
      [req.parent.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Compte parent introuvable' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/parent/children
router.get('/children', requireParent, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.full_name, u.permanent_code, u.photo_base64, u.onboarding_completed,
              pcl.created_at AS linked_at
       FROM parent_child_links pcl
       JOIN users u ON u.id = pcl.child_user_id
       WHERE pcl.parent_id = $1
       ORDER BY u.full_name`,
      [req.parent.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/parent/children/add — ajouter un enfant par code permanent
router.post('/children/add', requireParent, async (req, res) => {
  const { permanent_code } = req.body;
  if (!permanent_code) return res.status(400).json({ error: 'Code permanent requis' });

  try {
    const { rows } = await pool.query(
      'SELECT id, full_name, permanent_code FROM users WHERE permanent_code = $1 AND onboarding_completed = true',
      [permanent_code.trim().toUpperCase()]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Aucun étudiant trouvé avec ce code permanent' });

    const child = rows[0];
    await pool.query(
      `INSERT INTO parent_child_links (parent_id, child_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.parent.id, child.id]
    );
    res.json({ ok: true, child: { id: child.id, full_name: child.full_name, permanent_code: child.permanent_code } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/parent/children/:userId
router.delete('/children/:userId', requireParent, async (req, res) => {
  const childId = parseInt(req.params.userId);
  try {
    await pool.query(
      'DELETE FROM parent_child_links WHERE parent_id = $1 AND child_user_id = $2',
      [req.parent.id, childId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/parent/pending-link — être notifié quand l'enfant s'inscrit
router.post('/pending-link', requireParent, async (req, res) => {
  const { permanent_code } = req.body;
  if (!permanent_code) return res.status(400).json({ error: 'Code permanent requis' });

  try {
    await pool.query(
      `INSERT INTO parent_pending_links (parent_id, permanent_code)
       VALUES ($1, $2)
       ON CONFLICT (parent_id, permanent_code) DO NOTHING`,
      [req.parent.id, permanent_code.trim().toUpperCase()]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── DONNÉES ENFANT ───────────────────────────────────────────────────────────

async function checkAccess(parentId, childUserId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM parent_child_links WHERE parent_id = $1 AND child_user_id = $2',
    [parentId, childUserId]
  );
  return rows.length > 0;
}

// GET /api/parent/children/:userId/annees
router.get('/children/:userId/annees', requireParent, async (req, res) => {
  const childId = parseInt(req.params.userId);
  try {
    if (!await checkAccess(req.parent.id, childId)) return res.status(403).json({ error: 'Accès refusé' });

    const { rows } = await pool.query(
      `SELECT DISTINCT g.school_year
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = $1
       ORDER BY g.school_year DESC`,
      [childId]
    );
    res.json(rows.map(r => r.school_year));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/parent/children/:userId/resume?annee=...
router.get('/children/:userId/resume', requireParent, async (req, res) => {
  const childId = parseInt(req.params.userId);
  const { annee } = req.query;
  try {
    if (!await checkAccess(req.parent.id, childId)) return res.status(403).json({ error: 'Accès refusé' });

    const params = [childId];
    let yearClause = '';
    if (annee) { params.push(annee); yearClause = `AND g.school_year = $${params.length}`; }

    const personalRes = await pool.query(`
      SELECT
        ROUND(SUM(a.weight * us.percentage) /
          NULLIF(SUM(CASE WHEN us.percentage IS NOT NULL THEN a.weight ELSE 0 END), 0), 2) AS personal_avg,
        ROUND(CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY us.percentage) AS NUMERIC), 2) AS personal_median,
        COALESCE(SUM(CASE WHEN us.percentage IS NOT NULL THEN a.weight ELSE 0 END), 0) AS graded_weight,
        COALESCE(SUM(a.weight), 0) AS total_weight
      FROM assignments a
      LEFT JOIN user_scores us ON us.assignment_id = a.id AND us.user_id = $1
      JOIN groups g ON g.id = a.group_id
      JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
      WHERE true ${yearClause}
    `, params);

    const groupRes = await pool.query(`
      SELECT
        ROUND(AVG(member_avg), 2) AS group_avg,
        ROUND(CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY member_avg) AS NUMERIC), 2) AS group_median,
        COUNT(*) AS group_member_count
      FROM (
        SELECT us.user_id,
          SUM(a.weight * us.percentage) /
            NULLIF(SUM(CASE WHEN us.percentage IS NOT NULL THEN a.weight ELSE 0 END), 0) AS member_avg
        FROM assignments a
        JOIN user_scores us ON us.assignment_id = a.id
        JOIN groups g ON g.id = a.group_id
        JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
        JOIN group_members gm2 ON gm2.user_id = us.user_id AND gm2.group_id = g.id
        WHERE true ${yearClause}
        GROUP BY us.user_id
      ) t
    `, params);

    res.json({ ...personalRes.rows[0], ...groupRes.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/parent/children/:userId/cours?annee=...
router.get('/children/:userId/cours', requireParent, async (req, res) => {
  const childId = parseInt(req.params.userId);
  const { annee } = req.query;
  try {
    if (!await checkAccess(req.parent.id, childId)) return res.status(403).json({ error: 'Accès refusé' });

    const params = [childId];
    let yearClause = '';
    if (annee) { params.push(annee); yearClause = `AND g.school_year = $${params.length}`; }

    const { rows } = await pool.query(
      `SELECT
         g.id AS group_id, g.course_code, g.course_name, g.school_year, g.total_students,
         (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count,
         (SELECT ROUND(SUM(a.weight * us.percentage) /
           NULLIF(SUM(CASE WHEN us.percentage IS NOT NULL THEN a.weight ELSE 0 END), 0), 2)
          FROM assignments a LEFT JOIN user_scores us ON us.assignment_id = a.id AND us.user_id = $1
          WHERE a.group_id = g.id) AS personal_avg,
         (SELECT ROUND(AVG(member_avg), 2) FROM (
           SELECT SUM(a.weight * us.percentage) /
             NULLIF(SUM(CASE WHEN us.percentage IS NOT NULL THEN a.weight ELSE 0 END), 0) AS member_avg
           FROM assignments a
           JOIN user_scores us ON us.assignment_id = a.id
           JOIN group_members gm2 ON gm2.user_id = us.user_id AND gm2.group_id = g.id
           WHERE a.group_id = g.id GROUP BY us.user_id) t) AS group_avg,
         (SELECT ROUND(CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY member_avg) AS NUMERIC), 2) FROM (
           SELECT SUM(a.weight * us.percentage) /
             NULLIF(SUM(CASE WHEN us.percentage IS NOT NULL THEN a.weight ELSE 0 END), 0) AS member_avg
           FROM assignments a
           JOIN user_scores us ON us.assignment_id = a.id
           JOIN group_members gm2 ON gm2.user_id = us.user_id AND gm2.group_id = g.id
           WHERE a.group_id = g.id GROUP BY us.user_id) t) AS group_median,
         (SELECT COALESCE(SUM(a.weight), 0)
          FROM assignments a JOIN user_scores us ON us.assignment_id = a.id AND us.user_id = $1
          WHERE a.group_id = g.id AND us.percentage IS NOT NULL) AS graded_weight,
         (SELECT COALESCE(SUM(weight), 0) FROM assignments WHERE group_id = g.id) AS total_weight
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id AND gm.user_id = $1
       WHERE true ${yearClause}
       ORDER BY g.school_year DESC, g.course_code`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/parent/children/:userId/cours/:groupId/travaux
router.get('/children/:userId/cours/:groupId/travaux', requireParent, async (req, res) => {
  const childId = parseInt(req.params.userId);
  const groupId = parseInt(req.params.groupId);
  try {
    if (!await checkAccess(req.parent.id, childId)) return res.status(403).json({ error: 'Accès refusé' });

    const member = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, childId]
    );
    if (member.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });

    const { rows } = await pool.query(
      `SELECT
         a.id, a.title, a.category, a.weight, a.date_assigned, a.date_due, a.date_completed,
         us.score_obtained, us.score_max, us.percentage AS personal_pct, us.refreshed_at,
         (SELECT ROUND(AVG(us2.percentage), 2)
          FROM user_scores us2 JOIN group_members gm ON gm.user_id = us2.user_id AND gm.group_id = $1
          WHERE us2.assignment_id = a.id AND us2.percentage IS NOT NULL) AS group_avg_pct,
         (SELECT ROUND(CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY us2.percentage) AS NUMERIC), 2)
          FROM user_scores us2 JOIN group_members gm ON gm.user_id = us2.user_id AND gm.group_id = $1
          WHERE us2.assignment_id = a.id AND us2.percentage IS NOT NULL) AS group_median_pct,
         (SELECT COUNT(*)
          FROM user_scores us2 JOIN group_members gm ON gm.user_id = us2.user_id AND gm.group_id = $1
          WHERE us2.assignment_id = a.id AND us2.percentage IS NOT NULL) AS graded_count
       FROM assignments a
       LEFT JOIN user_scores us ON us.assignment_id = a.id AND us.user_id = $2
       WHERE a.group_id = $1
       ORDER BY a.date_assigned ASC NULLS LAST, a.title`,
      [groupId, childId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/parent/children/:userId/cours/:groupId/graphique
router.get('/children/:userId/cours/:groupId/graphique', requireParent, async (req, res) => {
  const childId = parseInt(req.params.userId);
  const groupId = parseInt(req.params.groupId);
  try {
    if (!await checkAccess(req.parent.id, childId)) return res.status(403).json({ error: 'Accès refusé' });

    const member = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, childId]
    );
    if (member.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });

    const totalRes = await pool.query(
      'SELECT COALESCE(SUM(weight), 0) AS total FROM assignments WHERE group_id = $1',
      [groupId]
    );
    const totalWeight = parseFloat(totalRes.rows[0].total) || 100;

    const { rows } = await pool.query(
      `SELECT a.id, a.title, a.weight, a.date_assigned, us.percentage AS personal_pct,
         (SELECT ROUND(AVG(us2.percentage), 2)
          FROM user_scores us2 JOIN group_members gm ON gm.user_id = us2.user_id AND gm.group_id = $1
          WHERE us2.assignment_id = a.id AND us2.percentage IS NOT NULL) AS group_avg_pct,
         (SELECT ROUND(CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY us2.percentage) AS NUMERIC), 2)
          FROM user_scores us2 JOIN group_members gm ON gm.user_id = us2.user_id AND gm.group_id = $1
          WHERE us2.assignment_id = a.id AND us2.percentage IS NOT NULL) AS group_median_pct
       FROM assignments a
       LEFT JOIN user_scores us ON us.assignment_id = a.id AND us.user_id = $2
       WHERE a.group_id = $1
       ORDER BY a.date_assigned ASC NULLS LAST, a.id`,
      [groupId, childId]
    );

    const graded = rows.filter(r => r.personal_pct !== null || r.group_avg_pct !== null);
    const gradedWeight = graded.reduce((s, r) => s + r.weight, 0);

    let cumWeight = 0, cumPS = 0, cumPW = 0, cumGAS = 0, cumGAW = 0, cumGMS = 0, cumGMW = 0;

    const points = graded.map(r => {
      cumWeight += r.weight;
      const xPct = parseFloat(((cumWeight / totalWeight) * 100).toFixed(2));

      if (r.personal_pct !== null) { cumPS += r.weight * parseFloat(r.personal_pct); cumPW += r.weight; }
      if (r.group_avg_pct !== null) { cumGAS += r.weight * parseFloat(r.group_avg_pct); cumGAW += r.weight; }
      if (r.group_median_pct !== null) { cumGMS += r.weight * parseFloat(r.group_median_pct); cumGMW += r.weight; }

      return {
        title: r.title,
        weight: r.weight,
        cumulative_weight_pct: xPct,
        personal_running_avg: cumPW > 0 ? parseFloat((cumPS / cumPW).toFixed(2)) : null,
        group_running_avg: cumGAW > 0 ? parseFloat((cumGAS / cumGAW).toFixed(2)) : null,
        personal_pct: r.personal_pct !== null ? parseFloat(r.personal_pct) : null,
        group_median_pct: r.group_median_pct !== null ? parseFloat(r.group_median_pct) : null,
      };
    });

    res.json({ points, total_weight: totalWeight, graded_weight: gradedWeight });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── COMPTE PARENT ────────────────────────────────────────────────────────────

// PUT /api/parent/account
router.put('/account', requireParent, async (req, res) => {
  const { first_name, last_name, email, phone, notify_email, notify_sms } = req.body;
  try {
    const updates = [];
    const values = [];
    let idx = 1;

    if (first_name !== undefined) { updates.push(`first_name = $${idx++}`); values.push(first_name.trim()); }
    if (last_name !== undefined) { updates.push(`last_name = $${idx++}`); values.push(last_name.trim()); }
    if (email !== undefined) { updates.push(`email = $${idx++}`); values.push(email.toLowerCase().trim()); }
    if (phone !== undefined) { updates.push(`phone = $${idx++}`); values.push(phone || null); }
    if (notify_email !== undefined) { updates.push(`notify_email = $${idx++}`); values.push(Boolean(notify_email)); }
    if (notify_sms !== undefined) { updates.push(`notify_sms = $${idx++}`); values.push(Boolean(notify_sms)); }

    if (updates.length === 0) return res.status(400).json({ error: 'Aucune modification' });

    values.push(req.parent.id);
    const { rows } = await pool.query(
      `UPDATE parents SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, first_name, last_name, email, phone, notify_email, notify_sms`,
      values
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ce courriel est déjà utilisé' });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/parent/invite-child — envoyer un courriel d'invitation à un enfant
router.post('/invite-child', requireParent, async (req, res) => {
  const { child_email } = req.body;
  if (!child_email) return res.status(400).json({ error: 'Adresse courriel requise' });

  try {
    const { rows } = await pool.query(
      'SELECT first_name, last_name FROM parents WHERE id = $1',
      [req.parent.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Compte parent introuvable' });

    const parent = rows[0];
    const base = (process.env.APP_URL || '').replace(/\/$/, '');
    const registerUrl = base ? `${base}/register` : '/register';

    await sendChildInvitationEmail(child_email, {
      parentName: `${parent.first_name} ${parent.last_name}`,
      registerUrl,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de l\'envoi du courriel' });
  }
});

// PUT /api/parent/account/password
router.put('/account/password', requireParent, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Tous les champs sont requis' });
  if (new_password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit comporter au moins 8 caractères' });

  try {
    const { rows } = await pool.query('SELECT password_hash FROM parents WHERE id = $1', [req.parent.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Compte introuvable' });

    const match = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });

    const hash = await bcrypt.hash(new_password, SALT_ROUNDS);
    await pool.query('UPDATE parents SET password_hash = $1 WHERE id = $2', [hash, req.parent.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
