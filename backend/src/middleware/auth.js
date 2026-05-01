const jwt = require('jsonwebtoken');
const { pool } = require('../db');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  try {
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

// Allows superadmin OR group admin (is_admin = true).
// Falls back to a DB check when the JWT is stale (e.g. user was promoted after login).
async function requireAdmin(req, res, next) {
  if (!req.user) return res.status(403).json({ error: 'Accès réservé aux administrateurs' });

  if (req.user.role === 'superadmin' || req.user.is_admin) return next();

  // JWT may be stale — verify against DB before rejecting
  try {
    const { rows } = await pool.query('SELECT is_admin, role FROM users WHERE id = $1', [req.user.id]);
    const u = rows[0];
    if (u && (u.role === 'superadmin' || u.is_admin)) {
      // Patch req.user so downstream middleware sees correct values
      req.user.is_admin = u.is_admin;
      req.user.role = u.role;
      return next();
    }
  } catch { /* fall through to 403 */ }

  return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
}

// Allows only superadmin (for sensitive config/deploy routes)
function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs système' });
  }
  next();
}

function requireRegularUser(req, res, next) {
  if (req.user && req.user.role === 'superadmin') {
    return res.status(403).json({ error: 'Non disponible pour un compte superadmin' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireSuperAdmin, requireRegularUser };

