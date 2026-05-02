const { pool } = require('../db');
const { fetchNotesForUser, parseAssignment, getCanonicalSchoolYear } = require('./portalApi');
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

  // Group by course_code only; school_year is determined at the course level
  // to avoid aberrant per-assignment dates creating duplicate groups.
  const coursesMap = new Map();
  for (const a of parsed) {
    if (!coursesMap.has(a.course_code)) {
      coursesMap.set(a.course_code, {
        course_code: a.course_code,
        course_name: a.course_name,
        school_year: null,
        assignments: [],
      });
    }
    coursesMap.get(a.course_code).assignments.push(a);
  }
  for (const [, course] of coursesMap) {
    course.school_year = getCanonicalSchoolYear(course.assignments);
  }

  const groupResults = [];
  const newGrades = [];
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const [, course] of coursesMap) {
      const groupRes = await client.query(
        `INSERT INTO groups (course_code, course_name, school_year)
         VALUES ($1, $2, $3)
         ON CONFLICT (course_code, school_year) DO UPDATE SET course_name = EXCLUDED.course_name
         RETURNING *`,
        [course.course_code, course.course_name, course.school_year]
      );
      const group = groupRes.rows[0];
      const isNew = group.admin_user_id === null;

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
            parseFloat(existing.rows[0].percentage).toFixed(2) !== Number(a.percentage).toFixed(2);

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
  const { rows: groups } = await pool.query('SELECT id, course_code FROM groups');

  for (const group of groups) {
    const startedAt = new Date();
    let userId = null;
    let newScores = 0;

    try {
      const { rows } = await pool.query(
        `SELECT u.*, gm.refreshed_at AS last_refresh
         FROM users u
         JOIN group_members gm ON u.id = gm.user_id
         WHERE gm.group_id = $1 AND u.portal_username IS NOT NULL
         ORDER BY gm.refreshed_at ASC NULLS FIRST
         LIMIT 1`,
        [group.id]
      );

      if (rows.length === 0) continue;
      const user = rows[0];
      userId = user.id;

      const { newGrades } = await syncUserData(user.id);
      newScores = newGrades.length;

      await pool.query(
        'UPDATE group_members SET refreshed_at = NOW() WHERE group_id = $1 AND user_id = $2',
        [group.id, user.id]
      );

      if (newGrades.length > 0) {
        await syncGroupAllMembers(group.id);

        const { rows: members } = await pool.query(
          'SELECT u.* FROM users u JOIN group_members gm ON u.id = gm.user_id WHERE gm.group_id = $1',
          [group.id]
        );
        for (const member of members) {
          for (const { assignment, group: gradeGroup, score: detectedScore } of newGrades) {
            const { rows: scoreRows } = await pool.query(
              'SELECT score_obtained, score_max, percentage FROM user_scores WHERE assignment_id = $1 AND user_id = $2',
              [assignment.id, member.id]
            );
            const memberScore =
              scoreRows.length > 0 && scoreRows[0].percentage !== null
                ? {
                    score_obtained: parseFloat(scoreRows[0].score_obtained),
                    score_max: parseFloat(scoreRows[0].score_max),
                    percentage: parseFloat(scoreRows[0].percentage),
                  }
                : detectedScore;
            await sendNotifications(member, { assignment, group: gradeGroup, score: memberScore }).catch(err =>
              console.error('Erreur notification:', err.message)
            );
          }
        }
      }

      await pool.query(
        `INSERT INTO sync_log (group_id, group_course_code, user_id, started_at, finished_at, success, new_scores)
         VALUES ($1, $2, $3, $4, NOW(), true, $5)`,
        [group.id, group.course_code, userId, startedAt, newScores]
      );
    } catch (err) {
      console.error(`Erreur refresh groupe ${group.id}:`, err.message);
      await pool.query(
        `INSERT INTO sync_log (group_id, group_course_code, user_id, started_at, finished_at, success, error_message, new_scores)
         VALUES ($1, $2, $3, $4, NOW(), false, $5, 0)`,
        [group.id, group.course_code, userId, startedAt, err.message]
      ).catch(() => {});
    }
  }
}

async function sendNotifications(user, { assignment, group, score }) {
  const subject = `Nouvelle note — ${group.course_code}`;
  const details = { courseCode: group.course_code, courseName: group.course_name, assignment, score };

  if (user.notify_email && user.email) {
    let success = true;
    try {
      await sendNewGradeEmail(user.email, subject, details);
    } catch (err) {
      success = false;
      console.error('Erreur courriel:', err.message);
    }
    await pool.query(
      'INSERT INTO notification_log (user_id, type, success) VALUES ($1, $2, $3)',
      [user.id, 'email', success]
    ).catch(() => {});
  }

  if (user.notify_sms && user.phone) {
    const msg = `Nouvelle note: ${assignment.title} (${group.course_code}) - ${score.score_obtained}/${score.score_max} (${score.percentage}%)`;
    let success = true;
    try {
      await sendSms(user.phone, msg);
    } catch (err) {
      success = false;
      console.error('Erreur SMS:', err.message);
    }
    await pool.query(
      'INSERT INTO notification_log (user_id, type, success) VALUES ($1, $2, $3)',
      [user.id, 'sms', success]
    ).catch(() => {});
  }
}

async function syncUserDataWithNotifications(userId) {
  const { groupResults, newGrades } = await syncUserData(userId);

  if (newGrades.length > 0) {
    const groupIds = [...new Set(newGrades.map(({ group }) => group.id))];

    for (const groupId of groupIds) {
      await syncGroupAllMembers(groupId);

      const { rows: members } = await pool.query(
        'SELECT u.* FROM users u JOIN group_members gm ON u.id = gm.user_id WHERE gm.group_id = $1',
        [groupId]
      );

      const gradesForGroup = newGrades.filter(({ group }) => group.id === groupId);

      for (const member of members) {
        for (const { assignment, group: gradeGroup, score: detectedScore } of gradesForGroup) {
          const { rows: scoreRows } = await pool.query(
            'SELECT score_obtained, score_max, percentage FROM user_scores WHERE assignment_id = $1 AND user_id = $2',
            [assignment.id, member.id]
          );
          const memberScore =
            scoreRows.length > 0 && scoreRows[0].percentage !== null
              ? {
                  score_obtained: parseFloat(scoreRows[0].score_obtained),
                  score_max: parseFloat(scoreRows[0].score_max),
                  percentage: parseFloat(scoreRows[0].percentage),
                }
              : detectedScore;
          await sendNotifications(member, { assignment, group: gradeGroup, score: memberScore }).catch(err =>
            console.error('Erreur notification:', err.message)
          );
        }
      }
    }
  }

  return { groupResults, newGrades };
}

module.exports = { syncUserData, syncUserDataWithNotifications, processAssignments, syncGroupAllMembers, runScheduledRefresh };
