# MobiFlow ETL Code Change Guide

## 1. Purpose

Use this document when you need to fix, enhance, or debug functionality in MobiFlow ETL.

Goal:

- tell you **which file** to open first
- tell you **which function or code block** likely controls the behavior
- help you decide whether the change belongs to **frontend**, **backend**, or **both**

This is not an end-user SOP. This is a developer change map.

---

## 2. Quick Mental Model

```text
Frontend UI (React, single-file SPA)
  -> API call
FastAPI route
  -> DB read/write and/or service call
Service layer
  -> metadata / transform / runner / auth / scheduler
PostgreSQL metadata DB or external source/destination system
```

In practice:

- Most **screen/UI changes** start in `frontend/src/main.tsx` and `frontend/src/styles.css`
- Most **API and permission changes** start in `backend/app/api/routes.py`
- Most **ETL execution changes** start in `backend/app/services/runner.py`
- Most **transformation logic changes** start in `backend/app/services/transforms.py`
- Most **source/destination metadata discovery changes** start in `backend/app/services/metadata.py`
- Most **connector field/schema changes** start in `backend/app/connectors/registry.py`
- Most **DB table/bootstrap/config changes** start in `backend/app/db/database.py`

---

## 3. Repository Map

```text
backend/
  app/
    main.py                    FastAPI startup, middleware, static frontend serving
    api/routes.py              Main REST API surface
    core/config.py             Environment settings
    core/logging.py            App logging setup
    core/security.py           Password/token helpers
    db/database.py             Metadata schema and DB access helpers
    connectors/registry.py     Connector definitions and config schemas
    models/schemas.py          Pydantic request/response models
    services/auth.py           Login/session/role enforcement
    services/connectivity.py   Test connection logic
    services/metadata.py       Source columns/table/path discovery
    services/transforms.py     Pandas transformation execution and validation
    services/runner.py         Pipeline runtime: extract -> transform -> load
    services/scheduler.py      In-process schedule execution
    services/sql_safety.py     Raw SQL restrictions
    services/pii.py            PII encryption/masking helpers
  tests/
    test_runner.py             Runner and runtime helper tests
    test_transforms.py         Transformation engine tests
frontend/
  src/
    main.tsx                   Entire React application
    styles.css                 Styling for all screens
docs/
  SOP.md
  ETL_TOOL_GUIDE.md
  TEAM_TECHNICAL_OVERVIEW.md
  AI_HANDOFF.md
```

---

## 4. Backend Change Map

## 4.1 App Startup, Middleware, Environment, Global Logging

### Open first

- `backend/app/main.py`
- `backend/app/core/config.py`
- `backend/app/core/logging.py`

### Change here when

- app should redirect or protect routes differently
- CORS / allowed hosts / HTTPS behavior must change
- startup or shutdown logic must change
- backend should read a new environment variable
- application-level logs should go to a new place

### Important code blocks

- `configure_logging()` in `core/logging.py`
- `Settings` and `get_settings()` in `core/config.py`
- `authenticate_api()` middleware in `main.py`
- `startup()` and `shutdown()` in `main.py`
- `serve_frontend()` in `main.py`

---

## 4.2 Authentication, Login, Session, Role Permission

### Open first

- `backend/app/services/auth.py`
- `backend/app/api/routes.py`
- `backend/app/models/schemas.py`
- `backend/app/db/database.py`

### Change here when

- login/logout behavior changes
- bearer token/session behavior changes
- role-based access changes
- new role is introduced
- password rules change

### Important code blocks

- `login()`
- `logout()`
- `user_from_token()`
- `require_role()`
- route handlers in `routes.py` that call `require_role(...)`
- users table setup in `init_db()`
- `UserRole` type in `models/schemas.py`

### Typical examples

- superuser/admin/support/viewer access fixes
- blocking some menu APIs for admin users
- adding password reset or session expiry behavior

---

## 4.3 Database Schema, Bootstrap, Metadata Persistence

### Open first

- `backend/app/db/database.py`

### Change here when

- a new table/column is needed
- metadata records must store new JSON fields
- bootstrap user behavior changes
- default config backfill logic changes

### Important code blocks

- `init_db()`
- `_fill_missing_postgres_connection_configs()`
- `encode()` / `decode()`
- `db()` context manager
- `PgDb` wrapper

### Warning

