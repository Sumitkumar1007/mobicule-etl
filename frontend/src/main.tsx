import React, { useEffect, useMemo, useState } from "react";
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
  role: "admin" | "support" | "viewer";
  created_at: string;
};
type AuthSession = { token: string; user: User };

type StepType = "select" | "rename" | "cast" | "fillna" | "derive" | "filter" | "deduplicate" | "sort";
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
type Menu = "datasources" | "destinations" | "transforms" | "pipelines" | "runs" | "access";

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
  const [users, setUsers] = useState<User[]>([]);
  const [selectedRun, setSelectedRun] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [activeMenu, setActiveMenu] = useState<Menu>("datasources");
  const [showPasswordPanel, setShowPasswordPanel] = useState(false);
  const [resourceName, setResourceName] = useState("");
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [editingPipelineId, setEditingPipelineId] = useState<number | null>(null);
  const [sourceColumns, setSourceColumns] = useState<string[]>([]);
  const [destinationColumns, setDestinationColumns] = useState<string[]>([]);
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
    status: "draft" as Transformation["status"],
    version: 1,
    steps: defaultSteps()
  });
  const [userForm, setUserForm] = useState({ name: "", email: "", password: "", role: "viewer" as User["role"] });
  const [passwordForm, setPasswordForm] = useState({ current_password: "", new_password: "", confirm_password: "" });
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
    schedule: "0 * * * *"
  });

  const sources = connectors.filter((item) => item.type === "source");
  const destinations = connectors.filter((item) => item.type === "destination");
  const isAdmin = currentUser?.role === "admin";
  const canRun = currentUser?.role === "admin" || currentUser?.role === "support";
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

  async function refresh() {
    const [connectorData, sourceData, destinationData, pipelineData, transformationData, transformationVersionData, runData, userData] = await Promise.all([
      api<Connector[]>("/connectors"),
      api<Resource[]>("/sources"),
      api<Resource[]>("/destinations"),
      api<Pipeline[]>("/pipelines"),
      api<Transformation[]>("/transformations"),
      api<TransformationVersion[]>("/transformation-versions"),
      api<Run[]>("/runs"),
      isAdmin ? api<User[]>("/users") : Promise.resolve([])
    ]);
    setConnectors(connectorData);
    setSourceResources(sourceData);
    setDestinationResources(destinationData);
    setPipelines(pipelineData);
    setTransformations(transformationData);
    setTransformationVersions(transformationVersionData);
    setRuns(runData);
    setUsers(userData);
    setForm((current) => ({
      ...current,
      source_config: refreshedConfig(current.source_config, connectorData.find((item) => item.key === current.source_key) ?? connectorData.find((item) => item.key === "postgres_source")),
      destination_config: refreshedConfig(current.destination_config, connectorData.find((item) => item.key === current.destination_key) ?? connectorData.find((item) => item.key === "postgres_destination")),
      source_id: current.source_id || (editingPipelineId ? "" : String(sourceData[0]?.id ?? "")),
      destination_id: current.destination_id || (editingPipelineId ? "" : String(destinationData[0]?.id ?? "")),
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
    const timer = window.setInterval(() => refresh().catch(showError), 4000);
    return () => window.clearInterval(timer);
  }, [currentUser]);

  useEffect(() => {
    if (currentUser && currentUser.role !== "admin" && activeMenu === "access") {
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
    if (resource) loadColumnsFor(resource, "source").catch(showError);
  }, [activeMenu, transformationDraft.source_id, sourceResources]);

  async function savePipeline() {
    const selectedSource = sourceResources.find((item) => String(item.id) === form.source_id);
    const selectedDestination = destinationResources.find((item) => String(item.id) === form.destination_id);
    if (!selectedSource || !selectedDestination) {
      throw new Error("Select datasource and destination first");
    }
    const selectedTransformation = transformations.find((item) => String(item.id) === form.transformation_id);
    const selectedVersion = transformationVersions.find(
      (item) => String(item.transformation_id) === form.transformation_id && String(item.version_no) === form.transformation_version
    );
    const payload = {
      name: form.name,
      source_id: Number(selectedSource.id),
      destination_id: Number(selectedDestination.id),
      source_key: selectedSource.connector_key,
      destination_key: selectedDestination.connector_key,
      source_config: selectedSource.config,
      destination_config: selectedDestination.config,
      transforms: selectedVersion ? stepsFromVersion(selectedVersion) : selectedTransformation?.steps ?? [],
      schedule: form.schedule
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
        config: parseJson(config)
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

  async function createUser() {
    await api<User>("/users", { method: "POST", body: JSON.stringify(userForm) });
    setUserForm({ name: "", email: "", password: "", role: "viewer" });
    setToast({ tone: "ok", text: "User created" });
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
    setForm({ ...form, transformation_id: String(result.id), transformation_version: "latest" });
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
      status: transformation.status,
      version: transformation.version,
      steps: transformation.steps.length ? transformation.steps : defaultSteps()
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
      status: "draft",
      version: 1,
      steps: defaultSteps()
    });
    setPreviewData(null);
    setValidationData(null);
    setPreviewOpen(false);
    setPreviewStepId("");
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

  async function loadColumnsFor(resource: Resource, target: "source" | "destination") {
    const metadataKey = resource.connector_key.replace("_destination", "_source");
    const payload = { source_key: metadataKey, source_config: resource.config };
    const result = await api<{ columns: string[]; error?: string }>("/metadata/columns", { method: "POST", body: JSON.stringify(payload) });
    if (result.error) setToast({ tone: "bad", text: result.error });
    if (target === "source") setSourceColumns(result.columns);
    else setDestinationColumns(result.columns);
  }

  function showError(error: unknown) {
    setToast({ tone: "bad", text: error instanceof Error ? error.message : "Request failed" });
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
    <main className="shell">
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
          {isAdmin && <button className={activeMenu === "access" ? "active" : ""} onClick={() => setActiveMenu("access")}>Access Control</button>}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">No-code data movement</p>
          </div>
          <div className="topbarActions">
            <span className="userBadge">{currentUser.name} · {currentUser.role}</span>
            {isAdmin && activeMenu === "pipelines" && <button className="primary" onClick={() => savePipeline().catch(showError)}>{editingPipelineId ? "Update pipeline" : "Save pipeline"}</button>}
            <button className="ghost" onClick={() => setShowPasswordPanel((value) => !value)}>Change Password</button>
            <button className="ghost" onClick={logout}>Logout</button>
          </div>
        </header>

        {showPasswordPanel && (
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

            <div className={previewOpen ? "builderGrid previewVisible" : "builderGrid previewHidden"}>
              <SchemaExplorer
                sourceResources={sourceResources}
                destinationResources={destinationResources}
                sourceId={transformationDraft.source_id}
                destinationId={transformationDraft.destination_id}
                columns={sourceColumns}
                search={columnSearch}
                onSearch={setColumnSearch}
                onSourceChange={(value) => {
                  const resource = sourceResources.find((item) => String(item.id) === value);
                  setTransformationDraft({ ...transformationDraft, source_id: value });
                  if (resource) loadColumnsFor(resource, "source").catch(showError);
                }}
                onDestinationChange={(value) => setTransformationDraft({ ...transformationDraft, destination_id: value })}
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
                  {transformationDraft.steps.map((step, index) => (
                    <StepCard
                      key={step.id}
                      step={step}
                      index={index}
                      columns={sourceColumns}
                      onChange={(next) => updateStep(step.id, () => next)}
                      onDuplicate={() => setTransformationDraft({ ...transformationDraft, steps: [...transformationDraft.steps, { ...step, id: makeId(), step_name: `${step.step_name} copy` }] })}
                      onDelete={() => setTransformationDraft({ ...transformationDraft, steps: transformationDraft.steps.filter((item) => item.id !== step.id) })}
                      onMoveUp={() => moveStep(step.id, -1)}
                      onMoveDown={() => moveStep(step.id, 1)}
                      readOnly={!isAdmin}
                    />
                  ))}
                </div>
              </section>

              {previewOpen && (
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
              )}
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
            {isAdmin && editingPipelineId && <button className="ghost small" onClick={() => {
              setEditingPipelineId(null);
              setForm({
                ...form,
                name: "Customer pipeline",
                transformation_id: "",
                transformation_version: "latest",
                schedule: "*/2 * * * *"
              });
            }}>New pipeline</button>}
          </div>
          <div className="formGrid two">
            <label>Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>Cron schedule<input value={form.schedule} onChange={(event) => setForm({ ...form, schedule: event.target.value })} placeholder="0 * * * *" /></label>
            <label>
              Datasource
              <select value={form.source_id} onChange={(event) => setForm({ ...form, source_id: event.target.value })}>
                <option value="">Select datasource</option>
                {sourceResources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>
              Destination
              <select value={form.destination_id} onChange={(event) => setForm({ ...form, destination_id: event.target.value })}>
                <option value="">Select destination</option>
                {destinationResources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>
              Transformation
              <select value={form.transformation_id} onChange={(event) => setForm({ ...form, transformation_id: event.target.value, transformation_version: "latest" })}>
                <option value="">No transformation</option>
                {transformations.filter((item) => item.status === "published").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>
              Transformation version
              <select value={form.transformation_version} onChange={(event) => setForm({ ...form, transformation_version: event.target.value })}>
                <option value="latest">Latest published</option>
                {selectedTransformationVersions.map((item) => <option key={item.id} value={String(item.version_no)}>v{item.version_no}</option>)}
              </select>
            </label>
          </div>
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
            {pipelines.map((pipeline) => (
              <div className="row" key={pipeline.id}>
                <span>#{pipeline.id}</span>
                <strong>{pipeline.name}</strong>
                <span>{labelFor(connectors, pipeline.source_key)} → {labelFor(connectors, pipeline.destination_key)}</span>
                <span>{pipeline.schedule || "Manual"}</span>
                {isAdmin && <button className="ghost small" onClick={() => {
                  setEditingPipelineId(pipeline.id);
                  setForm({
                    ...form,
                    name: pipeline.name,
                    source_id: String(findResourceId(sourceResources, pipeline.source_key, pipeline.source_config, pipeline.source_id) ?? ""),
                    destination_id: String(findResourceId(destinationResources, pipeline.destination_key, pipeline.destination_config, pipeline.destination_id) ?? ""),
                    transformation_id: String(findTransformationId(transformations, pipeline.transforms) ?? ""),
                    transformation_version: String(findTransformationVersion(transformationVersions, pipeline.transforms) ?? "latest"),
                    source_key: pipeline.source_key,
                    destination_key: pipeline.destination_key,
                    source_config: JSON.stringify(pipeline.source_config, null, 2),
                    destination_config: JSON.stringify(pipeline.destination_config, null, 2),
                    transforms: JSON.stringify(pipeline.transforms, null, 2),
                    schedule: pipeline.schedule || ""
                  });
                }}>Edit</button>}
                {canRun && <button className="primary small" onClick={() => runPipeline(pipeline.id).catch(showError)}>Run</button>}
                {isAdmin && <button className="ghost small" onClick={() => deletePipeline(pipeline.id).catch(showError)}>Delete</button>}
              </div>
            ))}
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

        {activeMenu === "access" && <section className="panel">
          <div className="panelHead">
            <div>
              <p className="eyebrow">Authentication & Authorization</p>
              <h2>Users and Roles</h2>
            </div>
          </div>
          <div className="formGrid three">
            <label>Name<input value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} /></label>
            <label>Email<input value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} /></label>
            <label>Password<input type="password" value={userForm.password} minLength={10} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} /></label>
            <label>
              Role
              <select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value as User["role"] })}>
                <option value="admin">Admin</option>
                <option value="support">Support</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
          </div>
          <div className="actions"><button className="primary" onClick={() => createUser().catch(showError)}>Create user</button></div>
          <div className="roleGrid">
            <RoleCard role="Admin" text="Full access, users, pipelines, schedules, runs, logs." />
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
              </div>
            ))}
          </div>
        </section>}
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
  columns,
  search,
  onSearch,
  onSourceChange,
  onDestinationChange
}: {
  sourceResources: Resource[];
  destinationResources: Resource[];
  sourceId: string;
  destinationId: string;
  columns: string[];
  search: string;
  onSearch: (value: string) => void;
  onSourceChange: (value: string) => void;
  onDestinationChange: (value: string) => void;
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
        <div>
          <p className="eyebrow">ETL TOOL INHOUSE</p>
          <h1>Sign in</h1>
        </div>
        <label>
          Email
          <input value={loginEmail} onChange={(event) => onEmail(event.target.value)} placeholder="admin@mobiflow.local" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={loginPassword}
            onChange={(event) => onPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onLogin();
            }}
          />
        </label>
        <button className="primary" onClick={onLogin}>Login</button>
      </section>
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
  onChange: (step: TransformationStep) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  readOnly?: boolean;
}) {
  return (
    <article className={`stepCard ${step.is_enabled ? "" : "disabled"}`}>
      <div className="stepHead">
        <span>{index + 1}</span>
        <div>
          <strong>{step.step_name}</strong>
          <small>{STEP_TYPES.find((item) => item.type === step.step_type)?.description}</small>
        </div>
        <label className="toggle"><input type="checkbox" disabled={readOnly} checked={step.is_enabled} onChange={(event) => onChange({ ...step, is_enabled: event.target.checked })} />Enabled</label>
      </div>
      <StepForm step={step} columns={columns} onChange={readOnly ? () => undefined : onChange} />
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

function StepForm({ step, columns, onChange }: { step: TransformationStep; columns: string[]; onChange: (step: TransformationStep) => void }) {
  const params = step.parameters;
  const setParams = (parameters: Record<string, unknown>) => onChange({ ...step, parameters });
  if (step.step_type === "select") {
    const selected = params.columns as string[] ?? [];
    return <div className="columnChips">{columns.map((column) => (
      <button className={selected.includes(column) ? "selectedChip" : ""} key={column} onClick={() => {
        const next = selected.includes(column) ? selected.filter((item) => item !== column) : [...selected, column];
        setParams({ columns: next });
      }}>{column}</button>
    ))}</div>;
  }
  if (step.step_type === "rename") {
    const mappings = params.mappings as { source: string; target: string }[] ?? [];
    return <RuleTable columns={columns} rows={mappings} labels={["Source column", "New column name"]} onAdd={() => setParams({ mappings: [...mappings, { source: "", target: "" }] })} onChange={(rows) => setParams({ mappings: rows })} />;
  }
  if (step.step_type === "cast") {
    const casts = params.casts as { column: string; type: string }[] ?? [];
    return <div className="ruleStack">{casts.map((item, idx) => (
      <div className="ruleRow" key={idx}>
        <ColumnSelect value={item.column} columns={columns} onChange={(value) => setParams({ casts: updateArray(casts, idx, { ...item, column: value }) })} />
        <select value={item.type} onChange={(event) => setParams({ casts: updateArray(casts, idx, { ...item, type: event.target.value }) })}>
          {DATA_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <button className="ghost small" onClick={() => setParams({ casts: casts.filter((_, itemIndex) => itemIndex !== idx) })}>Delete</button>
      </div>
    ))}<button className="ghost small" onClick={() => setParams({ casts: [...casts, { column: "", type: "string" }] })}>Add cast</button></div>;
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

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function Editor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="editor">{label}<textarea value={value} onChange={(event) => onChange(event.target.value)} /></label>;
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
              <button className="primary" onClick={onCreate}>
                {isEditing ? "Update" : "Create"} {selected.type === "source" ? "datasource" : "destination"}
              </button>
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
          <GeneratedConfigForm connector={selected} value={configValue} onChange={onConfigChange} />
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
            {!readOnly && <button className="ghost small" onClick={() => onEdit(resource)}>Edit</button>}
            {!readOnly && <button className="ghost small" onClick={() => onDelete(resource.id)}>Delete</button>}
          </div>
        ))}
      </div>
    </section>
  );
}

