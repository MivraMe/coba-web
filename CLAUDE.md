# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Project Overview

**NotesQC** — a grade-tracking web app for students at Collège Esther-Blondin. Users link their school portal credentials, which the backend stores encrypted and uses to periodically fetch grades. Students can compare their results against anonymized group averages and medians.

## Tech Stack

- **Runtime**: Node.js (CommonJS, no build step)
- **Framework**: Express 4
- **Database**: PostgreSQL 16 via `pg` (Pool with `DATABASE_URL`)
- **Auth**: JWT (7-day tokens, `Bearer` header), bcrypt (12 rounds), TOTP 2FA via `speakeasy`
- **Encryption**: AES-256-CBC for portal passwords (`ENCRYPTION_KEY` must be 64 hex chars)
- **2FA**: `speakeasy` (TOTP generation/verification) + `qrcode` (QR code data URLs)
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
      onboarding.js   # /api/onboarding — 5-step wizard (portal creds → photo → courses → notifs → done)
      dashboard.js    # /api/dashboard — grades, averages, chart data
      groups.js       # /api/groupes — group membership, invitations
      account.js      # /api/compte — profile, password, photo, notification prefs, TOTP setup/enable/disable
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

### Portal API integration
`portalApi.js` exposes four fetch functions, all using Basic Auth and the `PORTAL_BASE_URL` env var:

| Function | Endpoint | Returns |
|---|---|---|
| `fetchNotes(u, p)` | `GET /notes` | `{ assignments[] }` |
| `fetchProfile(u, p)` | `GET /profile` | `{ full_name, permanent_code, photo_base64 }` |
| `fetchOnboarding(u, p)` | `GET /onboarding` | `{ profile, count, assignments[] }` |
| `testHealth(u, p)` | `GET /health` | boolean |

`fetchNotesForUser(user)` and `fetchProfileForUser(user)` are convenience wrappers that decrypt `portal_password_encrypted` before calling the underlying function.

### Profile data
During onboarding step 1 and when updating portal credentials, the app calls both `/notes` and `/profile`. `full_name`, `permanent_code`, and `photo_base64` (raw base64, no data-URL prefix) are stored on the `users` table. `GET /api/auth/me` returns `full_name` and `permanent_code` (not photo — fetch separately). The nav and group member lists display `full_name` over email everywhere users are shown publicly.

### Profile photo & circular crop tool
Photos are stored as raw base64 (no `data:image/...;base64,` prefix) in `users.photo_base64`. The crop tool is a vanilla Canvas implementation shared across onboarding, account, and admin pages — it supports drag-to-pan and a zoom slider, outputs a 200×200 JPEG. Key endpoints:
- `GET /api/compte/photo` — returns `{ photo_base64 }` from DB
- `PUT /api/compte/photo` — saves cropped photo (`{ photo_base64 }`) or clears it (`{ clear: true }`); strips data-URL prefix before storing
- `GET /api/compte/portail-photo` — fetches live photo directly from the portal (calls `fetchProfileForUser`), does not read from DB

### Data sync flow
`portalApi.fetchNotesForUser` → `dataSync.processAssignments` (inside a single DB transaction). School year is determined per-course via **majority vote** on `date_due` values (`getCanonicalSchoolYear`) to prevent outlier dates from creating duplicate groups.

### Role system
Three levels encoded in the JWT payload: `user` (default), `is_admin: true` (group admin, set per-user), `role: 'superadmin'` (full access). The `requireAdmin` middleware passes either `is_admin` OR `superadmin`; `requireSuperAdmin` is for destructive/config routes only. `requireRegularUser` blocks superadmins from data routes.

`requireAdmin` does a DB fallback when the JWT is stale (e.g. user promoted after login): if the JWT doesn't grant access it runs a single `SELECT is_admin, role` query and patches `req.user` so downstream middleware sees correct values.

Superadmin accounts have no access to `/compte` — their TOTP setup is done inline in the admin panel gate.

### Scheduler
`REFRESH_INTERVAL_MINUTES` (default 5) drives the cron job. Each tick picks **one member per group** (least-recently-synced) to fetch grades for; if new grades are detected, all group members are synced and notified. Interval can be changed at runtime via `POST /api/admin/config` without restart.

### Superadmin bootstrap
If `ADMIN_EMAIL` + `ADMIN_PASSWORD` env vars are set, `ensureSuperAdmin()` creates or promotes that account on startup.

### Deploy endpoint
`GET /api/admin/deploy` (SSE stream, superadmin only) spawns `git pull && docker-compose up -d --build` inside the container. Requires `docker.sock` and `/opt/stacks/coba-web` volume mounts (see `docker-compose.yml`).

