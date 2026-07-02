# ETL Tool Guide

This guide explains how to use MobiFlow ETL end to end. It is written for team members who need to configure datasources, destinations, transformations, pipelines, schedules, run logs, rejected records, and ETL audit logs from the UI.

MobiFlow ETL is a low-code ETL control plane. The UI stores metadata in the backend database, then the backend runs extract, transform, and load jobs with connector-specific logic and Pandas transformations.

## 1. Main Workflow

Use this sequence for every new ETL job:

1. Login.
2. Create or select a Data Source.
3. Create or select a Destination.
4. Open Transform.
5. Select source and destination in the schema explorer.
6. Build transformation steps.
7. Preview and validate.
8. Save draft.
9. Publish the transformation.
10. Open Pipelines.
11. Create a pipeline using the published transformation.
12. Run manually or set a schedule.
13. Check Runs & Logs.
14. Check ETL Audit.
15. Check rejected/error file if records were rejected.

Important rule: bad records should be rejected by validation and written to an error file where configured. Bad records should not stop the full pipeline unless the error is structural, such as missing source file, invalid connector config, invalid custom code, multiple Excel sheets, hidden Excel sheets, or destination load failure.

## 2. Roles And Access

Admin:

- Manage datasources.
- Manage destinations.
- Create, edit, validate, preview, save, publish transformations.
- Create and run pipelines.
- Superuser-only user management in Access Control.

Support:

- View and support operations depending on API permission.
- Review runs, logs, audit logs, and transformation behavior.

Viewer:

- Read-only operational visibility.

Logout is available from the left menu area.

## 3. Data Source

Open `Data Source` from the left menu.

A datasource stores connection-level configuration. Some file/table choices can also be set later in Transform or Pipeline.

### 3.1 PostgreSQL Source

Use PostgreSQL source when input data is in a database table or a safe SQL query.

Parameters:

| Parameter | Required | Meaning | Example |
| --- | --- | --- | --- |
| `name` | Yes | UI name for this datasource | `Loan DB Source` |
| `host` | Yes | PostgreSQL host | `10.10.0.15` |
| `port` | No | PostgreSQL port. Default `5432` | `5432` |
| `database` | Yes | Database name | `loan_db` |
| `schema` | No | Schema name. Default `public` | `public` |
| `table` | No | Source table. Use this when not using query | `customer_notice` |
| `query` | No | Read-only SQL query. Use when table mode is not enough | `select * from customer_notice where run_date = current_date` |
| `username` | Yes | DB username | `etl_user` |
| `password` | Yes | DB password | secret |

Rules:

- If `query` is provided, query mode is used.
- If `query` is blank, `schema` and `table` are used.
- Raw SQL is guarded by backend SQL safety rules.
- In table mode, extraction uses a default limit in the current implementation.

### 3.2 SFTP Source

Use SFTP source when input data is a CSV or XLSX file on SFTP.

Parameters:

| Parameter | Required | Meaning | Example |
| --- | --- | --- | --- |
| `name` | Yes | UI name for this datasource | `Client A SFTP Source` |
| `host` | Yes | SFTP host | `sftp.client.com` |
| `port` | No | SFTP port. Default `22` | `22` |
| `username` | Yes | SFTP username | `etl_in` |
| `password` | Conditional | SFTP password if password login is used | secret |
| `private_key` | Conditional | Private key if key login is used | PEM key text |
| `file_password` | No | Password for protected XLSX input files | secret |
| `remote_path` | Conditional | Exact file path to read | `/input/loan_20260606.xlsx` |
| `path_pattern` | Conditional | Date/wildcard pattern for scheduled file pickup | `/input/loan_{YYYY}{MM}{DD}.xlsx` |
| `format` | No | File format, `csv` or `xlsx`. Default `csv` | `xlsx` |

Use either `remote_path` or `path_pattern`.

For scheduled date-based pickup, use `path_pattern`:

```text
/input/customer_{YYYY}{MM}{DD}.csv
/input/loan_{YYYY}-{MM}-{DD}.xlsx
/input/{YYYY}/{MM}/{DD}/loan_*.csv
```

Supported date tokens:

