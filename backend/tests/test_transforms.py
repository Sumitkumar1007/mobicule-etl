from app.services.transforms import apply_transforms


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