### Admin panel
- **User list**: shows avatar (real photo if available, else colored initials), full name, email, group badges in a 3-column grid (max 9 visible, then `+N`)
- **Edit modal** (superadmin): full crop tool for the user's photo, editable `full_name`; photo only sent in PATCH if modified (`changed` flag). Shows a "Désactiver le 2FA" danger button when the user has TOTP enabled — calls `DELETE /api/admin/users/:id/totp`
- **Portal test section**: endpoint selector (`/notes`, `/profile`, `/onboarding`, `/health`); profile/onboarding responses show a profile card; `photo_base64` is replaced with `[base64 X KB]` in the raw JSON output
- Admin routes that touch photos: `GET /api/admin/users/:id/photo` (superadmin), `PATCH /api/admin/users/:id` accepts `full_name` and `photo_base64`

### TOTP two-factor authentication

**Columns on `users`**: `totp_secret`, `totp_enabled` (default `false`), `totp_require_at_login` (default `false`), `admin_totp_verified_at`.

**Regular users** — opt-in via Mon compte → Double authentification section. When enabled, TOTP is always required at login. No option to bypass.

**Admin users** — TOTP at login is optional (controlled by `totp_require_at_login` checkbox in Mon compte, visible to admins only). Regardless of that setting, **TOTP is mandatory to access the admin panel**:
- `GET /api/admin/totp-elevation` — returns `{ totp_configured, elevated, expires_at }`. This endpoint sits **before** the gate middleware so it's always accessible.
- `POST /api/admin/totp-elevation` — verifies code, sets `admin_totp_verified_at = NOW()`. Wrong code → 401 → `api.js` auto-logouts the user (redirect to login).
- Gate middleware runs after the two elevation endpoints: if `totp_enabled` but not elevated → 403 `{ totp_elevation_required: true }`; if `!totp_enabled` → 403 `{ totp_setup_required: true }`.
- Elevation validity: `admin_totp_verified_at > JWT.iat` (must be from the current session) AND within 1 hour. On every admin login, `admin_totp_verified_at` is reset to `NULL` so re-verification is always required.

**Superadmin** — no access to `/compte`, so TOTP setup is done inline in the admin panel gate overlay (QR wizard). The same code that activates TOTP immediately elevates the session.

**Admin gate frontend** (`admin.js`): `checkTotpElevation()` runs before any panel data loads. Three states: `totp_configured=false` → setup wizard; `elevated=false` → verify panel; `elevated=true` → pass through + schedule 1h expiry timer.

**Superadmin: disable user TOTP**: `DELETE /api/admin/users/:id/totp` resets all TOTP columns. Accessible via the edit modal in the user list.

### Statistics & dashboard calculations

All stat calculations live in `routes/dashboard.js`. Four endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /api/dashboard/resume` | Global header stats for the selected year |
| `GET /api/dashboard/cours` | Per-course card stats |
| `GET /api/dashboard/cours/:id/travaux` | Per-assignment list with group avg/median |
| `GET /api/dashboard/cours/:id/graphique` | Time-series data for the chart |

**Formulas:**

- **Personal weighted average** — `Σ(weight × percentage) / Σ(weight)` where percentage IS NOT NULL
- **Personal median** — `PERCENTILE_CONT(0.5)` over raw assignment percentages (unweighted)
- **Group average** — `AVG(member_avg)` where `member_avg` is each member's personal weighted average
- **Group median** — `PERCENTILE_CONT(0.5)` over `member_avg` values
- **Per-assignment group avg/median** — simple `AVG`/`PERCENTILE_CONT` over raw percentages for that assignment, restricted to group members with a score

The group stats inner subquery joins `group_members` twice: once to find assignments in groups where the current user is a member (`gm.user_id = $1`), and once to restrict scores to current members of each group (`gm2.user_id = us.user_id`). This prevents former members' scores from being included.

**Group median visibility rule:** The group median is only shown when `member_count >= 3`. With 2 members, `PERCENTILE_CONT(0.5) = AVG` mathematically, making the median redundant. This is enforced in three places in `dashboard.js` (frontend): global header, course cards, and the detail panel. The `/resume` endpoint exposes `group_member_count` to support the header check.

**Chart modes (frontend `dashboard.js`):**
- *Moyenne* mode — plots cumulative weighted running average per student/group over time (x-axis = % of total grade weight evaluated)
- *Médiane* mode — plots raw per-assignment percentages

The detail panel's "Moy. groupe pondérée" and "Méd. groupe" come from `coursesCache` (the already-loaded `/cours` data), not recomputed from the assignment list.

### Frontend
Plain HTML pages + vanilla JS in `public/`. `public/js/api.js` is a shared fetch wrapper that attaches the JWT from `localStorage`. No bundler — all scripts are loaded with `<script>` tags. Pages map 1:1 to routes in `index.js`.

`setupNav(user)` in `api.js` displays `user.full_name || user.email` in the navbar.

`api.js` auto-logouts on any 401 response when a token exists (`if (res.status === 401 && getToken()) logout()`). This is intentionally used by the TOTP elevation endpoint to redirect admins to login on wrong code.

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
