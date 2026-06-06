import json
from dataclasses import dataclass, field
from datetime import date, datetime
from time import perf_counter
from typing import Any

import numpy as np
import pandas as pd

from app.core.config import get_settings
from app.services.pii import encrypt_value, mask_value


STEP_ORDER = {
    "select": 1,
    "rename": 2,
    "join": 3,
    "cast": 4,
    "validate": 5,
    "pii_encrypt": 6,
    "fillna": 7,
    "derive": 8,
    "blank_columns": 9,
    "filter": 10,
    "value_map": 11,
    "groupby": 12,
    "pivot": 13,
    "custom": 14,
    "deduplicate": 15,
    "reorder": 16,
    "sort": 17,
}

INTERNAL_ROW_ID = "__mobiflow_original_row_id"
ALLOWED_CUSTOM_IMPORTS = {"datetime", "math", "numpy", "pandas", "re", "time"}


def _safe_custom_import(name: str, globals: dict[str, Any] | None = None, locals: dict[str, Any] | None = None, fromlist: tuple[Any, ...] = (), level: int = 0) -> Any:
    root = name.split(".", 1)[0]
    if root not in ALLOWED_CUSTOM_IMPORTS:
        raise ImportError(f"Import {name} is not allowed in Custom Transform")
    return __import__(name, globals, locals, fromlist, level)


@dataclass
class StepLog:
    level: str
    message: str
    records_before: int
    records_after: int
    duration_ms: int
    step_id: str | None = None


@dataclass
class TransformResult:
    rows: list[dict[str, Any]]
    logs: list[StepLog] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    changed_columns: dict[str, list[str]] = field(default_factory=dict)
    rejected_rows: list[dict[str, Any]] = field(default_factory=list)


class RejectionHandler:
    def __init__(self, original_rows: list[dict[str, Any]]):
        self.original_rows = {index: _clean_record(row) for index, row in enumerate(original_rows)}
        self.rows: list[dict[str, Any]] = []

    def attach_tracking(self, df: pd.DataFrame) -> pd.DataFrame:
        if df.empty:
            return df
        tracked = df.copy()
        tracked[INTERNAL_ROW_ID] = list(range(len(tracked)))
        return tracked

    def reject_rows(self, rows: pd.DataFrame, step_name: str, column: str, reason: str) -> None:
        for raw_row in rows.to_dict(orient="records"):
            row = {key: _clean_value(value) for key, value in raw_row.items()}
            row_id = row.pop(INTERNAL_ROW_ID, None)
            original = self._original_record(row_id, row)
            rejected = dict(original)
            rejected.update(
                {
                    "_rejected_step": step_name,
                    "_rejected_column": column,
                    "_rejected_reason": reason,
                    "_original_record": json.dumps(original, separators=(",", ":"), default=str),
                }
            )
            self.rows.append(rejected)

    def reject_validation_rows(self, rows: pd.DataFrame, step_name: str, errors_by_index: dict[Any, list[dict[str, str]]]) -> None:
        for index, raw_row in rows.to_dict(orient="index").items():
            row = {key: _clean_value(value) for key, value in raw_row.items()}
            row_id = row.pop(INTERNAL_ROW_ID, None)
            original = self._original_record(row_id, row)
            errors = errors_by_index.get(index, [])
            rejected = dict(original)
            rejected.update(
                {
                    "_rejected_stage": "validation",
                    "_rejected_step": step_name,
                    "_rejected_column": ",".join(dict.fromkeys(error["column"] for error in errors)),
                    "_rejected_reason": "; ".join(error["reason"] for error in errors),
                    "_rejected_errors": json.dumps(errors, separators=(",", ":"), default=str),
                    "_original_record": json.dumps(original, separators=(",", ":"), default=str),
                }
            )
            self.rows.append(rejected)

    def _original_record(self, row_id: Any, fallback: dict[str, Any]) -> dict[str, Any]:
        try:
            key = int(row_id)
        except (TypeError, ValueError):
            key = None
        if key is not None and key in self.original_rows:
            return self.original_rows[key]
        return _clean_record(fallback)