There is no migration framework yet. Changes are handled by `CREATE TABLE IF NOT EXISTS` plus `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` style logic.

---

## 4.4 API Routes and REST Behavior

### Open first

- `backend/app/api/routes.py`
- `backend/app/models/schemas.py`

### Change here when

- a frontend button/API call is failing
- a new endpoint is needed
- validation/publish/start-run behavior changes
- API payload shape must change
- a backend response needs extra fields

### Main route groups in `routes.py`

- auth
  - `auth_login()`
  - `auth_logout()`
  - `auth_me()`
  - `change_password()`
- connector/resource management
  - `connectors()`
  - `connector_test()`
  - `sources()` / `create_source()` / `update_source()` / `delete_source()`
  - `destinations()` / `create_destination()` / `update_destination()` / `delete_destination()`
- transformation management
  - `transformations()`
  - `create_transformation()`
  - `get_transformation()`
  - `update_transformation()`
  - `add_transformation_step()`
  - `reorder_transformation_steps()`
  - `update_transformation_step()`
  - `delete_transformation_step()`
  - `preview_transformation()`
  - `validate_transformation()`
  - `publish_transformation()`
- pipeline management
  - `pipelines()`
  - `create_pipeline()`
  - `update_pipeline()`
  - `delete_pipeline()`
  - `get_pipeline()`
- run/log management
  - `start_run()`
  - `stop_run()`
  - `runs()`
  - `get_run()`
  - `run_logs()`
  - `download_logs()`
- user/admin/audit
  - `users()`
  - `create_user()`
  - `update_user()`
  - `delete_user()`
  - `audit_logs()`
  - `etl_audit_logs()`
- metadata helpers
  - `preview_rows()`
  - `metadata_columns()`
  - `metadata_options()`

### Change here for

- API error message text
- start/stop run behavior
- publish blocking logic
- validation endpoint payload/result
- user CRUD restrictions

---

## 4.5 Connector Fields and Config Form Schema

### Open first

- `backend/app/connectors/registry.py`
- `frontend/src/main.tsx`

### Change here when

- a new source/destination config field is needed
- a connector label/description changes
- a connector should require a new field
- frontend auto-generated config form should show new inputs

### Important code blocks

- `POSTGRES_FIELDS`
- `SFTP_FIELDS`
- `CONNECTORS`
- `list_connectors()`
- frontend `GeneratedConfigForm(...)`
- frontend `placeholderFor(...)`
- frontend `sampleConfig(...)`
- frontend `sampleConfigForKey(...)`

### Typical examples

- add SFTP field like `archive_path`
- add PostgreSQL destination mode option
- change default port / schema / format

---

## 4.6 Connector Test Connection Logic

### Open first

- `backend/app/services/connectivity.py`
- `backend/app/api/routes.py`

### Change here when

- `Test connection` button succeeds/fails incorrectly
- connection test should validate more fields
- connector-specific health checks need enhancement

### Important code blocks

- `test_connection()`
- `_test_postgres()`
- `_test_sftp()`
- `connector_test()` route

---

## 4.7 Source Metadata Discovery: Columns, Tables, SFTP Paths, XLSX Headers

### Open first

- `backend/app/services/metadata.py`
- `frontend/src/main.tsx`

### Change here when

- `Load schema from source` is wrong
- destination/source dropdown options are missing
- SFTP file path suggestions should change
- XLSX sheet/column detection should change

### Important code blocks

- `source_columns()`
- `source_options()`
- `_postgres_columns()`
- `_postgres_tables()`
- `_sftp_columns()`
- `_sftp_paths()`
- `_xlsx_columns()`
- `_decrypt_xlsx_if_needed()`
- `_validate_single_visible_sheet()`
- frontend `loadColumnsFor(...)` inside `App()`
- frontend `loadTargetOptions(...)` inside `App()`
- frontend `SchemaExplorer(...)`
- frontend `DatasetTargetEditor(...)`

---

## 4.8 Transformation Engine: Actual ETL Step Logic

### Open first

- `backend/app/services/transforms.py`
- `backend/tests/test_transforms.py`
- `frontend/src/main.tsx`

### Change here when

- a transformation step is giving wrong output
- new transformation step is required
- validation rules for step parameters must change
- row rejection logic changes
- step ordering needs change

### Important code blocks in `transforms.py`

