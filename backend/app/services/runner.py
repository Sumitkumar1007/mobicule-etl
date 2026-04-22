import csv
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import httpx

from app.connectors.registry import get_connector
from app.db.database import db, decode, encode
from app.services.transforms import preview_transforms

logger = logging.getLogger(__name__)
executor = ThreadPoolExecutor(max_workers=4)


def enqueue_run(pipeline_id: int) -> int:
    with db() as conn:
        row = conn.execute(
            "INSERT INTO runs (pipeline_id, status) VALUES (?, 'queued') RETURNING id",
            (pipeline_id,),
        ).fetchone()
        run_id = int(dict(row)["id"])
    executor.submit(run_pipeline, run_id)
    return run_id


def preview(source_key: str, source_config: dict[str, Any], transforms: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = extract(source_key, source_config)
    return preview_transforms(rows[:25], transforms).rows[:25]


def run_pipeline(run_id: int) -> None:
    try:
        pipeline = _load_pipeline(run_id)
        _mark_running(run_id)
        _log(run_id, "INFO", f"Run started for pipeline {pipeline['name']}")
        rows = extract(pipeline["source_key"], pipeline["source_config"])
        _update_counts(run_id, rows_read=len(rows))
        _log(run_id, "INFO", f"Extracted {len(rows)} rows")
        result = preview_transforms(rows, pipeline["transforms"])
        rows = result.rows
        for step_log in result.logs:
            _log(run_id, step_log.level, step_log.message)
            _transformation_log(run_id, step_log)
        for warning in result.warnings:
            _log(run_id, "WARNING", warning)
        _log(run_id, "INFO", f"Final output rows: {len(rows)}")
        written = load(pipeline["destination_key"], pipeline["destination_config"], rows)
        _succeed(run_id, written)
        _log(run_id, "INFO", f"Run succeeded, wrote {written} rows")
    except Exception as exc:
        logger.exception("Pipeline run failed")
        _fail(run_id, str(exc))
        _log(run_id, "ERROR", str(exc))


def extract(source_key: str, config: dict[str, Any]) -> list[dict[str, Any]]:
    connector = get_connector(source_key)
    if connector.type != "source":
        raise ValueError(f"{source_key} is not a source")
    if source_key == "sample_crm":
        limit = int(config.get("limit", 25))
        return [
            {"id": idx, "name": f"Customer {idx}", "tier": "enterprise" if idx % 3 == 0 else "growth", "mrr": idx * 125}
            for idx in range(1, limit + 1)
        ]
    if source_key == "http_json":
        url = config["url"]
        response = httpx.get(url, timeout=30)
        response.raise_for_status()
        payload = response.json()
        if isinstance(payload, list):
            return [dict(item) for item in payload]
        if isinstance(payload, dict):
            records = payload.get("data") or payload.get("items") or payload.get("records")
            if isinstance(records, list):
                return [dict(item) for item in records]
            return [payload]
    if source_key == "csv_file":
        path = Path(config["path"])
        with path.open(newline="", encoding="utf-8") as handle:
            return [dict(row) for row in csv.DictReader(handle)]
    if source_key == "postgres_source":
        return _extract_postgres(config)
    if source_key == "sftp_source":
        return _extract_sftp(config)
    raise ValueError(f"Unsupported source {source_key}")


def _extract_postgres(config: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as exc:
        raise RuntimeError("psycopg is required for PostgreSQL extraction. Install backend requirements.") from exc

    query = config.get("query")
    if not query:
        schema = "".join(ch for ch in config.get("schema", "public") if ch.isalnum() or ch == "_")
        table = "".join(ch for ch in config["table"] if ch.isalnum() or ch == "_")
        query = f'SELECT * FROM "{schema}"."{table}" LIMIT 1000'
    with psycopg.connect(
        host=config["host"],
        port=int(config.get("port", 5432)),
        dbname=config["database"],
        user=config["username"],
        password=config.get("password", ""),
        connect_timeout=10,
        row_factory=dict_row,
    ) as conn:
        return [dict(row) for row in conn.execute(query).fetchall()]


def _extract_sftp(config: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        import io

        import paramiko
    except ImportError as exc:
        raise RuntimeError("paramiko is required for SFTP extraction. Install backend requirements.") from exc

    password = config.get("password") or None
    private_key = config.get("private_key") or None
    pkey = paramiko.RSAKey.from_private_key(io.StringIO(private_key)) if private_key else None
    transport = paramiko.Transport((config["host"], int(config.get("port", 22))))
    try:
        transport.connect(username=config["username"], password=password, pkey=pkey)
        client = paramiko.SFTPClient.from_transport(transport)
        with client.open(config["remote_path"], "r") as handle:
            content = handle.read()
        if config.get("format") == "xlsx" or config["remote_path"].endswith(".xlsx"):
            return _rows_from_xlsx(content if isinstance(content, bytes) else content.encode("utf-8"))
        if isinstance(content, bytes):
            content = content.decode("utf-8")
        return [dict(row) for row in csv.DictReader(content.splitlines())]
    finally:
        transport.close()


def load(destination_key: str, config: dict[str, Any], rows: list[dict[str, Any]]) -> int:
    connector = get_connector(destination_key)
    if connector.type != "destination":
        raise ValueError(f"{destination_key} is not a destination")
    if destination_key == "jsonl_file":
        path = Path(config.get("path", "data/output.jsonl"))
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row) + "\n")
        return len(rows)
    if destination_key == "csv_output":
        path = Path(config.get("path", "data/output.csv"))
        path.parent.mkdir(parents=True, exist_ok=True)
        if not rows:
            return 0
        exists = path.exists()
        with path.open("a", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
            if not exists:
                writer.writeheader()
            writer.writerows(rows)
        return len(rows)
    if destination_key == "postgres_destination":
        return _load_postgres(config, rows)
    if destination_key == "sftp_destination":
        return _load_sftp(config, rows)
    raise ValueError(f"Unsupported destination {destination_key}")


def _load_postgres(config: dict[str, Any], rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    try:
        import psycopg
    except ImportError as exc:
        raise RuntimeError("psycopg is required for PostgreSQL destination. Install backend requirements.") from exc

    schema = "".join(ch for ch in config.get("schema", "public") if ch.isalnum() or ch == "_")
    table = "".join(ch for ch in config["table"] if ch.isalnum() or ch == "_")
    columns = [str(key) for key in rows[0].keys()]
    quoted_columns = ", ".join(f'"{col}"' for col in columns)
    placeholders = ", ".join(["%s"] * len(columns))
    sql = f'INSERT INTO "{schema}"."{table}" ({quoted_columns}) VALUES ({placeholders})'
    with psycopg.connect(
        host=config["host"],
        port=int(config.get("port", 5432)),
        dbname=config["database"],
        user=config["username"],
        password=config.get("password", ""),
        connect_timeout=10,
    ) as conn:
        with conn.cursor() as cursor:
            cursor.executemany(sql, [tuple(row.get(col) for col in columns) for row in rows])
    return len(rows)


def _load_sftp(config: dict[str, Any], rows: list[dict[str, Any]]) -> int:
    try:
        import io

        import paramiko
    except ImportError as exc:
        raise RuntimeError("paramiko is required for SFTP destination. Install backend requirements.") from exc
    if config.get("format") == "xlsx" or config["remote_path"].endswith(".xlsx"):
        payload: str | bytes = _xlsx_from_rows(rows)
    else:
        output = io.StringIO()
        if rows:
            writer = csv.DictWriter(output, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        payload = output.getvalue()
    password = config.get("password") or None
    private_key = config.get("private_key") or None
    pkey = paramiko.RSAKey.from_private_key(io.StringIO(private_key)) if private_key else None
    transport = paramiko.Transport((config["host"], int(config.get("port", 22))))
    try:
        transport.connect(username=config["username"], password=password, pkey=pkey)
        client = paramiko.SFTPClient.from_transport(transport)
        with client.open(config["remote_path"], "w") as handle:
            handle.write(payload)
    finally:
        transport.close()
    return len(rows)


def _rows_from_xlsx(content: bytes) -> list[dict[str, Any]]:
    import io

    from openpyxl import load_workbook

    workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    sheet = workbook.active
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        return []
    headers = [str(value) for value in rows[0]]
    return [{headers[index]: value for index, value in enumerate(row)} for row in rows[1:]]


def _xlsx_from_rows(rows: list[dict[str, Any]]) -> bytes:
    import io

    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    if rows:
        headers = list(rows[0].keys())
        sheet.append(headers)
        for row in rows:
            sheet.append([row.get(header) for header in headers])
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


def _load_pipeline(run_id: int) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            """
            SELECT p.* FROM pipelines p
            JOIN runs r ON r.pipeline_id = p.id
            WHERE r.id = ?
            """,
            (run_id,),
        ).fetchone()
    if row is None:
        raise ValueError(f"Run not found: {run_id}")
    data = dict(row)
    data["source_config"] = decode(data["source_config"])
    data["destination_config"] = decode(data["destination_config"])
    data["transforms"] = decode(data["transforms"])
    return data


def _mark_running(run_id: int) -> None:
    with db() as conn:
        conn.execute("UPDATE runs SET status='running', started_at=CURRENT_TIMESTAMP WHERE id=?", (run_id,))


def _update_counts(run_id: int, rows_read: int) -> None:
    with db() as conn:
        conn.execute("UPDATE runs SET rows_read=? WHERE id=?", (rows_read, run_id))


def _succeed(run_id: int, rows_written: int) -> None:
    with db() as conn:
        conn.execute(
            "UPDATE runs SET status='succeeded', rows_written=?, finished_at=CURRENT_TIMESTAMP WHERE id=?",
            (rows_written, run_id),
        )


def _fail(run_id: int, error: str) -> None:
    with db() as conn:
        conn.execute(
            "UPDATE runs SET status='failed', error=?, finished_at=CURRENT_TIMESTAMP WHERE id=?",
            (error, run_id),
        )


def _log(run_id: int, level: str, message: str) -> None:
    logger.log(getattr(logging, level, logging.INFO), message)
    with db() as conn:
        conn.execute("INSERT INTO run_logs (run_id, level, message) VALUES (?, ?, ?)", (run_id, level, message))


def _transformation_log(run_id: int, step_log) -> None:
    with db() as conn:
        conn.execute(
            """
            INSERT INTO transformation_run_logs
            (run_id, step_id, status, message, records_before, records_after, duration_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                step_log.step_id,
                step_log.level,
                step_log.message,
                step_log.records_before,
                step_log.records_after,
                step_log.duration_ms,
            ),
        )
