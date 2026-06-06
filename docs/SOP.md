# MobiFlow ETL SOP and User Guide

## 1. Purpose

This SOP explains how to use MobiFlow ETL to configure data movement from a source system to a destination system with visual transformation steps, preview, validation, scheduling, and run monitoring.

Target users:

- Admins who configure users, sources, destinations, transformations, and pipelines.
- Support users who preview, validate, and run pipelines.
- Viewers who inspect pipelines and logs.

## 2. Accessing the Application

Open the frontend:

```text
http://10.10.0.10:5173/
```

If running locally:

```text
http://localhost:5173/
```

The login screen appears first.

## 3. Login and Logout

### Login

1. Enter email.
2. Enter password.
3. Click `Login`.

Default local bootstrap user:

```text
Email: admin@mobiflow.local
Password: ChangeMe@12345!
```

For production, set a new `MOBIFLOW_BOOTSTRAP_ADMIN_PASSWORD` before first backend startup.

### Logout

1. Click `Logout` in the top bar.
2. The backend session token is revoked.
3. The login page appears again.

## 4. Logo Setup

The app loads a PNG logo first:

```text
frontend/public/logo.png
```

If PNG is missing, the app shows a text fallback.

To use your PNG logo:

1. Copy your logo into `frontend/public/`.
2. Rename it to `logo.png`.
3. Refresh the browser.

Recommended logo:

- PNG format
- Transparent background
- Minimum size `288 x 80`
- Should remain readable at `144 x 40`

## 5. Navigation Overview

Left menu sections:

- `Data Source`: configure source connectors.
- `Destination`: configure output connectors.
- `Transform`: build low-code transformation steps.
- `Pipelines`: attach source, transformation, destination, and schedule.
- `Runs & Logs`: inspect execution history and step logs.
- `Access Control`: create users and roles.

## 5.1 UI Screenshots

Place screenshots in:

```text
docs/screenshots/
```

Use these exact filenames:

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

Screenshot links:

| Page | File |
| --- | --- |
| Login | [00-login.png](screenshots/00-login.png) |
| Data Source | [01-data-source.png](screenshots/01-data-source.png) |
| Destination | [02-destination.png](screenshots/02-destination.png) |
| Transform Builder | [03-transform-builder.png](screenshots/03-transform-builder.png) |
| Pipelines | [04-pipelines.png](screenshots/04-pipelines.png) |
| Runs & Logs | [05-runs-logs.png](screenshots/05-runs-logs.png) |
| Access Control | [06-access-control.png](screenshots/06-access-control.png) |

## 6. Configure Data Source

Use this section to define where data is read from.

Steps:

1. Open `Data Source`.
2. Select a connector, such as PostgreSQL or SFTP.
3. Enter name and connection details.
4. Click `Create datasource`.

PostgreSQL source fields:

- Host
- Port
- Database
- Schema
- Table or Query
- Username
- Password

SFTP source fields:

- Host
- Port
- Username
- Password or private key
- Remote path
- Date file pattern
- Format: CSV or XLSX

Validation tips:

- Host must not contain extra characters.
- PostgreSQL table must exist.
- SFTP remote path must point to a readable file.
- Use Date file pattern for scheduled daily files, for example `/in/customers_{YYYY}{MM}{DD}.csv`.
- The UI shows `Resolved today` below the pattern.
- For CSV files, first row must contain headers.

## 7. Configure Destination

Use this section to define where transformed data is written.

Steps:

1. Open `Destination`.
2. Select a connector, such as PostgreSQL or SFTP.
3. Enter destination details.
4. Click `Create destination`.

Important SFTP note:

- Destination remote path must be a full file path, not only a directory.
- Use Output date pattern for dated outputs, for example `/out/{YYYY}/{MM}/{DD}/result.csv`.
- Missing SFTP output folders are created automatically by default.
- Use Rejected/error path or Rejected/error pattern to control where bad-record files are written.
- Correct example:

```text
/home/sumit/sftp-test/customer_pipeline.csv
```

- Risky example:

```text
/home/sumit/sftp-test
```

## XLSX Input Rules

- XLSX input must have exactly one visible sheet.
- If multiple sheets exist, job fails.
- If any hidden sheet exists, job fails.
- For password-protected XLSX, enter File password in SFTP source config. Backend needs `msoffcrypto-tool`.

## SFTP Date Pattern Examples

Supported tokens:

```text
{YYYY} {YY} {MM} {DD} {hh} {mm} {ss} {timestamp}
```

If current UTC date is `2026-06-05`:

