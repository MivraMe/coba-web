# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Project Overview

**NotesQC** — a grade-tracking web app for students at Collège Esther-Blondin. Users link their school portal credentials, which the backend stores encrypted and uses to periodically fetch grades. Students can compare their results against anonymized group averages and medians.

## Tech Stack

- **Runtime**: Node.js (CommonJS, no build step)
- **Framework**: Express 4
- **Database**: PostgreSQL 16 via `pg` (Pool with `DATABASE_URL`)
- **Auth**: JWT (7-day tokens, `Bearer` header), bcrypt (12 rounds)
- **Encryption**: AES-256-CBC for portal passwords (`ENCRYPTION_KEY` must be 64 hex chars)
- **Notifications**: Resend (email), Twilio (SMS)
- **Scheduler**: `node-cron` — runs `runScheduledRefresh` on a configurable interval
- **Frontend**: Vanilla JS + HTML served as static files from `backend/src/public/`
- **Deployment**: Docker Compose (app + postgres); the admin panel can trigger `git pull && docker-compose up --build` via docker-in-docker

## Project Structure

```
backend/
  src/
    index.js          # Entry point — mounts routes, calls initDb, ensureSuperAdmin, startScheduler
    db/
      index.js        # pg Pool, initDb() runs schema.sql on startup (idempotent)
      schema.sql      # All DDL; uses IF NOT EXISTS + ADD COLUMN IF NOT EXISTS for migrations
    middleware/
      auth.js         # requireAuth, requireAdmin, requireSuperAdmin, requireRegularUser
    routes/
      auth.js         # /api/auth — register, login, me
      onboarding.js   # /api/onboarding — 5-step wizard (portal creds → courses → notifs → done)
      dashboard.js    # /api/dashboard — grades, averages, chart data
      groups.js       # /api/groupes — group membership, invitations
      account.js      # /api/compte — profile, password, notification prefs
      invitations.js  # /api/invitations — group invite links
      admin.js        # /api/admin — stats, users, sync, config, deploy, todo
    services/
      crypto.js       # encrypt/decrypt portal passwords (AES-256-CBC)
      portalApi.js    # HTTP client for the external portal API; parses raw assignment JSON
      dataSync.js     # Core sync logic: fetchNotesForUser → processAssignments → notify
      scheduler.js    # node-cron wrapper; interval from REFRESH_INTERVAL_MINUTES env var
      notifications/
        email.js      # Resend integration
        sms.js        # Twilio integration
    public/           # Static HTML/CSS/JS frontend (no framework, no bundler)
```

## Key Commands

```bash
# Development (inside backend/)
npm run dev          # nodemon — auto-restart on file changes
npm start            # plain node

# Production
docker-compose up -d --build   # from repo root; requires .env with all required vars

# Generate secrets
openssl rand -hex 32            # use for JWT_SECRET and ENCRYPTION_KEY
```

No test suite exists in this repository.

## Architecture & Key Conventions

### Database migrations
`schema.sql` is the single source of truth. It runs on every startup via `initDb()`. New columns are added with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` at the bottom of the file — never modify existing `CREATE TABLE` blocks for migrations.

### Data sync flow
`portalApi.fetchNotesForUser` → `dataSync.processAssignments` (inside a single DB transaction). School year is determined per-course via **majority vote** on `date_due` values (`getCanonicalSchoolYear`) to prevent outlier dates from creating duplicate groups.

### Role system
Three levels encoded in the JWT payload: `user` (default), `is_admin: true` (group admin, set per-user), `role: 'superadmin'` (full access). The `requireAdmin` middleware passes either `is_admin` OR `superadmin`; `requireSuperAdmin` is for destructive/config routes only. `requireRegularUser` blocks superadmins from data routes.

### Scheduler
`REFRESH_INTERVAL_MINUTES` (default 5) drives the cron job. Each tick picks **one member per group** (least-recently-synced) to fetch grades for; if new grades are detected, all group members are synced and notified. Interval can be changed at runtime via `POST /api/admin/config` without restart.

### Superadmin bootstrap
If `ADMIN_EMAIL` + `ADMIN_PASSWORD` env vars are set, `ensureSuperAdmin()` creates or promotes that account on startup.

### Deploy endpoint
`GET /api/admin/deploy` (SSE stream, superadmin only) spawns `git pull && docker-compose up -d --build` inside the container. Requires `docker.sock` and `/opt/stacks/coba-web` volume mounts (see `docker-compose.yml`).

### Frontend
Plain HTML pages + vanilla JS in `public/`. `public/js/api.js` is a shared fetch wrapper that attaches the JWT from `localStorage`. No bundler — all scripts are loaded with `<script>` tags. Pages map 1:1 to routes in `index.js`.

## Required Environment Variables

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Full postgres connection string |
| `JWT_SECRET` | Min 32 chars random string |
| `ENCRYPTION_KEY` | Exactly 64 hex chars (`openssl rand -hex 32`) |
| `PORTAL_BASE_URL` | External school portal API base URL |
| `RESEND_API_KEY` | Optional — disables email if absent |
| `TWILIO_*` | Optional — disables SMS if absent |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Optional — auto-creates superadmin on boot |
| `REFRESH_INTERVAL_MINUTES` | Default 5 |