| Token | Meaning | Example on 2026-06-06 |
| --- | --- | --- |
| `{YYYY}` | Four digit year | `2026` |
| `{YY}` | Two digit year | `26` |
| `{MM}` | Month | `06` |
| `{DD}` | Day | `06` |
| `{hh}` | Hour | `14` |
| `{mm}` | Minute | `30` |
| `{ss}` | Second | `09` |
| `{timestamp}` | Compact timestamp | `20260606143009` |

If a pattern contains wildcard characters like `*`, the backend lists the directory and reads matching files.

### 3.3 Excel Input Rules

XLSX input has strict rules:

- Workbook must contain exactly one visible sheet.
- If multiple sheets are present, the job fails.
- If any hidden sheet is present, the job fails.
- Password-protected XLSX requires `file_password` in the SFTP source config.
- Backend must have `msoffcrypto-tool` installed.

Reason: multiple or hidden sheets can create ambiguous input. The ETL job must read one clear sheet only.

Password-protected XLSX flow:

1. Create or edit SFTP Source.
2. Select format `xlsx`.
3. Enter `File password`.
4. Save the source.
5. Use this source in Transform or Pipeline.

If the package is missing, backend returns an error similar to:

```text
Password-protected XLSX input requires msoffcrypto-tool. Install backend requirement and set file_password.
```

## 4. Destination

Open `Destination` from the left menu.

A destination stores where final transformed rows are written. Rejected/error files can also be configured for file destinations.

### 4.1 PostgreSQL Destination

Parameters:

| Parameter | Required | Meaning | Example |
| --- | --- | --- | --- |
| `name` | Yes | UI name for destination | `Loan DB Target` |
| `host` | Yes | PostgreSQL host | `10.10.0.15` |
| `port` | No | PostgreSQL port. Default `5432` | `5432` |
| `database` | Yes | Target database | `loan_mart` |
| `schema` | No | Target schema. Default `public` | `public` |
| `table` | Yes | Target table name | `notice_output` |
| `username` | Yes | DB username | `etl_writer` |
| `password` | Yes | DB password | secret |
| `mode` | No | Write mode: `append`, `upsert`, `truncate_insert` | `append` |
| `primary_key` | Conditional | Required for `upsert` | `customer_id` |

Write modes:

| Mode | Behavior |
| --- | --- |
| `append` | Insert all rows. Existing rows are not changed. |
| `upsert` | Insert or update by `primary_key`. |
| `truncate_insert` | Truncate target table, then insert output rows. |

Rules:

- Output columns must match target table columns.
- For `upsert`, the output must contain the selected `primary_key` column.
- PII encryption should be done in Transform before loading to database.

### 4.2 SFTP Destination

Parameters:

| Parameter | Required | Meaning | Example |
| --- | --- | --- | --- |
| `name` | Yes | UI name for destination | `Client A SFTP Out` |
| `host` | Yes | SFTP host | `sftp.client.com` |
| `port` | No | SFTP port. Default `22` | `22` |
| `username` | Yes | SFTP username | `etl_out` |
| `password` | Conditional | SFTP password if password login is used | secret |
| `private_key` | Conditional | Private key if key login is used | PEM key text |
| `remote_path` | Conditional | Exact output file path | `/output/loan_output.csv` |
| `output_path_pattern` | Conditional | Pattern for output file/folder | `/output/{YYYY}/{MM}/{DD}/loan_{timestamp}.xlsx` |
| `rejected_path` | No | Exact rejected/error file path | `/error/rejected.csv` |
| `rejected_path_pattern` | No | Pattern for rejected/error file | `/error/{YYYY}{MM}{DD}/rejected_{timestamp}.csv` |
| `xlsx_data_sheet` | No | Sheet name for generated XLSX output | `Data` |
| `auto_create_folders` | No | Create missing SFTP output/error folders. Default true | `true` |
| `format` | No | Output format, `csv` or `xlsx`. Default `csv` | `xlsx` |

Use either `remote_path` or `output_path_pattern`.

Examples:

```text
/output/customer_{YYYY}{MM}{DD}.csv
/output/{YYYY}/{MM}/{DD}/customer_{timestamp}.xlsx
/error/{YYYY}/{MM}/{DD}/customer_rejected_{timestamp}.csv
```

If `auto_create_folders` is true, folders such as `/output/2026/06/06` are created automatically before writing the file.

If output path ends with `/`, default filename is used:

- CSV: `output.csv`
- XLSX: `output.xlsx`

## 5. Transform

Open `Transform` from the left menu.

Transformations convert source rows into destination-ready rows. A transformation is first saved as draft, then published. Pipelines should use published transformation versions.

Screen areas:

- Source and destination selector.
- Source target file/table and format controls.
- Destination target output controls.
- Step canvas.
- Preview modal with Input, Output, Validation, and Notes tabs.
- Save Draft and Publish actions.

### 5.1 Draft And Publish

Draft:

- Editable saved transformation.
- Not the recommended version for production pipelines.

Published:

- Versioned snapshot.
- Available for pipeline selection.
- Pipeline can use latest published version or a specific version.

### 5.2 Preview

Preview runs the selected source through enabled steps and displays sample output.

Use Preview to check:

- Columns appear in correct order.
- Dates and numeric values are formatted correctly.
- Validation rejects bad records.
- PII values are masked/encrypted.
- Downstream warnings are visible.

### 5.3 Validate

Validate checks transformation structure before publish.

It catches issues like:

- Later step references a missing column.
- Select Columns appears after Rename or Cast.
- Validation column does not exist.
- Destination columns differ from output columns.
- Custom Python may make downstream column validation incomplete.

## 6. Transformation Steps And Parameters

Recommended order:

1. Select Columns
2. Rename Columns
3. Change Data Type
4. Validate Rows
5. Encrypt PII
6. Fill Null Values
7. Add Blank Columns
8. Add Derived Column
9. Filter Rows
10. Value Map
11. Join
12. Group By
13. Pivot
14. Remove Duplicates
15. Reorder Columns
16. Sort Rows
17. Custom Transform

### 6.1 Select Columns

Purpose: keep only selected columns.

Parameters:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `columns` | List of source columns to keep | `customer_id, mobile, amount` |

Rules:

- Select all columns needed by later steps.
- If a later step uses a removed column, validation fails.

### 6.2 Rename Columns

Purpose: rename source columns to business or destination names.

Parameters:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `mappings` | Source column to destination column mappings | `Customer_id -> APAC_CARD_NUMBER` |

Rules:

- Later steps must use renamed column names.
- Do this before validation if validation should use destination names.

### 6.3 Change Data Type

Purpose: convert columns to expected data types.

Parameters:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `casts` | List of column/type conversions | `EMI_AMT -> decimal` |
| `column` | Column to convert | `DUE_DATE` |
| `type` | Target type | `string`, `integer`, `decimal`, `date`, `datetime`, `boolean` |
| `format` | Date format when target is date/datetime | `dd/mm/yyyy` |

Rules:

- Invalid casts reject records instead of stopping the pipeline.
- Date formats use UI-supported formats such as `dd/mm/yyyy`, `yyyy-mm-dd`, and similar options.

### 6.4 Validate Rows

Purpose: reject bad rows and continue processing good rows.

Parameters:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `rules` | List of validation rules | one rule per column |
| `column` | Column to validate | `PARTY_MOBILE_NUMBER` |
| `type` | Rule type | `exact_length` |
| `value` | Rule value for length/numeric rules | `10` |
| `pattern` | Regex pattern for regex rule | `^[0-9]{10}$` |
| `format` | Date format for date rule | `dd/mm/yyyy` |
| `values` | Allowed values list | `MH, GJ, KA` |

Supported validation types:

| Type | Meaning | Sample |
| --- | --- | --- |
| `none` | No validation | accept as-is |
| `required` | Value must not be null or blank | customer id required |
| `not_blank` | Value must contain non-space text | name not blank |
| `regex` | Value must match regex | `^[0-9]{10}$` |
| `numeric` | Value must be numeric | `1000` |
| `decimal` | Value must be decimal/numeric | `1250.50` |
| `integer` | Value must be whole number | `12` |
| `date_format` | Value must match date format | `08/05/2026` with `dd/mm/yyyy` |
| `max_length` | Length must be <= value | max 50 |
| `min_length` | Length must be >= value | min 3 |
| `exact_length` | Length must be exactly value | mobile length 10 |
| `allowed_values` | Value must exist in list | `ACTIVE, INACTIVE` |

Examples:

```text
Mobile 10 digits:
column = PARTY_MOBILE_NUMBER
type = exact_length
value = 10
```