class TransformationExecutor:
    def run(self, rows: list[dict[str, Any]], steps: list[dict[str, Any]]) -> TransformResult:
        df = pd.DataFrame(rows)
        input_columns = list(df.columns)
        self.rejections = RejectionHandler(rows)
        df = self.rejections.attach_tracking(df)
        logs: list[StepLog] = []
        warnings: list[str] = []
        for index, step in enumerate(steps, start=1):
            normalized = normalize_step(step, index)
            if not normalized.get("is_enabled", True):
                logs.append(StepLog("INFO", f"Step {index} {normalized['step_name']} skipped", len(df), len(df), 0, normalized["id"]))
                continue
            before = len(df)
            start = perf_counter()
            try:
                df = self.apply_step(df, normalized)
            except Exception as exc:
                raise ValueError(f"Step {index} {normalized['step_name']} failed: {exc}") from exc
            duration_ms = int((perf_counter() - start) * 1000)
            logs.append(
                StepLog(
                    "INFO",
                    f"Step {index} {normalized['step_name']} applied",
                    before,
                    len(df),
                    duration_ms,
                    normalized["id"],
                )
            )
            warnings.extend(validate_step_order(normalized, steps[: index - 1]))
        output_df = _drop_internal_columns(df)
        records = _records_from_frame(output_df)
        output_columns = list(output_df.columns)
        return TransformResult(
            rows=records,
            logs=logs,
            warnings=warnings,
            changed_columns={
                "added": [col for col in output_columns if col not in input_columns],
                "removed": [col for col in input_columns if col not in output_columns],
                "kept": [col for col in output_columns if col in input_columns],
            },
            rejected_rows=self.rejections.rows,
        )

    def apply_step(self, df: pd.DataFrame, step: dict[str, Any]) -> pd.DataFrame:
        step_type = step["step_type"]
        params = step["parameters"]
        if step_type == "select":
            return self.apply_select(df, params)
        if step_type == "rename":
            return self.apply_rename(df, params)
        if step_type == "join":
            return self.apply_join(df, params)
        if step_type == "cast":
            return self.apply_cast(df, params)
        if step_type == "validate":
            return self.apply_validate(df, step)
        if step_type == "pii_encrypt":
            return self.apply_pii_encrypt(df, params)
        if step_type == "fillna":
            return self.apply_fillna(df, params)
        if step_type == "derive":
            return self.apply_derive(df, params)
        if step_type == "blank_columns":
            return self.apply_blank_columns(df, params)
        if step_type == "filter":
            return self.apply_filter(df, params)
        if step_type == "value_map":
            return self.apply_value_map(df, params)
        if step_type == "groupby":
            return self.apply_groupby(df, params)
        if step_type == "pivot":
            return self.apply_pivot(df, params)
        if step_type == "custom":
            return self.apply_custom(df, params)
        if step_type == "deduplicate":
            return self.apply_deduplicate(df, params)
        if step_type == "reorder":
            return self.apply_reorder(df, params)
        if step_type == "sort":
            return self.apply_sort(df, params)
        raise ValueError(f"Unsupported step type: {step_type}")

    def apply_select(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        columns = [col for col in params.get("columns", []) if col in df.columns]
        if not columns:
            return df
        if INTERNAL_ROW_ID in df.columns and INTERNAL_ROW_ID not in columns:
            columns.append(INTERNAL_ROW_ID)
        return df.loc[:, columns].copy()

    def apply_rename(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        mapping = {item["source"]: item["target"] for item in params.get("mappings", []) if item.get("source") and item.get("target")}
        duplicates = [target for target in mapping.values() if list(mapping.values()).count(target) > 1]
        if duplicates:
            raise ValueError(f"Duplicate destination columns: {', '.join(sorted(set(duplicates)))}")
        return df.rename(columns=mapping)

    def apply_join(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        right_rows = params.get("right_rows") or []
        if not isinstance(right_rows, list):
            raise ValueError("Join needs right rows")
        right = pd.DataFrame(right_rows)
        if right.empty:
            raise ValueError("Join source returned no rows")
        left_key = params.get("left_key")
        right_key = params.get("right_key")
        if left_key not in df.columns:
            raise ValueError(f"Unknown left join column {left_key}")
        if right_key not in right.columns:
            raise ValueError(f"Unknown right join column {right_key}")
        how = params.get("join_type", "left")
        if how not in {"left", "inner", "right", "outer"}:
            raise ValueError(f"Unsupported join type {how}")
        keep_columns = [col for col in params.get("right_columns", []) if col in right.columns and col != right_key]
        right_frame = right[[right_key, *keep_columns]].copy() if keep_columns else right.copy()
        suffix = params.get("suffix") or "_right"
        return df.merge(right_frame, how=how, left_on=left_key, right_on=right_key, suffixes=("", suffix))

    def apply_cast(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        result = df.copy()
        for item in params.get("casts", []):
            column = item.get("column")
            target_type = item.get("type")
            date_format = item.get("format")
            if column not in result.columns:
                raise ValueError(f"Unknown column {column}")
            converted = _cast_series(result[column], target_type, date_format)
            invalid = _invalid_cast_mask(result[column], converted, target_type)
            if invalid.any():
                failed = result.loc[invalid].copy()
                self.rejections.reject_rows(failed, "Change Data Type", str(column), f"Invalid {target_type} value")
                result = result.loc[~invalid].copy()
                converted = converted.loc[result.index]
            result[column] = converted
        return result

    def apply_validate(self, df: pd.DataFrame, step: dict[str, Any]) -> pd.DataFrame:
        rules = step["parameters"].get("rules") or step["parameters"].get("validations") or []
        if not isinstance(rules, list) or not rules:
            return df
        errors_by_index: dict[Any, list[dict[str, str]]] = {}
        for rule in rules:
            if not isinstance(rule, dict):
                continue
            column = str(rule.get("column") or "").strip()
            rule_type = str(rule.get("type") or rule.get("rule") or "none").strip().lower()
            if rule_type in {"", "none"}:
                continue
            if column not in df.columns:
                raise ValueError(f"Unknown validation column {column}")
            for index, value in df[column].items():
                reason = _validation_error(value, rule_type, rule)
                if reason:
                    errors_by_index.setdefault(index, []).append({"column": column, "rule": rule_type, "reason": reason})
        if not errors_by_index:
            return df
        rejected = df.loc[list(errors_by_index.keys())].copy()
        self.rejections.reject_validation_rows(rejected, step["step_name"], errors_by_index)
        return df.drop(index=list(errors_by_index.keys())).copy()

    def apply_pii_encrypt(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        columns = params.get("columns") or []
        if isinstance(columns, str):
            columns = _split_column_names(columns)
        selected = [str(column).strip() for column in columns if str(column).strip()]
        if not selected:
            return df
        missing = [column for column in selected if column not in df.columns]
        if missing:
            raise ValueError(f"Unknown PII column(s): {', '.join(missing)}")
        mode = str(params.get("mode") or "encrypt").strip().lower()
        key_id = str(params.get("key_id") or "default").strip() or "default"
        result = df.copy()
        for column in selected:
            if mode == "mask":
                result[column] = result[column].map(mask_value)
            else:
                result[column] = result[column].map(lambda value: encrypt_value(value, key_id))
        return result

    def apply_fillna(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        result = df.copy()
        for item in params.get("fills", []):
            column = item.get("column")
            strategy = item.get("strategy")
            if column not in result.columns:
                raise ValueError(f"Unknown column {column}")
            if strategy == "fixed":
                result[column] = result[column].fillna(item.get("value"))
            elif strategy == "empty_string":
                result[column] = result[column].fillna("")
            elif strategy == "zero":
                result[column] = result[column].fillna(0)
            elif strategy == "forward_fill":
                result[column] = result[column].ffill()
            elif strategy == "backward_fill":
                result[column] = result[column].bfill()
            else:
                raise ValueError(f"Unsupported fill strategy {strategy}")
        return result

    def apply_derive(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        result = df.copy()
        output_column = params.get("output_column")
        if not output_column:
            return result
        left = _operand_value(result, params.get("left", {}))
        right = _operand_value(result, params.get("right", {}))
        operator = params.get("operator")
        if operator == "+":
            result[output_column] = left + right
        elif operator == "-":
            result[output_column] = pd.to_numeric(left, errors="coerce") - pd.to_numeric(right, errors="coerce")
        elif operator == "*":
            result[output_column] = pd.to_numeric(left, errors="coerce") * pd.to_numeric(right, errors="coerce")
        elif operator == "/":
            result[output_column] = pd.to_numeric(left, errors="coerce") / pd.to_numeric(right, errors="coerce").replace(0, pd.NA)
        else:
            raise ValueError(f"Unsupported formula operator {operator}")
        output_type = params.get("output_type")
        if output_type:
            result[output_column] = _cast_series(result[output_column], output_type)
        return result

    def apply_blank_columns(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        result = df.copy()
        column_items = params.get("columns", [])
        if isinstance(column_items, str):
            column_items = _split_column_names(column_items)
        for item in column_items:
            if isinstance(item, str):
                name = item.strip()
                value_type = "empty_string"
                value = ""
            else:
                name = str(item.get("name") or "").strip()
                value_type = item.get("value_type", "empty_string")
                value = item.get("value", "")
            if not name:
                continue
            if name in result.columns and not params.get("override_existing", False):
                continue
            if value_type == "null":
                result[name] = None
            elif value_type == "custom":
                result[name] = value
            else:
                result[name] = ""
        return result

    def apply_filter(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        conditions = params.get("conditions", [])
        joiner = params.get("joiner", "and")
        if not conditions:
            return df
        masks = [_condition_mask(df, condition) for condition in conditions]
        mask = masks[0]
        for next_mask in masks[1:]:
            mask = mask | next_mask if joiner == "or" else mask & next_mask
        return df.loc[mask].copy()

    def apply_value_map(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        result = df.copy()
        column = params.get("column")
        output_column = params.get("output_column") or column
        if column not in result.columns:
            raise ValueError(f"Unknown column {column}")
        mappings = params.get("mappings", [])
        value_map = {str(item.get("from")): item.get("to") for item in mappings if item.get("from") is not None}
        default_value = params.get("default_value")

        def map_value(value: Any) -> Any:
            key = "" if value is None else str(value)
            if key in value_map:
                return value_map[key]
            return value if default_value in (None, "") else default_value

        result[output_column] = result[column].map(map_value)
        output_type = params.get("output_type")
        if output_type:
            result[output_column] = _cast_series(result[output_column], output_type)
        return result

    def apply_groupby(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        group_columns = [col for col in params.get("group_columns", []) if col in df.columns]
        aggregations = [item for item in params.get("aggregations", []) if item.get("column") in df.columns and item.get("function")]
        if not group_columns:
            raise ValueError("Group By needs at least one group column")
        if not aggregations:
            raise ValueError("Group By needs at least one aggregation")
        named_aggs: dict[str, tuple[str, str]] = {}
        for item in aggregations:
            func = item["function"]
            if func not in {"sum", "mean", "min", "max", "count", "count_distinct", "first", "last"}:
                raise ValueError(f"Unsupported aggregation {func}")
            output = item.get("output_column") or f"{item['column']}_{func}"
            named_aggs[output] = (item["column"], "nunique" if func == "count_distinct" else func)
        return df.groupby(group_columns, dropna=False).agg(**named_aggs).reset_index()

    def apply_pivot(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        index_columns = [col for col in params.get("index_columns", []) if col in df.columns]
        pivot_column = params.get("pivot_column")
        value_column = params.get("value_column")
        aggfunc = params.get("aggfunc", "sum")
        if not index_columns:
            raise ValueError("Pivot needs index columns")
        if pivot_column not in df.columns:
            raise ValueError(f"Unknown pivot column {pivot_column}")
        if value_column not in df.columns:
            raise ValueError(f"Unknown value column {value_column}")
        if aggfunc not in {"sum", "mean", "min", "max", "count", "count_distinct", "first"}:
            raise ValueError(f"Unsupported pivot aggregation {aggfunc}")
        source = df.copy()
        actual_value_column = value_column
        actual_aggfunc = aggfunc
        if aggfunc == "count":
            actual_value_column = "__pivot_count"
            source[actual_value_column] = 1
            actual_aggfunc = "sum"
        elif aggfunc == "count_distinct":
            actual_aggfunc = "nunique"
            if value_column in index_columns or value_column == pivot_column:
                actual_value_column = "__pivot_distinct_value"
                source[actual_value_column] = source[value_column]
        elif value_column in index_columns or value_column == pivot_column:
            actual_value_column = "__pivot_value"
            source[actual_value_column] = source[value_column]
        pivoted = pd.pivot_table(source, index=index_columns, columns=pivot_column, values=actual_value_column, aggfunc=actual_aggfunc, fill_value=params.get("fill_value", 0))
        pivoted = pivoted.reset_index()
        pivoted.columns = [str(col) for col in pivoted.columns]
        return pivoted

    def apply_custom(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        code = str(params.get("code") or "").strip()
        if not code:
            return df
        settings = get_settings()
        if settings.is_production and not settings.allow_custom_transforms:
            raise ValueError("Custom Python transforms are disabled in production. Enable MOBIFLOW_ALLOW_CUSTOM_TRANSFORMS only for trusted admins.")
        safe_builtins = {
            "abs": abs,
            "all": all,
            "any": any,
            "bool": bool,
            "dict": dict,
            "enumerate": enumerate,
            "float": float,
            "int": int,
            "len": len,
            "list": list,
            "max": max,
            "min": min,
            "range": range,
            "set": set,
            "sorted": sorted,
            "str": str,
            "sum": sum,
            "tuple": tuple,
            "zip": zip,
            "__import__": _safe_custom_import,
        }
        scope: dict[str, Any] = {"__builtins__": safe_builtins, "date": date, "datetime": datetime, "pd": pd, "np": np, "df": df.copy()}
        exec(code, scope, scope)
        result = scope.get("result")
        transform = scope.get("transform")
        if callable(transform):
            result = transform(df.copy())
        if result is None:
            raise ValueError("Custom Transform must define transform(df) returning a DataFrame or assign result = df")
        if not isinstance(result, pd.DataFrame):
            raise ValueError("Custom Transform must return a pandas DataFrame")
        return result

    def apply_deduplicate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        subset = [col for col in params.get("columns", []) if col in df.columns]
        keep = params.get("keep", "first")
        return df.drop_duplicates(subset=subset or None, keep=keep)

    def apply_reorder(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        selected = [col for col in params.get("columns", []) if col in df.columns]
        include_unlisted = params.get("include_unlisted", True)
        remaining = [col for col in df.columns if col not in selected] if include_unlisted else []
        ordered = [*selected, *remaining]
        return df.loc[:, ordered].copy() if ordered else df.copy()

    def apply_sort(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        column = params.get("column")
        if column not in df.columns:
            raise ValueError(f"Unknown column {column}")
        return df.sort_values(by=column, ascending=bool(params.get("ascending", True)))



def apply_transforms(rows: list[dict[str, Any]], transforms: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return TransformationExecutor().run(rows, transforms).rows


def preview_transforms(rows: list[dict[str, Any]], transforms: list[dict[str, Any]]) -> TransformResult:
    return TransformationExecutor().run(rows, transforms)


def validate_transforms(columns: list[str], steps: list[dict[str, Any]], destination_columns: list[str] | None = None) -> dict[str, list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    current = list(columns)
    for index, raw_step in enumerate(steps, start=1):
        step = normalize_step(raw_step, index)
        params = step["parameters"]
        step_type = step["step_type"]
        missing = sorted(_referenced_columns(step) - set(current))
        if missing and step_type == "select":
            warnings.append(f"Step {index} {step['step_name']} ignores missing columns: {', '.join(missing)}")
        elif missing:
            errors.append(f"Step {index} {step['step_name']} references missing columns: {', '.join(missing)}")
        if step_type == "select" and params.get("columns"):
            current = [col for col in params["columns"] if col in current]
        elif step_type == "rename":
            mapping = {item["source"]: item["target"] for item in params.get("mappings", []) if item.get("source") and item.get("target")}
            current = [mapping.get(col, col) for col in current]
            if len(current) != len(set(current)):
                errors.append(f"Step {index} creates duplicate output column names")
        elif step_type == "join":
            for column in params.get("right_columns", []):
                if column and column not in current:
                    current.append(column)
        elif step_type == "derive" and params.get("output_column"):
            if params["output_column"] not in current:
                current.append(params["output_column"])
        elif step_type == "blank_columns":
            column_items = params.get("columns", [])
            if isinstance(column_items, str):
                column_items = _split_column_names(column_items)
            for item in column_items:
                name = item.strip() if isinstance(item, str) else str(item.get("name") or "").strip()
                if name and name not in current:
                    current.append(name)
        elif step_type == "reorder" and params.get("columns"):
            selected = [col for col in params.get("columns", []) if col in current]
            remaining = [col for col in current if col not in selected] if params.get("include_unlisted", True) else []
            current = [*selected, *remaining]
        elif step_type == "value_map" and params.get("output_column"):
            if params["output_column"] not in current:
                current.append(params["output_column"])
        elif step_type == "groupby" and params.get("group_columns") and params.get("aggregations"):
            current = list(params["group_columns"])
            current.extend(item.get("output_column") or f"{item.get('column')}_{item.get('function')}" for item in params.get("aggregations", []) if item.get("column") and item.get("function"))
        elif step_type == "pivot" and params.get("index_columns"):
            current = list(params["index_columns"])
        elif step_type == "custom":
            declared_output_columns = [col for col in params.get("output_columns", []) if col]
            if declared_output_columns:
                current = declared_output_columns
            warnings.append(f"Step {index} {step['step_name']} uses custom Python; downstream column validation may be incomplete")
        warnings.extend(validate_step_order(step, steps[: index - 1]))
    if destination_columns:
        missing_destination = [col for col in destination_columns if col not in current]
        if missing_destination:
            errors.append(f"Destination requires missing columns: {', '.join(missing_destination)}")
    return {"errors": errors, "warnings": warnings}


def normalize_step(step: dict[str, Any], index: int = 1) -> dict[str, Any]:
    if "step_type" in step:
        return {
            "id": str(step.get("id") or index),
            "step_type": step["step_type"],
            "step_name": step.get("step_name") or human_step_name(step["step_type"]),
            "is_enabled": step.get("is_enabled", True),
            "parameters": step.get("parameters") or {},
        }
    kind = step.get("type")
    if kind == "select_fields":
        return _legacy(index, "select", {"columns": step.get("fields", [])})
    if kind == "rename_fields":
        return _legacy(index, "rename", {"mappings": [{"source": k, "target": v} for k, v in step.get("mapping", {}).items()]})
    if kind == "filter_equals":
        return _legacy(index, "filter", {"joiner": "and", "conditions": [{"column": step.get("field"), "operator": "equals", "value": step.get("value")}]})
    if kind == "python":
        return _legacy(index, "custom", {"code": step.get("code", "")})
    raise ValueError(f"Unsupported step type: {kind}")


def human_step_name(step_type: str) -> str:
    return {
        "select": "Select Columns",
        "rename": "Rename Columns",
        "join": "Join / Merge",
        "cast": "Change Data Type",
        "validate": "Validate Rows",
        "pii_encrypt": "Encrypt PII",
        "fillna": "Fill Null Values",
        "derive": "Add Derived Column",
        "blank_columns": "Add Blank Columns",
        "filter": "Filter Rows",
        "value_map": "Map Column Values",
        "groupby": "Group By",
        "pivot": "Pivot",
        "custom": "Custom Transform",
        "deduplicate": "Remove Duplicates",
        "reorder": "Reorder Columns",
        "sort": "Sort Rows",
    }.get(step_type, step_type.title())


def validate_step_order(step: dict[str, Any], previous: list[dict[str, Any]]) -> list[str]:
    warnings: list[str] = []
    current_rank = STEP_ORDER.get(step["step_type"], 99)
    for raw_previous in previous:
        previous_step = normalize_step(raw_previous)
        if STEP_ORDER.get(previous_step["step_type"], 0) > current_rank:
            warnings.append(f"{step['step_name']} appears after {previous_step['step_name']}; verify step order")
            break
    return warnings


def _legacy(index: int, step_type: str, parameters: dict[str, Any]) -> dict[str, Any]:
    return {"id": str(index), "step_type": step_type, "step_name": human_step_name(step_type), "is_enabled": True, "parameters": parameters}


def _referenced_columns(step: dict[str, Any]) -> set[str]:
    params = step["parameters"]
    if step["step_type"] == "select":
        return set(params.get("columns", []))
    if step["step_type"] == "rename":
        return {item.get("source") for item in params.get("mappings", []) if item.get("source")}
    if step["step_type"] == "join":
        return {params.get("left_key")} if params.get("left_key") else set()
    if step["step_type"] == "cast":
        return {item.get("column") for item in params.get("casts", []) if item.get("column")}
    if step["step_type"] == "validate":
        rules = params.get("rules") or params.get("validations") or []
        return {item.get("column") for item in rules if isinstance(item, dict) and item.get("column")}
    if step["step_type"] == "fillna":
        return {item.get("column") for item in params.get("fills", []) if item.get("column")}
    if step["step_type"] == "derive":
        return {operand.get("value") for operand in (params.get("left", {}), params.get("right", {})) if operand.get("kind") == "column"}
    if step["step_type"] == "filter":
        return {item.get("column") for item in params.get("conditions", []) if item.get("column")}
    if step["step_type"] == "reorder":
        return {column for column in params.get("columns", []) if column}
    if step["step_type"] == "value_map":
        return {params.get("column")} if params.get("column") else set()
    if step["step_type"] == "groupby":
        return set(params.get("group_columns", [])) | {item.get("column") for item in params.get("aggregations", []) if item.get("column")}
    if step["step_type"] == "pivot":
        return set(params.get("index_columns", [])) | {col for col in (params.get("pivot_column"), params.get("value_column")) if col}
    if step["step_type"] == "custom":
        return set()
    if step["step_type"] == "deduplicate":
        return set(params.get("columns", []))
    if step["step_type"] == "sort":
        return {params.get("column")} if params.get("column") else set()
    return set()


def _validation_error(value: Any, rule_type: str, rule: dict[str, Any]) -> str | None:
    if rule_type == "required":
        return None if not _is_blank(value) else "Value is required"
    if rule_type in {"not_blank", "everything_except_blank"}:
        return None if not _is_blank(value) else "Value must not be blank"
    if rule_type == "regex":
        import re

        pattern = str(rule.get("pattern") or rule.get("value") or "")
        if not pattern:
            return None
        text = "" if value is None else str(value)
        return None if re.fullmatch(pattern, text) else rule.get("message") or f"Value must match {pattern}"
    if rule_type == "numeric":
        return None if not _is_blank(value) and pd.notna(pd.to_numeric(value, errors="coerce")) else "Value must be numeric"
    if rule_type == "decimal":
        import re

        text = "" if value is None else str(value).strip()
        return None if re.fullmatch(r"[+-]?\d+(?:\.\d+)?", text) else "Value must be decimal"
    if rule_type == "integer":
        import re

        text = "" if value is None else str(value).strip()
        return None if re.fullmatch(r"[+-]?\d+", text) else "Value must be integer"
    if rule_type == "date_format":
        date_format = rule.get("format") or rule.get("value") or "dd/mm/yyyy"
        try:
            datetime.strptime(str(value), _strftime_format(date_format))
            return None
        except (TypeError, ValueError):
            return f"Expected date format {date_format}"
    if rule_type == "max_length":
        limit = int(rule.get("length") or rule.get("value") or 0)
        return None if len("" if value is None else str(value)) <= limit else f"Length must be <= {limit}"
    if rule_type == "min_length":
        limit = int(rule.get("length") or rule.get("value") or 0)
        return None if len("" if value is None else str(value)) >= limit else f"Length must be >= {limit}"
    if rule_type in {"exact_length", "length"}:
        limit = int(rule.get("length") or rule.get("value") or 0)
        return None if len("" if value is None else str(value)) == limit else f"Length must be exactly {limit}"
    if rule_type == "allowed_values":
        values = rule.get("values")
        if not isinstance(values, list):
            values = [item.strip() for item in str(rule.get("value") or "").split(",") if item.strip()]
        return None if str(value) in {str(item) for item in values} else "Value is not allowed"
    raise ValueError(f"Unsupported validation rule {rule_type}")


def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    try:
        if pd.isna(value):
            return True
    except (TypeError, ValueError):
        pass
    return str(value).strip() == ""


def _drop_internal_columns(df: pd.DataFrame) -> pd.DataFrame:
    return df.drop(columns=[INTERNAL_ROW_ID], errors="ignore")


def _records_from_frame(df: pd.DataFrame) -> list[dict[str, Any]]:
    return [_clean_record(record) for record in df.to_dict(orient="records")]


def _clean_record(record: dict[str, Any]) -> dict[str, Any]:
    return {key: _clean_value(value) for key, value in record.items() if key != INTERNAL_ROW_ID}


def _clean_value(value: Any) -> Any:
    if isinstance(value, dict):
        return _clean_record(value)
    if isinstance(value, list):
        return [_clean_value(item) for item in value]
    if isinstance(value, tuple):
        return [_clean_value(item) for item in value]
    if isinstance(value, np.generic):
        return value.item()
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


def _split_column_names(value: str) -> list[str]:
    return [item.strip() for item in value.replace("\n", ",").split(",") if item.strip()]


def _invalid_cast_mask(source: pd.Series, converted: pd.Series, target_type: Any) -> pd.Series:
    if target_type not in {"integer", "float", "boolean", "date", "datetime"}:
        return pd.Series(False, index=source.index)
    source_text = source.astype("string").str.strip()
    meaningful_source = source.notna() & source_text.ne("")
    invalid = meaningful_source & converted.isna()
    if target_type in {"date", "datetime"}:
        numeric_source = source.map(lambda value: isinstance(value, int | float) and not isinstance(value, bool))
        numeric_text = source_text.str.fullmatch(r"[+-]?\d+(?:\.0+)?", na=False)
        error_token = source_text.str.startswith("#", na=False)
        invalid = invalid | (meaningful_source & (numeric_source | numeric_text | error_token))
    return invalid


def _operand_value(df: pd.DataFrame, operand: dict[str, Any]) -> Any:
    if operand.get("kind") == "column":
        column = operand.get("value")
        if column not in df.columns:
            raise ValueError(f"Unknown column {column}")
        return df[column]
    return operand.get("value", "")


def _condition_mask(df: pd.DataFrame, condition: dict[str, Any]) -> pd.Series:
    column = condition.get("column")
    operator = condition.get("operator")
    value = condition.get("value")
    if column not in df.columns:
        raise ValueError(f"Unknown column {column}")
    series = df[column]
    if operator == "equals":
        return series == value
    if operator == "not_equals":
        return series != value
    if operator == "greater_than":
        return pd.to_numeric(series, errors="coerce") > float(value)
    if operator == "less_than":
        return pd.to_numeric(series, errors="coerce") < float(value)
    if operator == "contains":
        return series.astype("string").str.contains(str(value), na=False, regex=False)
    if operator == "like":
        return _like_mask(series, value)
    if operator == "not_like":
        return ~_like_mask(series, value)
    if operator == "starts_with":
        return series.astype("string").str.startswith(str(value), na=False)
    if operator == "is_null":
        return series.isna()
    if operator == "is_not_null":
        return series.notna()
    if operator == "in_list":
        values = [item.strip() for item in str(value).split(",") if item.strip()]
        return series.astype("string").isin(values)
    raise ValueError(f"Unsupported filter operator {operator}")


DATE_FORMATS = {
    "dd-mm-yyyy": "%d-%m-%Y",
    "dd-mm-yy": "%d-%m-%y",
    "dd/mm/yyyy": "%d/%m/%Y",
    "dd/mm/yy": "%d/%m/%y",
    "mm/dd/yyyy": "%m/%d/%Y",
    "mm/dd/yy": "%m/%d/%y",
    "mm-dd-yyyy": "%m-%d-%Y",
    "mm-dd-yy": "%m-%d-%y",
    "yyyy-mm-dd": "%Y-%m-%d",
    "yyyy/mm/dd": "%Y/%m/%d",
    "yy-mm-dd": "%y-%m-%d",
    "yy/mm/dd": "%y/%m/%d",
}


def _strftime_format(date_format: Any) -> str:
    normalized = str(date_format).replace("//", "/").lower()
    strftime_format = DATE_FORMATS.get(normalized)
    if not strftime_format:
        raise ValueError(f"Unsupported date format {date_format}")
    return strftime_format


def _cast_series(series: pd.Series, target_type: Any, date_format: Any = None) -> pd.Series:
    if target_type == "integer":
        return pd.to_numeric(series, errors="coerce").astype("Int64")
    if target_type == "float":
        return pd.to_numeric(series, errors="coerce")
    if target_type == "boolean":
        return series.map(_to_bool)
    if target_type == "date":
        parsed = _parse_datetime_series(series)
        if date_format:
            return parsed.dt.strftime(_strftime_format(date_format))
        return parsed.dt.date
    if target_type == "datetime":
        parsed = _parse_datetime_series(series)
        if date_format:
            return parsed.dt.strftime(_strftime_format(date_format))
        return parsed
    if target_type == "string":
        return series.astype("string")
    raise ValueError(f"Unsupported cast type {target_type}")


def _parse_datetime_series(series: pd.Series) -> pd.Series:
    parsed = pd.to_datetime(series, errors="coerce")
    missing = parsed.isna() & series.notna()
    if missing.any():
        parsed.loc[missing] = series.loc[missing].map(lambda value: pd.to_datetime(value, errors="coerce"))
    return parsed


def _like_mask(series: pd.Series, value: Any) -> pd.Series:
    text = str(value)
    if "%" not in text and "_" not in text:
        return series.astype("string").str.contains(text, na=False, regex=False)
    regex = "".join(".*" if char == "%" else "." if char == "_" else _escape_regex(char) for char in text)
    return series.astype("string").str.match(f"^{regex}$", na=False)


def _escape_regex(char: str) -> str:
    if char in r"\.^$*+?{}[]|()":
        return "\\" + char
    return char


def _to_bool(value: Any) -> bool | None:
    if value is None or pd.isna(value):
        return None
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in {"1", "true", "t", "yes", "y"}:
        return True
    if text in {"0", "false", "f", "no", "n"}:
        return False
    return None
