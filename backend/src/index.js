require('dotenv').config();
const express = require('express');
const path = require('path');
const compression = require('compression');
const { initDb } = require('./db');
const { startScheduler } = require('./services/scheduler');

const app = express();

app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/onboarding', require('./routes/onboarding'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/groupes', require('./routes/groups'));
app.use('/api/compte', require('./routes/account'));

const pages = ['register', 'onboarding', 'dashboard', 'groupes', 'compte'];
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
