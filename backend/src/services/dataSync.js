const { pool } = require('../db');
const { fetchNotesForUser, parseAssignment } = require('./portalApi');
const { sendNewGradeEmail } = require('./notifications/email');
const { sendSms } = require('./notifications/sms');

async function syncUserData(userId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  const user = rows[0];
  if (!user || !user.portal_username || !user.portal_password_encrypted) {
    return { groupResults: [], newGrades: [] };
  }

  const data = await fetchNotesForUser(user);
  return processAssignments(userId, data.assignments || []);
}

async function processAssignments(userId, rawAssignments) {
  const parsed = rawAssignments.map(parseAssignment);

  const coursesMap = new Map();
  for (const a of parsed) {
    const key = `${a.course_code}::${a.school_year}`;
    if (!coursesMap.has(key)) {
      coursesMap.set(key, {
        course_code: a.course_code,
        course_name: a.course_name,
        school_year: a.school_year,
        assignments: [],
      });
    }
    coursesMap.get(key).assignments.push(a);
  }

  const groupResults = [];
  const newGrades = [];
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const [, course] of coursesMap) {
      // Insert group, update name if it exists
      const groupRes = await client.query(
        `INSERT INTO groups (course_code, course_name, school_year)
         VALUES ($1, $2, $3)
         ON CONFLICT (course_code, school_year) DO UPDATE SET course_name = EXCLUDED.course_name
         RETURNING *`,
        [course.course_code, course.course_name, course.school_year]
      );
      const group = groupRes.rows[0];
      const isNew = group.admin_user_id === null;

      // First user to create the group becomes admin
      await client.query(
        'UPDATE groups SET admin_user_id = $1 WHERE id = $2 AND admin_user_id IS NULL RETURNING id',
        [userId, group.id]
      );

      await client.query(
        `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [group.id, userId]
      );

      for (const a of course.assignments) {
        const assignRes = await client.query(
          `INSERT INTO assignments (group_id, category, title, weight, date_assigned, date_due, date_completed)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (group_id, title, category) DO UPDATE
             SET weight = EXCLUDED.weight,
                 date_due = EXCLUDED.date_due,
                 date_completed = EXCLUDED.date_completed
           RETURNING *`,
          [group.id, a.category, a.title, a.weight, a.date_assigned, a.date_due, a.date_completed]
        );
        const assignment = assignRes.rows[0];

        if (a.score_obtained !== null) {
          const existing = await client.query(
            'SELECT percentage FROM user_scores WHERE assignment_id = $1 AND user_id = $2',
            [assignment.id, userId]
          );
          const hasNewGrade =
            existing.rows.length === 0 ||
            parseFloat(existing.rows[0].percentage) !== a.percentage;

          await client.query(
            `INSERT INTO user_scores (assignment_id, user_id, score_obtained, score_max, percentage, refreshed_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (assignment_id, user_id) DO UPDATE
               SET score_obtained = EXCLUDED.score_obtained,
                   score_max = EXCLUDED.score_max,
                   percentage = EXCLUDED.percentage,
                   refreshed_at = NOW()`,
            [assignment.id, userId, a.score_obtained, a.score_max, a.percentage]
          );

          if (hasNewGrade) newGrades.push({ assignment, group, score: a });
        } else {
          await client.query(
            `INSERT INTO user_scores (assignment_id, user_id, score_obtained, score_max, percentage, refreshed_at)
             VALUES ($1, $2, NULL, NULL, NULL, NOW())
             ON CONFLICT DO NOTHING`,
            [assignment.id, userId]
          );
        }
      }

      groupResults.push({ group, isNew });
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { groupResults, newGrades };
}

async function syncGroupAllMembers(groupId) {
  const { rows } = await pool.query(
    'SELECT u.* FROM users u JOIN group_members gm ON u.id = gm.user_id WHERE gm.group_id = $1',
    [groupId]
  );
  for (const user of rows) {
    if (!user.portal_username) continue;
    try {
      await syncUserData(user.id);
    } catch (err) {
      console.error(`Erreur sync utilisateur ${user.id}:`, err.message);
    }
  }
}

async function runScheduledRefresh() {
  const { rows: groups } = await pool.query('SELECT id FROM groups');

  for (const { id: groupId } of groups) {
    try {
      const { rows } = await pool.query(
        `SELECT u.*, gm.refreshed_at AS last_refresh
         FROM users u
         JOIN group_members gm ON u.id = gm.user_id
         WHERE gm.group_id = $1 AND u.portal_username IS NOT NULL
         ORDER BY gm.refreshed_at ASC NULLS FIRST
         LIMIT 1`,
        [groupId]
      );

      if (rows.length === 0) continue;
      const user = rows[0];

      const { newGrades } = await syncUserData(user.id);

      await pool.query(
        'UPDATE group_members SET refreshed_at = NOW() WHERE group_id = $1 AND user_id = $2',
        [groupId, user.id]
      );

      if (newGrades.length > 0) {
        await syncGroupAllMembers(groupId);

        const { rows: members } = await pool.query(
          'SELECT u.* FROM users u JOIN group_members gm ON u.id = gm.user_id WHERE gm.group_id = $1',
          [groupId]
        );
        for (const member of members) {
          for (const gradeInfo of newGrades) {
            await sendNotifications(member, gradeInfo).catch(err =>
              console.error('Erreur notification:', err.message)
            );
          }
        }
      }
    } catch (err) {
      console.error(`Erreur refresh groupe ${groupId}:`, err.message);
    }
  }
}

async function sendNotifications(user, { assignment, group, score }) {
  const subject = `Nouvelle note — ${group.course_code}`;
  const details = { courseCode: group.course_code, courseName: group.course_name, assignment, score };

  if (user.notify_email && user.email) {
    await sendNewGradeEmail(user.email, subject, details);
  }
  if (user.notify_sms && user.phone) {
    const msg = `Nouvelle note: ${assignment.title} (${group.course_code}) - ${score.score_obtained}/${score.score_max} (${score.percentage}%)`;
    await sendSms(user.phone, msg);
  }
}

module.exports = { syncUserData, processAssignments, syncGroupAllMembers, runScheduledRefresh };