- `TransformationExecutor.run()`
- `TransformationExecutor.apply_step()`
- `apply_select()`
- `apply_rename()`
- `apply_join()`
- `apply_cast()`
- `apply_validate()`
- `apply_pii_encrypt()`
- `apply_fillna()`
- `apply_derive()`
- `apply_blank_columns()`
- `apply_filter()`
- `apply_value_map()`
- `apply_groupby()`
- `apply_pivot()`
- `apply_custom()`
- `apply_deduplicate()`
- `apply_reorder()`
- `apply_sort()`
- `validate_transforms()`
- `validate_destination_config()`
- `validate_step_order()`
- `_validation_error()`
- `_cast_series()`
- `_condition_mask()`

### Important frontend code blocks for transform UI

- `STEP_TYPES`
- `defaultSteps()`
- `emptyStep()`
- `StepTypeSelector(...)`
- `StepCard(...)`
- `StepForm(...)`
- `RuleTable(...)`
- `OperandEditor(...)`
- `validationForStep(...)`
- `PreviewPanel(...)`
- `IssueList(...)`
- `columnsBeforeStep()`
- `columnsAfterStep()`

### Typical examples

- fix rename columns behavior
- change cast date parsing
- add new validation rule type
- add step-level warnings
- reorder common transformation steps

---

## 4.9 Runtime ETL Execution: Extract -> Transform -> Load

### Open first

- `backend/app/services/runner.py`
- `backend/tests/test_runner.py`

### Change here when

- pipeline runs are crashing
- source extraction is wrong
- destination load is wrong
- rejected file behavior is wrong
- runtime join preparation is wrong
- run logs / detailed ETL logs need change

### Most important runtime functions

- `enqueue_run()`
- `run_pipeline()`
- `extract()`
- `load()`
- `save_rejected_records()`
- `prepare_runtime_transforms()`
- `_load_pipeline()`
- `_runtime_pipeline_transforms()`
- `_update_counts()`
- `_succeed()`
- `_fail()`
- `_etl_audit_start()`
- `_etl_audit_stage()`
- `_etl_audit_finish()`
- `_etl_audit_fail()`
- `_log()`
- `_transformation_log()`

### Source-specific runtime functions

- `_extract_postgres()`
- `_extract_sftp()`
- `_sftp_read_paths()`
- `_rows_from_xlsx()`

### Destination-specific runtime functions

- `_load_postgres()`
- `_load_sftp()`
- `_sftp_write_path()`
- `_write_sftp_payload()`
- `_ensure_sftp_directory()`
- `_rejected_write_path()`
- `_rows_payload()`
- `_xlsx_from_rows()`

### Runtime logging functions

- `RunFileLogger`
- `_run_log_path()`
- `_create_run_file_logger()`
- `_write_run_file_log()`
- `_format_run_log_value()`

### Typical examples

- app crashes during run
- rows read/written counts are wrong
- output date pattern not resolved
- rejected file not created
- SFTP output path issue
- need more runtime logs in file

---

## 4.10 Scheduler and Scheduled Pipelines

### Open first

- `backend/app/services/scheduler.py`
- `frontend/src/main.tsx`

### Change here when

- scheduled pipelines are not firing
- cron/schedule matching changes
- lock behavior changes
- business schedule builder UI changes

### Important backend code blocks

- `start_scheduler()`
- `stop_scheduler()`
- `_loop()`
- `run_due_pipelines()`
- `_cron_matches()`
- `_field_matches()`
- `_try_scheduler_lock()`

### Important frontend code blocks

- `ScheduleEditor(...)`
- `parseScheduleToBuilder()`
- `nextScheduleBuilder()`
- `buildScheduleCron()`
- `describeSchedule()`
- `savePipeline()` inside `App()`

---

## 4.11 SQL Safety and Raw Query Rules

### Open first

- `backend/app/services/sql_safety.py`
- `backend/app/services/runner.py`
- `backend/app/services/metadata.py`

### Change here when

- raw SQL source should allow/block more patterns
- source query validation is too strict or too loose

### Important code blocks

- `validate_source_query()`
- usage in `_extract_postgres()`
- usage in `_postgres_columns()` / metadata discovery

---

## 4.12 PII Encryption and Masking

### Open first

- `backend/app/services/pii.py`
- `backend/app/services/transforms.py`
- `backend/app/core/config.py`
- `frontend/src/main.tsx`

### Change here when

