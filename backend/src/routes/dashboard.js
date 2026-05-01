const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRegularUser } = require('../middleware/auth');
const { syncUserData } = require('../services/dataSync');

const router = express.Router();
router.use(requireAuth);
router.use(requireRegularUser);

// GET /api/dashboard/annees
router.get('/annees', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT g.school_year
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = $1
       ORDER BY g.school_year DESC`,
      [req.user.id]
    );
    res.json(rows.map(r => r.school_year));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/dashboard/resume?annee=2025-2026 — global header stats
router.get('/resume', async (req, res) => {
  const { annee } = req.query;
  const params = [req.user.id];
  let yearClause = '';
  if (annee) { params.push(annee); yearClause = `AND g.school_year = $${params.length}`; }

  try {
    // Personal stats across all user's courses for the year
    const personalRes = await pool.query(`
      SELECT
        ROUND(
          SUM(a.weight * us.percentage) /
          NULLIF(SUM(CASE WHEN us.percentage IS NOT NULL THEN a.weight ELSE 0 END), 0),
          2
        ) AS personal_avg,
        ROUND(CAST(
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY us.percentage) AS NUMERIC
        ), 2) AS personal_median,
        COALESCE(SUM(CASE WHEN us.percentage IS NOT NULL THEN a.weight ELSE 0 END), 0) AS graded_weight,
        COALESCE(SUM(a.weight), 0) AS total_weight
      FROM assignments a
      LEFT JOIN user_scores us ON us.assignment_id = a.id AND us.user_id = $1
      JOIN groups g ON g.id = a.group_id
      JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
      WHERE true ${yearClause}
    `, params);

    // Group stats: median of per-member weighted averages across all courses
    const groupRes = await pool.query(`
      SELECT
        ROUND(AVG(member_avg), 2) AS group_avg,
        ROUND(CAST(
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY member_avg) AS NUMERIC
        ), 2) AS group_median
      FROM (
        SELECT
          us.user_id,
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

    res.json({
      ...personalRes.rows[0],
      ...groupRes.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/dashboard/cours?annee=2025-2026
router.get('/cours', async (req, res) => {
  const { annee } = req.query;
  try {
    const params = [req.user.id];
    let yearClause = '';
    if (annee) { params.push(annee); yearClause = `AND g.school_year = $${params.length}`; }

    const { rows } = await pool.query(
      `SELECT
         g.id AS group_id,
         g.course_code,
         g.course_name,
         g.school_year,
         g.total_students,
         g.admin_user_id = $1 AS is_admin,
         (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count,
         -- Personal weighted average
         (
           SELECT ROUND(
             SUM(a.weight * us.percentage) /
             NULLIF(SUM(CASE WHEN us.percentage IS NOT NULL THEN a.weight ELSE 0 END), 0),
           2)
           FROM assignments a
           LEFT JOIN user_scores us ON us.assignment_id = a.id AND us.user_id = $1
           WHERE a.group_id = g.id
         ) AS personal_avg,
         -- Group weighted average (mean of member averages)
         (
           SELECT ROUND(AVG(member_avg), 2) FROM (
             SELECT SUM(a.weight * us.percentage) /
               NULLIF(SUM(CASE WHEN us.percentage IS NOT NULL THEN a.weight ELSE 0 END), 0) AS member_avg
             FROM assignments a
             JOIN user_scores us ON us.assignment_id = a.id
             JOIN group_members gm2 ON gm2.user_id = us.user_id AND gm2.group_id = g.id
             WHERE a.group_id = g.id
             GROUP BY us.user_id
           ) t
         ) AS group_avg,
         -- Group weighted median
         (
           SELECT ROUND(CAST(
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY member_avg) AS NUMERIC
           ), 2) FROM (
             SELECT SUM(a.weight * us.percentage) /
               NULLIF(SUM(CASE WHEN us.percentage IS NOT NULL THEN a.weight ELSE 0 END), 0) AS member_avg
             FROM assignments a
             JOIN user_scores us ON us.assignment_id = a.id
             JOIN group_members gm2 ON gm2.user_id = us.user_id AND gm2.group_id = g.id
             WHERE a.group_id = g.id
             GROUP BY us.user_id
           ) t
         ) AS group_median,
         -- Graded weight (personal)
         (
           SELECT COALESCE(SUM(a.weight), 0)
           FROM assignments a
           JOIN user_scores us ON us.assignment_id = a.id AND us.user_id = $1
           WHERE a.group_id = g.id AND us.percentage IS NOT NULL
         ) AS graded_weight,
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

// GET /api/dashboard/cours/:groupId/travaux
router.get('/cours/:groupId/travaux', async (req, res) => {
  const groupId = parseInt(req.params.groupId);
  try {
    const member = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, req.user.id]
    );
    if (member.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });

    const { rows } = await pool.query(
      `SELECT
         a.id,
         a.title,
         a.category,
         a.weight,
         a.date_assigned,
         a.date_due,
         a.date_completed,
         us.score_obtained,
         us.score_max,
         us.percentage AS personal_pct,
         us.refreshed_at,
         -- Group average for this assignment
         (
           SELECT ROUND(AVG(us2.percentage), 2)
           FROM user_scores us2
           JOIN group_members gm ON gm.user_id = us2.user_id AND gm.group_id = $1
           WHERE us2.assignment_id = a.id AND us2.percentage IS NOT NULL
         ) AS group_avg_pct,
         -- Group median for this assignment
         (
           SELECT ROUND(CAST(
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY us2.percentage) AS NUMERIC
           ), 2)
           FROM user_scores us2
           JOIN group_members gm ON gm.user_id = us2.user_id AND gm.group_id = $1
           WHERE us2.assignment_id = a.id AND us2.percentage IS NOT NULL
         ) AS group_median_pct,
         (
           SELECT COUNT(*)
           FROM user_scores us2
           JOIN group_members gm ON gm.user_id = us2.user_id AND gm.group_id = $1
           WHERE us2.assignment_id = a.id AND us2.percentage IS NOT NULL
         ) AS graded_count
       FROM assignments a
       LEFT JOIN user_scores us ON us.assignment_id = a.id AND us.user_id = $2
       WHERE a.group_id = $1
       ORDER BY a.date_assigned ASC NULLS LAST, a.title`,
      [groupId, req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/dashboard/cours/:groupId/graphique
router.get('/cours/:groupId/graphique', async (req, res) => {
  const groupId = parseInt(req.params.groupId);
  try {
    const member = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, req.user.id]
    );
    if (member.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });

    const totalRes = await pool.query(
      'SELECT COALESCE(SUM(weight), 0) AS total FROM assignments WHERE group_id = $1',
      [groupId]
    );
    const totalWeight = parseFloat(totalRes.rows[0].total) || 100;

    // Fetch all assignments with per-assignment group avg and median
    const { rows } = await pool.query(
      `SELECT
         a.id,
         a.title,
         a.weight,
         a.date_assigned,
         us.percentage AS personal_pct,
         (
           SELECT ROUND(AVG(us2.percentage), 2)
           FROM user_scores us2
           JOIN group_members gm ON gm.user_id = us2.user_id AND gm.group_id = $1
           WHERE us2.assignment_id = a.id AND us2.percentage IS NOT NULL
         ) AS group_avg_pct,
         (
           SELECT ROUND(CAST(
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY us2.percentage) AS NUMERIC
           ), 2)
           FROM user_scores us2
           JOIN group_members gm ON gm.user_id = us2.user_id AND gm.group_id = $1
           WHERE us2.assignment_id = a.id AND us2.percentage IS NOT NULL
         ) AS group_median_pct
       FROM assignments a
       LEFT JOIN user_scores us ON us.assignment_id = a.id AND us.user_id = $2
       WHERE a.group_id = $1
       ORDER BY a.date_assigned ASC NULLS LAST, a.id`,
      [groupId, req.user.id]
    );

    // Only include assignments where at least one grade exists (group or personal)
    const graded = rows.filter(r => r.personal_pct !== null || r.group_avg_pct !== null);
    const gradedWeight = graded.reduce((s, r) => s + r.weight, 0);

    let cumWeight = 0;
    let cumPersonalSum = 0, cumPersonalWeight = 0;
    let cumGroupAvgSum = 0, cumGroupAvgWeight = 0;
    let cumGroupMedSum = 0, cumGroupMedWeight = 0;

    const points = graded.map(r => {
      cumWeight += r.weight;
      const xPct = parseFloat(((cumWeight / totalWeight) * 100).toFixed(2));

      if (r.personal_pct !== null) {
        cumPersonalSum += r.weight * parseFloat(r.personal_pct);
        cumPersonalWeight += r.weight;
      }
      if (r.group_avg_pct !== null) {
        cumGroupAvgSum += r.weight * parseFloat(r.group_avg_pct);
        cumGroupAvgWeight += r.weight;
      }
      if (r.group_median_pct !== null) {
        cumGroupMedSum += r.weight * parseFloat(r.group_median_pct);
        cumGroupMedWeight += r.weight;
      }

      return {
        title: r.title,
        weight: r.weight,
        cumulative_weight_pct: xPct,
        // Moyenne mode
        personal_running_avg: cumPersonalWeight > 0
          ? parseFloat((cumPersonalSum / cumPersonalWeight).toFixed(2)) : null,
        group_running_avg: cumGroupAvgWeight > 0
          ? parseFloat((cumGroupAvgSum / cumGroupAvgWeight).toFixed(2)) : null,
        // Médiane mode: per-assignment raw values
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

// POST /api/dashboard/synchroniser
router.post('/synchroniser', async (req, res) => {
  try {
    await syncUserData(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    if (err.code) return res.status(503).json({ error: err.message, code: err.code });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
