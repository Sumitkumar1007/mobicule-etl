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
