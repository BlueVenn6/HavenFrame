export type ScreenKey =
  | "projects"
  | "floorplan"
  | "singleRoom"
  | "multiRoom"
  | "spaceRender"
  | "customTasks"
  | "prompts"
  | "models"
  | "archive";

export type WorkflowKey = "floorplan" | "singleRoom" | "multiRoom" | "spaceRender" | "customTasks";

export interface Project {
  id: number;
  name: string;
  client_name?: string;
  style_tags?: string;
  room_types?: string;
  budget_min?: number;
  budget_max?: number;
  description?: string;
  status: string;
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
  created_at: string;
  updated_at: string;
}

export interface ProviderConfig {
  id: number;
  provider_name: string;
  provider_id?: string;
  provider_label?: string;
  provider_type: string;
  routing_mode: "direct_api" | "relay_base_url";
  compatibility_mode?: string;
  base_url?: string | null;
  api_key_name?: string | null;
  has_api_key?: boolean;
  model_name: string;
  model_id?: string | null;
  model_label?: string | null;
  display_name?: string | null;
  capability?: string | null;
  capabilities_json?: string[];
  default_endpoint_path?: string | null;
  is_enabled: boolean;
  priority: number;
  hidden?: boolean;
  deprecated?: boolean;
  last_test_status?: string | null;
  last_latency_ms?: number | null;
  last_error_summary?: string | null;
  extra_config_json?: Record<string, unknown>;
}

export interface MobileModelRouteDraft {
  provider_id: "openai" | "google_gemini" | "zhipu_glm" | "zai_glm";
  model_name: string;
  display_name: string;
  routing_mode: "direct_api" | "relay_base_url";
  compatibility_mode: "native" | "openai_compatible" | "gemini_compatible";
  capability?: "image" | "vision";
  base_url?: string;
  api_key?: string;
  api_key_name?: string;
  priority?: number;
}

export interface ModelConnectivityResult {
  ok: boolean;
  provider_id: string;
  model_id: string;
  display_name?: string;
  capability?: string | null;
  routing_mode: "direct_api" | "relay_base_url";
  compatibility_mode?: string | null;
  base_url_used?: string | null;
  endpoint_used?: string | null;
  status_code?: number | null;
  latency_ms?: number | null;
  error_type?: string | null;
  error?: string | null;
  release_status?: string | null;
  live_tested?: boolean;
}

export interface ModulePreference {
  id: number;
  module_name: string;
  priority_order_json: string[];
  default_provider_config_id?: number | null;
  fallback_enabled: boolean;
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
  is_team_visible?: boolean;
  version: number;
}

export interface CustomTaskTemplateDraft {
  name?: string;
  description?: string;
  defaultProvider?: string;
  defaultModel?: string;
  moduleChain?: string[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  exportRules?: Record<string, unknown>;
}

export interface ReviewSnapshot {
  project_id: number;
  assets?: AssetRecord[];
  board_documents?: BoardDocument[];
  extracted_items?: ExtractedItem[];
  versions: Array<{ id: number; version_name: string; description?: string; created_at: string }>;
  exports: Array<{ id: number; project_id: number; task_id?: number; type: string; file_name: string; file_path: string; content_path?: string; created_at: string }>;
  replay_entries: Array<{
    task_id: number;
    module: string;
    task_type: string;
    provider: string;
    model_name: string;
    status: string;
    prompt: string;
    params: Record<string, unknown>;
    created_at: string;
  }>;
  summary: {
    asset_count: number;
    task_count: number;
    export_count: number;
    version_count: number;
    board_document_count?: number;
    extracted_item_count?: number;
    latest_provider?: string;
  };
}

export interface BoardDocument {
  id: number;
  project_id?: number;
  task_id?: number;
  board_type: string;
  title: string;
  layout_json?: Record<string, unknown>;
  data_json?: Record<string, unknown>;
  preview_asset_id?: number | null;
}

export interface ExtractedItem {
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
  selection_state?: "keep" | "remove" | "replace" | "undecided";
  selection_updated_at?: string;
  review_schema_version?: number;
  procurement_status?: "pending" | "purchased";
  quantity?: number;
  purchase_method?: string;
  purchase_url?: string;
  notes?: string;
}

export interface ExtractionResponse {
  task: TaskRecord;
  items: ExtractedItem[];
  endpoint_used?: string;
  model_id?: string;
}

export interface PickedImage {
  uri: string;
  fileName: string;
  mimeType: string;
}

export interface WorkflowDefinition {
  key: WorkflowKey;
  screen: ScreenKey;
  title: string;
  titleEn: string;
  shortTitle: string;
  shortTitleEn: string;
  uploadTitle: string;
  uploadTitleEn: string;
  assetType: string;
  source: string;
  module: string;
  taskType: string;
  capability: string;
  defaultPrompt: string;
  defaultPromptEn: string;
  defaultStyle: string;
  requiresMultiple?: boolean;
}
