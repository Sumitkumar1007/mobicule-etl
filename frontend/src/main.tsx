import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API = import.meta.env.VITE_API_URL ?? "http://10.10.0.10:8000/api";
const SESSION_KEY = "mobiflow_session";

type Connector = {
  key: string;
  name: string;
  type: "source" | "destination";
  description: string;
  config_schema: {
    required?: string[];
    properties?: Record<string, SchemaProperty>;
  };
};

type SchemaProperty = {
  type?: string;
  default?: unknown;
  enum?: string[];
  secret?: boolean;
};

type Pipeline = {
  id: number;
  name: string;
  source_id?: number | null;
  destination_id?: number | null;
  source_key: string;
  destination_key: string;
  source_config: Record<string, unknown>;
  destination_config: Record<string, unknown>;
  transforms: Record<string, unknown>[];
  transformation_id?: number | null;
  transformation_version?: number | null;
  schedule?: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type Run = {
  id: number;
  pipeline_id: number;
  pipeline_name?: string;
  status: "queued" | "running" | "succeeded" | "failed";
  rows_read: number;
  rows_written: number;
  error?: string;
  duration_seconds?: number;
  started_at?: string;
  finished_at?: string;
  created_at: string;
};

type RunLog = {
  id: number;
  run_id: number;
  level: string;
  message: string;
  created_at: string;
};

type EtlAuditLog = {
  id: number;
  run_id?: number | null;
  pipeline_name?: string | null;
  job_type?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  duration_seconds?: number | null;
  status: string;
  current_stage?: string | null;
  failed_stage?: string | null;
  source_path?: string | null;
  target_path?: string | null;
  total_count: number;
  success_count: number;
  failed_count: number;
  rejected_count: number;
  error_message?: string | null;
  error_file_path?: string | null;
  triggered_by?: string | null;
  created_date: string;
  last_modified_date: string;
};

type Resource = {
  id: number;
  name: string;
  type: "source" | "destination";
  connector_key: string;
  config: Record<string, unknown>;
  connection_count: number;
  last_sync?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type User = {
  id: number;
  name: string;
  email: string;
  role: "superuser" | "admin" | "support" | "viewer";
  created_at: string;
};
type AuthSession = { token: string; user: User };

type StepType = "select" | "rename" | "cast" | "validate" | "pii_encrypt" | "fillna" | "derive" | "blank_columns" | "filter" | "deduplicate" | "reorder" | "sort" | "join" | "groupby" | "pivot" | "value_map" | "custom";
type Operand = { kind: "column" | "constant"; value: string };
type TransformationStep = {
  id: string;
  step_type: StepType;
  step_name: string;
  is_enabled: boolean;
  note?: string;
  parameters: Record<string, unknown>;
};
type Transformation = {
  id: number;
  name: string;
  description: string;
  source_id?: number | null;
  destination_id?: number | null;
  source_config: Record<string, unknown>;
  destination_config: Record<string, unknown>;
  status: "draft" | "published";
  version: number;
  steps: TransformationStep[];
  created_at: string;
  updated_at: string;
};
type TransformationVersion = {
  id: number;
  transformation_id: number;
  version_no: number;
  snapshot_data: Transformation;
  published_by?: string | null;
  published_at: string;
};
type TransformationPreview = {
  input_rows: number;
  output_rows: number;
  input_columns: string[];
  output_columns: string[];
  changed_columns: Record<string, string[]>;
  rows: Record<string, unknown>[];
  warnings: string[];
  execution_notes: string[];
};
type ValidationResult = { errors: string[]; warnings: string[] };
type Toast = { tone: "ok" | "bad"; text: string } | null;
type Menu = "datasources" | "destinations" | "transforms" | "pipelines" | "runs" | "audit" | "access";
type StepValidationState = { errors: string[]; warnings: string[] };
type ScheduleMode = "manual" | "hourly" | "daily" | "weekly" | "monthly" | "custom";
type ScheduleBuilder = {
  mode: ScheduleMode;
  everyHours: string;
  time: string;
  weekday: string;
  dayOfMonth: string;
  cron: string;
};

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => loadSession()?.user ?? null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [sourceResources, setSourceResources] = useState<Resource[]>([]);
  const [destinationResources, setDestinationResources] = useState<Resource[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [transformations, setTransformations] = useState<Transformation[]>([]);
  const [transformationVersions, setTransformationVersions] = useState<TransformationVersion[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [auditLogs, setAuditLogs] = useState<EtlAuditLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedRun, setSelectedRun] = useState<number | null>(null);
  const [selectedAuditId, setSelectedAuditId] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [activeMenu, setActiveMenu] = useState<Menu>("datasources");
  const [showPasswordPanel, setShowPasswordPanel] = useState(false);
  const [resourceName, setResourceName] = useState("");
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [editingPipelineId, setEditingPipelineId] = useState<number | null>(null);
  const [testingConnectorKey, setTestingConnectorKey] = useState<string | null>(null);
  const [sourceColumns, setSourceColumns] = useState<string[]>([]);
  const [destinationColumns, setDestinationColumns] = useState<string[]>([]);
  const [sourceTargetOptions, setSourceTargetOptions] = useState<{ tables: string[]; paths: string[]; sheets: string[] }>({ tables: [], paths: [], sheets: [] });
  const [destinationTargetOptions, setDestinationTargetOptions] = useState<{ tables: string[]; paths: string[]; sheets: string[] }>({ tables: [], paths: [], sheets: [] });
  const lastSourceOptionsKey = useRef("");
  const lastDestinationOptionsKey = useRef("");
  const [columnSearch, setColumnSearch] = useState("");
  const [activeTransformationId, setActiveTransformationId] = useState<number | null>(null);
  const [previewData, setPreviewData] = useState<TransformationPreview | null>(null);
  const [validationData, setValidationData] = useState<ValidationResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState<"input" | "output" | "validation" | "notes">("output");
  const [sampleSize, setSampleSize] = useState(50);
  const [previewStepId, setPreviewStepId] = useState("");
  const [transformationDraft, setTransformationDraft] = useState({
    name: "Customer cleanup",
    description: "Standardize customer data before loading",
    source_id: "",
    destination_id: "",
    source_config: {} as Record<string, unknown>,
    destination_config: {} as Record<string, unknown>,
    status: "draft" as Transformation["status"],
    version: 1,
    steps: [] as TransformationStep[]
  });
  const [userForm, setUserForm] = useState({ name: "", email: "", password: "", role: "viewer" as User["role"] });
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [passwordForm, setPasswordForm] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [scheduleBuilder, setScheduleBuilder] = useState<ScheduleBuilder>(() => parseScheduleToBuilder(""));
  const [form, setForm] = useState({
    name: "Customer pipeline",
    source_id: "",
    destination_id: "",
    transformation_id: "",
    transformation_version: "latest",
    source_key: "postgres_source",
    destination_key: "postgres_destination",
    source_config: sampleConfigForKey("postgres_source"),
    destination_config: sampleConfigForKey("postgres_destination"),
    transforms: "[]",
    schedule: ""
  });

  const sources = connectors.filter((item) => item.type === "source");
  const destinations = connectors.filter((item) => item.type === "destination");
  const isSuperuser = currentUser?.role === "superuser";
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "superuser";
  const canRun = currentUser?.role === "superuser" || currentUser?.role === "admin" || currentUser?.role === "support";
  const latestRun = runs[0];
  const metrics = useMemo(
    () => ({
      pipelines: pipelines.length,
      success: runs.filter((run) => run.status === "succeeded").length,
      failed: runs.filter((run) => run.status === "failed").length
    }),
    [pipelines, runs]
  );
  const selectedTransformationVersions = transformationVersions.filter((item) => String(item.transformation_id) === form.transformation_id);
  const selectedAuditLog = auditLogs.find((item) => item.id === selectedAuditId) ?? auditLogs[0];

  async function refresh() {
    const [connectorData, sourceData, destinationData, pipelineData, transformationData, transformationVersionData, runData, auditData, userData] = await Promise.all([
      api<Connector[]>("/connectors"),
      api<Resource[]>("/sources"),
      api<Resource[]>("/destinations"),
      api<Pipeline[]>("/pipelines"),
      api<Transformation[]>("/transformations"),
      api<TransformationVersion[]>("/transformation-versions"),
      api<Run[]>("/runs"),
      canRun ? api<EtlAuditLog[]>("/etl-audit-logs") : Promise.resolve([]),
      isSuperuser ? api<User[]>("/users") : Promise.resolve([])
    ]);
    setConnectors(connectorData);
    setSourceResources(sourceData);
    setDestinationResources(destinationData);
    setPipelines(pipelineData);
    setTransformations(transformationData);
    setTransformationVersions(transformationVersionData);
    setRuns(runData);
    setAuditLogs(auditData);
    setUsers(userData);
    setForm((current) => ({
      ...current,
      source_config: refreshedConfig(current.source_config, connectorData.find((item) => item.key === current.source_key) ?? connectorData.find((item) => item.key === "postgres_source")),
      destination_config: refreshedConfig(current.destination_config, connectorData.find((item) => item.key === current.destination_key) ?? connectorData.find((item) => item.key === "postgres_destination")),
      transformation_id: current.transformation_id || String(transformationData.find((item) => item.status === "published")?.id ?? "")
    }));
    setTransformationDraft((current) => ({
      ...current,
      source_id: current.source_id || String(sourceData[0]?.id ?? ""),
      destination_id: current.destination_id || String(destinationData[0]?.id ?? "")
    }));
  }

  useEffect(() => {
    if (!currentUser) return;
    refresh().catch(showError);
  }, [currentUser, isSuperuser, canRun]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.querySelector(".workspace")?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [activeMenu]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const expectedPath = currentUser ? "/" : "/login";
    if (window.location.pathname !== expectedPath) {
      window.history.replaceState({}, "", expectedPath);
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || activeMenu === "transforms") return;
    const timer = window.setInterval(() => refresh().catch(showError), 4000);
    return () => window.clearInterval(timer);
  }, [currentUser, activeMenu]);

  useEffect(() => {
    if (currentUser && !["admin", "superuser"].includes(currentUser.role) && activeMenu === "access") {
      setActiveMenu("datasources");
    }
    if (currentUser && !["superuser", "admin", "support"].includes(currentUser.role) && activeMenu === "audit") {
      setActiveMenu("datasources");
    }
  }, [currentUser, activeMenu]);

  useEffect(() => {
    if (!selectedRun) return;
    api<RunLog[]>(`/runs/${selectedRun}/logs`).then(setLogs).catch(showError);
  }, [selectedRun, runs]);

  useEffect(() => {
    if (activeMenu !== "transforms" || !transformationDraft.source_id) return;
    const resource = sourceResources.find((item) => String(item.id) === transformationDraft.source_id);
    if (!resource || resource.connector_key === "sftp_source") return;
    loadColumnsFor(resource, "source", transformationDraft.source_config).catch(showError);
  }, [activeMenu, transformationDraft.source_id, transformationDraft.source_config, sourceResources]);

  useEffect(() => {
    if (activeMenu !== "transforms" || !transformationDraft.source_id) return;
    const resource = sourceResources.find((item) => String(item.id) === transformationDraft.source_id);
    if (!resource) return;
    const key = `${resource.id}:${stableJson(transformationDraft.source_config)}`;
    if (lastSourceOptionsKey.current === key) return;
    lastSourceOptionsKey.current = key;
    loadTargetOptions(resource, transformationDraft.source_config, "source").catch(showError);
  }, [activeMenu, transformationDraft.source_id, transformationDraft.source_config, sourceResources]);

  useEffect(() => {
    if (activeMenu !== "transforms" || !transformationDraft.destination_id) return;
    const resource = destinationResources.find((item) => String(item.id) === transformationDraft.destination_id);
    if (!resource) return;
    const key = `${resource.id}:${stableJson(transformationDraft.destination_config)}`;
    if (lastDestinationOptionsKey.current === key) return;
    lastDestinationOptionsKey.current = key;
    loadTargetOptions(resource, transformationDraft.destination_config, "destination").catch(showError);
  }, [activeMenu, transformationDraft.destination_id, transformationDraft.destination_config, destinationResources]);

  async function savePipeline() {
    const selectedTransformation = transformations.find((item) => String(item.id) === form.transformation_id);
    const selectedVersion = transformationVersions.find(
      (item) => String(item.transformation_id) === form.transformation_id && String(item.version_no) === form.transformation_version
    );
    const versionSnapshot = selectedVersion?.snapshot_data;
    const effectiveTransformation = versionSnapshot ?? selectedTransformation;
    const selectedSource = sourceResources.find((item) => item.id === effectiveTransformation?.source_id);
    const selectedDestination = destinationResources.find((item) => item.id === effectiveTransformation?.destination_id);
    if (!effectiveTransformation || !selectedSource || !selectedDestination) {
      throw new Error("Select a transformation with datasource and destination");
    }
    const payload = {
      name: form.name,
      source_id: Number(selectedSource.id),
      destination_id: Number(selectedDestination.id),
      source_key: selectedSource.connector_key,
      destination_key: selectedDestination.connector_key,
      source_config: { ...selectedSource.config, ...(effectiveTransformation?.source_config ?? {}) },
      destination_config: { ...selectedDestination.config, ...(effectiveTransformation?.destination_config ?? {}) },
      transforms: selectedVersion ? stepsFromVersion(selectedVersion) : selectedTransformation?.steps ?? [],
      transformation_id: Number(form.transformation_id),
      transformation_version: selectedVersion ? selectedVersion.version_no : null,
      schedule: normalizedSchedule(form.schedule)
    };
    await api<Pipeline>(editingPipelineId ? `/pipelines/${editingPipelineId}` : "/pipelines", {
      method: editingPipelineId ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    setToast({ tone: "ok", text: editingPipelineId ? "Pipeline updated" : "Pipeline saved" });
    setEditingPipelineId(null);
    await refresh();
  }

  async function runPipeline(id: number) {
    const run = await api<Run>(`/pipelines/${id}/runs`, { method: "POST" });
    setSelectedRun(run.id);
    setToast({ tone: "ok", text: `Run ${run.id} queued` });
    await refresh();
  }

  async function createResource(kind: "source" | "destination") {
    const connectorKey = kind === "source" ? form.source_key : form.destination_key;
    const config = kind === "source" ? form.source_config : form.destination_config;
    const fallbackName = labelFor(connectors, connectorKey);
    const path = kind === "source" ? "/sources" : "/destinations";
    const target = editingResource ? `${path}/${editingResource.id}` : path;
    await api<Resource>(target, {
      method: editingResource ? "PUT" : "POST",
      body: JSON.stringify({
        name: resourceName || fallbackName,
        connector_key: connectorKey,
        config: sanitizeConnectorConfig(connectorKey, parseJson(config))
      })
    });
    setToast({ tone: "ok", text: `${kind === "source" ? "Datasource" : "Destination"} ${editingResource ? "updated" : "created"}` });
    setResourceName("");
    setEditingResource(null);
    await refresh();
  }

  async function deleteResource(kind: "source" | "destination", id: number) {
    await api(kind === "source" ? `/sources/${id}` : `/destinations/${id}`, { method: "DELETE" });
    setToast({ tone: "ok", text: `${kind === "source" ? "Datasource" : "Destination"} deleted` });
    await refresh();
  }

  async function deletePipeline(id: number) {
    await api(`/pipelines/${id}`, { method: "DELETE" });
    setToast({ tone: "ok", text: "Pipeline deleted" });
    await refresh();
  }

  async function setPipelineEnabled(pipeline: Pipeline, enabled: boolean) {
    await api<Pipeline>(`/pipelines/${pipeline.id}`, {
      method: "PUT",
      body: JSON.stringify({ enabled })
    });
    setToast({ tone: "ok", text: `Pipeline ${enabled ? "enabled" : "disabled"}` });
    await refresh();
  }

  async function testConnector(connectorKey: string, config: Record<string, unknown>, label: string) {
    setTestingConnectorKey(label);
    try {
      const result = await api<{ ok: boolean; message: string }>("/connectors/test", {
        method: "POST",
        body: JSON.stringify({ connector_key: connectorKey, config })
      });
      setToast({ tone: result.ok ? "ok" : "bad", text: result.message });
    } finally {
      setTestingConnectorKey(null);
    }
  }

  async function stopRun(id: number) {
    await api<Run>(`/runs/${id}/stop`, { method: "POST" });
    setToast({ tone: "ok", text: `Run ${id} stopped` });
    await refresh();
  }

  async function downloadRunLogs(id: number) {
    const text = await apiText(`/runs/${id}/logs/download`);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `run-${id}-logs.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function saveUser() {
    const payload = editingUserId && !userForm.password ? { name: userForm.name, email: userForm.email, role: userForm.role } : userForm;
    await api<User>(editingUserId ? `/users/${editingUserId}` : "/users", {
      method: editingUserId ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    setEditingUserId(null);
    setUserForm({ name: "", email: "", password: "", role: "viewer" });
    setToast({ tone: "ok", text: editingUserId ? "User updated" : "User created" });
    await refresh();
  }

  async function deleteUser(id: number) {
    await api(`/users/${id}`, { method: "DELETE" });
    setToast({ tone: "ok", text: "User deleted" });
    await refresh();
  }

  async function changePassword() {
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      throw new Error("New password and confirm password do not match");
    }
    await api<{ status: string }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password
      })
    });
    setPasswordForm({ current_password: "", new_password: "", confirm_password: "" });
    setShowPasswordPanel(false);
    setToast({ tone: "ok", text: "Password changed" });
  }

  async function saveTransformationDraft() {
    const payload = transformationPayload(transformationDraft);
    const saved = activeTransformationId
      ? await api<Transformation>(`/transformations/${activeTransformationId}`, { method: "PUT", body: JSON.stringify(payload) })
      : await api<Transformation>("/transformations", { method: "POST", body: JSON.stringify(payload) });
    loadTransformation(saved);
    setToast({ tone: "ok", text: "Transformation draft saved" });
    await refresh();
    return saved;
  }

  async function previewTransformation() {
    const transformationId = isAdmin ? (await saveTransformationDraft()).id : activeTransformationId;
    if (!transformationId) {
      throw new Error("Select an existing transformation to preview");
    }
    const result = await api<TransformationPreview>(`/transformations/${transformationId}/preview`, {
      method: "POST",
      body: JSON.stringify({ sample_size: sampleSize, until_step_id: previewStepId || null })
    });
    setPreviewData(result);
    setPreviewOpen(true);
    setPreviewTab("output");
    setToast({ tone: "ok", text: "Preview refreshed" });
  }

  async function validateTransformationDraft() {
    const transformationId = isAdmin ? (await saveTransformationDraft()).id : activeTransformationId;
    if (!transformationId) {
      throw new Error("Select an existing transformation to validate");
    }
    const result = await api<ValidationResult>(`/transformations/${transformationId}/validate`, { method: "POST" });
    setValidationData(result);
    setPreviewOpen(true);
    setPreviewTab("validation");
    setToast({ tone: result.errors.length ? "bad" : "ok", text: result.errors.length ? "Validation failed" : "Validation passed" });
  }

  async function publishTransformationDraft() {
    const saved = await saveTransformationDraft();
    const result = await api<Transformation>(`/transformations/${saved.id}/publish`, { method: "POST" });
    loadTransformation(result);
    setForm({ ...form, transformation_id: String(result.id), transformation_version: "latest", source_id: String(result.source_id ?? ""), destination_id: String(result.destination_id ?? "") });
    setToast({ tone: "ok", text: `Published v${result.version}` });
    await refresh();
  }

  function loadTransformation(transformation: Transformation) {
    setActiveTransformationId(transformation.id);
    setTransformationDraft({
      name: transformation.name,
      description: transformation.description,
      source_id: String(transformation.source_id ?? ""),
      destination_id: String(transformation.destination_id ?? ""),
      source_config: transformation.source_config ?? {},
      destination_config: transformation.destination_config ?? {},
      status: transformation.status,
      version: transformation.version,
      steps: transformation.steps
    });
    setPreviewData(null);
    setValidationData(null);
    setPreviewOpen(false);
  }

  function startNewTransformation() {
    setActiveTransformationId(null);
    setTransformationDraft({
      name: "Customer cleanup",
      description: "Standardize customer data before loading",
      source_id: String(sourceResources[0]?.id ?? ""),
      destination_id: String(destinationResources[0]?.id ?? ""),
      source_config: {},
      destination_config: {},
      status: "draft",
      version: 1,
      steps: []
    });
    setPreviewData(null);
    setValidationData(null);
    setPreviewOpen(false);
    setPreviewStepId("");
  }

  function duplicateTransformationDraft() {
    setActiveTransformationId(null);
    setTransformationDraft((current) => ({
      ...current,
      name: `${current.name || "Transformation"} copy`,
      status: "draft",
      version: 1,
      steps: current.steps.map((step) => ({ ...step, id: makeId(), step_name: step.step_name }))
    }));
    setPreviewData(null);
    setValidationData(null);
    setPreviewOpen(false);
    setPreviewStepId("");
    setToast({ tone: "ok", text: "Transformation copied as new draft" });
  }

  function updateStep(stepId: string, updater: (step: TransformationStep) => TransformationStep) {
    setTransformationDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => step.id === stepId ? updater(step) : step)
    }));
  }

  function addStep(stepType: StepType) {
    setTransformationDraft((current) => ({ ...current, steps: [...current.steps, emptyStep(stepType)] }));
  }

  function moveStep(stepId: string, direction: -1 | 1) {
    setTransformationDraft((current) => {
      const steps = [...current.steps];
      const index = steps.findIndex((step) => step.id === stepId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= steps.length) return current;
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...current, steps };
    });
  }

  async function loadColumnsFor(resource: Resource, target: "source" | "destination", overrides: Record<string, unknown> = {}) {
    const metadataKey = resource.connector_key.replace("_destination", "_source");
    const merged = { ...resource.config, ...overrides };
    if (!canLoadColumns(resource.connector_key, merged)) {
      if (target === "source") setSourceColumns([]);
      else setDestinationColumns([]);
      return;
    }
    const payload = { source_key: metadataKey, source_config: merged };
    const result = await api<{ columns: string[]; error?: string }>("/metadata/columns", { method: "POST", body: JSON.stringify(payload) });
    if (result.error) setToast({ tone: "bad", text: result.error });
    if (target === "source") setSourceColumns(result.columns);
    else setDestinationColumns(result.columns);
  }

  async function loadTargetOptions(resource: Resource, overrides: Record<string, unknown>, target: "source" | "destination") {
    const metadataKey = resource.connector_key.replace("_destination", "_source");
    const merged = { ...resource.config, ...overrides };
    const result = await api<{ tables: string[]; paths: string[]; sheets?: string[]; error?: string }>("/metadata/options", {
      method: "POST",
      body: JSON.stringify({ source_key: metadataKey, source_config: merged })
    });
    const next = { tables: result.tables ?? [], paths: result.paths ?? [], sheets: result.sheets ?? [] };
    if (target === "source") setSourceTargetOptions(next);
    else setDestinationTargetOptions(next);
    if (result.error) setToast({ tone: "bad", text: result.error });
  }

  function showError(error: unknown) {
    setToast({ tone: "bad", text: error instanceof Error ? error.message : "Request failed" });
  }

  function applyScheduleBuilder(next: ScheduleBuilder) {
    const schedule = buildScheduleCron(next);
    setScheduleBuilder(next);
    setForm((current) => ({ ...current, schedule }));
  }

  async function login() {
    const session = await api<AuthSession>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: loginEmail, password: loginPassword })
    });
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    setCurrentUser(session.user);
    setLoginPassword("");
    setToast({ tone: "ok", text: `Welcome ${session.user.name}` });
    await refresh();
  }

  async function logout() {
    try {
      await api<{ status: string }>("/auth/logout", { method: "POST" });
    } catch {
      // Session may already be expired. Local logout still needs to complete.
    } finally {
      setCurrentUser(null);
      localStorage.removeItem(SESSION_KEY);
      setConnectors([]);
      setSourceResources([]);
      setDestinationResources([]);
      setPipelines([]);
      setTransformations([]);
      setRuns([]);
      setLogs([]);
      setUsers([]);
    }
  }

  if (!currentUser) {
    return (
      <LoginPage
        loginEmail={loginEmail}
        loginPassword={loginPassword}
        onEmail={setLoginEmail}
        onPassword={setLoginPassword}
        onLogin={() => login().catch(showError)}
        toast={toast}
        onToast={setToast}
      />
    );
  }

  return (
    <main className={previewOpen ? "shell modalOpen" : "shell"}>
      <aside className="rail">
        <div className="brand">
          <LogoImage className="logoImage" />
          <strong className="brandTagline">ETL TOOL - INHOUSE</strong>
        </div>
        <nav>
          <button className={activeMenu === "datasources" ? "active" : ""} onClick={() => setActiveMenu("datasources")}>Data Source</button>
          <button className={activeMenu === "destinations" ? "active" : ""} onClick={() => setActiveMenu("destinations")}>Destination</button>
          <button className={activeMenu === "transforms" ? "active" : ""} onClick={() => setActiveMenu("transforms")}>Transform</button>
          <button className={activeMenu === "pipelines" ? "active" : ""} onClick={() => setActiveMenu("pipelines")}>Pipelines</button>
          <button className={activeMenu === "runs" ? "active" : ""} onClick={() => setActiveMenu("runs")}>Runs & Logs</button>
          {canRun && <button className={activeMenu === "audit" ? "active" : ""} onClick={() => setActiveMenu("audit")}>ETL Audit</button>}
          {isAdmin && <button className={activeMenu === "access" ? "active" : ""} onClick={() => setActiveMenu("access")}>Access Control</button>}
        </nav>
        <div className="railFooter">
          <button className="ghost logoutButton" onClick={logout}>Logout</button>
        </div>
      </aside>

      <section className="workspace">
        {showPasswordPanel && activeMenu === "access" && (
          <section className="panel accountPanel">
            <div className="panelHead">
              <div>
                <p className="eyebrow">Account</p>
                <h2>Change Password</h2>
              </div>
            </div>
            <div className="formGrid three">
              <label>Current password<input type="password" value={passwordForm.current_password} onChange={(event) => setPasswordForm({ ...passwordForm, current_password: event.target.value })} /></label>
              <label>New password<input type="password" minLength={10} value={passwordForm.new_password} onChange={(event) => setPasswordForm({ ...passwordForm, new_password: event.target.value })} /></label>
              <label>Confirm password<input type="password" minLength={10} value={passwordForm.confirm_password} onChange={(event) => setPasswordForm({ ...passwordForm, confirm_password: event.target.value })} /></label>
            </div>
            <div className="actions">
              <button className="primary" onClick={() => changePassword().catch(showError)}>Update password</button>
              <button className="ghost" onClick={() => setShowPasswordPanel(false)}>Cancel</button>
            </div>
          </section>
        )}

        {activeMenu === "datasources" && (
          <ConnectorCatalog
            title="Data Sources"
            eyebrow="Input connectors"
            connectors={sources}
            resources={sourceResources}
            selectedKey={form.source_key}
            resourceName={resourceName}
            configValue={form.source_config}
            onNameChange={setResourceName}
            onConfigChange={(value) => setForm({ ...form, source_config: value })}
            onCreate={() => createResource("source").catch(showError)}
            onTest={(connectorKey, config, label) => testConnector(connectorKey, config, label).catch(showError)}
            testingKey={testingConnectorKey}
            onDelete={(id) => deleteResource("source", id).catch(showError)}
            onEdit={(resource) => {
              setEditingResource(resource);
              setResourceName(resource.name);
              setForm({ ...form, source_key: resource.connector_key, source_config: JSON.stringify(resource.config, null, 2) });
            }}
            onSelect={(connector) => {
              setEditingResource(null);
              setResourceName(connector.name);
              setForm({ ...form, source_key: connector.key, source_config: sampleConfig(connector) });
            }}
            isEditing={Boolean(editingResource)}
            readOnly={!isAdmin}
          />
        )}

        {activeMenu === "destinations" && (
          <ConnectorCatalog
            title="Destinations"
            eyebrow="Output connectors"
            connectors={destinations}
            resources={destinationResources}
            selectedKey={form.destination_key}
            resourceName={resourceName}
            configValue={form.destination_config}
            onNameChange={setResourceName}
            onConfigChange={(value) => setForm({ ...form, destination_config: value })}
            onCreate={() => createResource("destination").catch(showError)}
            onTest={(connectorKey, config, label) => testConnector(connectorKey, config, label).catch(showError)}
            testingKey={testingConnectorKey}
            onDelete={(id) => deleteResource("destination", id).catch(showError)}
            onEdit={(resource) => {
              setEditingResource(resource);
              setResourceName(resource.name);
              setForm({ ...form, destination_key: resource.connector_key, destination_config: JSON.stringify(resource.config, null, 2) });
            }}
            onSelect={(connector) => {
              setEditingResource(null);
              setResourceName(connector.name);
              setForm({ ...form, destination_key: connector.key, destination_config: sampleConfig(connector) });
            }}
            isEditing={Boolean(editingResource)}
            readOnly={!isAdmin}
          />
        )}

        {activeMenu === "transforms" && (
          <section className="builderShell">
            <div className="builderTop">
              <div>
                <p className="eyebrow">Transformation</p>
                <h2>Transformation Builder</h2>
              </div>
              <div className="actions tight">
                <button className="ghost" onClick={() => previewTransformation().catch(showError)}>Preview</button>
                <button className="ghost" onClick={() => validateTransformationDraft().catch(showError)}>Validate</button>
                {isAdmin && activeTransformationId && <button className="ghost" onClick={duplicateTransformationDraft}>Duplicate</button>}
                {isAdmin && <button className="ghost" onClick={() => saveTransformationDraft().catch(showError)}>Save Draft</button>}
                {isAdmin && <button className="primary" onClick={() => publishTransformationDraft().catch(showError)}>Publish</button>}
              </div>
            </div>

            <div className="builderMeta">
              <label>Name<input value={transformationDraft.name} onChange={(event) => setTransformationDraft({ ...transformationDraft, name: event.target.value })} /></label>
              <label>Description<input value={transformationDraft.description} onChange={(event) => setTransformationDraft({ ...transformationDraft, description: event.target.value })} /></label>
              <label>
                Existing
                <select value={activeTransformationId ?? ""} onChange={(event) => {
                  if (!event.target.value) {
                    startNewTransformation();
                    return;
                  }
                  const selected = transformations.find((item) => String(item.id) === event.target.value);
                  if (selected) loadTransformation(selected);
                }}>
                  <option value="">New transformation</option>
                  {transformations.map((item) => <option key={item.id} value={item.id}>{item.name} v{item.version} ({item.status})</option>)}
                </select>
              </label>
              <Status status={transformationDraft.status === "published" ? "succeeded" : "queued"} />
            </div>

            <div className="builderGrid">
              <SchemaExplorer
                sourceResources={sourceResources}
                destinationResources={destinationResources}
                sourceId={transformationDraft.source_id}
                destinationId={transformationDraft.destination_id}
                sourceConfig={transformationDraft.source_config}
                destinationConfig={transformationDraft.destination_config}
                sourceOptions={sourceTargetOptions}
                destinationOptions={destinationTargetOptions}
                columns={sourceColumns}
                search={columnSearch}
                onSearch={setColumnSearch}
                onLoadSourceSchema={() => {
                  const resource = sourceResources.find((item) => String(item.id) === transformationDraft.source_id);
                  if (resource) loadColumnsFor(resource, "source", transformationDraft.source_config).catch(showError);
                }}
                onSourceChange={(value) => {
                  const resource = sourceResources.find((item) => String(item.id) === value);
                  setTransformationDraft({ ...transformationDraft, source_id: value, source_config: {} });
                  setSourceTargetOptions({ tables: [], paths: [], sheets: [] });
                  lastSourceOptionsKey.current = "";
                  if (resource && resource.connector_key !== "sftp_source") loadColumnsFor(resource, "source", {}).catch(showError);
                }}
                onDestinationChange={(value) => {
                  setTransformationDraft({ ...transformationDraft, destination_id: value, destination_config: {} });
                  setDestinationTargetOptions({ tables: [], paths: [], sheets: [] });
                  lastDestinationOptionsKey.current = "";
                }}
                onSourceConfigChange={(value) => {
                  const resource = sourceResources.find((item) => String(item.id) === transformationDraft.source_id);
                  setTransformationDraft({ ...transformationDraft, source_config: value });
                  if (resource && resource.connector_key !== "sftp_source") loadColumnsFor(resource, "source", value).catch(showError);
                }}
                onDestinationConfigChange={(value) => setTransformationDraft({ ...transformationDraft, destination_config: value })}
              />

              <section className="builderCanvas">
                <div className="panelHead">
                  <div>
                    <p className="eyebrow">Step canvas</p>
                    <h2>{transformationDraft.steps.length} steps</h2>
                  </div>
                  {isAdmin && <StepTypeSelector onSelect={addStep} />}
                </div>
                <div className="stepList">
                  {transformationDraft.steps.map((step, index) => {
                    const stepColumns = columnsBeforeStep(sourceColumns, transformationDraft.steps, index);
                    const stepValidation = validationForStep(step, index, validationData);
                    return <StepCard
                      key={step.id}
                      step={step}
                      index={index}
                      columns={stepColumns}
                      validation={stepValidation}
                      sourceResources={sourceResources}
                      activeSourceResource={sourceResources.find((item) => String(item.id) === transformationDraft.source_id)}
                      onChange={(next) => updateStep(step.id, () => next)}
                      onDuplicate={() => setTransformationDraft({ ...transformationDraft, steps: [...transformationDraft.steps, { ...step, id: makeId(), step_name: `${step.step_name} copy` }] })}
                      onDelete={() => setTransformationDraft({ ...transformationDraft, steps: transformationDraft.steps.filter((item) => item.id !== step.id) })}
                      onMoveUp={() => moveStep(step.id, -1)}
                      onMoveDown={() => moveStep(step.id, 1)}
                      readOnly={!isAdmin}
                    />;
                  })}
                </div>
              </section>
            </div>

            <div className="executionSummary">
              <Metric label="Input rows" value={previewData?.input_rows ?? "-"} />
              <Metric label="Output rows" value={previewData?.output_rows ?? "-"} />
              <Metric label="Warnings" value={(previewData?.warnings.length ?? 0) + (validationData?.warnings.length ?? 0)} />
              <Metric label="Runtime" value={previewData?.execution_notes.length ? "sampled" : "-"} />
            </div>
          </section>
        )}

        {activeMenu === "pipelines" && <section id="pipelines" className="panel">
          <div className="panelHead">
            <div>
              <p className="eyebrow">Pipeline Management</p>
              <h2>{editingPipelineId ? `Edit Pipeline #${editingPipelineId}` : "Create Pipeline"}</h2>
            </div>
            {isAdmin && <div className="panelActions">
              <button className="primary small" onClick={() => savePipeline().catch(showError)}>{editingPipelineId ? "Update pipeline" : "Save pipeline"}</button>
              {editingPipelineId && <button className="ghost small" onClick={() => {
                setEditingPipelineId(null);
                setScheduleBuilder(parseScheduleToBuilder(""));
                setForm({
                  ...form,
                  name: "Customer pipeline",
                  transformation_id: "",
                  transformation_version: "latest",
                  schedule: ""
                });
              }}>New pipeline</button>}
            </div>}
          </div>
          <div className="formGrid two pipelineFormGrid">
            <label>Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>
              Transformation
              <select value={form.transformation_id} onChange={(event) => {
                const selected = transformations.find((item) => String(item.id) === event.target.value);
                setForm({ ...form, transformation_id: event.target.value, transformation_version: "latest", source_id: String(selected?.source_id ?? ""), destination_id: String(selected?.destination_id ?? "") });
              }}>
                <option value="">Select transformation</option>
                {transformations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}{item.status === "published" ? "" : " (draft)"}
                  </option>
                ))}
              </select>
            </label>
            {form.transformation_id && <label>
              Transformation version
              <select value={form.transformation_version} onChange={(event) => setForm({ ...form, transformation_version: event.target.value })}>
                <option value="latest">Latest published</option>
                {selectedTransformationVersions.map((item) => <option key={item.id} value={String(item.version_no)}>v{item.version_no}</option>)}
              </select>
            </label>}
          </div>
          <ScheduleEditor value={scheduleBuilder} onChange={applyScheduleBuilder} />
          <div className="routePreview">
            <span>{sourceResources.find((item) => String(item.id) === form.source_id)?.name ?? "Source"}</span>
            <strong>→</strong>
            <span>{transformations.find((item) => String(item.id) === form.transformation_id)?.name ?? "No transform"}</span>
            <strong>→</strong>
            <span>{destinationResources.find((item) => String(item.id) === form.destination_id)?.name ?? "Destination"}</span>
          </div>
          <div className="panelHead listHead">
            <div>
              <p className="eyebrow">Saved</p>
              <h2>All Pipelines</h2>
            </div>
          </div>
          <div className="table">
            {pipelines.map((pipeline) => {
              const activeRun = activeRunForPipeline(runs, pipeline.id);
              return (
              <div className="row" key={pipeline.id}>
                <span>#{pipeline.id}</span>
                <strong>{pipeline.name}</strong>
                <span>{labelFor(connectors, pipeline.source_key)} → {labelFor(connectors, pipeline.destination_key)}</span>
                <span>{describeSchedule(pipeline.schedule)}</span>
                {activeRun && <span>{activeRun.status} #{activeRun.id}</span>}
                <div className="pipelineActions">
                  {isAdmin && <label className="toggle smallToggle" title={pipeline.enabled ? "Enabled" : "Disabled"} aria-label={pipeline.enabled ? "Disable pipeline" : "Enable pipeline"}><input type="checkbox" checked={pipeline.enabled} onChange={(event) => setPipelineEnabled(pipeline, event.target.checked).catch(showError)} /></label>}
                  {!isAdmin && <span>{pipeline.enabled ? "Active" : "Inactive"}</span>}
                  {isAdmin && <button className="ghost small" onClick={() => {
                    const nextSchedule = pipeline.schedule || "";
                    setScheduleBuilder(parseScheduleToBuilder(nextSchedule));
                    setEditingPipelineId(pipeline.id);
                    setForm({
                      ...form,
                      name: pipeline.name,
                      source_id: String(findResourceId(sourceResources, pipeline.source_key, pipeline.source_config, pipeline.source_id) ?? ""),
                      destination_id: String(findResourceId(destinationResources, pipeline.destination_key, pipeline.destination_config, pipeline.destination_id) ?? ""),
                      transformation_id: String(pipeline.transformation_id ?? findTransformationId(transformations, pipeline.transforms) ?? ""),
                      transformation_version: pipeline.transformation_version ? String(pipeline.transformation_version) : String(findTransformationVersion(transformationVersions, pipeline.transforms) ?? "latest"),
                      source_key: pipeline.source_key,
                      destination_key: pipeline.destination_key,
                      source_config: JSON.stringify(pipeline.source_config, null, 2),
                      destination_config: JSON.stringify(pipeline.destination_config, null, 2),
                      transforms: JSON.stringify(pipeline.transforms, null, 2),
                      schedule: nextSchedule
                    });
                  }}>Edit</button>}
                  {canRun && activeRun && <button className="ghost small" onClick={() => stopRun(activeRun.id).catch(showError)}>Stop</button>}
                  {canRun && !activeRun && <button className="primary small" disabled={!pipeline.enabled} onClick={() => runPipeline(pipeline.id).catch(showError)}>Run</button>}
                  {isAdmin && <button className="ghost small" onClick={() => deletePipeline(pipeline.id).catch(showError)}>Delete</button>}
                </div>
              </div>
              );
            })}
          </div>
        </section>}

        {activeMenu === "runs" && <section id="runs" className="runs">
          <section className="metrics">
            <Metric label="Pipelines" value={metrics.pipelines} />
            <Metric label="Succeeded" value={metrics.success} />
            <Metric label="Failed" value={metrics.failed} />
            <Metric label="Last run" value={latestRun ? `#${latestRun.id} ${latestRun.status}` : "None"} />
          </section>
          <div className="panel">
            <div className="panelHead">
              <div>
                <p className="eyebrow">Execution</p>
                <h2>Recent Runs</h2>
              </div>
            </div>
            <div className="table">
              {runs.map((run) => (
                <button className="row runRow" key={run.id} onClick={() => setSelectedRun(run.id)}>
                  <span>#{run.id}</span>
                  <strong>{run.pipeline_name || `Pipeline ${run.pipeline_id}`}</strong>
                  <Status status={run.status} />
                  <span>{run.rows_written}/{run.rows_read} records</span>
                  <span>{run.duration_seconds ?? "-"} sec</span>
                  <span>{run.started_at || run.created_at}</span>
                  {run.status === "running" || run.status === "queued" ? (
                    <span className="linkText" onClick={(event) => { event.stopPropagation(); stopRun(run.id).catch(showError); }}>Stop</span>
                  ) : <span>{run.error || "-"}</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="panelHead">
              <div>
                <p className="eyebrow">Observability</p>
                <h2>Run Logs</h2>
              </div>
            </div>
            <div className="logs">
              {selectedRun && <button className="download" onClick={() => downloadRunLogs(selectedRun).catch(showError)}>Download logs</button>}
              {logs.map((log) => (
                <p key={log.id}><span>{log.level}</span>{log.message}</p>
              ))}
            </div>
          </div>
        </section>}

        {canRun && activeMenu === "audit" && <section className="panel">
          <div className="panelHead">
            <div>
              <p className="eyebrow">ETL Pipeline Audit</p>
              <h2>ETL Audit Log</h2>
            </div>
          </div>
          <div className="auditTableWrap">
            <table className="auditTable">
              <thead>
                <tr>
                  <th>id</th>
                  <th>run_id</th>
                  <th>pipeline_name</th>
                  <th>job_type</th>
                  <th>start_time</th>
                  <th>end_time</th>
                  <th>duration_seconds</th>
                  <th>status</th>
                  <th>current_stage</th>
                  <th>failed_stage</th>
                  <th>source_path</th>
                  <th>target_path</th>
                  <th>total_count</th>
                  <th>success_count</th>
                  <th>failed_count</th>
                  <th>rejected_count</th>
                  <th>error_message</th>
                  <th>error_file_path</th>
                  <th>triggered_by</th>
                  <th>created_date</th>
                  <th>last_modified_date</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((item) => (
                  <tr key={item.id} className={selectedAuditLog?.id === item.id ? "selected" : ""} onClick={() => setSelectedAuditId(item.id)}>
                    <td>{item.id}</td>
                    <td>{item.run_id ?? "-"}</td>
                    <td>{item.pipeline_name || "-"}</td>
                    <td>{item.job_type || "-"}</td>
                    <td>{item.start_time || "-"}</td>
                    <td>{item.end_time || "-"}</td>
                    <td>{item.duration_seconds ?? "-"}</td>
                    <td><Status status={item.status as Run["status"]} /></td>
                    <td>{item.current_stage || "-"}</td>
                    <td>{item.failed_stage || "-"}</td>
                    <td>{item.source_path || "-"}</td>
                    <td>{item.target_path || "-"}</td>
                    <td>{item.total_count}</td>
                    <td>{item.success_count}</td>
                    <td>{item.failed_count}</td>
                    <td>{item.rejected_count}</td>
                    <td>{item.error_message || "-"}</td>
                    <td>{item.error_file_path || "-"}</td>
                    <td>{item.triggered_by || "-"}</td>
                    <td>{item.created_date}</td>
                    <td>{item.last_modified_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {auditLogs.length === 0 && <p className="emptyState">No ETL audit logs.</p>}
          </div>
          {selectedAuditLog && <div className="auditDetails">
            <strong>Selected run #{selectedAuditLog.run_id ?? selectedAuditLog.id}</strong>
            <span>Stage: {selectedAuditLog.current_stage || "-"}</span>
            <span>Source: {selectedAuditLog.source_path || "-"}</span>
            <span>Target: {selectedAuditLog.target_path || "-"}</span>
            <span>Error file: {selectedAuditLog.error_file_path || "-"}</span>
            <span>Error: {selectedAuditLog.error_message || "-"}</span>
          </div>}
        </section>}

        {activeMenu === "access" && <>
        <section className="panel accountSummaryPanel">
          <div className="panelHead">
            <div>
              <p className="eyebrow">Account</p>
              <h2>Account Controls</h2>
            </div>
          </div>
          <div className="accountSummary">
            <span className="userBadge">{currentUser.name} · {currentUser.role}</span>
            <button className="ghost" onClick={() => setShowPasswordPanel((value) => !value)}>Change Password</button>
          </div>
        </section>
        <section className="panel">
          <div className="panelHead">
            <div>
              <p className="eyebrow">Authentication & Authorization</p>
              <h2>Users and Roles</h2>
            </div>
          </div>
          {isSuperuser ? <>
          <div className="formGrid three">
            <label>Name<input value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} /></label>
            <label>Email<input value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} /></label>
            <label>Password<input type="password" value={userForm.password} minLength={10} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} placeholder={editingUserId ? "Leave blank to keep current password" : ""} /></label>
            <label>
              Role
              <select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value as User["role"] })}>
                <option value="superuser">Superuser</option>
                <option value="admin">Admin</option>
                <option value="support">Support</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
          </div>
          <div className="actions">
            <button className="primary" onClick={() => saveUser().catch(showError)}>{editingUserId ? "Update user" : "Create user"}</button>
            {editingUserId && <button className="ghost" onClick={() => { setEditingUserId(null); setUserForm({ name: "", email: "", password: "", role: "viewer" }); }}>Cancel</button>}
          </div>
          <div className="roleGrid">
            <RoleCard role="Superuser" text="Manage users and full platform access." />
            <RoleCard role="Admin" text="Manage pipelines, transformations, schedules, runs, and logs." />
            <RoleCard role="Support" text="Trigger pipelines and view pipelines/logs." />
            <RoleCard role="Viewer" text="Read-only access to pipelines and logs." />
          </div>
          <div className="table">
            {users.map((user) => (
              <div className="row" key={user.id}>
                <span>#{user.id}</span>
                <strong>{user.name}</strong>
                <span>{user.email}</span>
                <span>{user.role}</span>
                <button className="ghost small" onClick={() => { setEditingUserId(user.id); setUserForm({ name: user.name, email: user.email, password: "", role: user.role }); }}>Edit</button>
                <button className="ghost small" onClick={() => deleteUser(user.id).catch(showError)}>Delete</button>
              </div>
            ))}
          </div>
          </> : <p className="emptyState">User management is restricted to superusers. Admin users can manage pipelines and ETL operations only.</p>}
        </section>
        </>}
        {previewOpen && (
          <div className="previewModalBackdrop" onClick={() => setPreviewOpen(false)}>
            <div className="previewModal" onClick={(event) => event.stopPropagation()}>
              <PreviewPanel
                tab={previewTab}
                onTab={setPreviewTab}
                onClose={() => setPreviewOpen(false)}
                preview={previewData}
                validation={validationData}
                sampleSize={sampleSize}
                onSampleSize={setSampleSize}
                previewStepId={previewStepId}
                onPreviewStepId={setPreviewStepId}
                steps={transformationDraft.steps}
              />
            </div>
          </div>
        )}
      </section>
      {toast && <button className={`toast ${toast.tone}`} onClick={() => setToast(null)}>{toast.text}</button>}
    </main>
  );
}

function SchemaExplorer({
  sourceResources,
  destinationResources,
  sourceId,
  destinationId,
  sourceConfig,
  destinationConfig,
  sourceOptions,
  destinationOptions,
  columns,
  search,
  onSearch,
  onLoadSourceSchema,
  onSourceChange,
  onDestinationChange,
  onSourceConfigChange,
  onDestinationConfigChange
}: {
  sourceResources: Resource[];
  destinationResources: Resource[];
  sourceId: string;
  destinationId: string;
  sourceConfig: Record<string, unknown>;
  destinationConfig: Record<string, unknown>;
  sourceOptions: { tables: string[]; paths: string[]; sheets: string[] };
  destinationOptions: { tables: string[]; paths: string[]; sheets: string[] };
  columns: string[];
  search: string;
  onSearch: (value: string) => void;
  onLoadSourceSchema: () => void;
  onSourceChange: (value: string) => void;
  onDestinationChange: (value: string) => void;
  onSourceConfigChange: (value: Record<string, unknown>) => void;
  onDestinationConfigChange: (value: Record<string, unknown>) => void;
}) {
  const filtered = columns.filter((column) => column.toLowerCase().includes(search.toLowerCase()));
  const source = sourceResources.find((item) => String(item.id) === sourceId);
  const destination = destinationResources.find((item) => String(item.id) === destinationId);
  return (
    <section className="schemaPanel">
      <div className="panelHead">
        <div>
          <p className="eyebrow">Dataset/schema</p>
          <h2>Explorer</h2>
        </div>
      </div>
      <label>Source<select value={sourceId} onChange={(event) => onSourceChange(event.target.value)}>
        <option value="">Select datasource</option>
        {sourceResources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Destination<select value={destinationId} onChange={(event) => onDestinationChange(event.target.value)}>
        <option value="">Select destination</option>
        {destinationResources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <div className="datasetNames">
        <span>Source: {source?.name ?? "-"}</span>
        <span>Destination: {destination?.name ?? "-"}</span>
      </div>
      {source && <DatasetTargetEditor title="Source target" resource={source} value={sourceConfig} options={sourceOptions} onChange={onSourceConfigChange} />}
      {destination && <DatasetTargetEditor title="Destination target" resource={destination} value={destinationConfig} options={destinationOptions} onChange={onDestinationConfigChange} />}
      <button className="ghost small" type="button" onClick={onLoadSourceSchema}>Load schema from source</button>
      <label>Search columns<input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="customer_id" /></label>
      <div className="schemaList">
        {filtered.map((column) => (
          <button key={column} title={`${column} column`}>
            <strong>{column}</strong>
            <span>{inferType(column)} · sample after preview</span>
          </button>
        ))}
        {filtered.length === 0 && <p className="emptyState">Load schema from source.</p>}
      </div>
    </section>
  );
}

function DatasetTargetEditor({ title, resource, value, options, onChange }: { title: string; resource: Resource; value: Record<string, unknown>; options: { tables: string[]; paths: string[]; sheets: string[] }; onChange: (value: Record<string, unknown>) => void }) {
  if (resource.connector_key === "postgres_source") {
    return <div className="formGrid two">
      <label>{title} schema<input value={String(value.schema ?? "public")} onChange={(event) => onChange({ ...value, schema: event.target.value })} placeholder="public" /></label>
      <label>{title} table<SelectOrInput value={String(value.table ?? "")} options={options.tables} placeholder="customers" onChange={(next) => onChange({ ...value, table: next })} /></label>
    </div>;
  }
  if (resource.connector_key === "sftp_source") {
    const fileOptions = sftpPathOptions(resource, options.paths, String(value.remote_path ?? ""));
    const selectedPath = String(value.remote_path || value.path_pattern || "");
    const isXlsx = String(value.format ?? "csv") === "xlsx" || selectedPath.endsWith(".xlsx");
    return <div className="formGrid two">
      <label>{title} file path<SelectOrInput value={String(value.remote_path ?? "")} options={fileOptions} placeholder="/in/customers.csv" onChange={(next) => onChange({ ...value, remote_path: next, path_pattern: "", sheet_name: "" })} /></label>
      <label>Date file pattern<input value={String(value.path_pattern ?? "")} onChange={(event) => onChange({ ...value, path_pattern: event.target.value, remote_path: "", sheet_name: "" })} placeholder="/in/customers_{YYYY}{MM}{DD}.csv" />{Boolean(value.path_pattern) && <PatternPreview pattern={String(value.path_pattern)} />}</label>
      <label>{title} format<select value={String(value.format ?? "csv")} onChange={(event) => onChange({ ...value, format: event.target.value, sheet_name: "" })}><option value="csv">csv</option><option value="xlsx">xlsx</option></select></label>
      {isXlsx && <label>File password<input type="password" value={String(value.file_password ?? "")} onChange={(event) => onChange({ ...value, file_password: event.target.value })} placeholder="Only for protected XLSX" /></label>}
    </div>;
  }
  if (resource.connector_key === "postgres_destination") {
    return <div className="formGrid two">
      <label>{title} schema<input value={String(value.schema ?? "public")} onChange={(event) => onChange({ ...value, schema: event.target.value })} placeholder="public" /></label>
      <label>{title} table<SelectOrInput value={String(value.table ?? "")} options={options.tables} placeholder="customer_summary" onChange={(next) => onChange({ ...value, table: next })} /></label>
      <label>Mode<select value={String(value.mode ?? "append")} onChange={(event) => onChange({ ...value, mode: event.target.value })}><option value="append">append</option><option value="upsert">upsert</option><option value="truncate_insert">truncate + insert</option></select></label>
      <label>Primary key<input value={String(value.primary_key ?? "")} onChange={(event) => onChange({ ...value, primary_key: event.target.value })} placeholder="customer_id" /></label>
    </div>;
  }
  if (resource.connector_key === "sftp_destination") {
    const isXlsx = String(value.format ?? "csv") === "xlsx" || String(value.remote_path || value.output_path_pattern || "").endsWith(".xlsx");
    return <div className="formGrid two">
      <label>{title} output path<input value={String(value.remote_path ?? "")} onChange={(event) => onChange({ ...value, remote_path: event.target.value, output_path_pattern: "" })} placeholder="/out/result.csv" /></label>
      <label>Output date pattern<input value={String(value.output_path_pattern ?? "")} onChange={(event) => onChange({ ...value, output_path_pattern: event.target.value, remote_path: "" })} placeholder="/out/result_{YYYY}{MM}{DD}.xlsx" />{Boolean(value.output_path_pattern) && <PatternPreview pattern={String(value.output_path_pattern)} />}</label>
      <label>Rejected/error path<input value={String(value.rejected_path ?? "")} onChange={(event) => onChange({ ...value, rejected_path: event.target.value, rejected_path_pattern: "" })} placeholder="/err/rejected.csv" /></label>
      <label>Rejected/error pattern<input value={String(value.rejected_path_pattern ?? "")} onChange={(event) => onChange({ ...value, rejected_path_pattern: event.target.value, rejected_path: "" })} placeholder="/err/rejected_{YYYY}{MM}{DD}_{timestamp}.csv" />{Boolean(value.rejected_path_pattern) && <PatternPreview pattern={String(value.rejected_path_pattern)} />}</label>
      <label className="toggle inlineToggle"><input type="checkbox" checked={value.auto_create_folders !== false} onChange={(event) => onChange({ ...value, auto_create_folders: event.target.checked })} /> Auto-create output folders</label>
      <label>{title} format<select value={String(value.format ?? "csv")} onChange={(event) => onChange({ ...value, format: event.target.value })}><option value="csv">csv</option><option value="xlsx">xlsx</option></select></label>
      {isXlsx && <label>Data sheet<input value={String(value.xlsx_data_sheet ?? "Data")} onChange={(event) => onChange({ ...value, xlsx_data_sheet: event.target.value })} placeholder="Data" /></label>}
    </div>;
  }
  return null;
}

function PatternPreview({ pattern }: { pattern: string }) {
  const resolved = formatDatePattern(pattern);
  return <span className="patternPreview">Resolved today: {resolved}</span>;
}

function SelectOrInput({ value, options, placeholder, onChange }: { value: string; options: Array<string | { label: string; value: string }>; placeholder: string; onChange: (value: string) => void }) {
  const normalizedOptions = options.map((item) => typeof item === "string" ? { label: item, value: item } : item);
  const listId = useMemo(() => `options-${makeId()}`, []);
  return <div className="selectOrInput">
    <input list={normalizedOptions.length ? listId : undefined} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    {normalizedOptions.length > 0 && <datalist id={listId}>
      {normalizedOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
    </datalist>}
  </div>;
}

function sftpPathOptions(resource: Resource, paths: string[], currentValue: string) {
  const basePath = String(resource.config.remote_path ?? "");
  const options = paths.map((path) => {
    const normalizedBase = basePath.endsWith("/") ? basePath : `${basePath}/`;
    const label = path.startsWith(normalizedBase) ? path.slice(normalizedBase.length) : path.split("/").pop() || path;
    return { label, value: path };
  });
  if (currentValue && !options.some((item) => item.value === currentValue)) {
    options.unshift({ label: currentValue.split("/").pop() || currentValue, value: currentValue });
  }
  return options;
}

function LoginPage({
  loginEmail,
  loginPassword,
  onEmail,
  onPassword,
  onLogin,
  toast,
  onToast
}: {
  loginEmail: string;
  loginPassword: string;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onLogin: () => void;
  toast: Toast;
  onToast: (value: Toast) => void;
}) {
  return (
    <main className="loginShell">
      <section className="loginPanel">
        <LogoImage className="loginLogo" />
        <h1>Welcome to mCollect ETL</h1>
        <label className="loginField">
          <span className="loginIcon userIcon" aria-hidden="true" />
          <input value={loginEmail} onChange={(event) => onEmail(event.target.value)} placeholder="Username" />
        </label>
        <label className="loginField">
          <span className="loginIcon lockIcon" aria-hidden="true" />
          <input
            type="password"
            value={loginPassword}
            placeholder="Password"
            onChange={(event) => onPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onLogin();
            }}
          />
        </label>
        <button className="primary loginButton" onClick={onLogin}>&#10003; Login</button>
      </section>
      <section className="loginVisual" aria-hidden="true" />
      {toast && <button className={`toast ${toast.tone}`} onClick={() => onToast(null)}>{toast.text}</button>}
    </main>
  );
}

function LogoImage({ className }: { className: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className={`${className} logoFallback`}>MobiFlow</span>;
  }
  return <img className={className} src="/logo.png" alt="MobiFlow" onError={() => setFailed(true)} />;
}

function StepTypeSelector({ onSelect }: { onSelect: (type: StepType) => void }) {
  return (
    <select className="stepSelect" onChange={(event) => {
      if (event.target.value) onSelect(event.target.value as StepType);
      event.currentTarget.value = "";
    }}>
      <option value="">+ Add Step</option>
      {STEP_TYPES.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}
    </select>
  );
}

function StepCard({
  step,
  index,
  columns,
  validation,
  sourceResources,
  activeSourceResource,
  onChange,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
  readOnly = false
}: {
  step: TransformationStep;
  index: number;
  columns: string[];
  validation: StepValidationState;
  sourceResources: Resource[];
  activeSourceResource?: Resource;
  onChange: (step: TransformationStep) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  readOnly?: boolean;
}) {
  return (
    <article className={`stepCard ${step.is_enabled ? "" : "disabled"} ${validation.errors.length ? "hasError" : ""}`}>
      <div className="stepHead">
        <span>{index + 1}</span>
        <div>
          <strong>{step.step_name}</strong>
          <small>{STEP_TYPES.find((item) => item.type === step.step_type)?.description}</small>
        </div>
        <label className="toggle"><input type="checkbox" disabled={readOnly} checked={step.is_enabled} onChange={(event) => onChange({ ...step, is_enabled: event.target.checked })} />Enabled</label>
      </div>
      <StepForm step={step} columns={columns} sourceResources={sourceResources} activeSourceResource={activeSourceResource} onChange={readOnly ? () => undefined : onChange} />
      {validation.errors.length > 0 && (
        <div className="stepValidationMessage" role="alert">
          {validation.errors.map((message) => <p key={message}>{message}</p>)}
        </div>
      )}
      <label>Step note<input readOnly={readOnly} value={step.note ?? ""} onChange={(event) => onChange({ ...step, note: event.target.value })} placeholder="Standardize phone format" /></label>
      {!readOnly && <div className="stepActions">
        <button className="ghost small" onClick={onMoveUp} title="Move up">↑</button>
        <button className="ghost small" onClick={onMoveDown} title="Move down">↓</button>
        <button className="ghost small" onClick={onDuplicate}>Duplicate</button>
        <button className="ghost small" onClick={onDelete}>Delete</button>
      </div>}
    </article>
  );
}

function StepForm({ step, columns, sourceResources, activeSourceResource, onChange }: { step: TransformationStep; columns: string[]; sourceResources: Resource[]; activeSourceResource?: Resource; onChange: (step: TransformationStep) => void }) {
  const params = step.parameters;
  const setParams = (parameters: Record<string, unknown>) => onChange({ ...step, parameters });
  if (step.step_type === "select") {
    const selected = params.columns as string[] ?? [];
    const allSelected = columns.length > 0 && columns.every((column) => selected.includes(column));
    return <div className="ruleStack">
      <label className="toggle"><input type="checkbox" checked={allSelected} onChange={(event) => setParams({ columns: event.target.checked ? columns : [] })} />Select all</label>
      <div className="columnChips">{columns.map((column) => (
        <button className={selected.includes(column) ? "selectedChip" : ""} key={column} onClick={() => {
          const next = selected.includes(column) ? selected.filter((item) => item !== column) : [...selected, column];
          setParams({ columns: next });
        }}>{column}</button>
      ))}</div>
    </div>;
  }
  if (step.step_type === "rename") {
    const mappings = params.mappings as { source: string; target: string }[] ?? [];
    return <RuleTable columns={columns} rows={mappings} labels={["Source column", "New column name"]} onAdd={() => setParams({ mappings: [...mappings, { source: "", target: "" }] })} onChange={(rows) => setParams({ mappings: rows })} />;
  }
  if (step.step_type === "cast") {
    const casts = params.casts as { column: string; type: string; format?: string }[] ?? [];
    return <div className="ruleStack">{casts.map((item, idx) => (
      <div className="ruleRow" key={idx}>
        <ColumnSelect value={item.column} columns={columns} onChange={(value) => setParams({ casts: updateArray(casts, idx, { ...item, column: value }) })} />
        <select value={item.type} onChange={(event) => setParams({ casts: updateArray(casts, idx, { ...item, type: event.target.value }) })}>
          {DATA_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        {(item.type === "date" || item.type === "datetime") && <select value={item.format ?? "dd-mm-yyyy"} onChange={(event) => setParams({ casts: updateArray(casts, idx, { ...item, format: event.target.value }) })}>
          {DATE_FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>}
        <button className="ghost small" onClick={() => setParams({ casts: casts.filter((_, itemIndex) => itemIndex !== idx) })}>Delete</button>
      </div>
    ))}<button className="ghost small" onClick={() => setParams({ casts: [...casts, { column: "", type: "string" }] })}>Add cast</button></div>;
  }
  if (step.step_type === "validate") {
    const rules = params.rules as { column: string; type: string; value?: string; pattern?: string; format?: string; values?: string[] }[] ?? [];
    return <div className="ruleStack">
      {rules.map((item, idx) => {
        const ruleType = item.type || "not_blank";
        return <div className="ruleRow" key={idx}>
          <ColumnSelect value={item.column} columns={columns} onChange={(value) => setParams({ rules: updateArray(rules, idx, { ...item, column: value }) })} />
          <select value={ruleType} onChange={(event) => setParams({ rules: updateArray(rules, idx, { ...item, type: event.target.value, value: "", pattern: "", format: "dd/mm/yyyy", values: [] }) })}>
            {VALIDATION_RULES.map((rule) => <option key={rule.value} value={rule.value}>{rule.label}</option>)}
          </select>
          {ruleType === "regex" ? <input value={item.pattern ?? item.value ?? ""} onChange={(event) => setParams({ rules: updateArray(rules, idx, { ...item, pattern: event.target.value }) })} placeholder="^[0-9A-Za-z .,_/-]+$" />
            : ruleType === "date_format" ? <select value={item.format ?? item.value ?? "dd/mm/yyyy"} onChange={(event) => setParams({ rules: updateArray(rules, idx, { ...item, format: event.target.value }) })}>{DATE_FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
              : ["max_length", "min_length", "exact_length"].includes(ruleType) ? <input type="number" value={item.value ?? ""} onChange={(event) => setParams({ rules: updateArray(rules, idx, { ...item, value: event.target.value }) })} placeholder="length" />
                : ruleType === "allowed_values" ? <input value={Array.isArray(item.values) ? item.values.join(", ") : item.value ?? ""} onChange={(event) => setParams({ rules: updateArray(rules, idx, { ...item, values: csvList(event.target.value), value: event.target.value }) })} placeholder="MH, GJ, KA" />
                  : <input value="" readOnly placeholder="No value needed" />}
          <button className="ghost small" onClick={() => setParams({ rules: rules.filter((_, itemIndex) => itemIndex !== idx) })}>Delete</button>
        </div>;
      })}
      <button className="ghost small" onClick={() => setParams({ rules: [...rules, { column: "", type: "not_blank" }] })}>Add validation</button>
    </div>;
  }
  if (step.step_type === "pii_encrypt") {
    const selected = params.columns as string[] ?? [];
    const mode = String(params.mode ?? "encrypt");
    return <div className="ruleStack">
      <label>Mode<select value={mode} onChange={(event) => setParams({ ...params, mode: event.target.value })}><option value="encrypt">encrypt</option><option value="mask">mask</option></select></label>
      {mode === "encrypt" && <label>Encryption key id<input value={String(params.key_id ?? "default")} onChange={(event) => setParams({ ...params, key_id: event.target.value })} placeholder="client_a" /></label>}
      <div className="columnChips">{columns.map((column) => (
        <button className={selected.includes(column) ? "selectedChip" : ""} key={column} onClick={() => {
          const next = selected.includes(column) ? selected.filter((item) => item !== column) : [...selected, column];
          setParams({ ...params, columns: next });
        }}>{column}</button>
      ))}</div>
      {columns.length === 0 && <p className="emptyState">Load schema from source.</p>}
    </div>;
  }
  if (step.step_type === "join") {
    const sameConnection = String(params.right_source_mode ?? "saved_source") === "same_connection";
    const sameSourceConfig = (params.right_source_config as Record<string, unknown> | undefined) ?? {};
    const setSameSourceConfig = (next: Record<string, unknown>) => setParams({ ...params, right_source_mode: "same_connection", right_source_config: next });
    return <div className="formulaGrid">
      <label>Join source mode<select value={String(params.right_source_mode ?? "saved_source")} onChange={(event) => setParams({ ...params, right_source_mode: event.target.value, right_source_id: "", right_source_config: {} })}><option value="saved_source">Saved datasource</option><option value="same_connection">Same source connection</option></select></label>
      {sameConnection ? <>
        <label>Base connection<input value={activeSourceResource?.name ?? "Select source above"} readOnly /></label>
        {activeSourceResource?.connector_key === "postgres_source" ? <>
          <label>Right schema<input value={String(sameSourceConfig.schema ?? activeSourceResource.config.schema ?? "public")} onChange={(event) => setSameSourceConfig({ ...sameSourceConfig, schema: event.target.value })} placeholder="public" /></label>
          <label>Right table<input value={String(sameSourceConfig.table ?? "")} onChange={(event) => setSameSourceConfig({ ...sameSourceConfig, table: event.target.value, query: sameSourceConfig.query ?? "" })} placeholder="loan_table" /></label>
          <label className="fullWidth">Right query<textarea className="miniTextarea" value={String(sameSourceConfig.query ?? "")} onChange={(event) => setSameSourceConfig({ ...sameSourceConfig, query: event.target.value })} placeholder="Optional custom SQL for join side" /></label>
        </> : activeSourceResource?.connector_key === "sftp_source" ? <>
          <label>Right file path<input value={String(sameSourceConfig.remote_path ?? "")} onChange={(event) => setSameSourceConfig({ ...sameSourceConfig, remote_path: event.target.value })} placeholder="/in/loans.csv" /></label>
          <label>Format<select value={String(sameSourceConfig.format ?? activeSourceResource.config.format ?? "csv")} onChange={(event) => setSameSourceConfig({ ...sameSourceConfig, format: event.target.value })}><option value="csv">csv</option><option value="xlsx">xlsx</option></select></label>
        </> : <label>Right dataset config<input value={JSON.stringify(sameSourceConfig)} readOnly /></label>}
      </> : <label>Join source<select value={String(params.right_source_id ?? "")} onChange={(event) => setParams({ ...params, right_source_mode: "saved_source", right_source_id: event.target.value ? Number(event.target.value) : "" })}><option value="">Select datasource</option>{sourceResources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label>}
      <label>Join type<select value={String(params.join_type ?? "left")} onChange={(event) => setParams({ ...params, join_type: event.target.value })}>{["left", "inner", "right", "outer"].map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
      <label>Left key<ColumnSelect value={String(params.left_key ?? "")} columns={columns} onChange={(value) => setParams({ ...params, left_key: value })} /></label>
      <label>Right key<input value={String(params.right_key ?? "")} onChange={(event) => setParams({ ...params, right_key: event.target.value })} placeholder="customer_id" /></label>
      <label>Right columns<input value={asCsv(params.right_columns)} onChange={(event) => setParams({ ...params, right_columns: csvList(event.target.value) })} placeholder="name,status" /></label>
      <label>Right suffix<input value={String(params.suffix ?? "_right")} onChange={(event) => setParams({ ...params, suffix: event.target.value })} /></label>
    </div>;
  }
  if (step.step_type === "fillna") {
    const fills = params.fills as { column: string; strategy: string; value?: string }[] ?? [];
    return <div className="ruleStack">{fills.map((item, idx) => (
      <div className="ruleRow" key={idx}>
        <ColumnSelect value={item.column} columns={columns} onChange={(value) => setParams({ fills: updateArray(fills, idx, { ...item, column: value }) })} />
        <select value={item.strategy} onChange={(event) => setParams({ fills: updateArray(fills, idx, { ...item, strategy: event.target.value }) })}>
          {["fixed", "empty_string", "zero", "forward_fill", "backward_fill"].map((strategy) => <option key={strategy} value={strategy}>{humanize(strategy)}</option>)}
        </select>
        <input value={item.value ?? ""} onChange={(event) => setParams({ fills: updateArray(fills, idx, { ...item, value: event.target.value }) })} placeholder="fixed value" />
        <button className="ghost small" onClick={() => setParams({ fills: fills.filter((_, itemIndex) => itemIndex !== idx) })}>Delete</button>
      </div>
    ))}<button className="ghost small" onClick={() => setParams({ fills: [...fills, { column: "", strategy: "fixed", value: "" }] })}>Add fill</button></div>;
  }
  if (step.step_type === "derive") {
    const left = params.left as Operand ?? { kind: "column", value: "" };
    const right = params.right as Operand ?? { kind: "constant", value: "" };
    return <div className="formulaGrid">
      <label>Output column<input value={String(params.output_column ?? "")} onChange={(event) => setParams({ ...params, output_column: event.target.value })} /></label>
      <label>Derived column datatype<select value={String(params.output_type ?? "float")} onChange={(event) => setParams({ ...params, output_type: event.target.value })}>{DATA_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
      <OperandEditor label="Operand 1" operand={left} columns={columns} onChange={(value) => setParams({ ...params, left: value })} />
      <label>Operator<select value={String(params.operator ?? "+")} onChange={(event) => setParams({ ...params, operator: event.target.value })}>{["+", "-", "*", "/"].map((op) => <option key={op}>{op}</option>)}</select></label>
      <OperandEditor label="Operand 2" operand={right} columns={columns} onChange={(value) => setParams({ ...params, right: value })} />
    </div>;
  }
  if (step.step_type === "filter") {
    const conditions = params.conditions as { column: string; operator: string; value: string }[] ?? [];
    return <div className="ruleStack">
      <label>Join<select value={String(params.joiner ?? "and")} onChange={(event) => setParams({ ...params, joiner: event.target.value })}><option value="and">AND</option><option value="or">OR</option></select></label>
      {conditions.map((item, idx) => <div className="ruleRow" key={idx}>
        <ColumnSelect value={item.column} columns={columns} onChange={(value) => setParams({ ...params, conditions: updateArray(conditions, idx, { ...item, column: value }) })} />
        <select value={item.operator} onChange={(event) => setParams({ ...params, conditions: updateArray(conditions, idx, { ...item, operator: event.target.value }) })}>{FILTER_OPERATORS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}</select>
        <input value={item.value ?? ""} onChange={(event) => setParams({ ...params, conditions: updateArray(conditions, idx, { ...item, value: event.target.value }) })} placeholder="value" />
        <button className="ghost small" onClick={() => setParams({ ...params, conditions: conditions.filter((_, itemIndex) => itemIndex !== idx) })}>Delete</button>
      </div>)}
      <button className="ghost small" onClick={() => setParams({ ...params, conditions: [...conditions, { column: "", operator: "equals", value: "" }] })}>Add condition</button>
    </div>;
  }
  if (step.step_type === "deduplicate") {
    const selected = params.columns as string[] ?? [];
    return <div className="ruleStack">
      <div className="columnChips">{columns.map((column) => <button className={selected.includes(column) ? "selectedChip" : ""} key={column} onClick={() => setParams({ ...params, columns: selected.includes(column) ? selected.filter((item) => item !== column) : [...selected, column] })}>{column}</button>)}</div>
      <label>Keep<select value={String(params.keep ?? "first")} onChange={(event) => setParams({ ...params, keep: event.target.value })}><option value="first">First</option><option value="last">Last</option></select></label>
    </div>;
  }
  if (step.step_type === "blank_columns") {
    const blankColumns = Array.isArray(params.columns)
      ? (params.columns as Array<string | { name?: string }>).map((item) => typeof item === "string" ? item : item.name ?? "").join(", ")
      : String(params.columns ?? "");
    return <div className="ruleStack">
      <label className="editor fullWidth">
        Column names
        <textarea
          className="miniTextarea"
          value={blankColumns}
          onChange={(event) => setParams({ columns: event.target.value })}
          placeholder="COL1, COL2, COL3
or paste one column per line"
        />
      </label>
    </div>;
  }
  if (step.step_type === "value_map") {
    const mappings = params.mappings as { from: string; to: string }[] ?? [];
    return <div className="ruleStack">
      <div className="ruleRow">
        <ColumnSelect value={String(params.column ?? "")} columns={columns} onChange={(value) => setParams({ ...params, column: value })} />
        <label>Output column<input value={String(params.output_column ?? "")} onChange={(event) => setParams({ ...params, output_column: event.target.value })} placeholder="leave blank to overwrite" /></label>
        <label>Output datatype<select value={String(params.output_type ?? "string")} onChange={(event) => setParams({ ...params, output_type: event.target.value })}>{DATA_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
      </div>
      {mappings.map((item, idx) => <div className="mappingRow" key={idx}>
        <input value={item.from} onChange={(event) => setParams({ ...params, mappings: updateArray(mappings, idx, { ...item, from: event.target.value }) })} placeholder="yes" />
        <input value={item.to} onChange={(event) => setParams({ ...params, mappings: updateArray(mappings, idx, { ...item, to: event.target.value }) })} placeholder="1" />
        <button className="ghost small" onClick={() => setParams({ ...params, mappings: mappings.filter((_, itemIndex) => itemIndex !== idx) })}>Delete</button>
      </div>)}
      <button className="ghost small" onClick={() => setParams({ ...params, mappings: [...mappings, { from: "", to: "" }] })}>Add mapping</button>
    </div>;
  }
  if (step.step_type === "groupby") {
    const selected = params.group_columns as string[] ?? [];
    const aggregations = params.aggregations as { column: string; function: string; output_column: string }[] ?? [];
    return <div className="ruleStack">
      <div className="columnChips">{columns.map((column) => <button className={selected.includes(column) ? "selectedChip" : ""} key={column} onClick={() => setParams({ ...params, group_columns: selected.includes(column) ? selected.filter((item) => item !== column) : [...selected, column] })}>{column}</button>)}</div>
      {aggregations.map((item, idx) => <div className="ruleRow" key={idx}>
        <ColumnSelect value={item.column} columns={columns} onChange={(value) => setParams({ ...params, aggregations: updateArray(aggregations, idx, { ...item, column: value }) })} />
        <select value={item.function} onChange={(event) => setParams({ ...params, aggregations: updateArray(aggregations, idx, { ...item, function: event.target.value }) })}>{AGG_FUNCS.map((fn) => <option key={fn} value={fn}>{fn}</option>)}</select>
        <input value={item.output_column ?? ""} onChange={(event) => setParams({ ...params, aggregations: updateArray(aggregations, idx, { ...item, output_column: event.target.value }) })} placeholder="output column" />
        <button className="ghost small" onClick={() => setParams({ ...params, aggregations: aggregations.filter((_, itemIndex) => itemIndex !== idx) })}>Delete</button>
      </div>)}
      <button className="ghost small" onClick={() => setParams({ ...params, aggregations: [...aggregations, { column: "", function: "sum", output_column: "" }] })}>Add aggregation</button>
    </div>;
  }
  if (step.step_type === "pivot") {
    return <div className="formulaGrid">
      <label>Index columns<input value={asCsv(params.index_columns)} onChange={(event) => setParams({ ...params, index_columns: csvList(event.target.value) })} placeholder="customer_id,month" /></label>
      <label>Pivot column<ColumnSelect value={String(params.pivot_column ?? "")} columns={columns} onChange={(value) => setParams({ ...params, pivot_column: value })} /></label>
      <label>Value column<ColumnSelect value={String(params.value_column ?? "")} columns={columns} onChange={(value) => setParams({ ...params, value_column: value })} /></label>
      <label>Aggregation<select value={String(params.aggfunc ?? "sum")} onChange={(event) => setParams({ ...params, aggfunc: event.target.value })}>{AGG_FUNCS.filter((fn) => fn !== "last").map((fn) => <option key={fn} value={fn}>{fn}</option>)}</select></label>
      <label>Fill value<input value={String(params.fill_value ?? "0")} onChange={(event) => setParams({ ...params, fill_value: event.target.value })} /></label>
    </div>;
  }
  if (step.step_type === "custom") {
    return <div className="ruleStack">
      <div className="customTransformHelp">
        <strong>Input:</strong> previous step output is available as <code>df</code>.
        <strong>Output:</strong> return a dataframe from <code>transform(df)</code> or assign <code>result = df</code>.
        <strong>Helpers:</strong> <code>pd</code> and <code>np</code> are available.
      </div>
      <label>Declared output columns<input value={asCsv(params.output_columns)} onChange={(event) => setParams({ ...params, output_columns: csvList(event.target.value) })} placeholder="customer_id, net_amount, risk_band" /></label>
      <label className="editor fullWidth">
        Python code
        <CodeEditor
          className="pythonEditor"
          value={String(params.code ?? "")}
          onChange={(event) => setParams({ ...params, code: event.target.value })}
          placeholder={"def transform(df):\n    next_df = df.copy()\n    next_df['new_column'] = next_df['amount'] * 2\n    return next_df"}
        />
      </label>
    </div>;
  }
  if (step.step_type === "reorder") {
    const selected = params.columns as string[] ?? [];
    const selectedSet = new Set(selected);
    const selectedValid = selected.filter((column) => columns.includes(column));
    const missingFromSelection = columns.filter((column) => !selectedSet.has(column));
    const hasStaleOrder = selected.length > 0 && missingFromSelection.length > 0;
    const ordered = hasStaleOrder ? columns : selectedValid.length ? [...selectedValid, ...columns.filter((column) => !selectedValid.includes(column))] : columns;
    const syncColumns = () => setParams({ ...params, columns, include_unlisted: true });
    const moveDraggedColumn = (fromIndex: number, toIndex: number) => setParams({ ...params, columns: moveItem(ordered, fromIndex, toIndex), include_unlisted: true });
    return <div className="ruleStack">
      <div className="ruleToolbar">
        <label className="toggle"><input type="checkbox" checked={Boolean(params.include_unlisted ?? true)} onChange={(event) => setParams({ ...params, include_unlisted: event.target.checked })} />Keep unlisted columns after selected</label>
        <button className="ghost small" onClick={syncColumns}>Sync from previous step</button>
      </div>
      <div className="reorderList">
        {ordered.map((column, idx) => <div
          className="reorderItem"
          draggable
          key={`${column}-${idx}`}
          onDragStart={(event) => event.dataTransfer.setData("text/plain", String(idx))}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const fromIndex = Number(event.dataTransfer.getData("text/plain"));
            if (!Number.isNaN(fromIndex)) moveDraggedColumn(fromIndex, idx);
          }}
        >
          <span className="dragHandle">☰</span>
          <span>{idx + 1}. {column}</span>
        </div>)}
      </div>
    </div>;
  }
  return <div className="ruleRow"><ColumnSelect value={String(params.column ?? "")} columns={columns} onChange={(value) => setParams({ ...params, column: value })} /><label>Ascending<select value={String(params.ascending ?? true)} onChange={(event) => setParams({ ...params, ascending: event.target.value === "true" })}><option value="true">Ascending</option><option value="false">Descending</option></select></label></div>;
}

function RuleTable({ columns, rows, labels, onAdd, onChange }: { columns: string[]; rows: { source: string; target: string }[]; labels: string[]; onAdd: () => void; onChange: (rows: { source: string; target: string }[]) => void }) {
  return <div className="ruleStack">
    <div className="mappingHead"><span>{labels[0]}</span><span>{labels[1]}</span><span /></div>
    {rows.map((row, index) => <div className="mappingRow" key={index}>
      <ColumnSelect value={row.source} columns={columns} onChange={(value) => onChange(updateArray(rows, index, { ...row, source: value }))} />
      <input value={row.target} onChange={(event) => onChange(updateArray(rows, index, { ...row, target: event.target.value }))} />
      <button className="ghost small" onClick={() => onChange(rows.filter((_, itemIndex) => itemIndex !== index))}>Delete</button>
    </div>)}
    <button className="ghost small" onClick={onAdd}>Add mapping</button>
  </div>;
}

function OperandEditor({ label, operand, columns, onChange }: { label: string; operand: Operand; columns: string[]; onChange: (operand: Operand) => void }) {
  return <div className="operandEditor">
    <label>{label} type<select value={operand.kind} onChange={(event) => onChange({ kind: event.target.value as Operand["kind"], value: "" })}><option value="column">Column</option><option value="constant">Constant</option></select></label>
    <label>{label}{operand.kind === "column" ? <ColumnSelect value={operand.value} columns={columns} onChange={(value) => onChange({ ...operand, value })} /> : <input value={operand.value} onChange={(event) => onChange({ ...operand, value: event.target.value })} />}</label>
  </div>;
}

function PreviewPanel({ tab, onTab, onClose, preview, validation, sampleSize, onSampleSize, previewStepId, onPreviewStepId, steps }: { tab: "input" | "output" | "validation" | "notes"; onTab: (tab: "input" | "output" | "validation" | "notes") => void; onClose: () => void; preview: TransformationPreview | null; validation: ValidationResult | null; sampleSize: number; onSampleSize: (value: number) => void; previewStepId: string; onPreviewStepId: (value: string) => void; steps: TransformationStep[] }) {
  const rows = preview?.rows ?? [];
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  return <section className="previewPanel">
    <div className="previewHeader">
      <div className="previewTabs">{(["input", "output", "validation", "notes"] as const).map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => onTab(item)}>{humanize(item)}</button>)}</div>
      <button className="ghost small" onClick={onClose}>Close</button>
    </div>
    <div className="previewControls">
      <label>Sample<select value={sampleSize} onChange={(event) => onSampleSize(Number(event.target.value))}>{[20, 50, 100].map((size) => <option key={size}>{size}</option>)}</select></label>
      <label>Until step<select value={previewStepId} onChange={(event) => onPreviewStepId(event.target.value)}><option value="">All steps</option>{steps.map((step, index) => <option key={step.id} value={step.id}>{index + 1}. {step.step_name}</option>)}</select></label>
    </div>
    {tab === "validation" ? <IssueList validation={validation} warnings={preview?.warnings ?? []} /> : tab === "notes" ? <div className="notesList">{preview?.execution_notes.map((note) => <p key={note}>{note}</p>) ?? <p className="emptyState">Run preview to see execution notes.</p>}</div> : (
      <div className="dataPreview">
        <div className="previewStats">
          <span>Rows {preview?.input_rows ?? 0} → {preview?.output_rows ?? 0}</span>
          <span>Added {(preview?.changed_columns.added ?? []).join(", ") || "-"}</span>
          <span>Removed {(preview?.changed_columns.removed ?? []).join(", ") || "-"}</span>
        </div>
        <table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{String(row[column] ?? "")}</td>)}</tr>)}</tbody></table>
        {rows.length === 0 && <p className="emptyState">Run preview.</p>}
      </div>
    )}
  </section>;
}

function IssueList({ validation, warnings }: { validation: ValidationResult | null; warnings: string[] }) {
  const errors = validation?.errors ?? [];
  const combinedWarnings = [...(validation?.warnings ?? []), ...warnings];
  return <div className="issueList">
    {errors.map((item) => <p className="errorText" key={item}>Error: {item}</p>)}
    {combinedWarnings.map((item) => <p className="warningText" key={item}>Warning: {item}</p>)}
    {!errors.length && !combinedWarnings.length && <p className="emptyState">No validation issues.</p>}
  </div>;
}

function validationForStep(step: TransformationStep, index: number, validation: ValidationResult | null): StepValidationState {
  const stepPrefix = `Step ${index + 1} `;
  const errors = (validation?.errors ?? [])
    .filter((message) => message.startsWith(stepPrefix))
    .map((message) => message.slice(stepPrefix.length).trim());
  const warnings = (validation?.warnings ?? [])
    .filter((message) => message.includes(step.step_name))
    .map((message) => message.trim());
  return { errors, warnings };
}

function ScheduleEditor({ value, onChange }: { value: ScheduleBuilder; onChange: (value: ScheduleBuilder) => void }) {
  const showTime = value.mode === "daily" || value.mode === "weekly" || value.mode === "monthly";
  return <div className="scheduleEditor">
    <label>Schedule type
      <select value={value.mode} onChange={(event) => onChange(nextScheduleBuilder(value, event.target.value as ScheduleMode))}>
        <option value="manual">Manual only</option>
        <option value="hourly">Every few hours</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
        {value.mode === "custom" && <option value="custom">Custom cron</option>}
      </select>
    </label>
    {value.mode === "hourly" && <label>Every how many hours
      <select value={value.everyHours} onChange={(event) => onChange({ ...value, everyHours: event.target.value })}>
        {[1, 2, 3, 4, 6, 8, 12].map((hours) => <option key={hours} value={String(hours)}>{hours} hour{hours === 1 ? "" : "s"}</option>)}
      </select>
    </label>}
    {showTime && <label>Time
      <input type="time" value={value.time} onChange={(event) => onChange({ ...value, time: event.target.value || "09:00" })} />
    </label>}
    {value.mode === "weekly" && <label>Day of week
      <select value={value.weekday} onChange={(event) => onChange({ ...value, weekday: event.target.value })}>
        {WEEKDAY_OPTIONS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
      </select>
    </label>}
    {value.mode === "monthly" && <label>Day of month
      <select value={value.dayOfMonth} onChange={(event) => onChange({ ...value, dayOfMonth: event.target.value })}>
        {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => <option key={day} value={String(day)}>{day}</option>)}
      </select>
    </label>}
    {value.mode === "custom" && <label>Custom cron
      <input value={value.cron} onChange={(event) => onChange({ ...value, cron: event.target.value })} placeholder="0 9 * * 1" />
    </label>}
    <div className="scheduleHint">
      <strong>{describeSchedule(buildScheduleCron(value))}</strong>
      <span>{buildScheduleCron(value) || "No schedule. Pipeline runs manually only."}</span>
    </div>
  </div>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function Editor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="editor">{label}<textarea value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function CodeEditor({ className, value, onChange, placeholder }: { className?: string; value: string; onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void; placeholder?: string }) {
  return <div className={`codeEditorShell ${className ?? ""}`}>
    <pre className="codeEditorHighlight" aria-hidden="true" dangerouslySetInnerHTML={{ __html: highlightPython(value || placeholder || "") }} />
    <textarea className="codeEditorInput miniTextarea" value={value} onChange={onChange} placeholder={placeholder} spellCheck={false} />
  </div>;
}

function Status({ status }: { status: Run["status"] }) {
  return <span className={`status ${status}`}>{status}</span>;
}

function ColumnSelect({ value, columns, onChange }: { value: string; columns: string[]; onChange: (value: string) => void }) {
  if (columns.length === 0) {
    return <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="column_name" />;
  }
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select column</option>
      {columns.map((column) => <option key={column} value={column}>{column}</option>)}
    </select>
  );
}

function RoleCard({ role, text }: { role: string; text: string }) {
  return <div className="roleCard"><strong>{role}</strong><span>{text}</span></div>;
}

function ConnectorCatalog({
  title,
  eyebrow,
  connectors,
  resources,
  selectedKey,
  resourceName,
  configValue,
  onNameChange,
  onConfigChange,
  onCreate,
  onTest,
  testingKey,
  onDelete,
  onEdit,
  onSelect,
  isEditing = false,
  readOnly = false
}: {
  title: string;
  eyebrow: string;
  connectors: Connector[];
  resources: Resource[];
  selectedKey: string;
  resourceName: string;
  configValue: string;
  onNameChange: (value: string) => void;
  onConfigChange: (value: string) => void;
  onCreate: () => void;
  onTest: (connectorKey: string, config: Record<string, unknown>, label: string) => void;
  testingKey: string | null;
  onDelete: (id: number) => void;
  onEdit: (resource: Resource) => void;
  onSelect: (connector: Connector) => void;
  isEditing?: boolean;
  readOnly?: boolean;
}) {
  const selected = connectors.find((connector) => connector.key === selectedKey);
  return (
    <section className="panel">
      <div className="panelHead">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="connectorGrid">
        {connectors.map((connector) => (
          <button
            className={`connectorCard ${connector.key === selectedKey ? "selected" : ""}`}
            key={connector.key}
            onClick={() => onSelect(connector)}
          >
            <span>{connector.name.slice(0, 2).toUpperCase()}</span>
            <strong>{connector.name}</strong>
            <small>{connector.description}</small>
          </button>
        ))}
      </div>
      {selected && (
        <div className="connectorSetup">
          <div className="panelHead">
            <div>
              <p className="eyebrow">Configure</p>
              <h2>{selected.name}</h2>
            </div>
            {!readOnly && (
              <div className="actions tight">
                <button className="ghost" onClick={() => onTest(selected.key, safeParseObject(configValue), `draft-${selected.key}`)} disabled={testingKey === `draft-${selected.key}`}>
                  {testingKey === `draft-${selected.key}` ? "Testing..." : "Test connection"}
                </button>
                <button className="primary" onClick={onCreate}>
                  {isEditing ? "Update" : "Create"} {selected.type === "source" ? "datasource" : "destination"}
                </button>
              </div>
            )}
          </div>
          <div className="formGrid two">
            <label>
              Name
              <input value={resourceName} onChange={(event) => onNameChange(event.target.value)} placeholder={selected.name} />
            </label>
            <label>
              Connector
              <input value={selected.name} readOnly />
            </label>
          </div>
          <GeneratedConfigForm connector={selected} value={configValue} onChange={onConfigChange} connectionOnly />
        </div>
      )}
      <div className="panelHead listHead">
        <div>
          <p className="eyebrow">Configured</p>
          <h2>{selected?.type === "source" ? "Datasources" : "Destinations"}</h2>
        </div>
      </div>
      <div className="table">
        {resources.map((resource) => (
          <div className="row" key={resource.id}>
            <span>#{resource.id}</span>
            <strong>{resource.name}</strong>
            <span>{labelFor(connectors, resource.connector_key)}</span>
            <span>{resource.connection_count} connections</span>
            <span>{resource.last_sync || "-"}</span>
            <span>{resource.status}</span>
            {!readOnly && <div className="resourceActions">
              <button className="ghost small" onClick={() => onTest(resource.connector_key, resource.config, `saved-${resource.id}`)} disabled={testingKey === `saved-${resource.id}`}>{testingKey === `saved-${resource.id}` ? "Testing..." : "Test"}</button>
              <button className="ghost small" onClick={() => onEdit(resource)}>Edit</button>
              <button className="ghost small" onClick={() => onDelete(resource.id)}>Delete</button>
            </div>}
          </div>
        ))}
      </div>
    </section>
  );
}

function GeneratedConfigForm({
  connector,
  value,
  onChange,
  connectionOnly = false
}: {
  connector: Connector;
  value: string;
  onChange: (value: string) => void;
  connectionOnly?: boolean;
}) {
  const config = safeParseObject(value);
  const required = new Set(connector.config_schema.required ?? []);
  const entries = Object.entries(connector.config_schema.properties ?? {}).filter(([key]) => !connectionOnly || !CONNECTION_TARGET_FIELDS.has(key));

  function updateField(key: string, schema: SchemaProperty, rawValue: string) {
    const next = { ...config };
    if (schema.type === "number") {
      next[key] = rawValue === "" ? "" : Number(rawValue);
    } else if (schema.type === "object") {
      try {
        next[key] = rawValue ? JSON.parse(rawValue) : {};
      } catch {
        next[key] = rawValue;
      }
    } else {
      next[key] = rawValue;
    }
    onChange(JSON.stringify(next, null, 2));
  }

  return (
    <div className="generatedForm">
      {entries.map(([key, schema]) => (
        <label key={key}>
          {humanize(key)}{required.has(key) ? " *" : ""}
          {schema.enum ? (
            <select value={String(config[key] ?? schema.default ?? schema.enum[0] ?? "")} onChange={(event) => updateField(key, schema, event.target.value)}>
              {schema.enum.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          ) : schema.type === "object" ? (
            <textarea
              className="miniTextarea"
              value={typeof config[key] === "object" ? JSON.stringify(config[key], null, 2) : String(config[key] ?? schema.default ?? "{}")}
              onChange={(event) => updateField(key, schema, event.target.value)}
            />
          ) : (
            <input
              type={schema.secret ? "password" : schema.type === "number" ? "number" : "text"}
              value={String(config[key] ?? schema.default ?? "")}
              onChange={(event) => updateField(key, schema, event.target.value)}
              placeholder={placeholderFor(key, schema)}
            />
          )}
        </label>
      ))}
    </div>
  );
}

const STEP_TYPES: { type: StepType; label: string; description: string }[] = [
  { type: "select", label: "Select Columns", description: "Keep required columns only" },
  { type: "rename", label: "Rename Columns", description: "Map source names to destination names" },
  { type: "reorder", label: "Reorder Columns", description: "Control final output column order" },
  { type: "blank_columns", label: "Add Blank Columns", description: "Create required output columns as blank/null/custom" },
  { type: "join", label: "Join / Merge", description: "Merge another datasource by matching keys" },
  { type: "cast", label: "Change Data Type", description: "Convert string, integer, float, date, datetime" },
  { type: "validate", label: "Validate Rows", description: "Reject bad records by standard rules and continue" },
  { type: "pii_encrypt", label: "Encrypt PII", description: "Encrypt selected sensitive columns" },
  { type: "fillna", label: "Fill Null Values", description: "Fixed values, empty string, zero, forward/back fill" },
  { type: "derive", label: "Add Derived Column", description: "Create column with controlled formula builder" },
  { type: "filter", label: "Filter Rows", description: "Build AND/OR conditions visually" },
  { type: "value_map", label: "Map Column Values", description: "Map values such as yes to 1 and no to 0" },
  { type: "groupby", label: "Group By", description: "Aggregate rows by one or more columns" },
  { type: "pivot", label: "Pivot", description: "Turn values from rows into output columns" },
  { type: "custom", label: "Custom Transform", description: "Run trusted Python with df, pd, and np" },
  { type: "deduplicate", label: "Remove Duplicates", description: "Drop duplicate rows by subset" },
  { type: "sort", label: "Sort Rows", description: "Order output rows" }
];

const VALIDATION_RULES = [
  { value: "none", label: "none" },
  { value: "required", label: "required" },
  { value: "not_blank", label: "not blank" },
  { value: "regex", label: "regex" },
  { value: "numeric", label: "numeric" },
  { value: "decimal", label: "decimal" },
  { value: "integer", label: "integer" },
  { value: "date_format", label: "date format" },
  { value: "max_length", label: "max length" },
  { value: "min_length", label: "min length" },
  { value: "exact_length", label: "exact length" },
  { value: "allowed_values", label: "allowed values" }
];

const FILTER_OPERATORS = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "not equals" },
  { value: "greater_than", label: "greater than" },
  { value: "less_than", label: "less than" },
  { value: "contains", label: "contains" },
  { value: "like", label: "like" },
  { value: "not_like", label: "not like" },
  { value: "starts_with", label: "starts with" },
  { value: "is_null", label: "is null" },
  { value: "is_not_null", label: "is not null" },
  { value: "in_list", label: "in list" }
];

const DATA_TYPES = ["string", "integer", "float", "boolean", "date", "datetime"];
const DATE_FORMAT_OPTIONS = [
  { value: "dd-mm-yyyy", label: "dd-mm-yyyy" },
  { value: "dd-mm-yy", label: "dd-mm-yy" },
  { value: "dd/mm/yyyy", label: "dd/mm/yyyy" },
  { value: "dd/mm/yy", label: "dd/mm/yy" },
  { value: "mm/dd/yyyy", label: "mm/dd/yyyy" },
  { value: "mm/dd/yy", label: "mm/dd/yy" },
  { value: "mm-dd-yyyy", label: "mm-dd-yyyy" },
  { value: "mm-dd-yy", label: "mm-dd-yy" },
  { value: "yyyy-mm-dd", label: "yyyy-mm-dd" },
  { value: "yyyy/mm/dd", label: "yyyy/mm/dd" },
  { value: "yy-mm-dd", label: "yy-mm-dd" },
  { value: "yy/mm/dd", label: "yy/mm/dd" },
];
const AGG_FUNCS = ["sum", "mean", "min", "max", "count", "count_distinct", "first", "last"];
const WEEKDAY_OPTIONS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];
const CONNECTION_TARGET_FIELDS = new Set(["schema", "table", "query", "path_pattern", "output_path_pattern", "rejected_path", "rejected_path_pattern", "operation", "format", "mode", "primary_key", "xlsx_data_sheet", "auto_create_folders"]);

