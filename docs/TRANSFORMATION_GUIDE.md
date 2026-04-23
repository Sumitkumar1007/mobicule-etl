# Transformation Builder Guide

This guide explains how to build, preview, validate, publish, and attach transformations in MobiFlow ETL.

The transformation module is UI-driven. Users do not write JSON or Python. Internally, the backend applies each step with Pandas in the same order shown on screen.

## 1. Who Can Use This

Permissions:

- Admin: create, edit, preview, validate, save draft, publish transformations.
- Support: preview and validate existing transformations.
- Viewer: view existing transformations and results.

Only admins can change transformation structure because transformation changes affect pipeline output.

## 2. Transformation Flow

Use this flow for every transformation:

1. Configure a datasource.
2. Configure a destination.
3. Open `Transform`.
4. Select source and destination in the schema explorer.
5. Build steps in the step canvas.
6. Click `Preview`.
7. Click `Validate`.
8. Fix any errors or warnings.
9. Click `Save Draft`.
10. Click `Publish`.
11. Open `Pipelines`.
12. Select the published transformation in the pipeline form.
13. Save or update the pipeline.
14. Run the pipeline or schedule it.

## 3. Open the Transformation Builder

From the left menu, click:

```text
Transform
```

The screen contains:

- Top actions: `Preview`, `Validate`, `Save Draft`, `Publish`.
- Transformation metadata: name, description, existing transformation selector, status.
- Left panel: source, destination, source schema, searchable columns.
- Center panel: step canvas.
- Right panel: preview, validation, and execution notes. This opens after clicking `Preview` or `Validate`.
- Bottom summary: input rows, output rows, warnings, runtime status.

## 4. Select Source and Destination

In the `Dataset/schema Explorer`:

1. Select `Source`.
2. Select `Destination`.
3. Confirm source and destination names below the dropdowns.
4. Use `Search columns` to find source columns.

When a source is selected, the app loads source columns from the connector.

Example source columns:

```text
customer_id
full_name
mobile_no
dob
amount
discount
city
created_at
```

Important:

- If schema loading fails, check datasource host, port, database, table/query, username, and password.
- PostgreSQL defaults come from `.env` through `MOBIFLOW_METADATA_DATABASE_URL`.
- Destination schema validation works when the destination schema can be loaded.

## 5. Transformation Name and Description

At the top of the builder:

1. Enter `Name`.
2. Enter `Description`.

Use clear names. Good examples:

```text
Customer cleanup
Payment normalization
Monthly model prediction cleanup
```

Good descriptions:

```text
Standardize customer fields before loading to master table.
Filter invalid payment rows and calculate net amount.
Prepare model prediction output for SFTP delivery.
```

## 6. Existing Transformations

Use the `Existing` dropdown to load an existing transformation.

Options:

- `New transformation`: start a new draft.
- Existing transformation name/version/status: edit or inspect saved work.

Status values:

- `draft`: saved but not available for pipeline attachment.
- `published`: available in the pipeline transformation dropdown.

## 7. Step Canvas Basics

The step canvas contains transformation cards.

Each card has:

- Step number.
- Step name.
- Enabled toggle.
- Step configuration form.
- Step note.
- Move up.
- Move down.
- Duplicate.
- Delete.

Use `+ Add Step` to add a new step.

Default steps:

1. Select Columns
2. Rename Columns
3. Change Data Type
4. Fill Null Values
5. Add Derived Column
6. Filter Rows
7. Remove Duplicates

Sort Rows can be added manually.

## 8. Recommended Step Order

Use this order unless there is a specific business reason to do otherwise:

1. Select Columns
2. Rename Columns
3. Change Data Type
4. Fill Null Values
5. Add Derived Column
6. Filter Rows
7. Remove Duplicates
8. Sort Rows

Why order matters:

- Select Columns removes fields. Later steps cannot use removed fields.
- Rename Columns changes field names. Later steps must use the new names.
- Change Data Type should happen before numeric/date filters.
- Fill Null Values should happen before derived calculations when nulls could break output quality.
- Derived Columns should happen before filtering when the filter uses the derived field.
- Sort should usually be last.

