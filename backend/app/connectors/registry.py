from urllib.parse import urlparse

from app.core.config import get_settings
from app.models.schemas import ConnectorDefinition


PII_FIELDS = {
    "pii_columns": {"type": "string"},
}

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
    "path_pattern": {"type": "string"},
    "output_path_pattern": {"type": "string"},
    "rejected_path": {"type": "string"},
    "rejected_path_pattern": {"type": "string"},
    "xlsx_data_sheet": {"type": "string"},
    "auto_create_folders": {"type": "boolean", "default": True},
    "format": {"type": "string", "enum": ["csv", "xlsx"], "default": "csv"},
}

CONNECTORS: dict[str, ConnectorDefinition] = {
    "postgres_source": ConnectorDefinition(
        key="postgres_source",
        name="PostgreSQL",
        type="source",
        description="Connect to PostgreSQL. Choose table or SQL later in transform or pipeline.",
        config_schema={
            "type": "object",
            "required": ["host", "database", "username", "password"],
            "properties": POSTGRES_FIELDS,
        },
    ),
    "sftp_source": ConnectorDefinition(
        key="sftp_source",
        name="SFTP",
        type="source",
        description="Connect to SFTP. Choose file path or pattern later in transform or pipeline.",
        config_schema={
            "type": "object",
            "required": ["host", "username"],
            "properties": SFTP_FIELDS,
        },
    ),
    "postgres_destination": ConnectorDefinition(
        key="postgres_destination",
        name="PostgreSQL",
        type="destination",
        description="Connect to PostgreSQL destination. Choose target table later in transform or pipeline.",
        config_schema={
            "type": "object",
            "required": ["host", "database", "username", "password"],
            "properties": {
                **POSTGRES_FIELDS,
                "mode": {"type": "string", "enum": ["append", "upsert", "truncate_insert"], "default": "append"},
                "primary_key": {"type": "string"},
                **PII_FIELDS,
            },
        },
    ),
    "sftp_destination": ConnectorDefinition(
        key="sftp_destination",
        name="SFTP",
        type="destination",
        description="Connect to SFTP destination. Choose output path or pattern later in transform or pipeline.",
        config_schema={
            "type": "object",
            "required": ["host", "username"],
            "properties": {**SFTP_FIELDS, **PII_FIELDS},
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
        "username": parsed.username or "",
        "password": parsed.password or "",
        "schema": "public",
    }
