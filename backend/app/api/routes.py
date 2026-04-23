from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse

from app.connectors.registry import get_connector, list_connectors
from app.db.database import db, decode, encode
from app.models.schemas import (
    ConnectorDefinition,
    AuthResponse,
    ChangePasswordRequest,
    LoginRequest,
    MetadataRequest,
    Pipeline,
    PipelineCreate,
    PipelineUpdate,
    PreviewRequest,
    Resource,
    ResourceCreate,
    ResourceUpdate,
    Run,
    RunLog,
    RunWithPipeline,
    Transformation,
    TransformationCreate,
    TransformationPreviewRequest,
    TransformationPreviewResponse,
    TransformationUpdate,
    TransformationValidationResponse,
    User,
    UserCreate,
)
from app.core.security import hash_password, hash_token, verify_password
from app.services.auth import bearer_token, current_user, login, logout, require_role
from app.services.metadata import source_columns
from app.services.runner import enqueue_run, extract, preview
from app.services.transforms import preview_transforms, validate_transforms

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/auth/login", response_model=AuthResponse)
def auth_login(payload: LoginRequest) -> AuthResponse:
    token, user = login(payload.email, payload.password)
    return AuthResponse(token=token, user=user)


@router.post("/auth/logout")
def auth_logout(request: Request) -> dict[str, str]:
    token = bearer_token(request)
    if token:
        logout(token)
    return {"status": "logged_out"}


@router.get("/auth/me", response_model=User)
def auth_me(request: Request) -> User:
    return current_user(request)


@router.post("/auth/change-password")
def change_password(payload: ChangePasswordRequest, request: Request) -> dict[str, str]:
    user = current_user(request)
    with db() as conn:
        row = conn.execute("SELECT password_hash FROM users WHERE id=?", (user.id,)).fetchone()
        if row is None or not verify_password(payload.current_password, dict(row).get("password_hash")):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        conn.execute(
            "UPDATE users SET password_hash=? WHERE id=?",
            (hash_password(payload.new_password), user.id),
        )
        token = bearer_token(request)
        if token:
            conn.execute(
                """
                UPDATE auth_sessions
                SET revoked_at=CURRENT_TIMESTAMP
                WHERE user_id=? AND token_hash<>? AND revoked_at IS NULL
                """,
                (user.id, hash_token(token)),
            )
    return {"status": "password_changed"}


@router.get("/connectors", response_model=list[ConnectorDefinition])
def connectors() -> list[ConnectorDefinition]:
    return list_connectors()


@router.get("/sources", response_model=list[Resource])
def sources() -> list[Resource]:
    return _resources("source")


@router.post("/sources", response_model=Resource)
def create_source(payload: ResourceCreate, request: Request) -> Resource:
    require_role(request, {"admin"})
    return _create_resource("source", payload)


@router.put("/sources/{resource_id}", response_model=Resource)
def update_source(resource_id: int, payload: ResourceUpdate, request: Request) -> Resource:
    require_role(request, {"admin"})
    return _update_resource("source", resource_id, payload)


@router.delete("/sources/{resource_id}")
def delete_source(resource_id: int, request: Request) -> dict[str, str]:
    require_role(request, {"admin"})
    _delete_resource("source", resource_id)
    return {"status": "deleted"}


@router.get("/destinations", response_model=list[Resource])
def destinations() -> list[Resource]:
    return _resources("destination")


@router.post("/destinations", response_model=Resource)
def create_destination(payload: ResourceCreate, request: Request) -> Resource:
    require_role(request, {"admin"})
    return _create_resource("destination", payload)


@router.put("/destinations/{resource_id}", response_model=Resource)
def update_destination(resource_id: int, payload: ResourceUpdate, request: Request) -> Resource:
    require_role(request, {"admin"})
    return _update_resource("destination", resource_id, payload)


@router.delete("/destinations/{resource_id}")
def delete_destination(resource_id: int, request: Request) -> dict[str, str]:
    require_role(request, {"admin"})
    _delete_resource("destination", resource_id)
    return {"status": "deleted"}


