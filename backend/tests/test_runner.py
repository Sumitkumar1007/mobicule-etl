from app.services.runner import _same_connection_join_config


def test_same_connection_postgres_join_config():
    result = _same_connection_join_config(
        "postgres_source",
        {
            "host": "db.local",
            "port": 5432,
            "database": "warehouse",
            "username": "etl",
            "password": "secret",
            "schema": "public",
            "table": "customers",
        },
        {"schema": "analytics", "table": "loans"},
    )

    assert result["host"] == "db.local"
    assert result["database"] == "warehouse"
    assert result["schema"] == "analytics"
    assert result["table"] == "loans"


def test_same_connection_sftp_join_config():
    result = _same_connection_join_config(
        "sftp_source",
        {
            "host": "sftp.local",
            "port": 22,
            "username": "etl",
            "password": "secret",
            "remote_path": "/in",
            "format": "csv",
        },
        {"remote_path": "loans.csv", "format": "xlsx"},
    )

    assert result["host"] == "sftp.local"
    assert result["remote_path"] == "/in/loans.csv"
    assert result["format"] == "xlsx"
    assert result["operation"] == "read"
