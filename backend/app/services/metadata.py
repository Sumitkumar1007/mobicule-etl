import csv
import io
from pathlib import Path
from typing import Any

import httpx

from app.services.runner import extract


def source_columns(source_key: str, config: dict[str, Any]) -> list[str]:
    if source_key == "sample_crm":
        return ["id", "name", "tier", "mrr"]
    if source_key == "csv_file":
        path = Path(config["path"])
        with path.open(newline="", encoding="utf-8") as handle:
            reader = csv.reader(handle)
            return next(reader, [])
    if source_key == "http_json":
        rows = extract(source_key, config)[:1]
        return list(rows[0].keys()) if rows else []
    if source_key == "postgres_source":
        return _postgres_columns(config)
    if source_key == "sftp_source":
        return _sftp_columns(config)
    rows = extract(source_key, config)[:1]
    return list(rows[0].keys()) if rows else []


def _postgres_columns(config: dict[str, Any]) -> list[str]:
    try:
        import psycopg
    except ImportError as exc:
        raise RuntimeError("psycopg is required for PostgreSQL metadata. Install backend requirements.") from exc

    table = config.get("table")
    schema = config.get("schema", "public")
    query = config.get("query")
    with psycopg.connect(
        host=config["host"],
        port=int(config.get("port", 5432)),
        dbname=config["database"],
        user=config["username"],
        password=config.get("password", ""),
        connect_timeout=10,
    ) as conn:
        if table:
            rows = conn.execute(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = %s AND table_name = %s
                ORDER BY ordinal_position
                """,
                (schema, table),
            ).fetchall()
            return [row[0] for row in rows]
        if query:
            try:
                cursor = conn.execute(f"SELECT * FROM ({query}) AS preview_source LIMIT 0")
            except Exception as exc:
                raise ValueError(
                    "PostgreSQL column fetch failed. Fix the SQL query, or clear Query and use Schema/Table fields. "
                    f"Database error: {exc}"
                ) from exc
            return [column.name for column in cursor.description or []]
    return []


def _sftp_columns(config: dict[str, Any]) -> list[str]:
    try:
        import paramiko
    except ImportError as exc:
        raise RuntimeError("paramiko is required for SFTP metadata. Install backend requirements.") from exc

    host = config["host"]
    port = int(config.get("port", 22))
    username = config["username"]
    remote_path = config["remote_path"]
    password = config.get("password") or None
    private_key = config.get("private_key") or None
    pkey = paramiko.RSAKey.from_private_key(io.StringIO(private_key)) if private_key else None

    transport = paramiko.Transport((host, port))
    try:
        transport.connect(username=username, password=password, pkey=pkey)
        client = paramiko.SFTPClient.from_transport(transport)
        with client.open(remote_path, "r") as handle:
            if config.get("format") == "xlsx" or remote_path.endswith(".xlsx"):
                return _xlsx_columns(handle.read())
            first_line = handle.readline()
        return next(csv.reader([first_line]), [])
    finally:
        transport.close()


def _xlsx_columns(content: bytes) -> list[str]:
    from openpyxl import load_workbook

    workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    sheet = workbook.active
    first_row = next(sheet.iter_rows(values_only=True), [])
    return [str(value) for value in first_row if value is not None]
