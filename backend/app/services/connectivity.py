from typing import Any
import io
import posixpath

from app.connectors.registry import get_connector


def test_connection(connector_key: str, config: dict[str, Any]) -> str:
    connector = get_connector(connector_key)
    if connector_key in {"postgres_source", "postgres_destination"}:
        _test_postgres(config)
        return f"{connector.name} connection OK"
    if connector_key in {"sftp_source", "sftp_destination"}:
        checked_path = _test_sftp(config)
        return f"{connector.name} connection OK" + (f" ({checked_path})" if checked_path else "")
    raise ValueError(f"Connection test is not supported for {connector_key}")


def _test_postgres(config: dict[str, Any]) -> None:
    try:
        import psycopg
    except ImportError as exc:
        raise RuntimeError("psycopg is required for PostgreSQL connection tests. Install backend requirements.") from exc

    with psycopg.connect(
        host=config["host"],
        port=int(config.get("port", 5432)),
        dbname=config["database"],
        user=config["username"],
        password=config.get("password", ""),
        connect_timeout=10,
    ) as conn:
        conn.execute("SELECT 1").fetchone()


def _test_sftp(config: dict[str, Any]) -> str:
    try:
        import paramiko
    except ImportError as exc:
        raise RuntimeError("paramiko is required for SFTP connection tests. Install backend requirements.") from exc

    password = config.get("password") or None
    private_key = config.get("private_key") or None
    pkey = paramiko.RSAKey.from_private_key(io.StringIO(private_key)) if private_key else None
    transport = paramiko.Transport((config["host"], int(config.get("port", 22))))
    try:
        transport.connect(username=config["username"], password=password, pkey=pkey)
        client = paramiko.SFTPClient.from_transport(transport)
        remote_path = str(config.get("remote_path") or "").strip()
        if remote_path:
            check_path = remote_path if remote_path.endswith("/") else posixpath.dirname(remote_path) or "."
            client.stat(check_path)
            return check_path
        client.listdir(".")
        return "."
    finally:
        transport.close()
