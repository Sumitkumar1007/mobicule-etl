import json
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from urllib.parse import urlparse

from app.core.config import get_settings
from app.core.security import hash_password


def _pg_sql(sql: str) -> str:
    return sql.replace("?", "%s")


class PgDb:
    def __init__(self, url: str):
        import psycopg
        from psycopg.rows import dict_row

        self.conn = psycopg.connect(url, row_factory=dict_row)

    def execute(self, sql: str, params: tuple[Any, ...] = ()):
        return self.conn.execute(_pg_sql(sql), params)

    def executescript(self, script: str) -> None:
        ddl = script.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")
        with self.conn.cursor() as cursor:
            for statement in ddl.split(";"):
                if statement.strip():
                    cursor.execute(statement)

    def commit(self) -> None:
        self.conn.commit()

    def rollback(self) -> None:
        self.conn.rollback()

    def close(self) -> None:
        self.conn.close()


def _connect() -> PgDb:
    return PgDb(get_settings().metadata_database_url)


@contextmanager
def db() -> Iterator[PgDb]:
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS pipelines (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                source_id INTEGER,
                destination_id INTEGER,
                source_key TEXT NOT NULL,
                destination_key TEXT NOT NULL,
                source_config TEXT NOT NULL,
                destination_config TEXT NOT NULL,
                transforms TEXT NOT NULL,
                schedule TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS resources (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('source', 'destination')),
                connector_key TEXT NOT NULL,
                config TEXT NOT NULL,
                connection_count INTEGER NOT NULL DEFAULT 0,
                last_sync TEXT,
                status TEXT NOT NULL DEFAULT '-',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS runs (
                id SERIAL PRIMARY KEY,
                pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
                status TEXT NOT NULL,
                rows_read INTEGER NOT NULL DEFAULT 0,
                rows_written INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                started_at TEXT,
                finished_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS run_logs (
                id SERIAL PRIMARY KEY,
                run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                role TEXT NOT NULL CHECK(role IN ('admin', 'support', 'viewer')),
                password_hash TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS transformations (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                source_id INTEGER REFERENCES resources(id) ON DELETE SET NULL,
                destination_id INTEGER REFERENCES resources(id) ON DELETE SET NULL,
                source_config TEXT NOT NULL DEFAULT '{}',
                destination_config TEXT NOT NULL DEFAULT '{}',
                status TEXT NOT NULL DEFAULT 'draft',
                version INTEGER NOT NULL DEFAULT 1,
                steps TEXT NOT NULL,
                created_by TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS transformation_versions (
                id SERIAL PRIMARY KEY,
                transformation_id INTEGER NOT NULL REFERENCES transformations(id) ON DELETE CASCADE,
                version_no INTEGER NOT NULL,
                snapshot_data TEXT NOT NULL,
                published_by TEXT,
                published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS transformation_run_logs (
                id SERIAL PRIMARY KEY,
                run_id INTEGER,
                step_id TEXT,
                status TEXT NOT NULL,
                message TEXT NOT NULL,
                records_before INTEGER NOT NULL DEFAULT 0,
                records_after INTEGER NOT NULL DEFAULT 0,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS auth_sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at TEXT NOT NULL,
                revoked_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT")
        conn.execute("ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS source_id INTEGER REFERENCES resources(id) ON DELETE SET NULL")
        conn.execute("ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS destination_id INTEGER REFERENCES resources(id) ON DELETE SET NULL")
        conn.execute("ALTER TABLE transformations ADD COLUMN IF NOT EXISTS source_config TEXT NOT NULL DEFAULT '{}'")
        conn.execute("ALTER TABLE transformations ADD COLUMN IF NOT EXISTS destination_config TEXT NOT NULL DEFAULT '{}'")
        settings = get_settings()
        bootstrap_hash = hash_password(settings.bootstrap_admin_password) if settings.bootstrap_admin_password else None
        conn.execute(
            """
            INSERT INTO users (name, email, role, password_hash)
            SELECT ?, ?, ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM users WHERE email=?)
            """,
            ("Admin", settings.bootstrap_admin_email, "admin", bootstrap_hash, settings.bootstrap_admin_email),
        )
        if bootstrap_hash:
            conn.execute(
                """
                UPDATE users
                SET password_hash=?
                WHERE email=? AND (password_hash IS NULL OR password_hash='')
                """,
                (bootstrap_hash, settings.bootstrap_admin_email),
            )
        _fill_missing_postgres_connection_configs(conn, settings.metadata_database_url)


def _fill_missing_postgres_connection_configs(conn: PgDb, database_url: str) -> None:
    parsed = urlparse(database_url)
    defaults = {
        "host": parsed.hostname or "",
        "port": parsed.port or 5432,
        "database": parsed.path.lstrip("/"),
        "username": parsed.username or "",
        "password": parsed.password or "",
    }
    resource_rows = conn.execute(
        """
        SELECT id, config
        FROM resources
        WHERE connector_key IN ('postgres_source', 'postgres_destination')
        """
    ).fetchall()
    for row in resource_rows:
        config = decode(dict(row)["config"])
        if not isinstance(config, dict):
            continue
        next_config = _with_missing_defaults(config, defaults)
        if next_config != config:
            conn.execute("UPDATE resources SET config=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (encode(next_config), dict(row)["id"]))
    pipeline_rows = conn.execute(
        """
        SELECT id, source_key, destination_key, source_config, destination_config
        FROM pipelines
        WHERE source_key='postgres_source' OR destination_key='postgres_destination'
        """
    ).fetchall()
    for row in pipeline_rows:
        data = dict(row)
        source_config = decode(data["source_config"])
        destination_config = decode(data["destination_config"])
        if data["source_key"] == "postgres_source" and isinstance(source_config, dict):
            source_config = _with_missing_defaults(source_config, defaults)
        if data["destination_key"] == "postgres_destination" and isinstance(destination_config, dict):
            destination_config = _with_missing_defaults(destination_config, defaults)
        conn.execute(
            """
            UPDATE pipelines
            SET source_config=?, destination_config=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=?
            """,
            (encode(source_config), encode(destination_config), data["id"]),
        )


def _with_missing_defaults(config: dict[str, Any], defaults: dict[str, Any]) -> dict[str, Any]:
    next_config = dict(config)
    for key, value in defaults.items():
        if next_config.get(key) in (None, ""):
            next_config[key] = value
    return next_config


def encode(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"))


def decode(value: str) -> Any:
    return json.loads(value)
