from app.services.transforms import apply_transforms, validate_transforms


def test_select_and_rename_fields():
    rows = [{"id": 1, "name": "Ada", "tier": "enterprise"}]
    result = apply_transforms(
        rows,
        [
            {"type": "select_fields", "fields": ["id", "name"]},
            {"type": "rename_fields", "mapping": {"name": "customer_name"}},
        ],
    )
    assert result == [{"id": 1, "customer_name": "Ada"}]


def test_ui_steps_cast_fill_derive_filter_deduplicate_sort():
    rows = [
        {"id": "2", "name": "Ada", "amount": "10", "discount": "2", "city": None},
        {"id": "1", "name": "Grace", "amount": "-1", "discount": "0", "city": ""},
        {"id": "2", "name": "Ada", "amount": "10", "discount": "2", "city": None},
    ]
    result = apply_transforms(
        rows,
        [
            {"id": "s1", "step_type": "cast", "step_name": "Change Data Type", "parameters": {"casts": [{"column": "amount", "type": "float"}, {"column": "discount", "type": "float"}]}},
            {"id": "s2", "step_type": "fillna", "step_name": "Fill Null Values", "parameters": {"fills": [{"column": "city", "strategy": "fixed", "value": "UNKNOWN"}]}},
            {
                "id": "s3",
                "step_type": "derive",
                "step_name": "Add Derived Column",
                "parameters": {
                    "output_column": "net_amount",
                    "left": {"kind": "column", "value": "amount"},
                    "operator": "-",
                    "right": {"kind": "column", "value": "discount"},
                },
            },
            {"id": "s4", "step_type": "filter", "step_name": "Filter Rows", "parameters": {"joiner": "and", "conditions": [{"column": "amount", "operator": "greater_than", "value": "0"}]}},
            {"id": "s5", "step_type": "deduplicate", "step_name": "Remove Duplicates", "parameters": {"columns": ["id"], "keep": "first"}},
            {"id": "s6", "step_type": "sort", "step_name": "Sort Rows", "parameters": {"column": "id", "ascending": True}},
        ],
    )
    assert result == [{"id": "2", "name": "Ada", "amount": 10.0, "discount": 2.0, "city": "UNKNOWN", "net_amount": 8.0}]


def test_cast_date_with_output_format():
    rows = [{"notice_date": "2026-05-25"}, {"notice_date": "05/26/2026"}]
    result = apply_transforms(
        rows,
        [
            {
                "id": "date",
                "step_type": "cast",
                "step_name": "Change Data Type",
                "parameters": {"casts": [{"column": "notice_date", "type": "date", "format": "dd/mm/yy"}]},
            }
        ],
    )
    assert result == [{"notice_date": "25/05/26"}, {"notice_date": "26/05/26"}]


def test_cast_datetime_with_output_format():
    rows = [{"notice_date": "2026-01-01 00:00:00"}]
    result = apply_transforms(
        rows,
        [
            {
                "id": "date",
                "step_type": "cast",
                "step_name": "Change Data Type",
                "parameters": {"casts": [{"column": "notice_date", "type": "datetime", "format": "dd/mm//yyyy"}]},
            }
        ],
    )
    assert result == [{"notice_date": "01/01/2026"}]


def test_cast_date_rejects_numeric_and_error_tokens():
    from app.services.transforms import preview_transforms

    rows = [
        {"account": "ok", "notice_date": "2026-01-01"},
        {"account": "bad-number", "notice_date": "123456"},
        {"account": "bad-token", "notice_date": "#VALUE!"},
    ]
    result = preview_transforms(
        rows,
        [
            {
                "id": "date",
                "step_type": "cast",
                "step_name": "Change Data Type",
                "parameters": {"casts": [{"column": "notice_date", "type": "date", "format": "dd-mm-yyyy"}]},
            }
        ],
    )
    assert result.rows == [{"account": "ok", "notice_date": "01-01-2026"}]
    assert [row["account"] for row in result.rejected_rows] == ["bad-number", "bad-token"]
    assert all(row["_rejected_reason"] == "Invalid date value" for row in result.rejected_rows)


