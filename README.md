# NotesQC

A grade-tracking web app for students at Collège Esther-Blondin. Students link their school portal credentials, the backend periodically fetches their grades, and they can compare results against anonymized group averages and medians.

## Screenshots

<!-- Replace the placeholder paths with your actual image files -->

| Dashboard | Groups |
|---|---|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Groups](docs/screenshots/groups.png) |

| Onboarding | Admin Panel |
|---|---|
| ![Onboarding](docs/screenshots/onboarding.png) | ![Admin](docs/screenshots/admin.png) |

## Features

- Secure portal credential storage (AES-256-CBC encryption)
- Automatic grade sync on a configurable schedule
- Group grade comparisons — weighted averages, medians, per-assignment breakdowns
- Interactive chart (cumulative average over time)
- Email and SMS notifications on new grades
- TOTP two-factor authentication (opt-in for users, mandatory gate for admins)
- Admin panel with user management, portal testing, live deploy via SSE

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (CommonJS, no build step) |
| Framework | Express 4 |
| Database | PostgreSQL 16 via `pg` |
| Auth | JWT (7-day), bcrypt (12 rounds), TOTP via `speakeasy` |
| Encryption | AES-256-CBC (`ENCRYPTION_KEY`) |
| Notifications | Resend (email), Twilio (SMS) |
| Scheduler | `node-cron` |
| Frontend | Vanilla JS + HTML (no bundler) |
| Deployment | Docker Compose |

## Project Structure

```
backend/
  src/
    index.js              # Entry point
    db/
      index.js            # pg Pool + initDb()
      schema.sql          # All DDL (idempotent, IF NOT EXISTS)
    middleware/
      auth.js             # requireAuth / requireAdmin / requireSuperAdmin
    routes/
      auth.js             # /api/auth
      onboarding.js       # /api/onboarding (5-step wizard)
      dashboard.js        # /api/dashboard (grades, averages, charts)
      groups.js           # /api/groupes
      account.js          # /api/compte
      invitations.js      # /api/invitations
      admin.js            # /api/admin
    services/
      crypto.js           # AES encrypt/decrypt
      portalApi.js        # External portal HTTP client
      dataSync.js         # Sync logic + notifications
      scheduler.js        # node-cron wrapper
      notifications/
        email.js
        sms.js
    public/               # Static frontend (HTML/CSS/JS)
```

## Getting Started

### Prerequisites

- Docker and Docker Compose
- A `.env` file (see [Environment Variables](#environment-variables))

### Generate secrets

```bash
openssl rand -hex 32   # use output for JWT_SECRET
openssl rand -hex 32   # use output for ENCRYPTION_KEY
```

### Run with Docker Compose

```bash
cp .env.example .env   # fill in required values
docker-compose up -d --build
```

The app is available at `http://localhost:3000` (or `APP_PORT` if set).

### Development (without Docker)

```bash
cd backend
npm install
npm run dev   # nodemon — auto-restarts on changes
```

## Environment Variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Full PostgreSQL connection string |
| `JWT_SECRET` | Yes | Min 32 chars random string |
| `ENCRYPTION_KEY` | Yes | Exactly 64 hex chars |
| `PORTAL_BASE_URL` | Yes | Base URL of the external school portal API |
| `DB_PASSWORD` | Yes (Docker) | Postgres password for the `db` service |
| `ADMIN_EMAIL` | No | Auto-creates superadmin on boot |
| `ADMIN_PASSWORD` | No | Required if `ADMIN_EMAIL` is set |
| `REFRESH_INTERVAL_MINUTES` | No | Grade sync interval (default: `5`) |
| `RESEND_API_KEY` | No | Enables email notifications |
| `SMTP_FROM` | No | Sender address for emails |
| `TWILIO_ACCOUNT_SID` | No | Enables SMS notifications |
| `TWILIO_AUTH_TOKEN` | No | — |
| `TWILIO_PHONE_NUMBER` | No | — |
| `APP_PORT` | No | Host port to expose (default: `3000`) |
| `NODE_ENV` | No | `production` by default in Docker |

## Role System

| Role | Access |
|---|---|
| `user` | Own grades, group comparisons, account settings |
| `admin` | All user routes + admin panel (requires TOTP gate) |
| `superadmin` | Full access including config, deploy, user management |

## Database Migrations

`schema.sql` is the single source of truth and runs on every startup via `initDb()`. To add a column, append an `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statement at the bottom — never modify existing `CREATE TABLE` blocks.

## Grade Sync

The scheduler picks one member per group per tick (least-recently-synced). If new grades are detected, all group members are synced and notified. The interval can be changed at runtime from the admin panel without restarting.

## Deploy Endpoint

`GET /api/admin/deploy` (superadmin, SSE stream) runs `git pull && docker-compose up -d --build` inside the container. Requires the `docker.sock` and `/opt/stacks/coba-web` volume mounts configured in `docker-compose.yml`.