Example:

If Step 2 renames:

```text
source_month -> month
```

Then Step 3, Step 4, and later steps must refer to:

```text
month
```

Not:

```text
source_month
```

## 9. Select Columns

Purpose:

- Keep only required source columns.
- Remove unwanted columns early.
- Reduce transformation complexity.

UI:

- Column chips.
- Click a chip to select or unselect it.

Example:

Select:

```text
customer_id
full_name
mobile_no
dob
amount
discount
city
created_at
```

Rules:

- At least one existing column must be selected.
- Select every column needed by later steps.
- If a later step references an unselected column, validation fails.

Common mistake:

You select only:

```text
customer_id
amount
```

Then a later derived column uses:

```text
discount
```

Validation error:

```text
Step 5 Add Derived Column references missing columns: discount
```

Fix:

- Add `discount` to Select Columns, or remove `discount` from the later formula.

## 10. Rename Columns

Purpose:

- Standardize output names.
- Match destination column names.
- Make business names easier to understand.

UI:

- `Source column`
- `New column name`
- `Add mapping`
- `Delete`

Example mappings:

```text
full_name -> customer_name
mobile_no -> phone_number
amount -> gross_amount
created_at -> source_created_at
```

Rules:

- Source column must exist at that point in the step order.
- New column name must not duplicate another output column.
- Later steps must use renamed column names.

Good naming:

- Use lowercase snake case.
- Avoid spaces.
- Avoid special characters.

Good:

```text
customer_name
gross_amount
source_created_at
```

Avoid:

```text
Customer Name
Gross Amount (INR)
created-at
```

## 11. Change Data Type

Purpose:

- Convert fields into the right type before loading or filtering.
- Clean source values from CSV, database, or mixed inputs.

UI:

- Column dropdown.
- Type dropdown.
- `Add cast`.
- `Delete`.

Supported target types:

```text
string
integer
float
boolean
date
datetime
```

Examples:

```text
customer_id -> integer
amount -> float
discount -> float
dob -> date
created_at -> datetime
is_active -> boolean
```

Backend behavior:

- `integer`: non-numeric values become null.
- `float`: non-numeric values become null.
- `boolean`: accepts values like `1`, `0`, `true`, `false`, `yes`, `no`.
- `date`: parses date and keeps date part.
- `datetime`: parses full date/time.
- `string`: converts to string type.

Common mistake:

Filtering `amount > 0` before casting `amount` to float can produce wrong results if `amount` arrives as text.

Recommended:

1. Cast `amount` to `float`.
2. Then filter `amount greater than 0`.

## 12. Fill Null Values

Purpose:

- Replace nulls before loading.
- Prevent destination failures.
- Make downstream reporting cleaner.

UI:

- Column dropdown.
- Strategy dropdown.
- Fixed value input.
- `Add fill`.

Strategies:

```text
fixed
empty string
zero
forward fill
backward fill
```

Examples:

```text
city -> fixed -> UNKNOWN
failed_reason -> empty string
amount -> zero
status -> fixed -> ACTIVE
```

Strategy behavior:

- `fixed`: fills nulls with the value entered.
- `empty string`: fills nulls with blank text.
- `zero`: fills nulls with `0`.
- `forward fill`: uses the previous row value.
- `backward fill`: uses the next row value.

Guidance:

- Use `zero` only for numeric columns.
- Use `empty string` for optional text fields.
- Use `fixed` for controlled business defaults.
- Avoid forward/backward fill unless row order has meaning.

## 13. Add Derived Column

Purpose:

- Create a new output column from existing columns or constants.

UI:

- Output column.
- Operand 1 type: `Column` or `Constant`.
- Operand 1 value.
- Operator.
- Operand 2 type: `Column` or `Constant`.
- Operand 2 value.

Supported operators:

```text
+
-
*
/
```

The `+` operator can be used for text or numeric addition depending on values.

Examples:

Net amount:

```text
output column: net_amount
operand 1: column amount
operator: -
operand 2: column discount
```