def test_blank_columns_and_reorder_columns():
    rows = [{"id": "A1", "amount": "10"}]
    result = apply_transforms(
        rows,
        [
            {
                "id": "blank",
                "step_type": "blank_columns",
                "step_name": "Add Blank Columns",
                "parameters": {"columns": "template_empty, template_null"},
            },
            {
                "id": "order",
                "step_type": "reorder",
                "step_name": "Reorder Columns",
                "parameters": {"columns": ["template_empty", "id", "template_null"], "include_unlisted": True},
            },
        ],
    )
    assert list(result[0].keys()) == ["template_empty", "id", "template_null", "amount"]
    assert result == [{"template_empty": "", "id": "A1", "template_null": "", "amount": "10"}]


def test_preview_collects_rejected_rows_for_cast_validation_errors_only():
    from app.services.transforms import preview_transforms

    rows = [{"id": "1", "amount": "10"}, {"id": "2", "amount": "abc"}, {"id": "1", "amount": "10"}]
    result = preview_transforms(
        rows,
        [
            {"id": "cast", "step_type": "cast", "step_name": "Change Data Type", "parameters": {"casts": [{"column": "amount", "type": "float"}]}},
            {"id": "filter", "step_type": "filter", "step_name": "Filter Rows", "parameters": {"conditions": [{"column": "amount", "operator": "greater_than", "value": "0"}]}},
            {"id": "dedupe", "step_type": "deduplicate", "step_name": "Remove Duplicates", "parameters": {"columns": ["id"], "keep": "first"}},
        ],
    )
    assert result.rows == [{"id": "1", "amount": 10.0}]
    assert result.rejected_rows == [{"id": "2", "amount": "abc", "_rejected_step": "Change Data Type", "_rejected_column": "amount", "_rejected_reason": "Invalid float value"}]


def test_filter_like_and_not_like():
    rows = [
        {"id": 1, "name": "Ada Lovelace"},
        {"id": 2, "name": "Grace Hopper"},
        {"id": 3, "name": "Alan Turing"},
    ]

    like_result = apply_transforms(
        rows,
        [{"id": "s1", "step_type": "filter", "step_name": "Filter Rows", "parameters": {"conditions": [{"column": "name", "operator": "like", "value": "%a%"}]}}],
    )
    not_like_result = apply_transforms(
        rows,
        [{"id": "s1", "step_type": "filter", "step_name": "Filter Rows", "parameters": {"conditions": [{"column": "name", "operator": "not_like", "value": "%a%"}]}}],
    )

    assert like_result == [{"id": 1, "name": "Ada Lovelace"}, {"id": 2, "name": "Grace Hopper"}, {"id": 3, "name": "Alan Turing"}]
    assert not_like_result == []


def test_derived_column_output_type():
    rows = [{"amount": "10.25", "discount": "2.25"}]
    result = apply_transforms(
        rows,
        [
            {
                "id": "s1",
                "step_type": "derive",
                "step_name": "Add Derived Column",
                "parameters": {
                    "output_column": "net_amount",
                    "output_type": "integer",
                    "left": {"kind": "column", "value": "amount"},
                    "operator": "-",
                    "right": {"kind": "column", "value": "discount"},
                },
            }
        ],
    )

    assert result == [{"amount": "10.25", "discount": "2.25", "net_amount": 8}]