function parseScheduleToBuilder(schedule: string | null | undefined): ScheduleBuilder {
  const cron = normalizedSchedule(schedule);
  if (!cron) return { mode: "manual", everyHours: "1", time: "09:00", weekday: "1", dayOfMonth: "1", cron: "" };
  const parts = cron.split(/\s+/);
  if (parts.length !== 5) return { mode: "custom", everyHours: "1", time: "09:00", weekday: "1", dayOfMonth: "1", cron };
  const [minute, hour, day, month, weekday] = parts;
  if (minute === "0" && (hour === "*" || hour.startsWith("*/")) && day === "*" && month === "*" && weekday === "*") {
    return { mode: "hourly", everyHours: hour === "*" ? "1" : hour.slice(2), time: "09:00", weekday: "1", dayOfMonth: "1", cron };
  }
  if (isNumber(minute) && isNumber(hour) && day === "*" && month === "*" && weekday === "*") {
    return { mode: "daily", everyHours: "1", time: `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`, weekday: "1", dayOfMonth: "1", cron };
  }
  if (isNumber(minute) && isNumber(hour) && day === "*" && month === "*" && isNumber(weekday)) {
    return { mode: "weekly", everyHours: "1", time: `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`, weekday, dayOfMonth: "1", cron };
  }
  if (isNumber(minute) && isNumber(hour) && isNumber(day) && month === "*" && weekday === "*") {
    return { mode: "monthly", everyHours: "1", time: `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`, weekday: "1", dayOfMonth: day, cron };
  }
  return { mode: "custom", everyHours: "1", time: "09:00", weekday: "1", dayOfMonth: "1", cron };
}