```text
Only digits mobile:
column = PARTY_MOBILE_NUMBER
type = regex
pattern = ^[0-9]{10}$
```

```text
Due date:
column = DUE_DATE
type = date_format
format = dd/mm/yyyy
```

Rejected rows include:

- Original record.
- Rejected stage.
- Rejected column.
- Rejected reason.
- Validation metadata.

### 6.5 Encrypt PII

Purpose: encrypt or mask sensitive columns before saving to database or file.

Parameters:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `columns` | Sensitive columns to protect | `mobile, email, pan` |
| `mode` | `encrypt` or `mask` | `encrypt` |
| `key_id` | Client key id for encryption | `client_a` |

Multiple client keys:

Set backend environment:

```bash
MOBIFLOW_PII_ENCRYPTION_KEYS='{"client_a":"secret-a","client_b":"secret-b","default":"fallback-secret"}'
```

Then in the Encrypt PII step:

```text
columns = PARTY_MOBILE_NUMBER, PARTY_EMAIL
mode = encrypt
key_id = client_a
```

Output format:

```text
enc:v1:client_a:<ciphertext>
```

Mask mode example:

```text
9876543210 -> *******210
```

Rules:

- Encrypt before loading to PostgreSQL if PII must not be stored in plain text.
- Use different `key_id` per client.
- Keep keys stable. Changing keys makes old ciphertext undecryptable.
- Use a vault or KMS in production for stronger key management.

### 6.6 Fill Null Values

Purpose: replace null or blank values before calculations or output.

Parameters:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `fills` | List of fill rules | one per column |
| `column` | Column to fill | `STATE` |
| `strategy` | Fill strategy | `fixed`, `empty_string`, `zero`, `forward_fill`, `backward_fill` |
| `value` | Fixed value when strategy is fixed | `NA` |

Examples:

```text
STATE -> fixed -> Telangana
PARTY_EMAIL -> empty_string
EMI_AMT -> zero
```

### 6.7 Add Blank Columns

Purpose: create required output columns with blank values.

Parameters:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `columns` | Comma-separated output columns to add | `PARTY_EMAIL, PARTY_ID` |

Rules:

- Existing values are not overwritten.
- Useful when destination or file template needs columns not present in source.

### 6.8 Add Derived Column

Purpose: create a new column from a formula or operands.

Common uses:

- Calculate net amount.
- Combine fields.
- Add static flags.
- Build risk/category columns.

Parameters depend on selected derive form. Typical parameters:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `output_column` | New column name | `net_amount` |
| `left` | Left operand | `amount` |
| `operator` | Operation | `+`, `-`, `*`, `/`, concat-style operation |
| `right` | Right operand | `discount` |

Rule: source columns used in derive must still exist at this step.

### 6.9 Filter Rows

Purpose: keep rows matching a condition.

Typical parameters:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `column` | Column to test | `status` |
| `operator` | Condition | `equals`, `not_equals`, `contains`, comparison operators |
| `value` | Comparison value | `ACTIVE` |

Rows that do not match are removed from final output. Use Validate Rows when you need rejected-record tracking.

### 6.10 Value Map

Purpose: map source values to standard values.

Parameters:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `column` | Column to map | `state` |
| `mappings` | Old value to new value mappings | `TG -> Telangana` |
| `default` | Optional fallback value | `Unknown` |

Use for code-to-label or label-to-code standardization.

### 6.11 Join

Purpose: join current rows with another source.

Parameters:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `right_source_mode` | `saved_source` or `same_connection` | `same_connection` |
| `right_source_id` | Saved datasource id if using saved source | `12` |
| `right_source_config` | Override table/query/path for same connection | table `customer_master` |
| `join_type` | Join type | `left`, `inner`, `right`, `outer` |
| `left_key` | Current dataframe key | `customer_id` |
| `right_key` | Right source key | `customer_id` |

Rules:

- For same PostgreSQL connection, provide right table or query.
- For same SFTP connection, provide right file path and format.
- Join keys must exist.

### 6.12 Group By

Purpose: aggregate rows.

Typical parameters:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `group_columns` | Columns to group by | `branch, state` |
| `aggregations` | Column aggregation rules | `amount -> sum` |
| `output_column` | Optional output name | `total_amount` |

Use for summaries and totals.