```text
/in/paytm/input_{YYYY}{MM}{DD}.csv
-> /in/paytm/input_20260605.csv

/out/paytm/output_{DD}{MM}{YYYY}.xlsx
-> /out/paytm/output_05062026.xlsx

/err/paytm/rejected_{YYYY}{MM}{DD}_{timestamp}.csv
-> /err/paytm/rejected_20260605_20260605070809.csv
```

The pattern is resolved when the pipeline run starts. Scheduled runs therefore pick files based on the run date. For SFTP destinations, missing folders in the resolved output path are created automatically.

## PII Column Configuration

In Transform, add `Encrypt PII` step and select sensitive columns:

```text
PARTY_MOBILE_NUMBER, PARTY_EMAIL
```

Behavior:

- Use `encrypt` mode to store encrypted `enc:v1:` values in downstream output.
- Use `mask` mode to write masked values.
- Keep `MOBIFLOW_PII_ENCRYPTION_KEYS` and `MOBIFLOW_PII_ENCRYPTION_KEY` fallback stable across deployments.

## ETL Audit Log

Open `ETL Audit` to see pipeline-run audit rows from `etl_audit_log`.

This is separate from user/application management audit logs. It tracks run id, pipeline name, manual/scheduled job type, trigger user, stage, source path, target path, counts, rejected count, error message, and error file path.

## 8. Build Transformation

Open `Transform`.

For a full detailed guide, see [ETL_TOOL_GUIDE.md](ETL_TOOL_GUIDE.md).

The screen has three areas:

- Left: dataset and schema explorer.
- Center: transformation step builder.
- Right: preview, validation, and execution notes.

### 8.1 Choose Source and Destination

1. Select datasource in left panel.
2. Select destination in left panel.
3. Source columns load into schema explorer.

### 8.2 Add and Configure Steps

Use `+ Add Step` to add steps.

Supported MVP steps:

1. Select Columns
2. Rename Columns
3. Change Data Type
4. Fill Null Values
5. Add Derived Column
6. Filter Rows
7. Remove Duplicates
8. Sort Rows

Each step supports:

- Enable/disable
- Duplicate
- Delete
- Move up/down
- Step note

### 8.3 Recommended Step Order

Use this order unless there is a specific reason:

1. Select Columns
2. Rename Columns
3. Change Data Type
4. Fill Null Values
5. Add Derived Column
6. Filter Rows
7. Remove Duplicates
8. Sort Rows

Important:

- If Rename changes `source_month` to `month`, later steps must use `month`.
- If a later step still uses `source_month`, validation fails.

### 8.4 Select Columns

Purpose:

- Keep required columns only.

Steps:

1. Open Select Columns step.
2. Click column chips to include/exclude columns.
3. Ensure all columns needed by later steps are selected.

### 8.5 Rename Columns

Purpose:

- Standardize output names.

Example:

```text
source_month -> month
full_name -> customer_name
```

Steps:

1. Add mapping row.
2. Select source column.
3. Enter new name.

### 8.6 Change Data Type

Purpose:

- Convert columns before load.

Supported types:

- string
- integer
- float
- boolean
- date
- datetime

Steps:

1. Choose column.
2. Choose target type.
3. Add one row per cast rule.

### 8.7 Fill Null Values

Purpose:

- Avoid bad output or destination load failures.

Strategies:

- fixed value
- empty string
- zero
- forward fill
- backward fill

Example:

```text
failed_reason -> empty string
city -> UNKNOWN
```

### 8.8 Add Derived Column

Purpose:

- Create a new column using safe form-based formula controls.

Supported operators:

- `+`
- `-`
- `*`
- `/`

Example:

```text
net_amount = amount - discount
```

Steps:

1. Enter output column.
2. Select operand 1 as column or constant.
3. Choose operator.
4. Select operand 2 as column or constant.

Raw Python is not exposed to users.

### 8.9 Filter Rows

Purpose:

- Keep only rows matching conditions.

Operators:

- equals
- not equals
- greater than
- less than
- contains
- starts with
- is null
- is not null
- in list

Multiple conditions can use:

- AND
- OR

Example:

```text
amount > 0
status in ACTIVE, CLOSED
```

### 8.10 Remove Duplicates

Purpose:

- Remove duplicate rows using selected key columns.

Steps:

1. Select subset columns.
2. Choose keep first or keep last.

### 8.11 Sort Rows

Purpose:

- Sort final output.

Steps:

1. Choose column.
2. Choose ascending or descending.

## 9. Preview Transformation

Click `Preview`.

Preview supports:

- sample size: 20, 50, 100
- preview until selected step
- output rows
- changed columns
- execution notes

Use preview before publish.

## 10. Validate Transformation

Click `Validate`.

Validation checks:

- Missing referenced columns.
- Duplicate output names.
- Risky step order.
- Destination-required columns when destination schema is available.

Common error:

```text
Step 3 Change Data Type references missing columns: source_month
```

Meaning:

- Earlier step renamed or removed `source_month`.
- Fix by using current column name in Step 3.

## 11. Save Draft and Publish

### Save Draft

Click `Save Draft` to save work without making it available to pipelines.

### Publish

Click `Publish` after preview and validation pass.

Only published transformations appear in Pipeline transformation dropdown.

## 12. Create or Edit Pipeline

Open `Pipelines`.

### Create Pipeline

1. Enter pipeline name.
2. Enter cron schedule.
3. Select datasource.
4. Select destination.
5. Select published transformation.
6. Click `Save pipeline`.

### Edit Pipeline

1. Click `Edit` on a saved pipeline.
2. Form switches to edit mode.
3. Update fields.
4. Click `Update pipeline`.

This updates the existing pipeline. It does not create a duplicate.

### Start New Pipeline After Editing

Click `New pipeline` to exit edit mode.

## 13. Scheduling

MobiFlow supports cron-style schedules.

Examples:

```text
*/2 * * * *    Every 2 minutes
*/5 * * * *    Every 5 minutes
0 * * * *      Every hour
30 2 * * *     Every day at 02:30
```

Scheduler behavior:

- Runs inside backend process.
- Scans every 15 seconds.
- Enqueues each matching pipeline once per minute.
- Only enabled pipelines are scheduled.

If scheduled run does not happen:

1. Confirm backend is running.
2. Confirm pipeline schedule is not empty.
3. Confirm pipeline enabled is true.
4. Check `Runs & Logs`.
5. Check backend logs at `backend/logs/app.log`.

## 14. Manual Run

Open `Pipelines`.

Click `Run` on the pipeline row.

Then open `Runs & Logs` to inspect status.

## 15. Runs and Logs

Open `Runs & Logs`.

Recent Runs shows:

- run id
- pipeline name
- status
- records written/read
- duration
- start time
- error

Run Logs shows:

- extraction result
- step-wise transformation messages
- warnings
- final row count
- load result

Example successful log:

```text
INFO Run started for pipeline Customer pipeline
INFO Extracted 1 rows
INFO Step 1 Select Columns applied
INFO Step 2 Rename Columns applied
INFO Step 3 Change Data Type applied
INFO Final output rows: 1
INFO Run succeeded, wrote 1 rows
```

## 16. Access Control

Open `Access Control`.

Create user:

1. Enter name.
2. Enter email.
3. Enter password.
4. Select role.
5. Click `Create user`.

Roles:

- Admin: full create/edit/delete/publish.
- Support: preview, validate, run existing pipelines.
- Viewer: read-only and preview.

MVP note:

- Role is displayed and stored.
- Strict server-side permission enforcement should be added before production.

## 17. Common Issues

### Name or service not known

Cause:

- Bad hostname.
- Extra character in host.

Example:

```text
10.1.1.45`
```

Fix:

```text
10.1.1.45
```

### SFTP OSError: Failure

Likely cause:

- Destination path is directory, not file.

Fix:

```text
/home/sumit/sftp-test/customer_pipeline.csv
```

### Missing Column in Validation

Cause:

- Column removed by Select Columns.
- Column renamed earlier.
- Step order mismatch.

Fix:

- Include column in Select Columns.
- Use renamed column in later steps.
- Move steps into recommended order.

### Pipeline Edit Creates New Pipeline

Expected fixed behavior:

- Click Edit.
- Header shows `Edit Pipeline #id`.
- Button shows `Update pipeline`.
- Save updates same row.

### Scheduled Run Not Firing

Check:

- Backend running.
- Schedule matches current minute.
- Cron expression valid.
- Pipeline enabled.
- Backend logs include `Pipeline scheduler started`.

## 18. Production Hardening Checklist

Before production:

- Change bootstrap admin password and keep it outside source control.
- Enforce fine-grained role permissions for every write route.
- Store secrets in vault.
- Move scheduler/runner to durable worker service.
- Add retries and dead-letter handling.
- Keep app-management audit logs for create/update/delete/publish.
- Keep ETL run auditing in `etl_audit_log` for pipeline execution stages, counts, paths, errors, and rejected-file location.
- Add backup and retention policy for metadata DB.
- Add deployment automation and health monitoring.
