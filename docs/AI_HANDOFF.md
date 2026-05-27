# AI Project Handoff

Last updated: 2026-05-27

## Current State

MobiFlow ETL is a working MVP for UI-managed ETL:

- React + Vite frontend.
- FastAPI backend.
- PostgreSQL metadata store.
- Pandas transformation executor.
- In-process runner and scheduler.
- PostgreSQL and SFTP source/destination support.
- Auth with roles: `admin`, `support`, `viewer`.
- Manual runs, cron-style scheduled runs, logs, audit logs.

Latest verification from this workspace:

```text
cd backend && ../venv/bin/python -B -m pytest -q
28 passed in 0.55s

cd backend && ../venv/bin/python -B -m compileall app tests
pass

cd frontend && npm run build
pass
```

## Mental Model

```text
React UI
  -> FastAPI routes
  -> PostgreSQL metadata DB
  -> runner enqueue
  -> extract source rows
  -> apply Pandas transform steps
  -> save rejected cast rows when destination supports it
  -> load destination rows
  -> update runs and logs
```

Key implementation files:

- `backend/app/main.py`: app setup, auth middleware, CORS, static frontend serving, startup DB init, scheduler start.
- `backend/app/api/routes.py`: CRUD routes for resources, transformations, pipelines, runs, users, metadata.
- `backend/app/db/database.py`: PostgreSQL wrapper, schema creation, bootstrap admin.
- `backend/app/services/runner.py`: job queue, source extraction, destination loading, rejected-row writes, runtime transform snapshots.
- `backend/app/services/transforms.py`: step executor, validation, cast rejection, preview logs.
- `backend/app/services/scheduler.py`: 5-field cron matching and advisory lock.
- `frontend/src/main.tsx`: entire SPA, API client, screens, transform builder.

## Feature Surface

Connectors:

- `postgres_source`
- `postgres_destination`
- `sftp_source`
- `sftp_destination`

Legacy/dev runner connector paths also exist:

- `sample_crm`
- `http_json`
- `csv_file`
- `jsonl_file`
- `csv_output`

Transform steps:

- Select Columns
- Rename Columns
- Join / Merge
- Change Data Type
- Fill Null Values
- Add Derived Column
- Add Blank Columns
- Filter Rows
- Map Column Values
- Group By
- Pivot
- Custom Transform
- Remove Duplicates
- Reorder Columns
- Sort Rows

## Important Behaviors

- Transformations have draft/published state.
- Publishing writes a `transformation_versions` snapshot.
- Pipelines can pin a transformation version or use latest published version.
- Runner falls back to stored pipeline `transforms` if no published snapshot is found.
- `cast` rejects invalid numeric/date/boolean values and preserves rejected rows with `_rejected_*` columns.
- Rejected rows are written for SFTP destinations and local CSV/JSONL legacy destinations.
- SFTP source can read one `remote_path` or match `path_pattern`.
- SFTP destination can write `remote_path` or formatted `output_path_pattern`.
- PostgreSQL source with no raw query builds `SELECT * FROM "schema"."table" LIMIT 1000`.
- PostgreSQL destination supports append, upsert, and truncate-insert.

## Production Gaps

Treat these as known risks, not surprises:

- No Alembic or formal DB migrations.
- No queue or external workers.
- Scheduler is process-local, though it uses PostgreSQL advisory lock when enabled.
- Secrets are stored in metadata JSON.
- UI stores bearer token in `localStorage`.
- Custom Python transform is dangerous if enabled.
- Raw SQL sources are sensitive; production disables by default.
- Frontend is large single-file React code.
- Preview/metadata endpoints sometimes return `{error: ...}` with HTTP 200 for UI friendliness.

## Environment

`.env.example` lists expected variables. Most important:

```text
MOBIFLOW_METADATA_DATABASE_URL=postgresql://postgres:password@localhost:5432/mobiflow
MOBIFLOW_BOOTSTRAP_ADMIN_EMAIL=admin@mobiflow.local
MOBIFLOW_BOOTSTRAP_ADMIN_PASSWORD=change-me-with-strong-password
MOBIFLOW_FORCE_HTTPS=false
MOBIFLOW_ALLOWED_HOSTS=["localhost","127.0.0.1","10.10.0.10"]
MOBIFLOW_ALLOW_RAW_SQL_SOURCES=false
MOBIFLOW_ALLOW_CUSTOM_TRANSFORMS=false
MOBIFLOW_SCHEDULER_LOCK_ENABLED=true
```

Do not commit real `.env` values.

## Common Change Recipes

Add transform step:

1. Add schema literal in `backend/app/models/schemas.py`.
2. Add executor branch and implementation in `backend/app/services/transforms.py`.
3. Add validation logic in `validate_transforms`.
4. Add UI step type, defaults, editor controls, and column inference in `frontend/src/main.tsx`.
5. Add tests in `backend/tests/test_transforms.py`.

Add connector:

1. Add connector definition in `backend/app/connectors/registry.py`.
2. Add test connection in `backend/app/services/connectivity.py`.
3. Add metadata discovery in `backend/app/services/metadata.py`.
4. Add extract/load support in `backend/app/services/runner.py`.
5. Update docs and focused tests.

Change auth/roles:

1. Update `backend/app/services/auth.py`.
2. Update route `require_role` usage in `backend/app/api/routes.py`.
3. Update frontend role gates in `frontend/src/main.tsx`.
4. Add or adjust tests if behavior is security-relevant.

## Next-Agent Checklist

Before edits:

- Run `git status --short`.
- Read touched files.
- Avoid reverting user changes.
- Confirm whether request is backend, frontend, docs, or deployment.

After edits:

- Run relevant backend tests and compile.
- Run frontend build if TypeScript/UI changed.
- Summarize changed files and verification.
- Call out unrun checks or production risks.

