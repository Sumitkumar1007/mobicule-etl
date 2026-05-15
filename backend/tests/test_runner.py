from app.services.runner import _postgres_write_sql, _same_connection_join_config


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


def test_postgres_write_sql_supports_append_and_upsert():
    append_sql = _postgres_write_sql("public", "customers", ["id", "name"], {"mode": "append"})
    upsert_sql = _postgres_write_sql("public", "customers", ["id", "name"], {"mode": "upsert", "primary_key": "id"})

    assert append_sql == 'INSERT INTO "public"."customers" ("id", "name") VALUES (%s, %s)'
    assert upsert_sql == (
        'INSERT INTO "public"."customers" ("id", "name") VALUES (%s, %s) '
        'ON CONFLICT ("id") DO UPDATE SET "name"=EXCLUDED."name"'
    )


def test_postgres_upsert_requires_primary_key_in_rows():
    try:
        _postgres_write_sql("public", "customers", ["id", "name"], {"mode": "upsert", "primary_key": "customer_id"})
    except ValueError as exc:
        assert "primary key customer_id is not in output rows" in str(exc)
    else:
        raise AssertionError("Expected missing primary key to fail")
