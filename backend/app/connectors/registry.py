from urllib.parse import urlparse

from app.core.config import get_settings
from app.models.schemas import ConnectorDefinition


POSTGRES_FIELDS = {
    "host": {"type": "string"},
    "port": {"type": "number", "default": 5432},
    "database": {"type": "string"},
    "schema": {"type": "string", "default": "public"},
    "table": {"type": "string"},
    "query": {"type": "string"},
    "username": {"type": "string"},
    "password": {"type": "string", "secret": True},
}

SFTP_FIELDS = {
    "host": {"type": "string"},
    "port": {"type": "number", "default": 22},
    "username": {"type": "string"},
    "password": {"type": "string", "secret": True},
    "private_key": {"type": "string", "secret": True},
    "remote_path": {"type": "string"},
    "operation": {"type": "string", "enum": ["read", "write"], "default": "read"},
    "format": {"type": "string", "enum": ["csv", "xlsx"], "default": "csv"},
}

CONNECTORS: dict[str, ConnectorDefinition] = {
    "postgres_source": ConnectorDefinition(
        key="postgres_source",
        name="PostgreSQL",
        type="source",
        description="Read rows from PostgreSQL using a table or SQL query.",
        config_schema={
            "type": "object",
            "required": ["host", "database", "username", "password", "table"],
            "properties": POSTGRES_FIELDS,
        },
    ),
    "sftp_source": ConnectorDefinition(
        key="sftp_source",
        name="SFTP",
        type="source",
        description="Read CSV or XLSX files from an SFTP remote path.",
        config_schema={
            "type": "object",
            "required": ["host", "username", "remote_path"],
            "properties": SFTP_FIELDS,
        },
    ),
    "postgres_destination": ConnectorDefinition(
        key="postgres_destination",
        name="PostgreSQL",
        type="destination",
        description="Write records to PostgreSQL with append or upsert mode.",
        config_schema={
            "type": "object",
            "required": ["host", "database", "username", "password", "table"],
            "properties": {
                **POSTGRES_FIELDS,
                "mode": {"type": "string", "enum": ["append", "upsert"], "default": "append"},
                "primary_key": {"type": "string"},
            },
        },
    ),
    "sftp_destination": ConnectorDefinition(
        key="sftp_destination",
        name="SFTP",
        type="destination",
        description="Write CSV or XLSX files to an SFTP remote path.",
        config_schema={
            "type": "object",
            "required": ["host", "username", "remote_path"],
            "properties": {**SFTP_FIELDS, "operation": {"type": "string", "enum": ["write"], "default": "write"}},
        },
    ),
}


def list_connectors() -> list[ConnectorDefinition]:
    defaults = _postgres_defaults()
    connectors: list[ConnectorDefinition] = []
    for connector in CONNECTORS.values():
        data = connector.model_dump()
        if connector.key in {"postgres_source", "postgres_destination"}:
            properties = data["config_schema"].get("properties", {})
            for key, value in defaults.items():
                if key in properties:
                    properties[key] = {**properties[key], "default": value}
        connectors.append(ConnectorDefinition(**data))
    return connectors


def get_connector(key: str) -> ConnectorDefinition:
    if key not in CONNECTORS:
        raise KeyError(f"Unknown connector: {key}")
    return CONNECTORS[key]


def _postgres_defaults() -> dict[str, object]:
    parsed = urlparse(get_settings().metadata_database_url)
    return {
        "host": parsed.hostname or "",
        "port": parsed.port or 5432,
        "database": parsed.path.lstrip("/"),
        "username": parsed.username or "",
        "password": parsed.password or "",
        "schema": "public",
    }
