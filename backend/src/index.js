require('dotenv').config();
const express = require('express');
const path = require('path');
const compression = require('compression');
const bcrypt = require('bcrypt');
const { initDb, pool } = require('./db');
const { startScheduler } = require('./services/scheduler');

async function ensureSuperAdmin() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const { rows } = await pool.query('SELECT id, role FROM users WHERE email = $1', [email]);
  if (rows.length === 0) {
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      'INSERT INTO users (email, password_hash, role, onboarding_completed) VALUES ($1, $2, $3, true)',
      [email, hash, 'superadmin']
    );
    console.log(`Compte superadmin créé : ${email}`);
  } else if (rows[0].role !== 'superadmin') {
    await pool.query('UPDATE users SET role = $1, onboarding_completed = true WHERE email = $2', ['superadmin', email]);
    console.log(`Compte ${email} promu superadmin`);
  }
}

const app = express();

app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/onboarding', require('./routes/onboarding'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/groupes', require('./routes/groups'));
app.use('/api/compte', require('./routes/account'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/invitations', require('./routes/invitations'));

const pages = ['register', 'onboarding', 'dashboard', 'groupes', 'compte', 'admin', 'rejoindre'];
pages.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${page}.html`));
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await initDb();
    await ensureSuperAdmin();
    startScheduler();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Serveur démarré sur le port ${PORT}`);
    });
  } catch (err) {
    console.error('Erreur au démarrage:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

start();