function nextScheduleBuilder(current: ScheduleBuilder, mode: ScheduleMode): ScheduleBuilder {
  if (mode === "custom") return { ...current, mode, cron: current.cron || normalizedSchedule(buildScheduleCron(current)) };
  return { ...current, mode, cron: mode === current.mode ? current.cron : "" };
}

function buildScheduleCron(value: ScheduleBuilder): string {
  if (value.mode === "manual") return "";
  if (value.mode === "custom") return normalizedSchedule(value.cron);
  if (value.mode === "hourly") return `0 */${value.everyHours || "1"} * * *`;
  const [hour, minute] = splitScheduleTime(value.time);
  if (value.mode === "daily") return `${minute} ${hour} * * *`;
  if (value.mode === "weekly") return `${minute} ${hour} * * ${value.weekday || "1"}`;
  if (value.mode === "monthly") return `${minute} ${hour} ${value.dayOfMonth || "1"} * *`;
  return "";
}

function normalizedSchedule(schedule: string | null | undefined): string {
  return String(schedule || "").trim();
}

function splitScheduleTime(value: string): [string, string] {
  const [hour = "09", minute = "00"] = String(value || "09:00").split(":");
  return [hour.padStart(2, "0"), minute.padStart(2, "0")];
}

function isNumber(value: string): boolean {
  return /^\d+$/.test(value);
}