@router.get("/pipelines", response_model=list[Pipeline])
def pipelines() -> list[Pipeline]:
    with db() as conn:
        rows = conn.execute("SELECT * FROM pipelines ORDER BY id DESC").fetchall()
    return [_pipeline_from_row(row) for row in rows]


@router.post("/pipelines", response_model=Pipeline)
def create_pipeline(payload: PipelineCreate, request: Request) -> Pipeline:
    require_role(request, {"admin"})
    try:
        get_connector(payload.source_key)
        get_connector(payload.destination_key)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    with db() as conn:
        row = conn.execute(
            """
            INSERT INTO pipelines
            (name, source_key, destination_key, source_config, destination_config, transforms, schedule)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            RETURNING *
            """,
            (
                payload.name,
                payload.source_key,
                payload.destination_key,
                encode(payload.source_config),
                encode(payload.destination_config),
                encode(payload.transforms),
                payload.schedule,
            ),
        ).fetchone()
    return _pipeline_from_row(row)


@router.put("/pipelines/{pipeline_id}", response_model=Pipeline)
def update_pipeline(pipeline_id: int, payload: PipelineUpdate, request: Request) -> Pipeline:
    require_role(request, {"admin"})
    current = get_pipeline(pipeline_id)
    data = current.model_dump()
    update = payload.model_dump(exclude_unset=True)
    data.update(update)
    with db() as conn:
        row = conn.execute(
            """
            UPDATE pipelines
            SET name=?, source_key=?, destination_key=?, source_config=?, destination_config=?,
                transforms=?, schedule=?, enabled=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=?
            RETURNING *
            """,
            (
                data["name"],
                data["source_key"],
                data["destination_key"],
                encode(data["source_config"]),
                encode(data["destination_config"]),
                encode(data["transforms"]),
                data["schedule"],
                1 if data["enabled"] else 0,
                pipeline_id,
            ),
        ).fetchone()
    return _pipeline_from_row(row)


@router.delete("/pipelines/{pipeline_id}")
def delete_pipeline(pipeline_id: int, request: Request) -> dict[str, str]:
    require_role(request, {"admin"})
    with db() as conn:
        conn.execute("DELETE FROM pipelines WHERE id=?", (pipeline_id,))
    return {"status": "deleted"}


@router.get("/transformations", response_model=list[Transformation])
def transformations() -> list[Transformation]:
    with db() as conn:
        rows = conn.execute("SELECT * FROM transformations ORDER BY id DESC").fetchall()
    return [_transformation_from_row(row) for row in rows]


@router.post("/transformations", response_model=Transformation)
def create_transformation(payload: TransformationCreate, request: Request) -> Transformation:
    require_role(request, {"admin"})
    with db() as conn:
        row = conn.execute(
            """
            INSERT INTO transformations (name, description, source_id, destination_id, steps)
            VALUES (?, ?, ?, ?, ?)
            RETURNING *
            """,
            (payload.name, payload.description, payload.source_id, payload.destination_id, encode([step.model_dump() for step in payload.steps])),
        ).fetchone()
    return _transformation_from_row(row)


