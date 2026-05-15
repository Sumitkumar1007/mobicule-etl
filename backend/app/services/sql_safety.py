from app.core.config import get_settings

_FORBIDDEN_SQL_TOKENS = {
    "insert",
    "update",
    "delete",
    "drop",
    "alter",
    "truncate",
    "create",
    "grant",
    "revoke",
    "copy",
    "call",
    "execute",
}


def validate_source_query(query: str) -> str:
    normalized = query.strip()
    if not normalized:
        raise ValueError("PostgreSQL query cannot be empty")
    settings = get_settings()
    if settings.is_production and not settings.allow_raw_sql_sources:
        raise ValueError("Raw PostgreSQL source queries are disabled in production. Use schema/table or enable MOBIFLOW_ALLOW_RAW_SQL_SOURCES for trusted read-only users.")
    if normalized.endswith(";"):
        normalized = normalized[:-1].strip()
    if ";" in normalized:
        raise ValueError("PostgreSQL source query must be a single read-only statement")
    lowered = normalized.lower()
    first_word = lowered.split(None, 1)[0] if lowered.split(None, 1) else ""
    if first_word not in {"select", "with"}:
        raise ValueError("PostgreSQL source query must start with SELECT or WITH")
    tokens = {token.strip("(),;\n\t ") for token in lowered.replace("\n", " ").split()}
    forbidden = sorted(_FORBIDDEN_SQL_TOKENS & tokens)
    if forbidden:
        raise ValueError(f"PostgreSQL source query contains non-read-only keyword: {forbidden[0]}")
    return normalized
