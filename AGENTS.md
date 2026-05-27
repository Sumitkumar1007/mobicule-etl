# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

MobiFlow ETL is a UI-driven ETL control plane.

Users configure datasources, destinations, transformations, pipelines, schedules, and run logs from a React UI. FastAPI stores metadata in PostgreSQL and executes ETL jobs in-process with Pandas plus connector-specific extract/load logic.

Read these first:

- `README.md`
- `docs/AI_HANDOFF.md`
- `docs/TEAM_TECHNICAL_OVERVIEW.md`
- `docs/TRANSFORMATION_GUIDE.md`
- `docs/SOP.md`

## Repo Map

```text
backend/
  app/
    main.py                    FastAPI app, auth middleware, startup/shutdown
    api/routes.py              REST API surface
    db/database.py             metadata schema, DB helpers, bootstrap admin
    services/runner.py         extract -> transform -> load execution
    services/transforms.py     Pandas transformation engine
    services/scheduler.py      cron-style in-process scheduler
    services/metadata.py       source metadata discovery
    services/auth.py           login/session/role helpers
    services/sql_safety.py     raw SQL guardrails
    connectors/registry.py     connector definitions and config schemas
    models/schemas.py          Pydantic API models
  tests/
frontend/
  src/main.tsx                 React app, API client, all screens
  src/styles.css               UI styling
docs/
deploy/systemd/
```

## Commands

Backend compile:

```bash
cd backend
../venv/bin/python -B -m compileall app tests
```

Backend tests:

```bash
cd backend
../venv/bin/python -B -m pytest -q
```

Frontend build:

```bash
cd frontend
npm run build
```

Backend dev server:

```bash
cd backend
../venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Frontend dev server:

```bash
cd frontend
npm run dev -- --port 5173
```

Health:

```bash
curl http://127.0.0.1:8000/api/health
```

## Coding Rules

- Keep backend changes scoped by service boundary.
- Prefer existing API patterns in `backend/app/api/routes.py`.
- Prefer existing Pydantic schemas in `backend/app/models/schemas.py`.
- Add transform behavior in `backend/app/services/transforms.py` and tests in `backend/tests/test_transforms.py`.
- Add runner/connectors behavior in `backend/app/services/runner.py`, `backend/app/services/metadata.py`, or `backend/app/connectors/registry.py`, with tests in `backend/tests/test_runner.py` where practical.
- Frontend is currently a single large `frontend/src/main.tsx`; keep local patterns unless doing an intentional split.
- Do not commit `.env`, secrets, generated logs, or local data.
- Do not rewrite unrelated docs or reformat broad files.

## Data And Security Notes

- Metadata DB URL comes from `MOBIFLOW_METADATA_DATABASE_URL`.
- Passwords use salted PBKDF2-SHA256 hashes.
- Bearer tokens are stored hashed in `auth_sessions`.
- Frontend stores active session in `localStorage`.
- Connector credentials are currently stored as JSON in metadata DB. Production needs vault/encryption.
- Custom Python transforms use `exec`; production blocks them unless `MOBIFLOW_ALLOW_CUSTOM_TRANSFORMS=true`.
- Raw SQL sources are guarded by `services/sql_safety.py`; production blocks raw SQL unless explicitly enabled.

## Verification Expectations

For most backend changes, run:

```bash
cd backend
../venv/bin/python -B -m pytest -q
../venv/bin/python -B -m compileall app tests
```

For frontend or API-shape changes, run:

```bash
cd frontend
npm run build
```

Record any command that cannot be run and why.

## Known Architecture Limits

- Runner uses in-process `ThreadPoolExecutor(max_workers=4)`.
- Scheduler is an in-process thread.
- No external queue, retry model, or worker isolation yet.
- DB schema is managed by `CREATE TABLE IF NOT EXISTS` plus small `ALTER TABLE` statements; no migration tool yet.
- PostgreSQL extract defaults to `LIMIT 1000` when table mode is used.
- Run cancellation is cooperative between pipeline stages.

