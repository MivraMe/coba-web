const jwt = require('jsonwebtoken');

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

function requireAdmin(req, res, next) {
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

module.exports = { requireAuth, requireAdmin, requireRegularUser };