def test_join_groupby_pivot_and_value_map():
    rows = [
        {"customer_id": "1", "month": "Jan", "amount": "10", "active": "yes"},
        {"customer_id": "1", "month": "Feb", "amount": "20", "active": "no"},
        {"customer_id": "2", "month": "Jan", "amount": "5", "active": "yes"},
    ]
    result = apply_transforms(
        rows,
        [
            {
                "id": "join",
                "step_type": "join",
                "step_name": "Join / Merge",
                "parameters": {
                    "left_key": "customer_id",
                    "right_key": "customer_id",
                    "right_columns": ["segment"],
                    "right_rows": [{"customer_id": "1", "segment": "A"}, {"customer_id": "2", "segment": "B"}],
                },
            },
            {
                "id": "map",
                "step_type": "value_map",
                "step_name": "Map Column Values",
                "parameters": {
                    "column": "active",
                    "output_column": "active_flag",
                    "output_type": "integer",
                    "mappings": [{"from": "yes", "to": "1"}, {"from": "no", "to": "0"}],
                },
            },
            {"id": "cast", "step_type": "cast", "step_name": "Change Data Type", "parameters": {"casts": [{"column": "amount", "type": "float"}]}},
            {
                "id": "group",
                "step_type": "groupby",
                "step_name": "Group By",
                "parameters": {"group_columns": ["segment", "month"], "aggregations": [{"column": "amount", "function": "sum", "output_column": "total"}]},
            },
            {
                "id": "pivot",
                "step_type": "pivot",
                "step_name": "Pivot",
                "parameters": {"index_columns": ["segment"], "pivot_column": "month", "value_column": "total", "aggfunc": "sum"},
            },
        ],
    )

    assert result == [{"segment": "A", "Feb": 20.0, "Jan": 10.0}, {"segment": "B", "Feb": 0.0, "Jan": 5.0}]


def test_pivot_count_can_use_index_as_value_column():
    rows = [
        {"apac_card_number": "1", "vertical": "cards"},
        {"apac_card_number": "1", "vertical": "loans"},
        {"apac_card_number": "2", "vertical": "cards"},
    ]
    result = apply_transforms(
        rows,
        [
            {
                "id": "pivot",
                "step_type": "pivot",
                "step_name": "Pivot",
                "parameters": {
                    "index_columns": ["apac_card_number"],
                    "pivot_column": "vertical",
                    "value_column": "apac_card_number",
                    "aggfunc": "count",
                },
            }
        ],
    )

    assert result == [{"apac_card_number": "1", "cards": 1, "loans": 1}, {"apac_card_number": "2", "cards": 1, "loans": 0}]


def test_validate_select_allows_stale_missing_columns():
    result = validate_transforms(
        ["customer_id", "vertical"],
        [
            {
                "id": "select",
                "step_type": "select",
                "step_name": "Select Columns",
                "parameters": {"columns": ["customer_id", "id", "vertical"]},
            }
        ],
    )

    assert result["errors"] == []
    assert result["warnings"] == ["Step 1 Select Columns ignores missing columns: id"]


def test_groupby_count_distinct():
    rows = [
        {"segment": "A", "customer_id": "1"},
        {"segment": "A", "customer_id": "1"},
        {"segment": "A", "customer_id": "2"},
        {"segment": "B", "customer_id": "3"},
    ]
    result = apply_transforms(
        rows,
        [
            {
                "id": "group",
                "step_type": "groupby",
                "step_name": "Group By",
                "parameters": {
                    "group_columns": ["segment"],
                    "aggregations": [{"column": "customer_id", "function": "count_distinct", "output_column": "unique_customers"}],
                },
            }
        ],
    )

    assert result == [{"segment": "A", "unique_customers": 2}, {"segment": "B", "unique_customers": 1}]


def test_pivot_count_distinct_can_use_index_as_value_column():
    rows = [
        {"apac_card_number": "1", "vertical": "cards"},
        {"apac_card_number": "1", "vertical": "cards"},
        {"apac_card_number": "1", "vertical": "loans"},
        {"apac_card_number": "2", "vertical": "cards"},
    ]
    result = apply_transforms(
        rows,
        [
            {
                "id": "pivot",
                "step_type": "pivot",
                "step_name": "Pivot",
                "parameters": {
                    "index_columns": ["apac_card_number"],
                    "pivot_column": "vertical",
                    "value_column": "apac_card_number",
                    "aggfunc": "count_distinct",
                },
            }
        ],
    )

    assert result == [{"apac_card_number": "1", "cards": 1, "loans": 1}, {"apac_card_number": "2", "cards": 1, "loans": 0}]


