# MobiFlow ETL Team Technical Overview

## 1. Purpose

MobiFlow ETL is a UI-driven ETL control plane. It lets users configure sources, destinations, transformations, pipelines, schedules, and run logs from a web UI.

Product goal:

- Admin users build and publish transformations without editing JSON or Python files.
- Support users run pipelines and inspect failures.
- Viewer users inspect configured work and run history.
- Backend executes ETL jobs in-process with Pandas and connector-specific extract/load logic.

## 2. High-Level Architecture

```text
React UI
  |
  | HTTP + bearer token
  v
FastAPI backend
  |
  | metadata CRUD
  v
PostgreSQL metadata database
  |
  | pipeline run request / scheduler tick
  v
In-process runner
  |
  | extract -> transform -> load
  v
Source systems / destination systems
```

Main components:

- `frontend/src/main.tsx`: React application, API client, all screens.
- `backend/app/main.py`: FastAPI app setup, CORS, auth middleware, startup/shutdown.
- `backend/app/api/routes.py`: REST API routes for auth, resources, transformations, pipelines, runs, users, metadata.
- `backend/app/db/database.py`: metadata schema creation, DB helper, bootstrap admin.
- `backend/app/services/runner.py`: extract/load logic and pipeline execution.
- `backend/app/services/transforms.py`: Pandas transformation engine.
- `backend/app/services/scheduler.py`: cron-style in-process scheduler.
- `backend/app/services/metadata.py`: source column/table/path discovery.
- `backend/app/connectors/registry.py`: connector definitions and config schemas.

## 3. Runtime Stack

Backend:

- Python
- FastAPI
- Uvicorn
- Pydantic
- Pandas
- psycopg for PostgreSQL
- Paramiko for SFTP
- OpenPyXL for XLSX files
- httpx for HTTP JSON sources

Frontend:

- React
- Vite
- TypeScript
- Plain CSS

Metadata store:

- PostgreSQL configured through `MOBIFLOW_METADATA_DATABASE_URL`.

Execution model:

- In-process `ThreadPoolExecutor(max_workers=4)`.
- In-process scheduler thread.
- No external queue yet.

## 4. Repository Structure

```text
backend/
  app/
    api/routes.py
    connectors/registry.py
    core/config.py
    core/logging.py
    core/security.py
    db/database.py
    models/schemas.py
    services/auth.py
    services/metadata.py
    services/runner.py
    services/scheduler.py
    services/transforms.py
  tests/
frontend/
  src/main.tsx
  src/styles.css
docs/
  SOP.md
  TRANSFORMATION_GUIDE.md
  TEAM_TECHNICAL_OVERVIEW.md
deploy/systemd/
```

## 5. Environment Configuration

Copy `.env.example` to `.env` and set:

```bash
MOBIFLOW_METADATA_DATABASE_URL=postgresql://postgres:password@host:5432/mobiflow
MOBIFLOW_BOOTSTRAP_ADMIN_EMAIL=admin@mobiflow.local
MOBIFLOW_BOOTSTRAP_ADMIN_PASSWORD=change-me-with-strong-password
```

Important:

- `.env` must not be committed.
- Rotate any password that was shared outside intended environment.
- Bootstrap admin password is only used to create or initialize admin password when no hash exists.

## 6. Local Run Commands

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

Build frontend:

```bash
cd frontend
npm run build
```

Compile backend:

```bash
cd backend
../venv/bin/python -B -m compileall app tests
```

Health check:

```bash
curl http://127.0.0.1:8000/api/health
```

## 7. Authentication And Roles

Auth flow:

1. User posts email/password to `/api/auth/login`.
2. Backend verifies PBKDF2 password hash.
3. Backend creates random bearer token.
4. Backend stores SHA-256 token hash in `auth_sessions`.
5. Frontend stores token in `localStorage`.
6. Future API calls send `Authorization: Bearer <token>`.

Roles:

- `admin`: full create/update/delete access, user management, publish transformations.
- `support`: can run pipelines and inspect support workflows.
- `viewer`: read-oriented access.

Security notes:

- Tokens are stored hashed in DB.
- Passwords are PBKDF2-hashed with per-password salt.
- Frontend `localStorage` means XSS would expose active sessions. Harden frontend before internet-facing deployment.

## 8. Metadata Database

Tables created by `init_db()`:

- `users`: user records and password hashes.
- `auth_sessions`: login sessions.
- `resources`: source and destination connection records.
- `transformations`: draft/published transformation records.
- `transformation_versions`: published snapshots.
- `pipelines`: source + destination + transform + schedule configuration.
- `runs`: run status, row counts, errors.
- `run_logs`: human-readable run logs.
- `transformation_run_logs`: step-level transform logs.

Schema is currently created with `CREATE TABLE IF NOT EXISTS` and small `ALTER TABLE` statements. No formal migration tool yet.

## 9. Connector Model

Connector definitions live in `backend/app/connectors/registry.py`.

Supported configured connectors:

- `postgres_source`
- `postgres_destination`
- `sftp_source`
- `sftp_destination`

Legacy/dev connector paths also exist in runner code:

- `sample_crm`
- `http_json`
- `csv_file`
- `jsonl_file`
- `csv_output`

Connector config schemas drive frontend form rendering.

PostgreSQL source supports:

- `schema` + `table`
- or raw `query`

PostgreSQL destination supports:

- append insert
- upsert when `mode=upsert` and `primary_key` is set

SFTP source supports:

- single `remote_path`
- wildcard `path_pattern`
- CSV and XLSX

SFTP destination supports:

- `remote_path`
- CSV and XLSX

## 10. ETL Run Lifecycle

Manual run:

```text
POST /api/pipelines/{pipeline_id}/runs
  -> enqueue_run()
  -> ThreadPoolExecutor submits run_pipeline(run_id)
```

Scheduled run:

```text
scheduler thread wakes every 15 seconds
  -> finds enabled pipelines with schedule
  -> cron match
  -> enqueue_run()
```

Run states:

- `queued`
- `running`
- `succeeded`
- `failed`

Pipeline execution:

```text
load pipeline metadata
mark queued run as running
extract rows
apply transformations
write transformation logs
load rows to destination
mark run succeeded
```

Stop behavior:

- `/api/runs/{run_id}/stop` marks queued/running runs failed.
- Runner checks DB status between major phases.
- If stopped, runner exits without overwriting final failed status.

## 11. Extract Logic

Location: `backend/app/services/runner.py`

PostgreSQL:

- Uses psycopg.
- If `query` exists, executes query directly.
- If no `query`, builds `SELECT * FROM "schema"."table" LIMIT 1000`.

SFTP:

- Connects with password or private key.
- Reads one path or wildcard paths.
- Adds `_source_file` to each row.
- CSV uses `csv.DictReader`.
- XLSX uses OpenPyXL active sheet.

HTTP JSON:

- Expects JSON list, or dict with `data`, `items`, or `records`.

CSV file:

- Reads local CSV path.

## 12. Transform Engine

Location: `backend/app/services/transforms.py`

Input:

```python
list[dict[str, Any]]
```

Internal representation:

```python
pandas.DataFrame
```

Output:

```python
list[dict[str, Any]]
```

Supported steps:

- `select`: keep selected columns.
- `rename`: rename columns.
- `join`: merge another source into current data.
- `cast`: convert types.
- `fillna`: fill missing values.
- `derive`: create calculated column.
- `filter`: filter rows by conditions.
- `value_map`: map source values to output values.
- `groupby`: aggregate data.
- `pivot`: pivot rows to columns.
- `custom`: run custom Python transform.
- `deduplicate`: remove duplicates.
- `sort`: sort rows.

Validation:

- Checks referenced columns.
- Warns when select has stale columns.
- Tracks columns after select, rename, derive, value map, groupby, pivot, and custom declared outputs.
- Checks destination required columns when destination metadata is available.

Custom transform:

- Accepts either `result = df` or `def transform(df): return next_df`.
- Exposes Pandas as `pd` and NumPy as `np`.
- Should be considered trusted-admin-only.

## 13. Transformation Publish Model

Transformations can be:

- `draft`
- `published`

Publishing:

1. Validates transformation.
2. Sets status to `published`.
3. Stores snapshot in `transformation_versions`.

Pipelines attach transformation steps by copying published transformation steps into pipeline config. This makes pipeline runs stable even if transformation draft changes later.

## 14. Pipeline Model

Pipeline fields:

- `name`
- `source_id`
- `destination_id`
- `source_key`
- `destination_key`
- `source_config`
- `destination_config`
- `transforms`
- `schedule`
- `enabled`

Pipelines can be:

- saved by admins
- run by admins/support
- scheduled with cron-like syntax

## 15. Scheduler

Location: `backend/app/services/scheduler.py`

Supported cron shape:

```text
minute hour day month weekday
```

Examples:

```text
*/2 * * * *    every 2 minutes
0 * * * *      hourly
30 2 * * *     daily at 02:30
```

Limitations:

- Scheduler is in-process.
- Multiple backend instances can duplicate scheduled runs.
- Restart loses in-memory last-run cache.
- No persistent scheduler lock yet.

## 16. API Surface

Important routes:

Auth:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/change-password`

Connectors/resources:

- `GET /api/connectors`
- `GET /api/sources`
- `POST /api/sources`
- `PUT /api/sources/{id}`
- `DELETE /api/sources/{id}`
- `GET /api/destinations`
- `POST /api/destinations`
- `PUT /api/destinations/{id}`
- `DELETE /api/destinations/{id}`

Transformations:

- `GET /api/transformations`
- `POST /api/transformations`
- `GET /api/transformations/{id}`
- `PUT /api/transformations/{id}`
- `DELETE /api/transformations/{id}`
- `POST /api/transformations/{id}/preview`
- `POST /api/transformations/{id}/validate`
- `POST /api/transformations/{id}/publish`
- `GET /api/transformation-versions`

Pipelines/runs:

- `GET /api/pipelines`
- `POST /api/pipelines`
- `GET /api/pipelines/{id}`
- `PUT /api/pipelines/{id}`
- `DELETE /api/pipelines/{id}`
- `POST /api/pipelines/{id}/runs`
- `GET /api/runs`
- `GET /api/runs/{id}`
- `POST /api/runs/{id}/stop`
- `GET /api/runs/{id}/logs`
- `GET /api/runs/{id}/logs/download`

Metadata:

- `POST /api/metadata/columns`
- `POST /api/metadata/options`

Users:

- `GET /api/users`
- `POST /api/users`

## 17. Frontend Screens

All frontend code currently lives in `frontend/src/main.tsx`.

Screens:

- Login
- Data Source
- Destination
- Transform
- Pipelines
- Runs & Logs
- Access Control

Frontend API client:

- `api<T>()` for JSON responses.
- `apiText()` for text responses.
- `request()` attaches bearer token and handles non-OK responses.

Session:

- Stored under `mobiflow_session` in `localStorage`.
- Removed on logout or HTTP 401.

## 18. Deployment

Systemd service templates:

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

## 19. Testing

Current tests:

- Transform behavior tests.
- Join config tests.
- PostgreSQL write SQL tests.

Useful commands:

```bash
cd backend
../venv/bin/python -B -m compileall app tests
```

If `pytest` is installed:

```bash
cd backend
../venv/bin/python -B -m pytest -q
```

Frontend:

```bash
cd frontend
npm run build
```

## 20. Known Limitations

Execution:

- Jobs run in current backend process.
- No durable queue.
- No retry engine.
- No worker isolation.
- Full datasets are loaded into memory.

Scheduler:

- In-process only.
- Not safe for multi-instance deployments without duplicate-run protection.

Security:

- Raw SQL source query is trusted-admin-only.
- Custom Python transform is trusted-admin-only.
- Connector secrets are stored in metadata DB config JSON.
- Frontend token is in `localStorage`.

Schema/migrations:

- No migration framework.
- DB schema evolves through startup DDL.

Frontend:

- Most code is in one large React file.
- No automated frontend test suite yet.

## 21. Recommended Next Improvements

Near term:

- Add Alembic or equivalent migration tooling.
- Add API integration tests for auth, transformations, pipeline run lifecycle, and scheduler.
- Split frontend into feature modules.
- Add secret masking/encryption for connector credentials.
- Add explicit SQL safety rules or read-only database users for source queries.
- Add better run cancellation for long extract/load operations.

Medium term:

- Move runner to durable queue.
- Add worker process isolation for custom transforms.
- Add scheduler locking for multi-instance deployments.
- Add row streaming/chunking for large datasets.
- Add structured run metrics.
- Add retry policy and dead-letter handling.

Production hardening:

- Use HTTPS.
- Set strict CORS origins.
- Rotate bootstrap/admin credentials.
- Use least-privilege DB users.
- Disable or sandbox custom Python if users are not fully trusted.
- Add audit logs for admin changes.