Amount in INR from USD:

```text
output column: amount_inr
operand 1: column amount_usd
operator: *
operand 2: constant 83
```

Full name:

```text
output column: full_name
operand 1: column first_name
operator: +
operand 2: column last_name
```

Important:

- Raw Python is not exposed.
- Advanced arbitrary expressions are not supported in the current MVP.
- For arithmetic, cast numeric columns before deriving.
- Division by zero becomes null.

Common mistake:

Creating:

```text
net_amount = amount - discount
```

but `amount` and `discount` are still strings.

Fix:

1. Add Change Data Type step before derived column.
2. Cast both fields to `float`.

## 14. Filter Rows

Purpose:

- Keep only records that match business rules.

UI:

- Join: `AND` or `OR`.
- Column.
- Operator.
- Value.
- `Add condition`.
- `Delete`.

Supported operators:

```text
equals
not equals
greater than
less than
contains
starts with
is null
is not null
in list
```

Examples:

Keep positive amount:

```text
amount greater than 0
```

Keep valid city:

```text
city is not null
```

Keep active statuses:

```text
status in list ACTIVE, CLOSED
```

Keep customer names starting with A:

```text
customer_name starts with A
```

Join behavior:

- `AND`: all conditions must be true.
- `OR`: at least one condition must be true.

Example with AND:

```text
amount greater than 0
AND
city is not null
AND
status in list ACTIVE, CLOSED
```

Example with OR:

```text
status equals ACTIVE
OR
status equals CLOSED
```

Notes:

- `greater than` and `less than` treat values as numbers.
- `contains` and `starts with` treat values as text.
- `in list` expects comma-separated values.

## 15. Remove Duplicates

Purpose:

- Remove duplicate rows before loading.
- Keep one record by a selected key.

UI:

- Column chips.
- Keep selector: `First` or `Last`.

Examples:

Deduplicate customers:

```text
columns: customer_id
keep: Last
```

Deduplicate payments:

```text
columns: payment_id
keep: First
```

Deduplicate by composite key:

```text
columns: customer_id, source_month
keep: Last
```

Rules:

- If no subset column is selected, the backend checks duplicate rows across all columns.
- If subset columns are selected, duplicates are based only on those columns.

## 16. Sort Rows

Purpose:

- Order output before loading or file writing.

UI:

- Column dropdown.
- Ascending selector.

Examples:

Sort newest first:

```text
created_at descending
```

Sort customer ID ascending:

```text
customer_id ascending
```

Guidance:

- Put Sort Rows near the end.
- Cast date/datetime columns before sorting dates.

## 17. Step Notes

Every step has a `Step note`.

Use notes to explain business reason.

Good examples:

```text
Keep only fields required by customer master destination.
Rename to match destination table contract.
Remove failed prediction rows before SFTP delivery.
```

Benefits:

- Easier handover.
- Easier audit.
- Easier debugging during production support.

## 18. Preview Transformation

Click:

```text
Preview
```

Preview saves the draft first for admins, then runs a sample through the transformation engine.

Preview controls:

- Sample size: `20`, `50`, `100`.
- Until step: `All steps` or a selected step.
- Tabs: `Input`, `Output`, `Validation`, `Notes`.

Use cases:

- Preview all steps to check final output.
- Preview until Step 3 to debug type conversion.
- Preview until Step 5 to check derived column logic.

Preview output shows:

- Input row count.
- Output row count.
- Added columns.
- Removed columns.
- Preview table.
- Execution notes.

Execution note examples:

```text
Step 1 Select Columns applied
Step 2 Rename Columns applied
Step 3 Change Data Type applied
Step 4 Fill Null Values applied
```

## 19. Validate Transformation

Click:

```text
Validate
```

Validation checks:

- Missing referenced columns.
- Duplicate output column names.
- Risky step ordering.
- Destination-required columns when destination schema is available.

Validation examples:

```text
Error: Step 3 Change Data Type references missing columns: source_month
```

Meaning:

- `source_month` was removed or renamed before Step 3.