@router.get("/transformations/{transformation_id}", response_model=Transformation)
def get_transformation(transformation_id: int) -> Transformation:
    with db() as conn:
        row = conn.execute("SELECT * FROM transformations WHERE id=?", (transformation_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Transformation not found")
    return _transformation_from_row(row)


@router.put("/transformations/{transformation_id}", response_model=Transformation)
def update_transformation(transformation_id: int, payload: TransformationUpdate, request: Request) -> Transformation:
    require_role(request, {"admin"})
    return _update_transformation_record(transformation_id, payload)


def _update_transformation_record(transformation_id: int, payload: TransformationUpdate) -> Transformation:
    current = get_transformation(transformation_id)
    data = current.model_dump()
    update = payload.model_dump(exclude_unset=True)
    data.update(update)
    with db() as conn:
        row = conn.execute(
            """
            UPDATE transformations
            SET name=?, description=?, source_id=?, destination_id=?, status=?, steps=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=?
            RETURNING *
            """,
            (
                data["name"],
                data["description"],
                data["source_id"],
                data["destination_id"],
                data["status"],
                encode(data["steps"]),
                transformation_id,
            ),
        ).fetchone()
    return _transformation_from_row(row)


@router.delete("/transformations/{transformation_id}")
def delete_transformation(transformation_id: int, request: Request) -> dict[str, str]:
    require_role(request, {"admin"})
    with db() as conn:
        conn.execute("DELETE FROM transformations WHERE id=?", (transformation_id,))
    return {"status": "deleted"}


@router.post("/transformations/{transformation_id}/steps", response_model=Transformation)
def add_transformation_step(transformation_id: int, step: dict[str, object], request: Request) -> Transformation:
    require_role(request, {"admin"})
    transformation = get_transformation(transformation_id)
    steps = [item.model_dump() for item in transformation.steps]
    steps.append(step)
    return _update_transformation_record(transformation_id, TransformationUpdate(steps=steps))


@router.put("/transformations/{transformation_id}/steps/reorder", response_model=Transformation)
def reorder_transformation_steps(transformation_id: int, payload: dict[str, list[str]], request: Request) -> Transformation:
    require_role(request, {"admin"})
    transformation = get_transformation(transformation_id)
    order = payload.get("step_ids", [])
    by_id = {item.id: item.model_dump() for item in transformation.steps}
    steps = [by_id[item] for item in order if item in by_id]
    steps.extend(item.model_dump() for item in transformation.steps if item.id not in order)
    return _update_transformation_record(transformation_id, TransformationUpdate(steps=steps))


@router.put("/transformations/{transformation_id}/steps/{step_id}", response_model=Transformation)
def update_transformation_step(transformation_id: int, step_id: str, step: dict[str, object], request: Request) -> Transformation:
    require_role(request, {"admin"})
    transformation = get_transformation(transformation_id)
    steps = [item.model_dump() for item in transformation.steps]
    steps = [step if item["id"] == step_id else item for item in steps]
    return _update_transformation_record(transformation_id, TransformationUpdate(steps=steps))


@router.delete("/transformations/{transformation_id}/steps/{step_id}", response_model=Transformation)
def delete_transformation_step(transformation_id: int, step_id: str, request: Request) -> Transformation:
    require_role(request, {"admin"})
    transformation = get_transformation(transformation_id)
    steps = [item.model_dump() for item in transformation.steps if item.id != step_id]
    return _update_transformation_record(transformation_id, TransformationUpdate(steps=steps))


@router.post("/transformations/{transformation_id}/preview", response_model=TransformationPreviewResponse)
def preview_transformation(transformation_id: int, payload: TransformationPreviewRequest) -> TransformationPreviewResponse:
    transformation = get_transformation(transformation_id)
    source = _resource_by_id(transformation.source_id, "source")
    steps = [step.model_dump() for step in transformation.steps]
    if payload.until_step_id:
        selected_steps = []
        for step in steps:
            selected_steps.append(step)
            if step["id"] == payload.until_step_id:
                break
        steps = selected_steps
    rows = extract(source.connector_key, source.config)[: payload.sample_size]
    result = preview_transforms(rows, steps)
    input_columns = list(rows[0].keys()) if rows else []
    output_columns = list(result.rows[0].keys()) if result.rows else []
    return TransformationPreviewResponse(
        input_rows=len(rows),
        output_rows=len(result.rows),
        input_columns=input_columns,
        output_columns=output_columns,
        changed_columns=result.changed_columns,
        rows=result.rows[: payload.sample_size],
        warnings=result.warnings,
        execution_notes=[log.message for log in result.logs],
    )


@router.post("/transformations/{transformation_id}/validate", response_model=TransformationValidationResponse)
def validate_transformation(transformation_id: int) -> TransformationValidationResponse:
    transformation = get_transformation(transformation_id)
    source = _resource_by_id(transformation.source_id, "source")
    source_key = source.connector_key.replace("_destination", "_source")
    columns = source_columns(source_key, source.config)
    destination_columns: list[str] = []
    if transformation.destination_id:
        destination = _resource_by_id(transformation.destination_id, "destination")
        if destination.connector_key == "postgres_destination":
            try:
                destination_columns = source_columns(destination.connector_key.replace("_destination", "_source"), destination.config)
            except Exception:
                destination_columns = []
    result = validate_transforms(columns, [step.model_dump() for step in transformation.steps], destination_columns)
    return TransformationValidationResponse(**result)


@router.post("/transformations/{transformation_id}/publish", response_model=Transformation)
def publish_transformation(transformation_id: int, request: Request) -> Transformation:
    require_role(request, {"admin"})
    validation = validate_transformation(transformation_id)
    if validation.errors:
        raise HTTPException(status_code=400, detail="; ".join(validation.errors))
    transformation = get_transformation(transformation_id)
    snapshot = transformation.model_dump()
    with db() as conn:
        version = transformation.version + 1 if transformation.status == "published" else transformation.version
        row = conn.execute(
            """
            UPDATE transformations
            SET status='published', version=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=?
            RETURNING *
            """,
            (version, transformation_id),
        ).fetchone()
        conn.execute(
            """
            INSERT INTO transformation_versions (transformation_id, version_no, snapshot_data)
            VALUES (?, ?, ?)
            """,
            (transformation_id, version, encode(snapshot)),
        )
    return _transformation_from_row(row)


@router.get("/pipelines/{pipeline_id}", response_model=Pipeline)
def get_pipeline(pipeline_id: int) -> Pipeline:
    with db() as conn:
        row = conn.execute("SELECT * FROM pipelines WHERE id=?", (pipeline_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return _pipeline_from_row(row)


@router.post("/pipelines/{pipeline_id}/runs", response_model=Run)
def start_run(pipeline_id: int, request: Request) -> Run:
    require_role(request, {"admin", "support"})
    with db() as conn:
        exists = conn.execute("SELECT 1 FROM pipelines WHERE id=?", (pipeline_id,)).fetchone()
    if exists is None:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    run_id = enqueue_run(pipeline_id)
    return get_run(run_id)


@router.post("/runs/{run_id}/stop", response_model=Run)
def stop_run(run_id: int, request: Request) -> Run:
    require_role(request, {"admin", "support"})
    with db() as conn:
        conn.execute(
            """
            UPDATE runs
            SET status='failed', error='Stopped by user', finished_at=CURRENT_TIMESTAMP
            WHERE id=? AND status IN ('queued', 'running')
            """,
            (run_id,),
        )
    return get_run(run_id)


@router.get("/runs", response_model=list[RunWithPipeline])
def runs() -> list[RunWithPipeline]:
    with db() as conn:
        rows = conn.execute(
            """
            SELECT r.*, p.name AS pipeline_name
            FROM runs r
            LEFT JOIN pipelines p ON p.id = r.pipeline_id
            ORDER BY r.id DESC LIMIT 20
            """
        ).fetchall()
    return [_run_from_row(row) for row in rows]


@router.get("/runs/{run_id}", response_model=Run)
def get_run(run_id: int) -> Run:
    with db() as conn:
        row = conn.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return Run(**dict(row))


@router.get("/runs/{run_id}/logs", response_model=list[RunLog])
def run_logs(run_id: int) -> list[RunLog]:
    with db() as conn:
        rows = conn.execute("SELECT * FROM run_logs WHERE run_id=? ORDER BY id ASC", (run_id,)).fetchall()
    return [RunLog(**dict(row)) for row in rows]


@router.get("/runs/{run_id}/logs/download")
def download_logs(run_id: int) -> PlainTextResponse:
    logs = run_logs(run_id)
    text = "\n".join(f"{log.created_at} [{log.level}] {log.message}" for log in logs)
    return PlainTextResponse(
        text,
        headers={"Content-Disposition": f'attachment; filename="run-{run_id}.log"'},
    )


@router.get("/users", response_model=list[User])
def users(request: Request) -> list[User]:
    require_role(request, {"admin"})
    with db() as conn:
        rows = conn.execute("SELECT id, name, email, role, created_at FROM users ORDER BY id DESC").fetchall()
    return [User(**dict(row)) for row in rows]


@router.post("/users", response_model=User)
def create_user(payload: UserCreate, request: Request) -> User:
    require_role(request, {"admin"})
    with db() as conn:
        row = conn.execute(
            """
            INSERT INTO users (name, email, role, password_hash)
            VALUES (?, ?, ?, ?)
            RETURNING id, name, email, role, created_at
            """,
            (payload.name, payload.email, payload.role, hash_password(payload.password)),
        ).fetchone()
    return User(**dict(row))


@router.post("/preview")
def preview_rows(payload: PreviewRequest) -> dict[str, object]:
    try:
        rows = preview(payload.source_key, payload.source_config, payload.transforms)
    except Exception as exc:
        return {"rows": [], "count": 0, "error": str(exc)}
    return {"rows": rows, "count": len(rows)}


@router.post("/metadata/columns")
def metadata_columns(payload: MetadataRequest) -> dict[str, object]:
    try:
        columns = source_columns(payload.source_key, payload.source_config)
    except Exception as exc:
        return {"columns": [], "error": str(exc)}
    return {"columns": columns}


def _resources(kind: str) -> list[Resource]:
    with db() as conn:
        rows = conn.execute("SELECT * FROM resources WHERE type=? ORDER BY id DESC", (kind,)).fetchall()
    return [_resource_from_row(row) for row in rows]


def _create_resource(kind: str, payload: ResourceCreate) -> Resource:
    try:
        connector = get_connector(payload.connector_key)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if connector.type != kind:
        raise HTTPException(status_code=400, detail=f"{payload.connector_key} is not a {kind}")
    with db() as conn:
        row = conn.execute(
            """
            INSERT INTO resources (name, type, connector_key, config)
            VALUES (?, ?, ?, ?)
            RETURNING *
            """,
            (payload.name, kind, payload.connector_key, encode(payload.config)),
        ).fetchone()
    return _resource_from_row(row)


def _update_resource(kind: str, resource_id: int, payload: ResourceUpdate) -> Resource:
    with db() as conn:
        row = conn.execute("SELECT * FROM resources WHERE id=? AND type=?", (resource_id, kind)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"{kind} not found")
    current = _resource_from_row(row).model_dump()
    update = payload.model_dump(exclude_unset=True)
    current.update(update)
    if current["connector_key"]:
        connector = get_connector(current["connector_key"])
        if connector.type != kind:
            raise HTTPException(status_code=400, detail=f"{current['connector_key']} is not a {kind}")
    with db() as conn:
        row = conn.execute(
            """
            UPDATE resources
            SET name=?, connector_key=?, config=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND type=?
            RETURNING *
            """,
            (current["name"], current["connector_key"], encode(current["config"]), resource_id, kind),
        ).fetchone()
    return _resource_from_row(row)


def _delete_resource(kind: str, resource_id: int) -> None:
    with db() as conn:
        conn.execute("DELETE FROM resources WHERE id=? AND type=?", (resource_id, kind))


def _resource_from_row(row) -> Resource:
    data = dict(row)
    data["config"] = decode(data["config"])
    return Resource(**data)


def _resource_by_id(resource_id: int | None, kind: str) -> Resource:
    if resource_id is None:
        raise HTTPException(status_code=400, detail=f"Select {kind} first")
    with db() as conn:
        row = conn.execute("SELECT * FROM resources WHERE id=? AND type=?", (resource_id, kind)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"{kind.title()} not found")
    return _resource_from_row(row)


def _transformation_from_row(row) -> Transformation:
    data = dict(row)
    data["steps"] = decode(data["steps"])
    return Transformation(**data)


def _pipeline_from_row(row) -> Pipeline:
    data = dict(row)
    data["enabled"] = bool(data["enabled"])
    data["source_config"] = decode(data["source_config"])
    data["destination_config"] = decode(data["destination_config"])
    data["transforms"] = decode(data["transforms"])
    return Pipeline(**data)


def _run_from_row(row) -> RunWithPipeline:
    data = dict(row)
    data["duration_seconds"] = _duration(data.get("started_at"), data.get("finished_at"))
    return RunWithPipeline(**data)


def _duration(started_at: str | None, finished_at: str | None) -> float | None:
    if not started_at or not finished_at:
        return None
    from datetime import datetime

    try:
        start = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
        finish = datetime.fromisoformat(finished_at.replace("Z", "+00:00"))
        return round((finish - start).total_seconds(), 2)
    except ValueError:
        return None
