CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  recovery_email VARCHAR(255),
  portal_username VARCHAR(255),
  portal_password_encrypted TEXT,
  phone VARCHAR(20),
  notify_email BOOLEAN NOT NULL DEFAULT false,
  notify_sms BOOLEAN NOT NULL DEFAULT false,
  totp_secret VARCHAR(255),
  onboarding_step INTEGER NOT NULL DEFAULT 0,
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  course_code VARCHAR(20) NOT NULL,
  course_name VARCHAR(255) NOT NULL,
  school_year VARCHAR(10) NOT NULL,
  total_students INTEGER,
  admin_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(course_code, school_year)
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  refreshed_at TIMESTAMPTZ,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS assignments (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  category VARCHAR(255) NOT NULL DEFAULT '',
  title VARCHAR(255) NOT NULL,
  weight INTEGER NOT NULL DEFAULT 0,
  date_assigned DATE,
  date_due TIMESTAMPTZ,
  date_completed DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id, title, category)
);

CREATE TABLE IF NOT EXISTS user_scores (
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score_obtained DECIMAL(8,2),
  score_max DECIMAL(8,2),
  percentage DECIMAL(5,2),
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (assignment_id, user_id)
);

CREATE TABLE IF NOT EXISTS notification_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_invitations (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  inviter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_assignments_group ON assignments(group_id);
CREATE INDEX IF NOT EXISTS idx_user_scores_user ON user_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_user_scores_assignment ON user_scores(assignment_id);

-- Admin flag (idempotent migration)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS sync_log (
  id SERIAL PRIMARY KEY,
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  group_course_code VARCHAR(20),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  success BOOLEAN,
  error_message TEXT,
  new_scores INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notification_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(10) NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  success BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_sync_log_group ON sync_log(group_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_started ON sync_log(started_at);
CREATE INDEX IF NOT EXISTS idx_notif_log_sent ON notification_log(type, sent_at);

-- Superadmin role (idempotent migration)
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user';

-- TODO items
CREATE TABLE IF NOT EXISTS todo_items (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'Planifié',
  priority VARCHAR(10) NOT NULL DEFAULT 'Normale',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT todo_items_title_key UNIQUE (title)
);

INSERT INTO todo_items (title, description, status, priority) VALUES
  ('Comparaison entre sessions scolaires', 'Statistiques côte à côte pour deux années scolaires (ex. 2024-2025 vs 2025-2026) afin de visualiser la progression.', 'Planifié', 'Normale'),
  ('Profil utilisateur étendu', 'Prénom, nom et code permanent obtenus via une route API dédiée du portail collégial — aucune saisie manuelle.', 'Planifié', 'Haute'),
  ('Chat entre membres d''un groupe', 'Messagerie simple permettant aux membres d''un même groupe de communiquer directement dans l''application.', 'Planifié', 'Normale'),
  ('Invitations à rejoindre l''application', 'Inviter des étudiants à créer un compte NotesQC via un lien ou un courriel personnalisé.', 'Planifié', 'Normale'),
  ('Double authentification (2FA)', 'Renforcement de la sécurité via une authentification à deux facteurs TOTP (ex. Google Authenticator).', 'Planifié', 'Haute'),
  ('Push notifications mobiles', 'Notifications push natives via une future application mobile NotesQC.', 'Planifié', 'Basse'),
  ('Masquer des cours', 'Masquer certains cours du dashboard, enregistrés en BD, accessibles via un filtre dédié.', 'Planifié', 'Normale'),
  ('Historique des changements de notes', 'Conserver l''ancienne valeur si une note est modifiée lors d''une synchro. Badge "Modifié" dans le détail.', 'Planifié', 'Normale'),
  ('Simulateur de note', 'Entrer des notes hypothétiques pour les évaluations sans résultat et voir l''impact sur la moyenne.', 'Planifié', 'Normale'),
  ('Objectif de note par cours', 'Définir une cible en % pour chaque cours avec barre de progression.', 'Planifié', 'Normale'),
  ('Tableau de progression', 'Graphique de l''évolution de la moyenne générale dans le temps (snapshot à chaque synchro).', 'Planifié', 'Normale'),
  ('Meilleure note du groupe', 'Afficher anonymement la meilleure note obtenue pour chaque évaluation dans le détail groupe.', 'Planifié', 'Basse'),
  ('Classement optionnel dans un groupe', 'Option opt-in pour un classement par moyenne au sein du groupe, visible uniquement par ses membres.', 'Planifié', 'Basse'),
  ('Backup automatique', 'Sauvegarde automatique de la BD chaque nuit vers un NAS ou stockage distant.', 'Planifié', 'Haute')
ON CONFLICT (title) DO NOTHING;