function GeneratedConfigForm({
  connector,
  value,
  onChange
}: {
  connector: Connector;
  value: string;
  onChange: (value: string) => void;
}) {
  const config = safeParseObject(value);
  const required = new Set(connector.config_schema.required ?? []);
  const entries = Object.entries(connector.config_schema.properties ?? {});

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
  { type: "cast", label: "Change Data Type", description: "Convert string, integer, float, date, datetime" },
  { type: "fillna", label: "Fill Null Values", description: "Fixed values, empty string, zero, forward/back fill" },
  { type: "derive", label: "Add Derived Column", description: "Create column with controlled formula builder" },
  { type: "filter", label: "Filter Rows", description: "Build AND/OR conditions visually" },
  { type: "deduplicate", label: "Remove Duplicates", description: "Drop duplicate rows by subset" },
  { type: "sort", label: "Sort Rows", description: "Order output rows" }
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
    cast: { casts: [] },
    fillna: { fills: [] },
    derive: { output_column: "", output_type: "float", left: { kind: "column", value: "" }, operator: "+", right: { kind: "constant", value: "" } },
    filter: { joiner: "and", conditions: [] },
    deduplicate: { columns: [], keep: "first" },
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

function transformationPayload(draft: { name: string; description: string; source_id: string; destination_id: string; steps: TransformationStep[] }) {
  return {
    name: draft.name,
    description: draft.description,
    source_id: draft.source_id ? Number(draft.source_id) : null,
    destination_id: draft.destination_id ? Number(draft.destination_id) : null,
    steps: draft.steps
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

function stableJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(flattenKeys(value)).sort());
}

function resourceSignature(config: Record<string, unknown>): string {
  return ["host", "database", "schema", "table", "query", "remote_path", "format"]
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

function updateArray<T>(rows: T[], index: number, value: T) {
  return rows.map((row, rowIndex) => rowIndex === index ? value : row);
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

function sampleConfig(connector: Connector) {
  const properties = connector.config_schema.properties;
  if (!properties || typeof properties !== "object") return "{}";
  const sample: Record<string, unknown> = {};
  Object.entries(properties).forEach(([key, schema]) => {
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
      remote_path: "/data/file.csv",
      operation: key.includes("destination") ? "write" : "read",
      format: "csv"
    }, null, 2);
  }
  return JSON.stringify({
    host: "",
    port: 5432,
    database: "",
    schema: "public",
    table: "customers",
    username: "",
    password: ""
  }, null, 2);
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
  if (key.includes("path")) return "/path/to/file.csv";
  return humanize(key);
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