- PII masking/encryption behavior changes
- encryption key routing changes
- UI needs different PII controls

### Important code blocks

- `encrypt_value()` / `mask_value()` in `pii.py`
- `apply_pii_encrypt()` in `transforms.py`
- settings for `pii_encryption_key` / `pii_encryption_keys`
- transform step UI in `StepForm(...)`

---

## 5. Frontend Change Map

## 5.1 Big Rule

Frontend is mostly in one file:

- `frontend/src/main.tsx`

When changing frontend behavior, first locate whether the issue is:

- app-level state and API calls
- a specific UI section/component
- transformation step editor logic
- helper function / config serialization
- styling only

For styling-only issues, also open:

- `frontend/src/styles.css`

---

## 5.2 App-Level State, API Calls, Screen Switching

### Open first

- `frontend/src/main.tsx`

### Change here when

- data is not refreshing
- API integration is wrong
- menu navigation behavior changes
- role-based screen visibility changes
- login redirect is wrong

### Important code blocks

- `function App()`
- `refresh()`
- `login()`
- `logout()`
- `savePipeline()`
- `saveTransformationDraft()` / publish-related handlers inside `App()`
- resource create/update/delete handlers inside `App()`
- run/start/stop/download handlers inside `App()`
- `request(...)`, `api(...)`, `apiText(...)`
- `loadSession()`

### Constants/types to inspect

- `API`
- `SESSION_KEY`
- `Menu`
- `User`
- `Pipeline`
- `Run`
- `Transformation`

---

## 5.3 Login Screen and Branding

### Open first

- `frontend/src/main.tsx`
- `frontend/src/styles.css`

### Important code blocks

- `LoginPage(...)`
- `LogoImage(...)`
- login-related state in `App()`
- login styles in `styles.css`

### Change here when

- login page layout changes
- logo changes
- auto-redirect to `/login` changes
- login form validation changes

---

## 5.4 Datasource and Destination Screens

### Open first

- `frontend/src/main.tsx`
- `backend/app/connectors/registry.py`
- `backend/app/services/connectivity.py`
- `backend/app/services/metadata.py`

### Important frontend code blocks

- `ConnectorCatalog(...)`
- `GeneratedConfigForm(...)`
- `SchemaExplorer(...)`
- `DatasetTargetEditor(...)`
- `SelectOrInput(...)`
- `sftpPathOptions(...)`
- `PatternPreview(...)`
- `placeholderFor(...)`
- `sampleConfig(...)`
- `sampleConfigForKey(...)`
- `sanitizeConnectorConfig(...)`

### Change here when

- config forms are missing fields
- destination target output path behavior changes
- output/rejected pattern UI changes
- form placeholders/defaults change
- SFTP path options are wrong

---

## 5.5 Transformation Builder Screen

### Open first

- `frontend/src/main.tsx`
- `frontend/src/styles.css`
- `backend/app/services/transforms.py`
- `backend/app/api/routes.py`

### Main frontend components/code blocks

- `SchemaExplorer(...)`
- `StepTypeSelector(...)`
- `StepCard(...)`
- `StepForm(...)`
- `RuleTable(...)`
- `OperandEditor(...)`
- `PreviewPanel(...)`
- `IssueList(...)`
- `validationForStep(...)`
- `STEP_TYPES`
- `defaultSteps()`
- `emptyStep()`
- `columnsBeforeStep()`
- `columnsAfterStep()`
- `transformationPayload(...)`
- `sanitizeTransformationSteps(...)`

### Change here when

- step cards/UI layout changes
- validation messages under step cards change
- preview/validate/publish buttons change
- transformation step order changes
- destination target editor inside transform needs changes

---

## 5.6 Pipelines Screen

### Open first

- `frontend/src/main.tsx`
- `backend/app/api/routes.py`
- `backend/app/services/scheduler.py`

### Important code blocks

- pipeline form state in `App()` (`form`)
- `savePipeline()`
- `ScheduleEditor(...)`
- `parseScheduleToBuilder()`
- `buildScheduleCron()`
- `describeSchedule()`
- pipeline listing table in `App()`
- enable/disable pipeline handlers

### Change here when

- schedule UI needs enhancement
- transformation version selection changes
- route preview changes
- pipeline list actions change

---

## 5.7 Runs, Logs, ETL Audit Screen

### Open first

