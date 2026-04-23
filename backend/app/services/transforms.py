from dataclasses import dataclass, field
from time import perf_counter
from typing import Any

import pandas as pd


STEP_ORDER = {
    "select": 1,
    "rename": 2,
    "cast": 4,
    "fillna": 5,
    "derive": 6,
    "filter": 7,
    "deduplicate": 8,
    "sort": 9,
}


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


class TransformationExecutor:
    def run(self, rows: list[dict[str, Any]], steps: list[dict[str, Any]]) -> TransformResult:
        df = pd.DataFrame(rows)
        input_columns = list(df.columns)
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
        records = df.where(pd.notnull(df), None).to_dict(orient="records")
        output_columns = list(df.columns)
        return TransformResult(
            rows=records,
            logs=logs,
            warnings=warnings,
            changed_columns={
                "added": [col for col in output_columns if col not in input_columns],
                "removed": [col for col in input_columns if col not in output_columns],
                "kept": [col for col in output_columns if col in input_columns],
            },
        )

    def apply_step(self, df: pd.DataFrame, step: dict[str, Any]) -> pd.DataFrame:
        step_type = step["step_type"]
        params = step["parameters"]
        if step_type == "select":
            return self.apply_select(df, params)
        if step_type == "rename":
            return self.apply_rename(df, params)
        if step_type == "cast":
            return self.apply_cast(df, params)
        if step_type == "fillna":
            return self.apply_fillna(df, params)
        if step_type == "derive":
            return self.apply_derive(df, params)
        if step_type == "filter":
            return self.apply_filter(df, params)
        if step_type == "deduplicate":
            return self.apply_deduplicate(df, params)
        if step_type == "sort":
            return self.apply_sort(df, params)
        raise ValueError(f"Unsupported step type: {step_type}")

    def apply_select(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        columns = [col for col in params.get("columns", []) if col in df.columns]
        if not columns:
            raise ValueError("Select Columns requires at least one existing column")
        return df.loc[:, columns].copy()

    def apply_rename(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        mapping = {item["source"]: item["target"] for item in params.get("mappings", []) if item.get("source") and item.get("target")}
        duplicates = [target for target in mapping.values() if list(mapping.values()).count(target) > 1]
        if duplicates:
            raise ValueError(f"Duplicate destination columns: {', '.join(sorted(set(duplicates)))}")
        return df.rename(columns=mapping)

    def apply_cast(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        result = df.copy()
        for item in params.get("casts", []):
            column = item.get("column")
            target_type = item.get("type")
            if column not in result.columns:
                raise ValueError(f"Unknown column {column}")
            result[column] = _cast_series(result[column], target_type)
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
            raise ValueError("Derived column needs output column")
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

    def apply_deduplicate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        subset = [col for col in params.get("columns", []) if col in df.columns]
        keep = params.get("keep", "first")
        return df.drop_duplicates(subset=subset or None, keep=keep)

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
        if missing:
            errors.append(f"Step {index} {step['step_name']} references missing columns: {', '.join(missing)}")
        if step_type == "select" and params.get("columns"):
            current = [col for col in params["columns"] if col in current]
        elif step_type == "rename":
            mapping = {item["source"]: item["target"] for item in params.get("mappings", []) if item.get("source") and item.get("target")}
            current = [mapping.get(col, col) for col in current]
            if len(current) != len(set(current)):
                errors.append(f"Step {index} creates duplicate output column names")
        elif step_type == "derive" and params.get("output_column"):
            if params["output_column"] not in current:
                current.append(params["output_column"])
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
        raise ValueError("Raw Python transforms are disabled. Use UI-derived formula steps.")
    raise ValueError(f"Unsupported step type: {kind}")


def human_step_name(step_type: str) -> str:
    return {
        "select": "Select Columns",
        "rename": "Rename Columns",
        "cast": "Change Data Type",
        "fillna": "Fill Null Values",
        "derive": "Add Derived Column",
        "filter": "Filter Rows",
        "deduplicate": "Remove Duplicates",
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
    if step["step_type"] == "cast":
        return {item.get("column") for item in params.get("casts", []) if item.get("column")}
    if step["step_type"] == "fillna":
        return {item.get("column") for item in params.get("fills", []) if item.get("column")}
    if step["step_type"] == "derive":
        return {operand.get("value") for operand in (params.get("left", {}), params.get("right", {})) if operand.get("kind") == "column"}
    if step["step_type"] == "filter":
        return {item.get("column") for item in params.get("conditions", []) if item.get("column")}
    if step["step_type"] == "deduplicate":
        return set(params.get("columns", []))
    if step["step_type"] == "sort":
        return {params.get("column")} if params.get("column") else set()
    return set()


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


def _cast_series(series: pd.Series, target_type: Any) -> pd.Series:
    if target_type == "integer":
        return pd.to_numeric(series, errors="coerce").astype("Int64")
    if target_type == "float":
        return pd.to_numeric(series, errors="coerce")
    if target_type == "boolean":
        return series.map(_to_bool)
    if target_type == "date":
        return pd.to_datetime(series, errors="coerce").dt.date
    if target_type == "datetime":
        return pd.to_datetime(series, errors="coerce")
    if target_type == "string":
        return series.astype("string")
    raise ValueError(f"Unsupported cast type {target_type}")


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
