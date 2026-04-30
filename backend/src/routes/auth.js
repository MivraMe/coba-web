const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const SALT_ROUNDS = 12;

function signToken(userId, email, isAdmin = false, role = 'user') {
  return jwt.sign({ id: userId, email, is_admin: isAdmin, role }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Courriel et mot de passe requis' });
  if (password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit comporter au moins 8 caractères' });

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const { rows } = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, onboarding_step, onboarding_completed, is_admin, role',
      [normalizedEmail, hash]
    );
    const user = rows[0];
    res.status(201).json({ token: signToken(user.id, user.email, user.is_admin, user.role), user });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ce courriel est déjà utilisé' });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Courriel et mot de passe requis' });

  try {
    const { rows } = await pool.query(
      'SELECT id, email, password_hash, onboarding_step, onboarding_completed, is_admin, role FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Identifiants incorrects' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Identifiants incorrects' });

    const { password_hash, ...safeUser } = user;
    res.json({ token: signToken(user.id, user.email, user.is_admin, user.role), user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, recovery_email, phone, notify_email, notify_sms, onboarding_step, onboarding_completed, is_admin, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