Fix:

- If Select Columns removed it, add `source_month` back.
- If Rename Columns changed it to `month`, use `month` in Step 3.

Another example:

```text
Error: Destination requires missing columns: source_month, status
```

Meaning:

- Destination schema expects these columns but the final transformation output does not include them.

Fix:

- Add them in Select Columns, or
- Rename output columns to match destination, or
- Add derived/default columns if needed.

Warning example:

```text
Warning: Change Data Type appears after Filter Rows; verify step order
```

Meaning:

- The order may still work, but the filter might be using unconverted data.

## 20. Save Draft

Click:

```text
Save Draft
```

Use draft when:

- Work is incomplete.
- You want to preview later.
- You do not want pipelines to use this transformation yet.

Draft transformations do not appear in the pipeline transformation dropdown.

## 21. Publish Transformation

Click:

```text
Publish
```

Publish after:

1. Preview output looks correct.
2. Validation has no errors.
3. Destination columns are correct.
4. Step notes are clear.

Published transformations appear in:

```text
Pipelines -> Transformation dropdown
```

Version behavior:

- A transformation has a version number.
- Publishing makes the transformation available for pipeline use.
- Future versions can be selected or pinned in pipeline design.

## 22. Attach Transformation to Pipeline

Open:

```text
Pipelines
```

Steps:

1. Enter pipeline name.
2. Select datasource.
3. Select destination.
4. Select published transformation.
5. Select transformation version.
6. Enter schedule if needed.
7. Click `Save pipeline` or `Update pipeline`.

Pipeline route preview shows:

```text
source -> transformation -> destination
```

Important:

- Only published transformations are available.
- If transformation dropdown is empty, publish the transformation first.
- If editing a pipeline, use `Update pipeline`, not `Save pipeline`.

## 23. Run and Check Logs

Open:

```text
Runs & Logs
```

Manual run:

1. Open `Pipelines`.
2. Click `Run`.
3. Open `Runs & Logs`.
4. Select the latest run.
5. Read the step logs.

Logs show:

- Run started.
- Extract count.
- Step-by-step transformation messages.
- Load count.
- Success or failure.

Example:

```text
INFO Run started for pipeline Customer pipeline
INFO Extracted 1250 rows
INFO Step 1 Select Columns applied
INFO Step 2 Rename Columns applied
INFO Step 3 Change Data Type applied
INFO Step 4 Fill Null Values applied
INFO Final output rows: 1148
INFO Run succeeded, wrote 1148 rows
```

## 24. Full Example: Customer Cleanup

Goal:

Clean raw customer data and load it into `customer_master`.

Source fields:

```text
customer_id
full_name
mobile_no
dob
amount
discount
city
status
created_at
```

Destination fields:

```text
customer_id
customer_name
mobile_number
dob
net_amount
city
status
source_created_at
```

Steps:

1. Select Columns
2. Rename Columns
3. Change Data Type
4. Fill Null Values
5. Add Derived Column
6. Filter Rows
7. Remove Duplicates
8. Sort Rows

Step 1 Select Columns:

```text
customer_id
full_name
mobile_no
dob
amount
discount
city
status
created_at
```

Step 2 Rename Columns:

```text
full_name -> customer_name
mobile_no -> mobile_number
created_at -> source_created_at
```

Step 3 Change Data Type:

```text
customer_id -> integer
dob -> date
amount -> float
discount -> float
source_created_at -> datetime
```

Step 4 Fill Null Values:

```text
city -> fixed -> UNKNOWN
status -> fixed -> ACTIVE
discount -> zero
```

Step 5 Add Derived Column:

```text
net_amount = amount - discount
```

Step 6 Filter Rows:

```text
net_amount greater than 0
AND
customer_id is not null
```

Step 7 Remove Duplicates:

```text
columns: customer_id
keep: Last
```

Step 8 Sort Rows:

```text
customer_id ascending
```

Then:

1. Click `Preview`.
2. Review output columns.
3. Click `Validate`.
4. Fix any errors.
5. Click `Save Draft`.
6. Click `Publish`.
7. Attach to pipeline.

