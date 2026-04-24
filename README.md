# MobiFlow ETL

MobiFlow ETL is a UI-driven ETL control plane. Users create datasources, destinations, visual transformation steps, pipelines, schedules, and run logs without writing JSON or Python code.

## Stack

- Frontend: React + Vite
- Backend: FastAPI + Python
- Transform engine: Pandas
- Metadata store: PostgreSQL through `MOBIFLOW_METADATA_DATABASE_URL`
- Execution: in-process background runner and cron-style scheduler
- Connectors: PostgreSQL and SFTP source/destination support

## Current MVP Features

- Password login with backend-issued bearer tokens, logout, and admin-only user creation.
- Replaceable brand logo in sidebar and login page.
- Datasource and destination management.
- Transformation Builder with schema explorer, step cards, preview, validation, draft, and publish.
- Supported transform steps: Select Columns, Rename Columns, Change Data Type, Fill Null Values, Add Derived Column, Filter Rows, Remove Duplicates, Sort Rows.
- Pipeline builder with published transformation dropdown. No visible transformation JSON.
- Manual pipeline runs.
- Cron-style scheduled runs, including `*/2 * * * *`.
- Runs & Logs screen with step-wise execution messages.
- Access Control screen for user/role records.

## Project Structure

```text
backend/
  app/
    api/routes.py              FastAPI API routes
    db/database.py             Metadata schema and DB helpers
    services/runner.py         Extract, transform, load, run logs
    services/scheduler.py      Cron-style in-process scheduler
    services/transforms.py     Pandas transformation executor
frontend/
  public/logo.png              Optional custom PNG logo
  src/main.tsx                 React application
  src/styles.css               UI styling
docs/
  SOP.md                       Detailed user guide
  TRANSFORMATION_GUIDE.md      Detailed transformation builder guide
```

## Environment

Copy `.env.example` to `.env` in project root:

```bash
cp .env.example .env
```

Then edit the database URL:

```bash
MOBIFLOW_METADATA_DATABASE_URL=postgresql://postgres:password@host:5432/mobiflow
MOBIFLOW_BOOTSTRAP_ADMIN_EMAIL=admin@mobiflow.local
MOBIFLOW_BOOTSTRAP_ADMIN_PASSWORD=change-me-with-strong-password
```

The current local app reads these values from `.env`. On first backend start, the bootstrap admin user is created. If the admin already exists and has no password hash, the backend sets this password during startup.

For this local workspace, the bootstrap login is:

```text
Email: admin@mobiflow.local
Password: ChangeMe@12345!
```

Change `MOBIFLOW_BOOTSTRAP_ADMIN_PASSWORD` before production.

## Quick Start

Backend:

```bash
cd backend
../venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Frontend:

```bash
cd frontend
npm run dev -- --port 5173
```

Open:

- Frontend: `http://localhost:5173/`
- Backend API: `http://localhost:8000/api/health`
- OpenAPI docs: `http://localhost:8000/docs`

On current host, network frontend is usually:

```text
http://10.10.0.10:5173/
```

## Run As Services

To keep backend and frontend alive after terminal closes, use `systemd`.

Service files in repo:

- `deploy/systemd/mobiflow-backend.service`
- `deploy/systemd/mobiflow-frontend.service`

Install:

```bash
sudo cp deploy/systemd/mobiflow-backend.service /etc/systemd/system/
sudo cp deploy/systemd/mobiflow-frontend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mobiflow-backend
sudo systemctl enable --now mobiflow-frontend
```

Useful commands:

```bash
sudo systemctl status mobiflow-backend
sudo systemctl status mobiflow-frontend
sudo journalctl -u mobiflow-backend -f
sudo journalctl -u mobiflow-frontend -f
sudo systemctl restart mobiflow-backend
sudo systemctl restart mobiflow-frontend
```

## Logo

The app tries to load:

```text
frontend/public/logo.png
```

If that file does not exist, it shows a text fallback.

To use your PNG logo, place it here:

```text
frontend/public/logo.png
```

Then refresh the browser.

Recommended PNG size:

- Width: 288 px or larger
- Height: 80 px or larger
- Transparent background preferred
- Keep readable at `144 x 40` display size

## UI Screenshots

Add manual screenshots here:

```text
docs/screenshots/
```

Use these filenames:

```text
00-login.png
01-data-source.png
02-destination.png
03-transform-builder.png
04-pipelines.png
05-runs-logs.png
06-access-control.png
```

Recommended capture size: `1440 x 1000`.

The SOP links these files automatically.

## Common Commands

Build frontend:

```bash
cd frontend
npm run build
```

Compile backend:

```bash
cd backend
../venv/bin/python -B -m compileall app
```

Health check:

```bash
curl http://127.0.0.1:8000/api/health
```

## Scheduling

Pipelines run when:

- Pipeline is enabled.
- Schedule is not empty.
- Cron expression matches current minute.

Examples:

```text
*/2 * * * *    Every 2 minutes
0 * * * *      Every hour
30 2 * * *     Every day at 02:30
```

The scheduler scans every 15 seconds and enqueues matching pipelines once per minute.

## Notes

- Backend APIs require `Authorization: Bearer <token>` except `/api/health` and `/api/auth/login`.
- Passwords are stored as salted PBKDF2-SHA256 hashes. Session tokens are stored hashed and expire by `MOBIFLOW_AUTH_TOKEN_TTL_HOURS`.
- Secrets are currently stored in metadata config. Use a vault before production.
- The scheduler is in-process. Use a dedicated worker/scheduler service for HA production deployments.
