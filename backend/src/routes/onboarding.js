const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { encrypt } = require('../services/crypto');
const { fetchNotes, parseAssignment, getCanonicalSchoolYear } = require('../services/portalApi');
const { processAssignments } = require('../services/dataSync');

const router = express.Router();
router.use(requireAuth);

// GET /api/onboarding/status
router.get('/status', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT onboarding_step, onboarding_completed FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/onboarding/portail — étape 1
router.post('/portail', async (req, res) => {
  const { portal_username, portal_password } = req.body;
  if (!portal_username || !portal_password) {
    return res.status(400).json({ error: 'Identifiant et mot de passe du portail requis' });
  }

  try {
    // Verify credentials by fetching notes (401/502/504 throw with code)
    const data = await fetchNotes(portal_username, portal_password);
    const rawAssignments = data.assignments || [];

    // Parse and discover courses — group by course_code only,
    // then apply canonical school_year (same logic as processAssignments)
    const parsed = rawAssignments.map(parseAssignment);
    const coursesMap = new Map();
    for (const a of parsed) {
      if (!coursesMap.has(a.course_code)) {
        coursesMap.set(a.course_code, {
          course_code: a.course_code,
          course_name: a.course_name,
          assignments: [],
        });
      }
      coursesMap.get(a.course_code).assignments.push(a);
    }
    for (const [, c] of coursesMap) {
      c.school_year = getCanonicalSchoolYear(c.assignments);
    }

    // Check which groups already exist
    const courses = [];
    for (const [, c] of coursesMap) {
      const { rows } = await pool.query(
        `SELECT id,
           (SELECT COUNT(*) FROM group_members WHERE group_id = groups.id) AS member_count
         FROM groups WHERE course_code = $1 AND school_year = $2`,
        [c.course_code, c.school_year]
      );
      courses.push({
        course_code: c.course_code,
        course_name: c.course_name,
        school_year: c.school_year,
        group_id: rows[0]?.id || null,
        member_count: rows[0] ? parseInt(rows[0].member_count) : 0,
        is_new: !rows[0],
      });
    }

    // Save encrypted credentials
    const encrypted = encrypt(portal_password);
    await pool.query(
      'UPDATE users SET portal_username = $1, portal_password_encrypted = $2, onboarding_step = GREATEST(onboarding_step, 1) WHERE id = $3',
      [portal_username, encrypted, req.user.id]
    );

    // Insert all assignments in DB
    await processAssignments(req.user.id, rawAssignments);

    await pool.query(
      'UPDATE users SET onboarding_step = GREATEST(onboarding_step, 2) WHERE id = $1',
      [req.user.id]
    );

    res.json({ courses, total_assignments: rawAssignments.length });
  } catch (err) {
    if (err.code === 'INVALID_CREDENTIALS') return res.status(401).json({ error: err.message, code: err.code });
    if (err.code === 'PORTAL_SLOW') return res.status(503).json({ error: err.message, code: err.code });
    if (err.code === 'SESSION_EXPIRED') return res.status(503).json({ error: err.message, code: err.code });
    if (err.code === 'PORTAL_UNREACHABLE') return res.status(503).json({ error: err.message, code: err.code });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/onboarding/groupes — étape 3 (configure new groups)
router.post('/groupes', async (req, res) => {
  const { groups } = req.body;
  if (!Array.isArray(groups)) return res.status(400).json({ error: 'Données invalides' });

  try {
    for (const g of groups) {
      if (g.group_id) {
        const isAdmin = await pool.query(
          'SELECT id FROM groups WHERE id = $1 AND admin_user_id = $2',
          [g.group_id, req.user.id]
        );
        if (isAdmin.rows.length > 0) {
          await pool.query(
            'UPDATE groups SET school_year = $1, total_students = $2 WHERE id = $3',
            [g.school_year, g.total_students || null, g.group_id]
          );
        }
      }
    }
    await pool.query(
      'UPDATE users SET onboarding_step = GREATEST(onboarding_step, 3) WHERE id = $1',
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/onboarding/notifications — étape 4
router.post('/notifications', async (req, res) => {
  const { recovery_email, phone, notify_email, notify_sms } = req.body;
  try {
    await pool.query(
      `UPDATE users SET
        recovery_email = COALESCE($1, recovery_email),
        phone = COALESCE($2, phone),
        notify_email = $3,
        notify_sms = $4,
        onboarding_step = GREATEST(onboarding_step, 4)
       WHERE id = $5`,
      [recovery_email || null, phone || null, !!notify_email, !!notify_sms, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/onboarding/terminer — étape 5
router.post('/terminer', async (req, res) => {
  try {
    await pool.query(
      'UPDATE users SET onboarding_step = 5, onboarding_completed = true WHERE id = $1',
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