## 25. Full Example: Prediction Output Cleanup

Goal:

Prepare model prediction results for SFTP delivery.

Source fields:

```text
audit_id
audit_key
audit_value
model_name
source_month
prediction_completed_count
prediction_failed_count
failed_reason
duration
prediction_table
prediction_file
created_at
modified_at
created_by
```

Recommended steps:

1. Select Columns
2. Rename Columns
3. Change Data Type
4. Fill Null Values
5. Filter Rows
6. Sort Rows

Step 1 Select Columns:

```text
audit_id
audit_key
audit_value
model_name
source_month
prediction_completed_count
prediction_failed_count
failed_reason
duration
prediction_file
created_at
```

Step 2 Rename Columns:

```text
source_month -> month
prediction_completed_count -> completed_count
prediction_failed_count -> failed_count
prediction_file -> output_file
created_at -> run_created_at
```

Step 3 Change Data Type:

```text
audit_id -> integer
completed_count -> integer
failed_count -> integer
duration -> float
run_created_at -> datetime
```

Step 4 Fill Null Values:

```text
failed_reason -> empty string
failed_count -> zero
```

Step 5 Filter Rows:

```text
completed_count greater than 0
AND
output_file is not null
```

Step 6 Sort Rows:

```text
run_created_at descending
```

Important:

- After renaming `source_month` to `month`, later steps must use `month`.
- If destination expects `source_month`, either do not rename it or map it back before publishing.

## 26. Troubleshooting

### Connection failed to wrong host

Symptom:

```text
connection to server at "10.10.0.10", port 5432 failed
```

Fix:

1. Open `Data Source`.
2. Edit the datasource.
3. Confirm host comes from `.env`, usually `10.1.1.45`.
4. Save datasource.
5. Open `Transform`.
6. Reload source schema.

### Missing column after rename

Symptom:

```text
Step 3 Change Data Type references missing columns: source_month
```

Fix:

- Use the renamed column in Step 3, or move Change Data Type before Rename Columns.

### Destination requires missing columns

Symptom:

```text
Destination requires missing columns: source_month, status
```

Fix:

- Add missing columns in Select Columns.
- Rename columns to destination-required names.
- Add derived/default columns.
- Confirm destination table schema.

### Derived column output is blank/null

Possible causes:

- Numeric columns were not cast before arithmetic.
- Operand column was removed by Select Columns.
- Operand column was renamed, but formula still uses old name.
- Division by zero occurred.

Fix:

1. Preview until the step before Add Derived Column.
2. Confirm operands exist.
3. Cast operands to numeric.
4. Preview again.

### Filter removes too many rows

Possible causes:

- Wrong join type: AND instead of OR.
- Numeric value is text and needs cast.
- `in list` values are misspelled.
- Nulls were not filled before filtering.

Fix:

1. Preview until the step before Filter Rows.
2. Change sample size to 100.
3. Check actual values.
4. Adjust condition or cast/fill before filter.

### Publish button not visible

Cause:

- Current user is not admin.

Fix:

- Login as admin.
- Ask admin to publish transformation.

## 27. Best Practices

Use these rules for production-minded transformations:

- Keep step names as the standard labels.
- Add meaningful step notes.
- Select only needed columns.
- Rename early.
- Cast before numeric/date filtering.
- Fill nulls before derived calculations.
- Preview after every major change.
- Validate before every publish.
- Publish only when destination schema matches output.
- Attach only published transformations to pipelines.
- Check Runs & Logs after first production run.

## 28. Pre-Publish Checklist

Before clicking `Publish`, confirm:

- Source schema loads successfully.
- Destination schema loads successfully.
- Select Columns includes all required fields.
- Rename Columns does not create duplicate names.
- Type casts are correct.
- Null handling matches business rules.
- Derived columns have correct formulas.
- Filters do not remove valid rows.
- Deduplication key is correct.
- Sort order is intentional.
- Preview output row count is expected.
- Validation has no errors.
- Step notes explain important business rules.