function describeSchedule(schedule: string | null | undefined): string {
  const cron = normalizedSchedule(schedule);
  if (!cron) return "Manual";
  const builder = parseScheduleToBuilder(cron);
  if (builder.mode === "hourly") return `Every ${builder.everyHours} hour${builder.everyHours === "1" ? "" : "s"}`;
  if (builder.mode === "daily") return `Daily at ${builder.time}`;
  if (builder.mode === "weekly") return `Weekly on ${WEEKDAY_OPTIONS.find((day) => day.value === builder.weekday)?.label || "selected day"} at ${builder.time}`;
  if (builder.mode === "monthly") return `Monthly on day ${builder.dayOfMonth} at ${builder.time}`;
  return `Custom (${cron})`;
}

function defaultSteps(): TransformationStep[] {
  return [
    emptyStep("select"),
    emptyStep("rename"),
    emptyStep("cast"),
    emptyStep("fillna"),
    emptyStep("derive"),
    emptyStep("filter"),
    emptyStep("deduplicate")
  ];
}

function emptyStep(stepType: StepType): TransformationStep {
  const base = STEP_TYPES.find((item) => item.type === stepType);
  const params: Record<string, unknown> = {
    select: { columns: [] },
    rename: { mappings: [] },
    join: { right_source_mode: "saved_source", right_source_id: "", right_source_config: {}, join_type: "left", left_key: "", right_key: "", right_columns: [], suffix: "_right" },
    cast: { casts: [] },
    validate: { rules: [] },
    pii_encrypt: { columns: [], mode: "encrypt", key_id: "default" },
    fillna: { fills: [] },
    derive: { output_column: "", output_type: "float", left: { kind: "column", value: "" }, operator: "+", right: { kind: "constant", value: "" } },
    blank_columns: { columns: "" },
    filter: { joiner: "and", conditions: [] },
    value_map: { column: "", output_column: "", output_type: "integer", mappings: [{ from: "yes", to: "1" }, { from: "no", to: "0" }] },
    groupby: { group_columns: [], aggregations: [{ column: "", function: "sum", output_column: "" }] },
    pivot: { index_columns: [], pivot_column: "", value_column: "", aggfunc: "sum", fill_value: 0 },
    custom: { output_columns: [], code: "def transform(df):\n    next_df = df.copy()\n    return next_df" },
    deduplicate: { columns: [], keep: "first" },
    reorder: { columns: [], include_unlisted: true },
    sort: { column: "", ascending: true }
  }[stepType] as Record<string, unknown>;
  return {
    id: makeId(),
    step_type: stepType,
    step_name: base?.label ?? humanize(stepType),
    is_enabled: true,
    parameters: params
  };
}

