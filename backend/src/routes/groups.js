const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRegularUser } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireRegularUser);

// GET /api/groupes
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         g.id,
         g.course_code,
         g.course_name,
         g.school_year,
         g.total_students,
         g.admin_user_id = $1 AS is_admin,
         g.created_at,
         (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count,
         gm.joined_at,
         gm.refreshed_at
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id AND gm.user_id = $1
       ORDER BY g.school_year DESC, g.course_code`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/groupes/:id
router.get('/:id', async (req, res) => {
  const groupId = parseInt(req.params.id);
  try {
    const member = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, req.user.id]
    );
    if (member.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });

    const groupRes = await pool.query(
      `SELECT g.*, g.admin_user_id = $2 AS is_admin,
        (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count
       FROM groups g WHERE g.id = $1`,
      [groupId, req.user.id]
    );
    if (groupRes.rows.length === 0) return res.status(404).json({ error: 'Groupe introuvable' });

    const membersRes = await pool.query(
      `SELECT u.id, u.email, gm.joined_at, gm.refreshed_at,
         u.id = g.admin_user_id AS is_admin
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       JOIN groups g ON g.id = gm.group_id
       WHERE gm.group_id = $1
       ORDER BY gm.joined_at ASC`,
      [groupId]
    );

    res.json({ group: groupRes.rows[0], members: membersRes.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/groupes/:id — update group info (admin only)
router.put('/:id', async (req, res) => {
  const groupId = parseInt(req.params.id);
  const { total_students, school_year } = req.body;

  try {
    const { rows } = await pool.query(
      'SELECT id FROM groups WHERE id = $1 AND admin_user_id = $2',
      [groupId, req.user.id]
    );
    if (rows.length === 0) return res.status(403).json({ error: 'Réservé à l\'administrateur du groupe' });

    if (school_year) {
      const conflict = await pool.query(
        `SELECT id FROM groups
         WHERE course_code = (SELECT course_code FROM groups WHERE id = $1)
           AND school_year = $2
           AND id != $1`,
        [groupId, school_year]
      );
      if (conflict.rows.length > 0) {
        return res.status(409).json({
          error: 'Un groupe pour ce cours avec cette année scolaire existe déjà.',
        });
      }
    }

    await pool.query(
      'UPDATE groups SET total_students = COALESCE($1, total_students), school_year = COALESCE($2, school_year) WHERE id = $3',
      [total_students ?? null, school_year || null, groupId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
