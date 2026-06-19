# MobiFlow ETL Migration And Deployment Plan

## 1. Purpose

This document defines plan to migrate and deploy MobiFlow ETL to new server with low downtime, safe rollback, and full validation.

App stack:

- Frontend: React + Vite
- Backend: FastAPI + Uvicorn
- Metadata DB: PostgreSQL
- ETL engine: Pandas
- Connectors: PostgreSQL, SFTP
- Process model:
  - backend service on port `8000`
  - frontend service on port `5173`
  - in-process scheduler in backend

## 2. Current Deployment Model

Current repo includes systemd units:

- `deploy/systemd/mobiflow-backend.service`
- `deploy/systemd/mobiflow-frontend.service`

Backend service:

- runs from `/home/ubuntu/aiml/mobicule-etl/backend`
- uses env file `/home/ubuntu/aiml/mobicule-etl/.env`
- starts `uvicorn app.main:app --host 0.0.0.0 --port 8000`

Frontend service:

- runs from `/home/ubuntu/aiml/mobicule-etl/frontend`
- builds app before start
- starts `vite preview --host 0.0.0.0 --port 5173`

## 3. Migration Options

### Option A: Move app only, keep existing metadata DB

Best first choice.

Pros:

- fastest
- lower risk
- no DB restore/cutover complexity

Requirements:

- new server must reach existing PostgreSQL metadata DB
- new server must reach all external PostgreSQL and SFTP systems

### Option B: Move app and metadata DB

Use only if infra requires full server move.

Pros:

- full migration
- no dependency on old DB host

Risks:

- higher downtime risk
- restore/validation work
- final sync window needed

## 4. Recommended Approach

Recommended path:

1. Provision new server.
2. Deploy code and dependencies.
3. Point new app to existing metadata DB first.
4. Validate full app behavior.
5. Stop old backend scheduler/backend at cutover.
6. Switch traffic to new server.
7. Monitor.
8. Decommission old server after soak period.

Reason:

- app and scheduler behavior validated before DB move risk added
- rollback simpler

## 5. Prerequisites

Before migration, collect:

- current `.env` values
- metadata PostgreSQL host, port, DB name, username
- list of source PostgreSQL systems
- list of SFTP systems
- firewall allowlist requirements
- current DNS / reverse proxy / LB details
- service user and filesystem path assumptions
- rollback owner and approval path

Do not copy secrets into docs or git.

### 5.1 Infrastructure prerequisites

- new Linux server provisioned
- SSH access to new server
- sudo access on new server
- enough disk for:
  - repo checkout
  - Python virtualenv
  - frontend node modules
  - logs
- enough RAM/CPU for:
  - FastAPI backend
  - frontend build
  - ETL job concurrency
- outbound network access from new server to:
  - metadata PostgreSQL
  - source PostgreSQL systems
  - destination PostgreSQL systems
  - SFTP systems
  - package registries if installing online

### 5.2 Application prerequisites

- repo access for deployment user
- Python and Node package install method approved
- final hostname or IP decided
- DNS or reverse proxy change owner identified
- TLS certificate / HTTPS termination plan decided
- service user path confirmed as:
  - `/home/ubuntu/aiml/mobicule-etl`

### 5.3 Database prerequisites

- PostgreSQL admin or restore access if DB migration required
- DB backup method agreed
- DB rollback method agreed
- firewall/security group rules ready for new server IP
- row-count validation owner identified

### 5.4 Secrets and access prerequisites

- production `.env` values available
- bootstrap admin credentials available
- PII encryption key and optional key map available
- SFTP credentials / keys available where needed
- source and destination DB credentials available where needed
- no secrets stored in migration tickets, docs, or git commits

### 5.5 Operational prerequisites

- cutover window approved
- rollback window approved
- monitoring/log access available
- smoke test owner identified
- business sign-off owner identified

## 6. Required Environment Variables

Use `.env.example` as base.

Critical values:

- `MOBIFLOW_METADATA_DATABASE_URL`
- `MOBIFLOW_APP_NAME`
- `MOBIFLOW_ENVIRONMENT`
- `MOBIFLOW_API_PREFIX`
- `MOBIFLOW_LOG_PATH`
- `MOBIFLOW_AUTH_TOKEN_TTL_HOURS`
- `MOBIFLOW_BOOTSTRAP_ADMIN_EMAIL`
- `MOBIFLOW_BOOTSTRAP_ADMIN_PASSWORD`
- `MOBIFLOW_FORCE_HTTPS`
- `MOBIFLOW_ALLOWED_HOSTS`
- `MOBIFLOW_ALLOW_RAW_SQL_SOURCES`
- `MOBIFLOW_ALLOW_CUSTOM_TRANSFORMS`
- `MOBIFLOW_SCHEDULER_LOCK_ENABLED`
- `MOBIFLOW_PII_ENCRYPTION_KEY`
- `MOBIFLOW_PII_ENCRYPTION_KEYS` if used