function transformationPayload(draft: { name: string; description: string; source_id: string; destination_id: string; source_config: Record<string, unknown>; destination_config: Record<string, unknown>; steps: TransformationStep[] }) {
  return {
    name: draft.name,
    description: draft.description,
    source_id: draft.source_id ? Number(draft.source_id) : null,
    destination_id: draft.destination_id ? Number(draft.destination_id) : null,
    source_config: sanitizeConnectorConfig("sftp_source", draft.source_config),
    destination_config: sanitizeConnectorConfig("sftp_destination", draft.destination_config),
    steps: sanitizeTransformationSteps(draft.steps)
  };
}

function findResourceId(resources: Resource[], connectorKey: string, config: Record<string, unknown>, savedId?: number | null) {
  if (savedId && resources.some((item) => item.id === savedId)) return savedId;
  return resources.find((item) => item.connector_key === connectorKey && stableJson(item.config) === stableJson(config))?.id
    ?? resources.find((item) => item.connector_key === connectorKey && resourceSignature(item.config) === resourceSignature(config))?.id;
}

function findTransformationId(transformations: Transformation[], steps: Record<string, unknown>[]) {
  return transformations.find((item) => stableJson(item.steps) === stableJson(steps))?.id;
}

function findTransformationVersion(versions: TransformationVersion[], steps: Record<string, unknown>[]) {
  return versions.find((item) => stableJson(stepsFromVersion(item)) === stableJson(steps))?.version_no;
}