def test_custom_transform_accepts_df_and_returns_next_step_input():
    rows = [{"customer_id": "1", "amount": 10}, {"customer_id": "2", "amount": 20}]
    result = apply_transforms(
        rows,
        [
            {
                "id": "custom",
                "step_type": "custom",
                "step_name": "Custom Transform",
                "parameters": {
                    "code": "\n".join([
                        "def transform(df):",
                        "    next_df = df.copy()",
                        "    next_df['double_amount'] = next_df['amount'] * 2",
                        "    return next_df",
                    ])
                },
            },
            {
                "id": "select",
                "step_type": "select",
                "step_name": "Select Columns",
                "parameters": {"columns": ["customer_id", "double_amount"]},
            },
        ],
    )

    assert result == [{"customer_id": "1", "double_amount": 20}, {"customer_id": "2", "double_amount": 40}]


def test_custom_transform_can_use_top_level_constants_inside_transform():
    rows = [{"Apac Number": "A1", "Amount": 10}]
    result = apply_transforms(
        rows,
        [
            {
                "id": "custom",
                "step_type": "custom",
                "step_name": "Custom Transform",
                "parameters": {
                    "code": "\n".join([
                        "MANDATORY_COLUMNS = ['Apac Number']",
                        "def transform(df):",
                        "    missing = [c for c in MANDATORY_COLUMNS if c not in df.columns]",
                        "    assert not missing",
                        "    return df.assign(validated=True)",
                    ])
                },
            }
        ],
    )

    assert result == [{"Apac Number": "A1", "Amount": 10, "validated": True}]


def test_custom_transform_supports_result_variable():
    rows = [{"amount": 10}]
    result = apply_transforms(
        rows,
        [
            {
                "id": "custom",
                "step_type": "custom",
                "step_name": "Custom Transform",
                "parameters": {"code": "result = df.assign(net=df['amount'] - 1)"},
            }
        ],
    )

    assert result == [{"amount": 10, "net": 9}]


def test_custom_transform_supports_numpy_helper():
    rows = [{"amount": 10}, {"amount": 20}]
    result = apply_transforms(
        rows,
        [
            {
                "id": "custom",
                "step_type": "custom",
                "step_name": "Custom Transform",
                "parameters": {
                    "code": "\n".join([
                        "def transform(df):",
                        "    next_df = df.copy()",
                        "    next_df['bucket'] = np.where(next_df['amount'] >= 20, 'high', 'low')",
                        "    return next_df",
                    ])
                },
            }
        ],
    )

    assert result == [{"amount": 10, "bucket": "low"}, {"amount": 20, "bucket": "high"}]


def test_custom_transform_declared_output_columns_help_validation():
    result = validate_transforms(
        ["customer_id", "amount"],
        [
            {
                "id": "custom",
                "step_type": "custom",
                "step_name": "Custom Transform",
                "parameters": {"output_columns": ["customer_id", "net_amount"], "code": "result = df"},
            },
            {
                "id": "select",
                "step_type": "select",
                "step_name": "Select Columns",
                "parameters": {"columns": ["customer_id", "net_amount"]},
            }
        ],
        destination_columns=["customer_id", "net_amount"],
    )

    assert result["errors"] == []


def test_validate_deduplicate_and_sort_missing_columns():
    result = validate_transforms(
        ["customer_id"],
        [
            {
                "id": "dedupe",
                "step_type": "deduplicate",
                "step_name": "Remove Duplicates",
                "parameters": {"columns": ["missing_id"]},
            },
            {
                "id": "sort",
                "step_type": "sort",
                "step_name": "Sort Rows",
                "parameters": {"column": "missing_sort"},
            },
        ],
    )

    assert result["errors"] == [
        "Step 1 Remove Duplicates references missing columns: missing_id",
        "Step 2 Sort Rows references missing columns: missing_sort",
    ]
