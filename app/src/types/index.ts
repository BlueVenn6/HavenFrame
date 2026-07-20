export type RoutingMode = "direct_api" | "relay_base_url";
export type CompatibilityMode = "native" | "openai_compatible" | "gemini_compatible" | "custom_rest";
export type ConnectivityStatus = "not_tested" | "testing" | "connected" | "failed" | "requires_base_url" | "requires_api_key";

export type Capability =
  | "text"
  | "vision"
  | "reasoning"
  | "image"
  | "text_to_image"
  | "image_to_image"
  | "image_generation"
  | "image_edit"
  | "custom_rest"
  | "inpaint"
  | "style_transfer"
  | "upscale"
  | "segmentation"
  | "multi_image_composition";

export type ModuleName =
  | "dashboard"
  | "projects"
  | "floorplan"
  | "boards"
  | "room_board_extraction"
  | "multi_room_board_extraction"
  | "space_render"
  | "image_editing"
  | "fast_draft";

export interface Project {
  id: number;
  name: string;
  client_name?: string;
  style_tags?: string;
  room_types?: string;
  budget_min?: number;
  budget_max?: number;
  description?: string;
  cover_asset_id?: number | null;
  status: string;
  archive_root_path?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetRecord {
  id: number;
  project_id?: number;
  type: string;
  file_name: string;
  file_path: string;
  content_path?: string;
  room_type?: string;
  source?: string;
  mime_type?: string;
  width?: number | null;
  height?: number | null;
  metadata_json?: Record<string, unknown>;
  created_at: string;
}

export interface TaskRecord {
  id: number;
  project_id?: number;
  template_id?: number | null;
  module: string;
  task_type: string;
  provider: string;
  model_name: string;
  provider_config_id?: number | null;
  status: "queued" | "running" | "success" | "failed" | "cancelled";
  progress: number;
  input_payload_json?: Record<string, unknown>;
  output_payload_json?: Record<string, unknown>;
  prompt_snapshot_json?: {
    resolved_prompt?: string;
    negative_prompt?: string;
  };
  params_snapshot_json?: Record<string, unknown>;
  error_message?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromptTemplate {
  id: number;
  name: string;
  module: string;
  scope: string;
  system_prompt?: string;
  user_prompt: string;
  negative_prompt?: string;
  variables_json?: string[];
  is_builtin: boolean;
  is_favorite: boolean;
  version: number;
  updated_at?: string;
  version_history?: PromptVersionEntry[];
}

export interface PromptVersionEntry {
  version: number;
  label: string;
  updated_at: string;
  summary: string;
}

export interface ModelConfig {
  id: number;
  provider_type: string;
  provider_name: string;
  provider_id?: string;
  provider_label?: string;
  routing_mode: RoutingMode;
  compatibility_mode?: CompatibilityMode;
  endpoint?: string;
  base_url?: string;
  api_key?: string;
  api_key_encrypted?: string;
  api_key_name?: string;
  has_api_key?: boolean;
  model_name: string;
  model_id?: string;
  model_label?: string;
  display_name?: string;
  short_name?: string;
  capability?: string;
  registry_capabilities?: string[];
  modality?: string[];
  api_surface?: string;
  recommended?: boolean;
  deprecated?: boolean;
  preview?: boolean;
  costly?: boolean;
  direct_api_supported?: boolean;
  relay_supported?: boolean;
  needs_official_id_verification?: boolean;
  status_reason?: string;
  hidden?: boolean;
  capabilities_json: Capability[];
  timeout_sec: number;
  max_concurrency: number;
  headers_json?: string | Record<string, unknown>;
  query_params_json?: string | Record<string, unknown>;
  payload_template_json?: string | Record<string, unknown>;
  response_mapping_json?: string | Record<string, unknown>;
  is_default: boolean;
  is_enabled: boolean;
  priority: number;
  tags_json?: string[];
  required_auth_fields?: string[];
  default_endpoint_path?: string;
  request_schema_type?: string;
  response_schema_type?: string;
  last_test_status?: ConnectivityStatus | string;
  last_test_at?: string | null;
  last_latency_ms?: number | null;
  last_error_summary?: string | null;
  extra_config_json?: {
    label?: string;
    model_id?: string;
    model_label?: string;
    provider_id?: string;
    provider_label?: string;
    provider_family?: string;
    compatibility_mode?: CompatibilityMode;
    capability?: string;
    api_key_name?: string;
    vision_model_id?: string;
    default_endpoint_path?: string;
    workflow_preset_path?: string;
    workflow_json_path?: string;
    node_mapping_config?: Record<string, string>;
    display_name?: string;
    short_name?: string;
    recommended?: boolean;
    deprecated?: boolean;
    preview?: boolean;
    costly?: boolean;
    direct_api_supported?: boolean;
    relay_supported?: boolean;
    needs_official_id_verification?: boolean;
    status_reason?: string;
    hidden?: boolean;
    last_test_status?: string;
    last_test_at?: string;
    last_latency_ms?: number;
    last_error_summary?: string;
    notes?: string;
  };
}

export interface ModelConnectivityTestRequest {
  provider_config_id?: number;
  provider_id: string;
  provider_label?: string;
  model_id: string;
  model_label?: string;
  display_name?: string;
  capability?: string;
  include_costly?: boolean;
  routing_mode: RoutingMode;
  compatibility_mode: CompatibilityMode;
  base_url?: string | null;
  endpoint_path?: string | null;
  api_key?: string;
  access_key?: string;
  secret_key?: string;
  region?: string;
  headers_json?: string | Record<string, unknown>;
  body_template_json?: string | Record<string, unknown>;
  test_prompt?: string;
  timeout_sec?: number;
}

export interface ModelConnectivityTestResult {
  ok: boolean;
  provider_id: string;
  model_id: string;
  model_id_used?: string;
  display_name?: string;
  capability?: string;
  routing_mode: RoutingMode;
  compatibility_mode?: CompatibilityMode;
  base_url_used?: string | null;
  endpoint_used?: string | null;
  timeout_sec?: number | null;
  status_code?: number | null;
  latency_ms?: number | null;
  response_preview?: string | null;
  normalized_output?: string | null;
  error_type?: string | null;
  error?: string | null;
  raw_error_preview?: string | null;
  cost_risk?: boolean;
  live_tested?: boolean;
  request_attempted?: boolean;
  response_received?: boolean;
  release_status?: string | null;
  fallback_used?: boolean;
  verification_source?: string | null;
  verified_task_id?: number | null;
}

export interface ModuleModelPreference {
  id: number;
  module_name: string;
  priority_order_json: string[];
  default_provider_config_id?: number | null;
  fallback_enabled: boolean;
}

export type WorkflowModelSlotKey =
  | "floorplan.image"
  | "space_render.image"
  | "space_render.extraction"
  | "room_board.image"
  | "room_board.extraction"
  | "multi_room_board.image"
  | "multi_room_board.extraction"
  | "custom_tasks.image";

export interface WorkflowModelOverride {
  provider: string;
  model: string;
  providerConfigId?: number | null;
  endpointPath?: string;
}

export interface CustomTaskTemplate {
  id: number;
  name: string;
  description?: string;
  module_chain_json: string[];
  input_schema_json: Record<string, unknown>;
  output_schema_json?: Record<string, unknown>;
  default_provider?: string;
  default_model?: string;
  export_rules_json?: Record<string, unknown>;
  is_team_visible: boolean;
  version: number;
}

export interface ExportRecord {
  id: number;
  project_id?: number | null;
  task_id?: number | null;
  type: string;
  file_name: string;
  file_path: string;
  content_path?: string;
  export_config_json?: Record<string, unknown>;
  created_at: string;
}

export interface ExtractedItemRecord {
  id: number;
  project_id?: number;
  asset_id?: number;
  room_type?: string;
  category?: string;
  name: string;
  material?: string;
  color?: string;
  color_hex?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  price_min?: number;
  price_max?: number;
  notes?: string;
  selection_state?: "keep" | "remove" | "replace" | "undecided";
  replacement_notes?: string;
  selection_updated_at?: string;
  selection_task_id?: number;
  selection_revision_no?: number;
  review_schema_version?: number;
  procurement_status?: "pending" | "purchased";
  quantity?: number;
  purchase_method?: string;
  purchase_url?: string;
  last_saved_at?: string;
  extraction_source?: string;
  extraction_signature?: string;
  inference_reason?: string;
}

export interface BoardDocumentRecord {
  id: number;
  project_id?: number;
  task_id?: number;
  board_type: string;
  title: string;
  layout_json?: Record<string, unknown>;
  data_json?: Record<string, unknown>;
  preview_asset_id?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface QuoteCard {
  board_document?: BoardDocumentRecord;
  items: ExtractedItemRecord[];
  total_min: number;
  total_max: number;
  currency: string;
}

export interface LocalUploadPlaceholder {
  name: string;
  size: number;
  type: string;
  placeholder_path: string;
}

export interface ReviewSnapshot {
  project_id: number;
  assets?: AssetRecord[];
  board_documents?: BoardDocumentRecord[];
  extracted_items?: ExtractedItemRecord[];
  versions: Array<{
    id: number;
    version_name: string;
    description?: string;
    created_at: string;
  }>;
  exports: ExportRecord[];
  replay_entries: ReviewReplayEntry[];
  summary: {
    asset_count: number;
    task_count: number;
    export_count: number;
    version_count: number;
    board_document_count?: number;
    extracted_item_count?: number;
    preview_asset_count?: number;
    latest_provider?: string;
  };
}

export interface ReviewReplayEntry {
  task_id: number;
  module: string;
  task_type: string;
  provider: string;
  model_name: string;
  status: string;
  prompt: string;
  params: Record<string, unknown>;
  created_at: string;
}

export type RendererEngineStatus =
  | "unknown"
  | "unconfigured"
  | "disabled"
  | "checking"
  | "ready"
  | "running"
  | "degraded"
  | "failed";

export type RendererEngineType = "internal" | "external_service" | "utility";

export type RendererCapability =
  | "txt2img"
  | "img2img"
  | "inpaint"
  | "controlnet"
  | "upscale"
  | "workflow"
  | "local_model"
  | "batch";

export interface RendererEngine {
  id: string;
  name: string;
  type: RendererEngineType;
  base_url?: string | null;
  enabled: boolean;
  status: RendererEngineStatus;
  last_checked_at?: string | null;
  capabilities: RendererCapability[];
  description: string;
  config: Record<string, unknown>;
  error_message?: string | null;
}

export interface LocalServiceStatus {
  id: string;
  name: string;
  status: string;
  address?: string | null;
  path?: string | null;
  log_path?: string | null;
  last_checked_at: string;
  detail: string;
  error_message?: string | null;
  actions: string[];
}

export interface LocalAssetPathStatus {
  id: string;
  name: string;
  path: string;
  status: string;
  last_checked_at: string;
  detail: string;
  error_message?: string | null;
}

export interface LocalDiagnosticItem {
  id: string;
  name: string;
  status: string;
  reason?: string | null;
  suggestion: string;
  command?: string | null;
}

export interface LocalRuntimeStatus {
  checked_at: string;
  mode: "desktop" | "dev" | "web";
  backend: LocalServiceStatus;
  frontend: LocalServiceStatus;
  workspace: LocalServiceStatus;
  archive: LocalServiceStatus;
  queue: LocalServiceStatus;
  services: LocalServiceStatus[];
  assets: LocalAssetPathStatus[];
  diagnostics: LocalDiagnosticItem[];
  default_engine_id?: string | null;
}

export interface FloorplanDraft {
  outputMode: "2d_color" | "3d_birdview";
  style: string;
  customStyle: string;
  aspectRatio: string;
  promptTemplateId: number;
  customPrompt: string;
  negativePrompt: string;
  scaleCalibration: string;
  detectRooms: boolean;
  extractLabels: boolean;
  detectOpenings: boolean;
  manualCorrectionMode: boolean;
  outputTypes: string[];
}

export interface ReferenceSlotDraft {
  id: string;
  label: string;
  status: "empty" | "attached" | "required" | "optional";
  required?: boolean;
  note?: string;
}

export interface SpaceRenderDraft {
  roomType: string;
  customRoomType: string;
  styles: string[];
  customStyle: string;
  styleStrength: number;
  styleDescription: string;
  realismLevel: number;
  lightingMode: string;
  structurePreservationStrength: number;
  referenceWeight: number;
  creativity: number;
  lightingIntensity: number;
  materialFidelity: number;
  materialKeywords: string[];
  colorPalette: string[];
  furnitureKeywords: string[];
  lightingKeywords: string[];
  mustKeep: string[];
  mustChange: string[];
  promptFragments: string[];
  designBrief: string;
  promptTemplateId: number;
  mainPrompt: string;
  customPrompt: string;
  negativePrompt: string;
  referenceSlots: ReferenceSlotDraft[];
  outputCount: number;
  aspectRatio: string;
  resolutionPreset: string;
  seed: string;
  safetyCostAcknowledged: boolean;
}

export interface ProviderImageTaskPayload {
  project_id?: number;
  module: string;
  task_type: string;
  capability: string;
  provider?: string;
  model_name?: string;
  provider_config_id?: number | null;
  payload_summary?: string;
  payload_json: Record<string, unknown>;
  prompt_snapshot?: {
    resolved_prompt?: string;
    negative_prompt?: string;
  };
  params_snapshot?: Record<string, unknown>;
  finalize_demo?: boolean;
  api_key?: string;
  base_url?: string;
  routing_mode?: RoutingMode;
  compatibility_mode?: CompatibilityMode;
  endpoint_path?: string;
  request_format?: string;
  image_transport?: string;
  data_flow_confirmed?: boolean;
  allow_provider_fallback?: boolean;
}

export interface CustomWorkflowDraft {
  taskName: string;
  taskType: string;
  customTaskType: string;
  capability: string;
  mainPrompt: string;
  designBrief: string;
  references: ReferenceSlotDraft[];
  styleKeywords: string[];
  materialKeywords: string[];
  colorPalette: string[];
  lightingKeywords: string[];
  mustKeep: string[];
  mustChange: string[];
  outputCount: number;
  aspectRatio: string;
  resolutionPreset: string;
  seed: string;
  priority: string;
  saveOutputsToProject: boolean;
  inputSchemaJson: string;
  promptTemplate: string;
  negativePrompt: string;
  headersJson: string;
  bodyTemplateJson: string;
  outputParserType: string;
}