Important:

- keep `MOBIFLOW_PII_ENCRYPTION_KEY` same across migration if encrypted PII data must remain compatible
- keep client key map same if `MOBIFLOW_PII_ENCRYPTION_KEYS` used
- production should keep:
  - `MOBIFLOW_ALLOW_RAW_SQL_SOURCES=false`
  - `MOBIFLOW_ALLOW_CUSTOM_TRANSFORMS=false`

## 7. New Server Preparation

Target path should match service files:

- `/home/ubuntu/aiml/mobicule-etl`

Install on new server:

- Python 3
- `python3-venv`
- Node.js
- npm
- git
- systemd
- build tools if needed by Python packages

Create directories:

- repo root
- Python virtualenv
- `logs/`

Clone repo:

```bash
git clone <repo-url> /home/ubuntu/aiml/mobicule-etl
```

Create backend virtualenv and install:

```bash
cd /home/ubuntu/aiml/mobicule-etl
python3 -m venv venv
./venv/bin/pip install -r backend/requirements.txt
```

Install frontend deps:

```bash
cd /home/ubuntu/aiml/mobicule-etl/frontend
npm install
```

## 8. Config Setup

Create `.env` in repo root.

Suggested production baseline:

```env
MOBIFLOW_METADATA_DATABASE_URL=postgresql://USER:PASSWORD@DBHOST:5432/mobiflow
MOBIFLOW_APP_NAME=MobiFlow ETL
MOBIFLOW_ENVIRONMENT=production
MOBIFLOW_API_PREFIX=/api
MOBIFLOW_LOG_PATH=logs/app.log
MOBIFLOW_AUTH_TOKEN_TTL_HOURS=12
MOBIFLOW_BOOTSTRAP_ADMIN_EMAIL=admin@mobiflow.local
MOBIFLOW_BOOTSTRAP_ADMIN_PASSWORD=<strong-secret>
MOBIFLOW_FORCE_HTTPS=true
MOBIFLOW_ALLOWED_HOSTS=["new-hostname","new-ip","localhost","127.0.0.1"]
MOBIFLOW_ALLOW_RAW_SQL_SOURCES=false
MOBIFLOW_ALLOW_CUSTOM_TRANSFORMS=false
MOBIFLOW_SCHEDULER_LOCK_ENABLED=true
MOBIFLOW_PII_ENCRYPTION_KEY=<same-existing-key>
```

If behind reverse proxy, ensure proxy preserves HTTPS expectations.

## 9. Database Strategy

### 9.1 If keeping same metadata DB

Tasks:

- allow new server IP on DB firewall / security group
- test DB login from new server
- confirm app startup succeeds
- validate current data visible in UI

### 9.2 If moving metadata DB

Tasks:

1. Take PostgreSQL backup.
2. Restore on new DB host.
3. Point new server `.env` to restored DB.
4. Validate row counts and key tables.

Minimum tables to verify:

- `users`
- `auth_sessions`
- `resources`
- `transformations`
- `transformation_versions`
- `pipelines`
- `runs`
- `run_logs`
- `transformation_run_logs`
- `audit_logs`
- `etl_audit_log`

Important:

- freeze writes during final sync window
- do not run both old and new app against diverging DBs after cutover

## 10. Application Validation On New Server

### Backend checks

Run:

```bash
cd /home/ubuntu/aiml/mobicule-etl/backend
../venv/bin/python -B -m compileall app tests
../venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Check:

```bash
curl http://127.0.0.1:8000/api/health
```

Expected:

```json
{"status":"ok"}
```

### Frontend checks

Run:

```bash
cd /home/ubuntu/aiml/mobicule-etl/frontend
npm run build
npm run preview -- --host 0.0.0.0 --port 5173
```

Open:

- `http://<new-server>:5173/`

Validate:

- login screen loads
- `/login` behavior works
- app loads after auth

## 11. Functional Smoke Test

Minimum smoke test on new server:

1. Login as admin.
2. Open Data Sources screen.
3. Open Destinations screen.
4. Open Transform Builder.
5. Load existing transformation.
6. Preview transformation.
7. Validate transformation.
8. Open Pipelines.
9. Open Runs & Logs.
10. Open ETL Audit.
11. Run one safe manual pipeline.
12. Confirm run logs and audit update.

If scheduler used, also validate one scheduled run after cutover.

## 12. Connectivity Validation

From new server verify connectivity to:

- metadata PostgreSQL
- source PostgreSQL servers
- destination PostgreSQL servers
- SFTP hosts
- DNS for all upstreams

