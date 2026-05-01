const { decrypt } = require('./crypto');

const BASE_URL = () => process.env.PORTAL_BASE_URL;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function makeRequest(username, password, path, attempt = 0) {
  const credentials = Buffer.from(`${username}:${password}`).toString('base64');
  let response;
  try {
    response = await fetch(`${BASE_URL()}${path}`, {
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    if (attempt < 3) {
      await sleep((attempt + 1) * 2000);
      return makeRequest(username, password, path, attempt + 1);
    }
    throw Object.assign(new Error('Impossible de contacter le portail'), { code: 'PORTAL_UNREACHABLE' });
  }

  if (response.status === 401) {
    throw Object.assign(new Error('Identifiants invalides'), { code: 'INVALID_CREDENTIALS' });
  }

  if ((response.status === 502 || response.status === 504) && attempt < 3) {
    await sleep((attempt + 1) * 3000);
    return makeRequest(username, password, path, attempt + 1);
  }

  if (response.status === 502) {
    throw Object.assign(new Error('Session expirée — veuillez réessayer'), { code: 'SESSION_EXPIRED' });
  }
  if (response.status === 504) {
    throw Object.assign(new Error('Le portail est trop lent — veuillez réessayer dans quelques minutes'), { code: 'PORTAL_SLOW' });
  }

  return response;
}

async function testHealth(username, password) {
  const res = await makeRequest(username, password, '/health');
  return res.ok;
}

async function fetchNotes(username, password) {
  const res = await makeRequest(username, password, '/notes');
  if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
  return res.json();
}

async function fetchNotesForUser(user) {
  const password = decrypt(user.portal_password_encrypted);
  return fetchNotes(user.portal_username, password);
}

async function fetchProfile(username, password) {
  const res = await makeRequest(username, password, '/profile');
  if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
  return res.json();
}

async function fetchProfileForUser(user) {
  const password = decrypt(user.portal_password_encrypted);
  return fetchProfile(user.portal_username, password);
}

async function fetchOnboarding(username, password) {
  const res = await makeRequest(username, password, '/onboarding');
  if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
  return res.json();
}

function parseResult(result) {
  if (!result) return { score_obtained: null, score_max: null, percentage: null };
  const match = result.match(/^([\d,]+)\s*\/\s*([\d,]+)\s*\(([\d,]+)\s*%\)/);
  if (!match) return { score_obtained: null, score_max: null, percentage: null };
  return {
    score_obtained: parseFloat(match[1].replace(',', '.')),
    score_max: parseFloat(match[2].replace(',', '.')),
    percentage: parseFloat(match[3].replace(',', '.')),
  };
}

function parseCourse(course) {
  const idx = course.indexOf(' - ');
  if (idx === -1) return { course_code: course.trim(), course_name: '' };
  return {
    course_code: course.slice(0, idx).trim(),
    course_name: course.slice(idx + 3).trim(),
  };
}

function parsePortalDate(dateStr) {
  if (!dateStr) return null;
  // Format: DD-MM-YYYY or "DD-MM-YYYY à HH:MM"
  const match = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+à\s+(\d{2}):(\d{2}))?/);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  if (hour !== undefined) {
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
  }
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
}

function getSchoolYear(date) {
  if (!date) return null;
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  return month >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

const MIN_YEAR = 2025;

function pickDateForSchoolYear(dateAssigned, dateDue) {
  if (dateAssigned && dateAssigned.getFullYear() >= MIN_YEAR) return dateAssigned;
  if (dateDue && dateDue.getFullYear() >= MIN_YEAR) return dateDue;
  return new Date();
}

// Determine the canonical school year for a COURSE by looking at all its
// parsed assignments. Using a majority vote on date_due prevents a single
// aberrant date_assigned (e.g. 2021, 2024) from mis-classifying the course.
function getCanonicalSchoolYear(parsedAssignments) {
  function majorityVote(dates) {
    const counts = {};
    for (const d of dates) {
      const sy = getSchoolYear(d);
      counts[sy] = (counts[sy] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  const dueDates = parsedAssignments
    .map(a => a.date_due)
    .filter(d => d && d.getFullYear() >= MIN_YEAR);
  if (dueDates.length > 0) return majorityVote(dueDates);

  const assignedDates = parsedAssignments
    .map(a => a.date_assigned)
    .filter(d => d && d.getFullYear() >= MIN_YEAR);
  if (assignedDates.length > 0) return majorityVote(assignedDates);

  return getSchoolYear(new Date());
}

function parseAssignment(raw) {
  const { course_code, course_name } = parseCourse(raw.course);
  const dateAssigned = parsePortalDate(raw.date_assigned);
  const dateDue = parsePortalDate(raw.date_due);
  const dateCompleted = raw.date_completed ? parsePortalDate(raw.date_completed) : null;
  const schoolYear = getSchoolYear(pickDateForSchoolYear(dateAssigned, dateDue));
  const { score_obtained, score_max, percentage } = parseResult(raw.result);

  return {
    course_code,
    course_name,
    school_year: schoolYear,
    category: raw.category || '',
    title: raw.title,
    weight: parseInt(raw.weight) || 0,
    date_assigned: dateAssigned,
    date_due: dateDue,
    date_completed: dateCompleted,
    score_obtained,
    score_max,
    percentage,
  };
}

module.exports = {
  testHealth,
  fetchNotes,
  fetchNotesForUser,
  fetchProfile,
  fetchProfileForUser,
  fetchOnboarding,
  parseAssignment,
  parseCourse,
  getSchoolYear,
  getCanonicalSchoolYear,
};
