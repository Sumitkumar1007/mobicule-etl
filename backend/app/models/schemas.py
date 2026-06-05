from typing import Any, Literal

from pydantic import BaseModel, Field


ConnectorType = Literal["source", "destination"]
RunStatus = Literal["queued", "running", "succeeded", "failed"]
UserRole = Literal["admin", "support", "viewer"]


class ConnectorDefinition(BaseModel):
    key: str
    name: str
    type: ConnectorType
    description: str
    config_schema: dict[str, Any]


class ConnectorTestRequest(BaseModel):
    connector_key: str
    config: dict[str, Any] = Field(default_factory=dict)


class ConnectorTestResponse(BaseModel):
    ok: bool
    message: str


class ResourceCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    connector_key: str
    config: dict[str, Any] = Field(default_factory=dict)


class ResourceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    connector_key: str | None = None
    config: dict[str, Any] | None = None


class Resource(ResourceCreate):
    id: int
    type: ConnectorType
    connection_count: int = 0
    last_sync: str | None = None
    status: str = "-"
    created_at: str
    updated_at: str


class PipelineCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    source_id: int | None = None
    destination_id: int | None = None
    source_key: str
    destination_key: str
    source_config: dict[str, Any] = Field(default_factory=dict)
    destination_config: dict[str, Any] = Field(default_factory=dict)
    transforms: list[dict[str, Any]] = Field(default_factory=list)
    transformation_id: int | None = None
    transformation_version: int | None = None
    schedule: str | None = None


class PipelineUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    source_id: int | None = None
    destination_id: int | None = None
    source_key: str | None = None
    destination_key: str | None = None
    source_config: dict[str, Any] | None = None
    destination_config: dict[str, Any] | None = None
    transforms: list[dict[str, Any]] | None = None
    transformation_id: int | None = None
    transformation_version: int | None = None
    schedule: str | None = None
    enabled: bool | None = None


class Pipeline(PipelineCreate):
    id: int
    enabled: bool = True
    created_at: str
    updated_at: str


class TransformationStep(BaseModel):
    id: str
    step_type: Literal["select", "rename", "cast", "validate", "fillna", "derive", "blank_columns", "filter", "deduplicate", "reorder", "sort", "join", "groupby", "pivot", "value_map", "custom"]
    step_name: str
    is_enabled: bool = True
    note: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)


class TransformationCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str = ""
    source_id: int | None = None
    destination_id: int | None = None
    source_config: dict[str, Any] = Field(default_factory=dict)
    destination_config: dict[str, Any] = Field(default_factory=dict)
    steps: list[TransformationStep] = Field(default_factory=list)


class TransformationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = None
    source_id: int | None = None
    destination_id: int | None = None
    source_config: dict[str, Any] | None = None
    destination_config: dict[str, Any] | None = None
    status: Literal["draft", "published"] | None = None
    steps: list[TransformationStep] | None = None


class Transformation(TransformationCreate):
    id: int
    status: Literal["draft", "published"] = "draft"
    version: int = 1
    created_by: str | None = None
    created_at: str
    updated_at: str


class TransformationVersion(BaseModel):
    id: int
    transformation_id: int
    version_no: int
    snapshot_data: dict[str, Any]
    published_by: str | None = None
    published_at: str


class TransformationPreviewRequest(BaseModel):
    sample_size: int = Field(default=50, ge=1, le=100)
    until_step_id: str | None = None


class TransformationPreviewResponse(BaseModel):
    input_rows: int
    output_rows: int
    input_columns: list[str]
    output_columns: list[str]
    changed_columns: dict[str, list[str]]
    rows: list[dict[str, Any]]
    warnings: list[str] = Field(default_factory=list)
    execution_notes: list[str] = Field(default_factory=list)


class TransformationValidationResponse(BaseModel):
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class Run(BaseModel):
    id: int
    pipeline_id: int
    status: RunStatus
    rows_read: int = 0
    rows_written: int = 0
    error: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    created_at: str


class RunWithPipeline(Run):
    pipeline_name: str | None = None
    duration_seconds: float | None = None


class RunLog(BaseModel):
    id: int
    run_id: int
    level: str
    message: str
    created_at: str


class PreviewRequest(BaseModel):
    source_key: str
    source_config: dict[str, Any] = Field(default_factory=dict)
    transforms: list[dict[str, Any]] = Field(default_factory=list)


class MetadataRequest(BaseModel):
    source_key: str
    source_config: dict[str, Any] = Field(default_factory=dict)


class User(BaseModel):
    id: int
    name: str
    email: str
    role: UserRole
    created_at: str


class UserCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str
    role: UserRole = "viewer"
    password: str = Field(min_length=10, max_length=128)


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    email: str | None = None
    role: UserRole | None = None
    password: str | None = Field(default=None, min_length=10, max_length=128)


class LoginRequest(BaseModel):
    email: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10, max_length=128)


class AuthResponse(BaseModel):
    token: str
    user: User


class AuditLog(BaseModel):
    id: int
    actor_user_id: int | None = None
    actor_email: str | None = None
    action: str
    entity_type: str
    entity_id: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)
    created_at: str


class EtlAuditLog(BaseModel):
    id: int
    run_id: int | None = None
    pipeline_name: str | None = None
    job_type: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    duration_seconds: float | None = None
    status: str
    current_stage: str | None = None
    failed_stage: str | None = None
    source_path: str | None = None
    target_path: str | None = None
    total_count: int = 0
    success_count: int = 0
    failed_count: int = 0
    rejected_count: int = 0
    error_message: str | None = None
    error_file_path: str | None = None
    triggered_by: str | None = None
    created_date: str
    last_modified_date: str