- `frontend/src/main.tsx`
- `backend/app/api/routes.py`
- `backend/app/services/runner.py`

### Important frontend code blocks

- runs section inside `App()`
- `Status(...)`
- logs section inside `App()`
- download logs button handler
- ETL audit table section inside `App()`

### Important backend code blocks

- `runs()`
- `get_run()`
- `run_logs()`
- `download_logs()`
- `run_pipeline()`
- `_log()`
- `RunFileLogger` and related file logging helpers

### Change here when

- UI log list is empty/wrong
- download logs output changes
- audit fields need to be added
- crash diagnosis requires more logging

---

## 5.8 Access Control Screen

### Open first

- `frontend/src/main.tsx`
- `backend/app/api/routes.py`
- `backend/app/services/auth.py`
- `backend/app/db/database.py`

### Important code blocks

- users/access section in `App()`
- `RoleCard(...)`
- user create/edit/delete handlers in `App()`
- backend `users()` / `create_user()` / `update_user()` / `delete_user()`
- role checks in `require_role(...)`

### Change here when

- user management permissions change
- role descriptions or UI text changes
- superuser-only restrictions change

---

## 5.9 Styling and Layout

### Open first

- `frontend/src/styles.css`
- `frontend/src/main.tsx`

### Change here when

- alignment/spacing issues happen
- sticky/fixed panels change
- button, card, grid, or logs panel look changes
- responsive/mobile layout changes

### Typical selectors/components to inspect

- `.builderTop`
- `.builderGrid`
- `.builderCanvas`
- `.schemaPanel`
- `.previewPanel`
- `.mappingHead` / `.mappingRow`
- `.logs` / `.runLogs`
- `.pipelineFormGrid`
- `.scheduleEditor`
- `.routePreview`
- login classes

---

## 6. Common Change Recipes

## 6.1 Add a New Transformation Step

Change these places:

1. `backend/app/models/schemas.py`
   - add step type if required in schema typing
2. `backend/app/services/transforms.py`
   - add execution branch in `apply_step()`
   - add implementation method
   - update `validate_transforms()` if step references columns or changes output shape
   - update `human_step_name()` and maybe `STEP_ORDER`
3. `frontend/src/main.tsx`
   - add to `STEP_TYPES`
   - add defaults in `emptyStep()`
   - add editor UI in `StepForm(...)`
   - update `columnsAfterStep()` if step changes output columns
4. `backend/tests/test_transforms.py`
   - add tests

---

## 6.2 Add a New Connector Field

Change these places:

1. `backend/app/connectors/registry.py`
2. `frontend/src/main.tsx`
   - `GeneratedConfigForm(...)`
   - `placeholderFor(...)`
   - maybe `sampleConfig(...)`
3. if runtime behavior changes:
   - `backend/app/services/connectivity.py`
   - `backend/app/services/metadata.py`
   - `backend/app/services/runner.py`

---

## 6.3 Add a New API Response Field

Change these places:

1. `backend/app/models/schemas.py`
2. route in `backend/app/api/routes.py`
3. row conversion helper if needed:
   - `_resource_from_row()`
   - `_transformation_from_row()`
   - `_pipeline_from_row()`
   - `_run_from_row()`
4. frontend type and screen usage in `frontend/src/main.tsx`

---

## 6.4 Fix a Runtime Crash During Pipeline Execution

Open in this order:

1. `backend/app/services/runner.py`
2. `backend/app/services/transforms.py`
3. `backend/app/services/metadata.py`
4. `backend/app/api/routes.py`
5. `backend/tests/test_runner.py` or `backend/tests/test_transforms.py`

Check:

- `logs/runs/run_<run_id>.log`
- `logs/app.log`
- `run_logs` table/API output
- `etl_audit_log`

---

## 6.5 Fix Source/Destination Path Pattern Issue

Open in this order:

1. `frontend/src/main.tsx`
   - `DatasetTargetEditor(...)`
   - `PatternPreview(...)`
   - `sanitizeConnectorConfig(...)`
   - `transformationPayload(...)`
2. `backend/app/services/runner.py`
   - `_sftp_read_paths()`
   - `_sftp_write_path()`
   - `_rejected_write_path()`
   - `_format_path_pattern()`
3. `backend/app/services/metadata.py`
   - `_sftp_paths()`

---

## 6.6 Fix Run Logs Not Showing or Need More Detail

Open in this order:

1. `backend/app/services/runner.py`
   - `_log()`
   - `run_pipeline()`
   - `RunFileLogger`
2. `backend/app/api/routes.py`
   - `run_logs()`
   - `download_logs()`
3. `frontend/src/main.tsx`
   - runs/logs section
4. `frontend/src/styles.css`
   - `.logs`, `.runLogs`

---

## 6.7 Change Schedule UI From Technical to Business-Friendly

Open in this order:

1. `frontend/src/main.tsx`
   - `ScheduleEditor(...)`
   - `parseScheduleToBuilder()`
   - `buildScheduleCron()`
   - `describeSchedule()`
2. `backend/app/services/scheduler.py`
   - only if scheduling semantics themselves must change

---

## 7. Backend vs Frontend Decision Guide

Use this quick rule:

### Frontend-only

If the issue is only about:

- alignment
- spacing
- labels/text
- showing/hiding controls
- client-side field hints
- rendering of already available data

Start with:

- `frontend/src/main.tsx`
- `frontend/src/styles.css`

### Backend-only

If the issue is about:

- wrong DB save/load
- auth/permission failure
- source/destination connection behavior
- ETL logic
- validation rules
- scheduler execution
- logs not being persisted

Start with:

- `backend/app/api/routes.py`
- relevant file under `backend/app/services/`

### Both frontend and backend

If the issue is about:

- new feature field or payload
- validation visible in UI and also enforced in API/runtime
- new transformation step
- new connector capability
- additional run/audit data in UI

Then update both sides.

---

## 8. Tests To Update

### Update `backend/tests/test_transforms.py` when

- transformation logic changes
- validation logic changes
- step ordering changes
- rejected row behavior changes

### Update `backend/tests/test_runner.py` when

- runtime extract/load behavior changes
- SFTP path generation changes
- rejected file path behavior changes
- run logging behavior changes

### Frontend

There is currently no dedicated frontend test suite in this repo. Use:

```bash
cd frontend
npm run build
```

---

## 9. Recommended Workflow Before Editing

1. Read this file.
2. Identify whether the request is:
   - UI only
   - API only
   - runtime ETL
   - auth/roles
   - connector config
   - transform logic
   - scheduler
3. Open the file(s) listed in the matching section.
4. Search the named function/code block.
5. Make the smallest correct change.
6. Run relevant verification.

---

## 10. Verification Commands

### Backend changes

```bash
cd backend
../venv/bin/python -B -m pytest -q
../venv/bin/python -B -m compileall app tests
```

### Frontend changes

```bash
cd frontend
npm run build
```

### Health check

```bash
curl http://127.0.0.1:8000/api/health
```

---

## 11. Fast Lookup Table

| If you need to change... | Open first |
| --- | --- |
| Login/session/roles | `backend/app/services/auth.py`, `backend/app/api/routes.py`, `frontend/src/main.tsx` |
| Source/destination config fields | `backend/app/connectors/registry.py`, `frontend/src/main.tsx` |
| Test connection behavior | `backend/app/services/connectivity.py` |
| Schema/column discovery | `backend/app/services/metadata.py`, `frontend/src/main.tsx` |
| Transformation execution | `backend/app/services/transforms.py` |
| Transformation UI | `frontend/src/main.tsx` |
| Pipeline save/run behavior | `backend/app/api/routes.py`, `backend/app/services/runner.py`, `frontend/src/main.tsx` |
| Scheduled runs | `backend/app/services/scheduler.py`, `frontend/src/main.tsx` |
| Run logs and crash tracing | `backend/app/services/runner.py`, `backend/app/api/routes.py`, `frontend/src/main.tsx` |
| Audit fields | `backend/app/services/runner.py`, `backend/app/api/routes.py`, `frontend/src/main.tsx` |
| DB schema / bootstrap user | `backend/app/db/database.py` |
| Styling / alignment | `frontend/src/styles.css` |
| Environment variables | `backend/app/core/config.py` |
| Global backend logging | `backend/app/core/logging.py` |

---

## 12. Related Docs

- `README.md`
- `docs/AI_HANDOFF.md`
- `docs/TEAM_TECHNICAL_OVERVIEW.md`
- `docs/ETL_TOOL_GUIDE.md`
- `docs/SOP.md`

Use this file as the **developer change index**. Use the other documents for architecture, deployment, and business/user workflow context.