function stepsFromVersion(version: TransformationVersion): TransformationStep[] {
  return Array.isArray(version.snapshot_data?.steps) ? version.snapshot_data.steps : [];
}

function activeRunForPipeline(runs: Run[], pipelineId: number) {
  return runs.find((run) => run.pipeline_id === pipelineId && (run.status === "queued" || run.status === "running"));
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(flattenKeys(value)).sort());
}

function resourceSignature(config: Record<string, unknown>): string {
  return ["host", "port", "database", "username"]
    .map((key) => String(config[key] ?? ""))
    .join("|");
}

function flattenKeys(value: unknown, keys: Record<string, true> = {}) {
  if (value && typeof value === "object") {
    Object.keys(value).forEach((key) => {
      keys[key] = true;
      flattenKeys((value as Record<string, unknown>)[key], keys);
    });
  }
  return keys;
}

function columnsBeforeStep(sourceColumns: string[], steps: TransformationStep[], stepIndex: number) {
  return steps.slice(0, stepIndex).reduce((current, step) => columnsAfterStep(current, step), sourceColumns);
}

function columnsAfterStep(current: string[], step: TransformationStep) {
  if (!step.is_enabled) return current;
  const params = step.parameters;
  if (step.step_type === "select" && Array.isArray(params.columns) && params.columns.length) {
    return (params.columns as string[]).filter((column) => current.includes(column));
  }
  if (step.step_type === "rename") {
    const mappings = params.mappings as { source?: string; target?: string }[] ?? [];
    const bySource = new Map<string, string>();
    mappings.forEach((item) => {
      if (item.source && item.target) bySource.set(item.source, item.target);
    });
    return current.map((column) => bySource.get(column) ?? column);
  }
  if (step.step_type === "join") {
    return appendMissing(current, params.right_columns as string[] ?? []);
  }
  if (step.step_type === "derive" && params.output_column) {
    return appendMissing(current, [String(params.output_column)]);
  }
  if (step.step_type === "blank_columns") {
    return appendMissing(current, blankColumnNames(params.columns));
  }
  if (step.step_type === "value_map" && params.output_column) {
    return appendMissing(current, [String(params.output_column)]);
  }
  if (step.step_type === "groupby" && Array.isArray(params.group_columns)) {
    const aggregations = params.aggregations as { column?: string; function?: string; output_column?: string }[] ?? [];
    return [
      ...(params.group_columns as string[]),
      ...aggregations.filter((item) => item.column && item.function).map((item) => item.output_column || `${item.column}_${item.function}`)
    ];
  }
  if (step.step_type === "pivot" && Array.isArray(params.index_columns)) {
    return params.index_columns as string[];
  }
  if (step.step_type === "custom" && Array.isArray(params.output_columns) && params.output_columns.length) {
    return params.output_columns as string[];
  }
  if (step.step_type === "reorder" && Array.isArray(params.columns) && params.columns.length) {
    const selected = (params.columns as string[]).filter((column) => current.includes(column));
    const remaining = params.include_unlisted === false ? [] : current.filter((column) => !selected.includes(column));
    return [...selected, ...remaining];
  }
  return current;
}