Special dependency notes:

- `paramiko` used for SFTP
- `openpyxl` used for XLSX
- `msoffcrypto-tool` required for password-protected XLSX
- `psycopg` required for PostgreSQL

## 13. Service Installation

Install systemd units:

```bash
sudo cp deploy/systemd/mobiflow-backend.service /etc/systemd/system/
sudo cp deploy/systemd/mobiflow-frontend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mobiflow-backend
sudo systemctl enable --now mobiflow-frontend
```

Check:

```bash
sudo systemctl status mobiflow-backend
sudo systemctl status mobiflow-frontend
sudo journalctl -u mobiflow-backend -f
sudo journalctl -u mobiflow-frontend -f
```

## 14. Cutover Plan

### Before cutover

Confirm:

- new backend healthy
- new frontend reachable
- login works
- preview/validate works
- one manual run works
- logs clean

### Cutover steps

1. Disable old backend service or at least stop old scheduler/backend.
2. Ensure only one backend scheduler remains active.
3. Switch DNS / reverse proxy / load balancer to new server.
4. Verify external access.
5. Run one post-cutover smoke test.
6. Watch logs for 1 to 2 scheduler intervals.

Why stop old backend:

- scheduler runs in-process
- even with advisory lock, only one active production backend should own scheduling

## 15. Rollback Plan

Rollback triggers:

- backend health failures
- login/auth failures
- metadata DB instability
- pipeline failures on critical jobs
- duplicate schedule behavior
- SFTP/PostgreSQL connectivity failures

Rollback steps:

1. Switch traffic back to old server.
2. Stop new backend service.
3. Keep old backend as scheduler owner.
4. If DB moved, revert DB endpoint only if restore plan already verified.
5. Revalidate one manual run on old server.

Keep old server intact until new server stable for agreed soak period.

## 16. Risks And Controls

### Risk: duplicate scheduled runs

Cause:

- old and new backend both active

Control:

- stop old backend at cutover
- keep `MOBIFLOW_SCHEDULER_LOCK_ENABLED=true`

### Risk: encrypted data incompatibility

Cause:

- changed PII encryption key

Control:

- keep same `MOBIFLOW_PII_ENCRYPTION_KEY` / key map

### Risk: production exposure of unsafe features

Cause:

- raw SQL source or custom transform enabled

Control:

- keep both disabled in production unless strictly required

### Risk: DB schema drift

Cause:

- no formal migration tool
- app applies schema changes at startup

Control:

- test new version against DB clone first if possible
- take DB backup before first production startup on new version

### Risk: frontend process model

Cause:

- current service uses `vite preview`
- acceptable for MVP, not ideal long-term

Control:

- acceptable for like-for-like migration
- later improvement: serve built static assets via nginx/Caddy

## 17. Suggested Future Hardening

After migration, improve architecture:

- nginx or Caddy in front
- backend bound to `127.0.0.1:8000`
- static frontend served by nginx, not `vite preview`
- managed PostgreSQL or dedicated DB host
- external secret storage / vault
- single scheduler instance policy
- formal DB migration tooling
- session handling stronger than localStorage if internet-facing

## 18. Execution Checklist

### Pre-migration

- [ ] inventory complete
- [ ] new server provisioned
- [ ] repo cloned
- [ ] Python venv created
- [ ] backend deps installed
- [ ] frontend deps installed
- [ ] `.env` created
- [ ] DB reachable
- [ ] upstream PostgreSQL reachable
- [ ] upstream SFTP reachable

### Validation

- [ ] backend compile passes
- [ ] frontend build passes
- [ ] `/api/health` passes
- [ ] login works
- [ ] transformation preview works
- [ ] transformation validation works
- [ ] one manual pipeline run works
- [ ] logs and audit visible

### Cutover

- [ ] old backend stop plan ready
- [ ] rollback plan approved
- [ ] traffic switch performed
- [ ] post-cutover smoke test passes
- [ ] monitoring active

### Post-cutover

- [ ] scheduler observed
- [ ] no duplicate runs
- [ ] no auth issues
- [ ] no upstream connectivity issues
- [ ] old server retained for rollback window

## 19. Recommended Command Set

Backend verify:

```bash
cd backend
../venv/bin/python -B -m compileall app tests
```

Frontend verify:

```bash
cd frontend
npm run build
```

Backend health:

```bash
curl http://127.0.0.1:8000/api/health
```

Service logs:

```bash
sudo journalctl -u mobiflow-backend -f
sudo journalctl -u mobiflow-frontend -f
```

## 20. Final Recommendation

Use app-only migration first:

- new server
- same metadata DB
- validate
- cut traffic
- monitor
- later move DB only if needed

This path gives lowest risk and fastest recovery.