### 6.13 Pivot

Purpose: convert row values into columns.

Typical parameters:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `index` | Identifier columns | `customer_id` |
| `columns` | Values that become columns | `month` |
| `values` | Measure column | `amount` |
| `aggfunc` | Aggregation function | `sum` |

### 6.14 Remove Duplicates

Purpose: remove duplicate rows.

Parameters:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `subset` | Columns used to detect duplicates | `customer_id` |
| `keep` | Which duplicate to keep | `first`, `last` |

### 6.15 Reorder Columns

Purpose: set final output column order.

Parameters:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `columns` | Final output order | `APAC_CARD_NUMBER, PARTY_NAME, DUE_DATE` |

Use near the end of the transformation.

### 6.16 Sort Rows

Purpose: sort output rows.

Parameters:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `columns` | Sort columns | `STATE, CITY` |
| `ascending` | Sort direction | true or false |

### 6.17 Custom Transform

Purpose: run controlled Python transform logic when low-code steps are not enough.

Input function shape:

```python
def transform(df):
    df["NOTICE_COMMUNICATION_DATE"] = pd.Timestamp.now().strftime("%d/%m/%Y")
    return df
```

Rules:

- Function must return a dataframe.
- Custom transforms can make downstream column validation incomplete.
- Production custom Python execution is controlled by backend environment settings.
- Prefer low-code steps whenever possible.

## 7. Error And Rejection Handling

Validation and cast failures reject only bad records. Good records continue.

Rejected/error file should contain:

- Original record.
- Final row values available at rejection time.
- Rejected stage.
- Rejected column.
- Rejected reason.
- Validation details.

Rejected/error file path is controlled by destination config:

| Config | Meaning |
| --- | --- |
| `rejected_path` | Exact rejected/error file path |
| `rejected_path_pattern` | Date pattern for rejected/error file |

If no rejected path is configured, backend derives a rejected filename from output path.

Examples:

```text
/error/client_a/rejected.csv
/error/client_a/{YYYY}/{MM}/{DD}/rejected_{timestamp}.csv
```

## 8. Pipeline

Open `Pipelines` from the left menu.

A pipeline connects:

- Source.
- Destination.
- Published transformation.
- Optional schedule.

Parameters:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `name` | Pipeline name | `Client A Daily Loan ETL` |
| `source` | Datasource to extract from | `Client A SFTP Source` |
| `destination` | Destination to load into | `Client A SFTP Out` |
| `transformation` | Published transformation | `Loan Notice v4` |
| `transformation_version` | `latest` or fixed version | `latest` |
| `schedule` | Cron expression | `0 9 * * *` |
| `enabled` | Whether schedule can run | true |

Manual run:

1. Open Pipelines.
2. Select pipeline.
3. Click Run.
4. Check Runs & Logs.

Scheduled run:

1. Enter cron expression.
2. Keep pipeline enabled.
3. Scheduler runs in backend process.

Cron examples:

| Schedule | Meaning |
| --- | --- |
| `0 * * * *` | Every hour |
| `0 9 * * *` | Every day at 09:00 |
| `*/15 * * * *` | Every 15 minutes |
| `0 9 * * 1-5` | Weekdays at 09:00 |

## 9. Runs & Logs

Open `Runs & Logs`.

Use this screen to see operational execution status.

Run status values:

| Status | Meaning |
| --- | --- |
| `queued` | Run accepted but not started |
| `running` | Run is executing |
| `succeeded` | Run completed successfully |
| `failed` | Run failed |

Logs show messages such as:

- Run started.
- Extracted row count.
- Transformation step messages.
- Validation warnings.
- Rejected records saved.
- Final output row count.
- Error message if failed.

## 10. ETL Audit Log

Open `ETL Audit`.

This is pipeline-run audit, not user-management audit. It tracks lifecycle, stages, counts, paths, and failures for ETL runs.

Audit table name:

```text
etl_audit_log
```

Columns:

| Column | Meaning |
| --- | --- |
| `id` | Audit row id |
| `run_id` | Linked run id |
| `pipeline_name` | Pipeline name at run time |
| `job_type` | `manual`, `scheduled`, or system type |
| `start_time` | Run start timestamp |
| `end_time` | Run end timestamp |
| `duration_seconds` | Total duration |
| `status` | `running`, `succeeded`, `failed`, `stopped` |
| `current_stage` | Current or last completed stage |
| `failed_stage` | Stage where failure happened |
| `source_path` | Source table/query/file path after pattern resolution |
| `target_path` | Destination table/file path after pattern resolution |
| `total_count` | Total rows extracted |
| `success_count` | Rows successfully written |
| `failed_count` | Failed/rejected count |
| `rejected_count` | Rejected records count |
| `error_message` | Failure message |
| `error_file_path` | Rejected/error file path |
| `triggered_by` | User or scheduler identity |
| `created_date` | Audit row created time |
| `last_modified_date` | Audit row updated time |

Stages:

| Stage | Meaning |
| --- | --- |
| `extract` | Reading source data |
| `transform` | Applying transformation steps |
| `reject` | Writing rejected/error records |
| `load` | Writing destination |

Use audit log for daily production checks:

- Confirm run status is succeeded.
- Compare total, success, rejected, and failed counts.
- Verify source path and target path are correct for the run date.
- Open error file path if rejected count is greater than zero.

## 11. Access Control

Open `Access Control` as superuser.

User parameters:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `name` | User display name | `Sumit Yadav` |
| `email` | Login email | `sumit@example.com` |
| `password` | Initial password | secret |
| `role` | User role | `superuser`, `admin`, `support`, `viewer` |

Users can change their password from the account/password panel when available.

## 12. Common Examples

### 12.1 Daily SFTP XLSX To SFTP CSV

Source:

```text
format = xlsx
path_pattern = /input/loan_{YYYY}{MM}{DD}.xlsx
file_password = <only if protected>
```

Destination:

```text
format = csv
output_path_pattern = /output/{YYYY}/{MM}/{DD}/loan_output_{timestamp}.csv
rejected_path_pattern = /error/{YYYY}/{MM}/{DD}/loan_rejected_{timestamp}.csv
auto_create_folders = true
```

Transform:

1. Select Columns.
2. Rename Columns.
3. Validate Rows.
4. Encrypt PII.
5. Add Blank Columns.
6. Reorder Columns.

Pipeline:

```text
schedule = 0 9 * * *
```

### 12.2 Mobile Number Validation

Use Validate Rows:

```text
column = PARTY_MOBILE_NUMBER
type = exact_length
value = 10
```

For digits only plus length:

```text
column = PARTY_MOBILE_NUMBER
type = regex
pattern = ^[0-9]{10}$
```

### 12.3 Client-Specific PII Encryption

Backend config:

```bash
MOBIFLOW_PII_ENCRYPTION_KEYS='{"client_a":"secret-a","client_b":"secret-b"}'
```

Transform step:

```text
step = Encrypt PII
columns = PARTY_MOBILE_NUMBER, PARTY_EMAIL
mode = encrypt
key_id = client_a
```

## 13. Troubleshooting

Source columns not loading:

- Check source host, port, username, password/key.
- Check table/query/path.
- For SFTP, verify file exists and format is correct.
- For XLSX, verify exactly one visible sheet.

Output file missing columns:

- Check Select Columns step.
- Check Rename Columns step.
- Check Reorder Columns step.
- Confirm final preview output columns before publishing.

Mobile number blank in output:

- Check source column selected.
- Check rename mapping points to correct source column.
- Check validation did not reject those rows.
- Check Add Blank Columns did not create a different mobile column name.
- Check Reorder Columns includes the populated column.

Job fails for Excel:

- Multiple sheets are not allowed.
- Hidden sheets are not allowed.
- Password-protected file needs File password and backend dependency.

Rejected rows exist:

- Open ETL Audit.
- Find `error_file_path`.
- Download/open rejected file.
- Review `_original_record`, `_rejected_column`, and `_rejected_reason`.

Schedule did not run:

- Confirm pipeline is enabled.
- Confirm backend service and scheduler are running.
- Confirm cron expression.
- Check Runs & Logs and ETL Audit.

## 14. Production Notes

- Do not commit `.env`, secrets, logs, or local data.
- Use strong database and SFTP credentials.
- Use client-specific PII keys.
- Store production keys in a vault/KMS when available.
- Keep rejected/error files protected because they may contain original records.
- Monitor `etl_audit_log` daily.
- Treat custom Python transforms as privileged behavior.