function appendMissing(current: string[], additions: string[]) {
  return [...current, ...additions.filter((column) => column && !current.includes(column))];
}

function blankColumnNames(value: unknown) {
  if (typeof value === "string") return csvList(value.replace(/\n/g, ","));
  if (!Array.isArray(value)) return [];
  return value.map((item) => typeof item === "string" ? item : String((item as { name?: unknown }).name ?? "")).filter(Boolean);
}

function updateArray<T>(rows: T[], index: number, value: T) {
  return rows.map((row, rowIndex) => rowIndex === index ? value : row);
}

function moveArray<T>(rows: T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function moveItem<T>(rows: T[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= rows.length || toIndex >= rows.length) return rows;
  const next = [...rows];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function csvList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function asCsv(value: unknown) {
  return Array.isArray(value) ? value.join(", ") : "";
}

function inferType(column: string) {
  const lower = column.toLowerCase();
  if (lower.includes("date") || lower.endsWith("_at")) return "datetime";
  if (lower.includes("amount") || lower.includes("mrr") || lower.includes("price")) return "float";
  if (lower.endsWith("id") || lower.includes("count")) return "integer";
  return "string";
}

function labelFor(connectors: Connector[], key: string) {
  return connectors.find((item) => item.key === key)?.name ?? key;
}

function parseJson(value: string) {
  const parsed = JSON.parse(value);
  return parsed;
}

function highlightPython(code: string) {
  const placeholders: string[] = [];
  let escaped = escapeHtml(code);
  escaped = escaped.replace(/(\".*?\"|\'.*?\'|#.*$)/gm, (match) => {
    const tokenClass = match.startsWith("#") ? "comment" : "string";
    const key = `__TOKEN_${placeholders.length}__`;
    placeholders.push(`<span class="token ${tokenClass}">${match}</span>`);
    return key;
  });
  escaped = escaped
    .replace(/\b(def|return|if|elif|else|for|while|in|import|from|as|try|except|raise|with|lambda|and|or|not|True|False|None|class)\b/g, '<span class="token keyword">$1</span>')
    .replace(/\b(pd|np|df|result|transform)\b/g, '<span class="token builtin">$1</span>');
  return escaped.replace(/__TOKEN_(\d+)__/g, (_, index) => placeholders[Number(index)] ?? "");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeConnectorConfig(connectorKey: string, config: Record<string, unknown>) {
  if (!connectorKey.startsWith("sftp_")) return config;
  const next = { ...config };
  delete next.path_pattern;
  delete next.output_path_pattern;
  return next;
}

function sanitizeTransformationSteps(steps: TransformationStep[]) {
  return steps.map((step) => {
    if (step.step_type !== "join") return step;
    const params = { ...step.parameters };
    if (String(params.right_source_mode ?? "") === "same_connection" && params.right_source_config && typeof params.right_source_config === "object") {
      params.right_source_config = sanitizeConnectorConfig("sftp_source", params.right_source_config as Record<string, unknown>);
    }
    return { ...step, parameters: params };
  });
}

function sampleConfig(connector: Connector) {
  const properties = connector.config_schema.properties;
  if (!properties || typeof properties !== "object") return "{}";
  const sample: Record<string, unknown> = {};
  Object.entries(properties).forEach(([key, schema]) => {
    if (CONNECTION_TARGET_FIELDS.has(key)) return;
    if (schema.default !== undefined) sample[key] = schema.default;
    else if (schema.type === "number") sample[key] = key === "port" ? 5432 : 0;
    else if (schema.type === "object") sample[key] = {};
    else if (schema.enum && Array.isArray(schema.enum)) sample[key] = schema.enum[0];
    else if (key === "query" || key === "primary_key") sample[key] = "";
    else sample[key] = schema.secret ? "" : key;
  });
  return JSON.stringify(sample, null, 2);
}

function refreshedConfig(current: string, connector?: Connector) {
  return connector && current.includes("10.10.0.10") ? sampleConfig(connector) : current;
}

function sampleConfigForKey(key: string) {
  if (key.includes("sftp")) {
    return JSON.stringify({
      host: "",
      port: 22,
      username: "",
      password: "",
      remote_path: "",
    }, null, 2);
  }
  return JSON.stringify({
    host: "",
    port: 5432,
    database: "",
    username: "",
    password: ""
  }, null, 2);
}

function formatDatePattern(pattern: string) {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const values: Record<string, string> = {
    YYYY: String(now.getUTCFullYear()),
    YY: String(now.getUTCFullYear()).slice(-2),
    MM: pad(now.getUTCMonth() + 1),
    DD: pad(now.getUTCDate()),
    hh: pad(now.getUTCHours()),
    mm: pad(now.getUTCMinutes()),
    ss: pad(now.getUTCSeconds()),
  };
  values.timestamp = `${values.YYYY}${values.MM}${values.DD}${values.hh}${values.mm}${values.ss}`;
  return pattern.replace(/\{(YYYY|YY|MM|DD|hh|mm|ss|timestamp)\}/g, (_match, token: string) => values[token] ?? _match);
}

function makeId() {
  if (globalThis.crypto && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function safeParseObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function placeholderFor(key: string, schema: SchemaProperty) {
  if (schema.secret) return "Stored securely later";
  if (key === "host") return "10.10.0.20";
  if (key === "database") return "analytics";
  if (key === "query") return "select * from table";
  if (key === "remote_path") return "/home/sftp/base-folder";
  if (key.includes("path")) return "/path/to/file.csv";
  return humanize(key);
}

function canLoadColumns(connectorKey: string, config: Record<string, unknown>) {
  if (connectorKey === "postgres_source") return Boolean(config.query || config.table);
  if (connectorKey === "sftp_source") return Boolean(config.remote_path || config.path_pattern);
  if (connectorKey === "postgres_destination") return Boolean(config.table);
  if (connectorKey === "sftp_destination") return Boolean(config.remote_path || config.output_path_pattern);
  return true;
}

function loadSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) as AuthSession : null;
  } catch {
    return null;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await request(path, init);
  return response.json();
}

async function apiText(path: string, init?: RequestInit): Promise<string> {
  const response = await request(path, init);
  return response.text();
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const session = loadSession();
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (session?.token) headers.set("Authorization", `Bearer ${session.token}`);
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers
  });
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem(SESSION_KEY);
    }
    throw new Error(await readableError(response));
  }
  return response;
}

async function readableError(response: Response): Promise<string> {
  const fallback = response.status === 401
    ? "Invalid email or password"
    : response.status === 403
      ? "You do not have permission to perform this action"
      : "Request failed. Please try again.";
  try {
    const payload = await response.json();
    if (typeof payload.detail === "string") return payload.detail;
    if (Array.isArray(payload.detail)) {
      return payload.detail
        .map((item: { loc?: unknown[]; msg?: string }) => {
          const location = Array.isArray(item.loc) ? item.loc.filter((part: unknown) => part !== "body").join(".") : "";
          return `${location ? `${location}: ` : ""}${item.msg ?? "Invalid value"}`;
        })
        .join("; ");
    }
  } catch {
    try {
      const text = await response.text();
      if (text) return text;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

createRoot(document.getElementById("root")!).render(<App />);
