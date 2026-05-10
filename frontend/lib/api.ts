export type JobStatus =
  | "queued"
  | "running"
  | "awaiting_image_generation_preview"
  | "awaiting_concept_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

export type ImageGenerationPreview = {
  image_model: string;
  three_quarter_mode: string;
  three_quarter_edit_model?: string;
  shared_context: string;
  front_prompt: string;
  three_quarter_prompt: string;
};

export type ProductSpec = {
  schema_version: "1.0";
  mode: "object";
  object_type: "tin" | "box" | "bottle" | "tray" | "spoon";
  requires_step: boolean;
  product_name: string;
  dimensions: {
    length_mm: number;
    width_mm: number;
    height_mm: number;
  };
  shape: {
    base: "rounded_rectangular_box" | "cylindrical_bottle" | "spoon";
    corner_radius_mm: number;
    lid_type: "hinged" | "lift_off";
  };
  materials: {
    body: string;
    lid: string;
    label: string;
  };
  colors: string[];
  features: string[];
  manufacturing: {
    wall_thickness_mm: number;
    lid_clearance_mm: number;
  };
  engraving?: {
    text: string;
    depth_mm: number;
    font_size_mm: number;
    location: "handle_top_center";
  } | null;
  brand: {
    company?: string | null;
    brand_keywords: string[];
    tone?: string | null;
  };
  concept: {
    idea_summary?: string | null;
    stakeholder_pitch?: string | null;
    constraints: string[];
  };
  domain_kit:
    | "cpg_packaging"
    | "food_beverage"
    | "retail_display"
    | "subscription_unboxing"
    | "consumer_electronics"
    | "medical_device"
    | "wellness_personal_care"
    | "industrial_tooling"
    | "home_appliance"
    | "automotive_accessory";
  components: Array<
    | {
        type: "nameplate";
        text?: string | null;
        thickness_mm: number;
        font_size_mm: number;
        location: "lid_top" | "front_face";
      }
    | {
        type: "wrap_label";
        height_mm: number;
        thickness_mm: number;
        location: "body_sides" | "bottle_body";
      }
    | {
        type: "window_cutout";
        size_x_mm: number;
        size_y_mm: number;
        corner_radius_mm: number;
        location: "lid_top" | "front_face";
      }
    | {
        type: "insert_tray";
        thickness_mm: number;
        clearance_mm: number;
        compartments: number;
      }
    | {
        type: "hanger_hole";
        width_mm: number;
        height_mm: number;
        corner_radius_mm: number;
        location: "front_face";
      }
    | {
        type: "hole_pattern";
        diameter_mm: number;
        rows: number;
        cols: number;
        spacing_mm: number;
        location: "front_face";
      }
    | {
        type: "tamper_band";
        height_mm: number;
        thickness_mm: number;
        location: "bottle_neck";
      }
    | {
        type: "button_boss";
        diameter_mm: number;
        height_mm: number;
        count: number;
        spacing_mm: number;
        location: "front_face";
      }
    | {
        type: "screen_window";
        size_x_mm: number;
        size_y_mm: number;
        corner_radius_mm: number;
        bezel_mm: number;
        location: "front_face";
      }
    | {
        type: "carry_handle";
        width_mm: number;
        depth_mm: number;
        thickness_mm: number;
        location: "top";
      }
  >;
  render: {
    camera_preset: "isometric" | "front";
    background: "studio_light" | "white";
  };
  warnings: string[];
};

export type ConceptStyleRow = {
  index: number;
  front: string;
  three_quarter?: string;
};

export type ResearchBriefField =
  | "brand_snapshot"
  | "visual_packaging_cues"
  | "category_competitive_notes"
  | "financial_snapshot"
  | "corporate_strategy";

export type ResearchBrief = Partial<Record<ResearchBriefField, string>>;

/** Cached result from POST /jobs/{id}/manufacturing-brief; shape is LLM-defined with these common fields. */
export type ManufacturingPlan = {
  /** physical_product | virtual_service | hybrid — drives UI labels for the same JSON shape. */
  plan_focus?: "physical_product" | "virtual_service" | "hybrid";
  headline?: string;
  process_summary?: string;
  recommended_processes?: Array<{
    name?: string;
    rationale?: string;
    typical_lead_time_weeks?: string;
  }>;
  bill_of_materials?: Array<{
    component?: string;
    function?: string;
    material_or_process?: string;
    sourcing_notes?: string;
  }>;
  cost_snapshot?: {
    tooling_usd_band?: string;
    unit_cost_usd_band?: string;
    moq_comment?: string;
    disclaimer?: string;
  };
  risks?: string[];
  supplier_playbook?: Array<{
    venue?: string;
    geography?: string;
    how_to_reach?: string;
    checklist?: string;
  }>;
  visual_cues?: string[];
  stub?: boolean;
  stub_reason?: string;
  stub_detail?: string;
  company_context_used?: boolean;
};

/**
 * Client-side hint for empty-state copy; kept aligned with backend
 * `manufacturing_brief._stub_plan_focus_from_prompt` (conservative, explicit software signals).
 */
export function inferPlanFocusFromPrompt(prompt: string): "physical_product" | "virtual_service" | "hybrid" {
  const p = prompt.toLowerCase();
  const strongDigitalPhrases = [
    "saas",
    "software as a service",
    "software-only",
    "software only",
    "b2b software",
    "web application",
    "web app",
    "webapp",
    "mobile application",
    "mobile app",
    "iphone app",
    "android app",
    "ios app",
    "desktop application",
    "desktop app",
    "progressive web app",
  ] as const;
  const strongDigital =
    strongDigitalPhrases.some((s) => p.includes(s)) || /\bsoftware\b/.test(p);
  const physical = [
    "packaging",
    "bottle",
    " tin",
    "tin ",
    " jar",
    "box ",
    "carton",
    "clamshell",
    "device",
    "hardware",
    "tool",
    "furniture",
    "wearable",
    "printed",
    "manufactur",
    "factory",
    "mold",
    "injection",
    "mesh",
    "glb",
    "stl",
    "prototype",
    "sku",
    "cpg",
  ].some((w) => p.includes(w));
  if (strongDigital && physical) return "hybrid";
  if (strongDigital) return "virtual_service";
  return "physical_product";
}

export type JobPayload = {
  job_id: string;
  user_id?: string;
  status: JobStatus;
  prompt: string;
  company?: string | null;
  documents?: string[];
  spec?: ProductSpec;
  files: {
    step?: string;
    stl?: string;
    glb?: string;
    preview?: string;
    spec?: string;
    meshy_stl?: string;
    meshy_obj?: string;
    meshy_mtl?: string;
    meshy_fbx?: string;
    meshy_usdz?: string;
    meshy_3mf?: string;
  };
  error?: {
    code: "INVALID_SPEC" | "UNSUPPORTED_OBJECT_TYPE" | "GENERATION_FAILED" | "RENDER_FAILED";
    message: string;
  };
  warnings: string[];
  stage_durations_ms: Record<string, number>;
  cancel_requested?: boolean;
  queue?: Record<string, string | null>;
  generation_phase?: string | null;
  concept_references?: Record<string, string> | null;
  concept_styles?: ConceptStyleRow[] | null;
  selected_concept_style_index?: number;
  concept_generation_style_index?: number | null;
  fast_reference_images?: boolean;
  /** Server job metadata update time (ISO8601); used when merging polls after regenerate. */
  updated_at?: string | null;
  /** Last Meshy export formats from confirm or regenerate-3d. */
  meshy_target_formats?: string[] | null;
  research_digest?: string | null;
  research_sources?: Array<{ title: string; url: string; snippet?: string }>;
  research_brief?: ResearchBrief | null;
  research_warnings?: string[];
  /** Populated when brand research used Backboard (optional observability). */
  backboard_thread_id?: string | null;
  backboard_assistant_id?: string | null;
  image_generation_preview?: ImageGenerationPreview | null;
  manufacturing_plan?: ManufacturingPlan | null;
};

/** Empty string would make fetch hit the Next origin (`/jobs/...`) and break API calls. Trailing slashes are stripped so paths join as `/jobs/...`. */
const API_URL_ROOT = (
  (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").trim() || "http://localhost:8000"
).replace(/\/+$/, "");
const API_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;
const USER_ID = process.env.NEXT_PUBLIC_USER_ID;

const FETCH_TIMEOUT_MS = 180_000;

/** Avoid hung UI when the API never responds (wrong host, VPN, stalled worker). */
function fetchTimeoutSignal(): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(FETCH_TIMEOUT_MS);
  }
  return undefined;
}

function authHeaders(): HeadersInit {
  const headers: Record<string, string> = {};
  if (API_TOKEN) headers["x-api-token"] = API_TOKEN;
  if (USER_ID) headers["x-user-id"] = USER_ID;
  return headers;
}

export async function generate(
  prompt: string,
  options?: { fastReferenceImages?: boolean },
): Promise<{ job_id: string; status: "queued" }> {
  const response = await fetch(`${API_URL_ROOT}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      prompt,
      fast_reference_images: Boolean(options?.fastReferenceImages),
    }),
  });
  if (!response.ok) {
    throw new Error(`Generate request failed (${response.status})`);
  }
  return response.json();
}

export async function generateEnterprise(args: {
  prompt: string;
  company?: string;
  documents?: string[];
  fastReferenceImages?: boolean;
}): Promise<{ job_id: string; status: "queued" }> {
  const response = await fetch(`${API_URL_ROOT}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal: fetchTimeoutSignal(),
    body: JSON.stringify({
      prompt: args.prompt,
      company: args.company,
      documents: args.documents ?? [],
      fast_reference_images: Boolean(args.fastReferenceImages),
    }),
  });
  if (!response.ok) {
    throw new Error(`Generate request failed (${response.status})`);
  }
  return response.json();
}

export async function getJob(jobId: string): Promise<JobPayload> {
  const response = await fetch(`${API_URL_ROOT}/jobs/${jobId}`, {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Could not fetch job ${jobId}`);
  }
  return response.json();
}

/** Build or return cached manufacturing / BOM / cost overview (completed jobs only). */
export async function requestManufacturingBrief(
  jobId: string,
  options?: { companyContext?: string; refresh?: boolean },
): Promise<JobPayload> {
  const response = await fetch(`${API_URL_ROOT}/jobs/${jobId}/manufacturing-brief`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal: fetchTimeoutSignal(),
    body: JSON.stringify({
      company_context: options?.companyContext?.trim() || undefined,
      refresh: Boolean(options?.refresh),
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Manufacturing brief failed (${response.status}): ${detail}`);
  }
  return response.json() as Promise<JobPayload>;
}

export type SupplierContactPayload = {
  toEmail: string;
  subject: string;
  message: string;
};

export type SupplierContactResult = {
  ok: boolean;
  tracking_id?: string | null;
  detail?: string;
};

/** Send supplier outreach email via Pingram (server-side API key; completed jobs only). */
export async function sendSupplierContact(
  jobId: string,
  payload: SupplierContactPayload,
): Promise<SupplierContactResult> {
  const SEND_TIMEOUT_MS = 60_000;
  const signal =
    typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(SEND_TIMEOUT_MS)
      : fetchTimeoutSignal();
  const response = await fetch(`${API_URL_ROOT}/jobs/${jobId}/supplier-contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
    body: JSON.stringify({
      to_email: payload.toEmail.trim(),
      subject: payload.subject.trim(),
      message: payload.message.trim(),
    }),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    parsed = {};
  }
  if (!response.ok) {
    const detail = typeof parsed.detail === "string" ? parsed.detail : text || response.statusText;
    throw new Error(`Supplier email failed (${response.status}): ${detail}`);
  }
  return {
    ok: Boolean(parsed.ok),
    tracking_id: typeof parsed.tracking_id === "string" ? parsed.tracking_id : null,
    detail: typeof parsed.detail === "string" ? parsed.detail : undefined,
  };
}

/** Recent jobs from the server (newest first). Used to repopulate the gallery when localStorage is empty. */
export async function listJobs(options?: { limit?: number }): Promise<JobPayload[]> {
  const url = new URL(`${API_URL_ROOT}/jobs`);
  if (options?.limit !== undefined) {
    url.searchParams.set("limit", String(options.limit));
  }
  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Could not fetch jobs (${response.status})`);
  }
  const body = (await response.json()) as { items?: JobPayload[] };
  return Array.isArray(body.items) ? body.items : [];
}

export async function deleteJob(jobId: string): Promise<{ job_id: string; deleted: boolean }> {
  const response = await fetch(`${API_URL_ROOT}/jobs/${jobId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!response.ok) {
    const raw = await response.text();
    let msg = raw || `Delete failed (${response.status})`;
    try {
      const parsed = JSON.parse(raw) as { detail?: string };
      if (typeof parsed.detail === "string" && parsed.detail.trim()) {
        msg = parsed.detail.trim();
      }
    } catch {
      /* use msg */
    }
    throw new Error(msg);
  }
  return response.json();
}

export async function addConceptStyle(
  jobId: string,
  options?: { detailPrompt?: string | null },
): Promise<{ job_id: string; status: "queued" }> {
  const detail = options?.detailPrompt?.trim();
  const body = JSON.stringify(detail ? { detail_prompt: detail } : {});
  const response = await fetch(`${API_URL_ROOT}/jobs/${jobId}/add-concept-style`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Add concept style failed (${response.status}): ${detail}`);
  }
  return response.json();
}

export async function selectConceptStyle(jobId: string, styleIndex: number): Promise<JobPayload> {
  const response = await fetch(`${API_URL_ROOT}/jobs/${jobId}/select-concept-style`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ style_index: styleIndex }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Select concept style failed (${response.status}): ${detail}`);
  }
  return response.json();
}

export async function regenerateConceptArt(jobId: string): Promise<{ job_id: string; status: "queued" }> {
  const response = await fetch(`${API_URL_ROOT}/jobs/${jobId}/regenerate-concept`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: "{}",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Regenerate concept art failed (${response.status}): ${detail}`);
  }
  return response.json();
}

export async function regenerate3dBuild(
  jobId: string,
  options?: { targetFormats?: string[] },
): Promise<{ job_id: string; status: "queued" }> {
  const target_formats = options?.targetFormats?.length
    ? options.targetFormats
    : ["glb"];
  const response = await fetch(`${API_URL_ROOT}/jobs/${jobId}/regenerate-3d`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ target_formats }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Regenerate 3D failed (${response.status}): ${detail}`);
  }
  return response.json();
}

export async function confirmImageGeneration(
  jobId: string,
  options?: { researchDigest?: string; researchBrief?: ResearchBrief },
): Promise<{ job_id: string; status: "queued" }> {
  const body: { research_digest?: string; research_brief?: ResearchBrief } = {};
  if (options?.researchDigest !== undefined) {
    body.research_digest = options.researchDigest;
  }
  if (options?.researchBrief !== undefined) {
    body.research_brief = options.researchBrief;
  }
  const response = await fetch(`${API_URL_ROOT}/jobs/${jobId}/confirm-image-generation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
    signal: fetchTimeoutSignal(),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Confirm image generation failed (${response.status}): ${detail}`);
  }
  return response.json();
}

/** Persist edited research text and rebuild full image prompts without starting reference generation. */
export async function saveImageGenerationPreview(
  jobId: string,
  options: { researchDigest?: string; researchBrief?: ResearchBrief },
): Promise<JobPayload> {
  const body: Record<string, unknown> = {};
  if (options.researchDigest !== undefined) {
    body.research_digest = options.researchDigest;
  }
  if (options.researchBrief !== undefined) {
    body.research_brief = options.researchBrief;
  }
  const response = await fetch(`${API_URL_ROOT}/jobs/${jobId}/save-image-generation-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
    signal: fetchTimeoutSignal(),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Save research preview failed (${response.status}): ${detail}`);
  }
  return response.json() as Promise<JobPayload>;
}

export async function confirmConcept(
  jobId: string,
  options?: { targetFormats?: string[] },
): Promise<{ job_id: string; status: "queued" }> {
  const target_formats = options?.targetFormats?.length
    ? options.targetFormats
    : ["glb"];
  const response = await fetch(`${API_URL_ROOT}/jobs/${jobId}/confirm-concept`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ target_formats }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Confirm concept failed (${response.status}): ${detail}`);
  }
  return response.json();
}

export async function cancelJob(jobId: string): Promise<{ job_id: string; status: JobStatus; cancel_requested: boolean }> {
  const response = await fetch(`${API_URL_ROOT}/jobs/${jobId}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: "{}",
    signal: fetchTimeoutSignal(),
  });
  const raw = await response.text();
  if (!response.ok) {
    let msg = raw || `Cancel failed (${response.status})`;
    try {
      const parsed = JSON.parse(raw) as { detail?: string };
      if (typeof parsed.detail === "string" && parsed.detail.trim()) {
        msg = parsed.detail.trim();
      }
    } catch {
      /* use msg */
    }
    throw new Error(msg);
  }
  try {
    return JSON.parse(raw) as { job_id: string; status: JobStatus; cancel_requested: boolean };
  } catch {
    throw new Error(`Cancel failed: invalid response from server`);
  }
}

export type ComposioFetchFields = { required: string[]; optional: string[] };

export type ComposioToolkitInfo = {
  slug: string;
  name: string;
  connected: boolean;
  fetch_fields: ComposioFetchFields;
  /** Present when Composio metadata or connection listing failed for this toolkit. */
  warning?: string;
};

export async function getComposioToolkits(): Promise<{ enabled: boolean; toolkits: ComposioToolkitInfo[] }> {
  const response = await fetch(`${API_URL_ROOT}/composio/toolkits`, {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Composio toolkits failed (${response.status})`);
  }
  return response.json();
}

export async function postComposioConnect(args: {
  toolkit: string;
  callback_url?: string;
}): Promise<{ redirect_url: string | null; connection_request_id: string | null; status?: string | null }> {
  const response = await fetch(`${API_URL_ROOT}/composio/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      toolkit: args.toolkit,
      callback_url: args.callback_url,
    }),
  });
  if (!response.ok) {
    const raw = await response.text();
    let msg = raw || `Composio connect failed (${response.status})`;
    try {
      const parsed = JSON.parse(raw) as { detail?: string };
      if (typeof parsed.detail === "string" && parsed.detail.trim()) {
        msg = parsed.detail.trim();
      }
    } catch {
      /* use msg as-is */
    }
    throw new Error(msg);
  }
  return response.json();
}

export async function postComposioDisconnect(body: {
  toolkit: string;
}): Promise<{ removed: number; connected_account_ids: string[] }> {
  const response = await fetch(`${API_URL_ROOT}/composio/disconnect`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const raw = await response.text();
    let msg = raw || `Composio disconnect failed (${response.status})`;
    try {
      const parsed = JSON.parse(raw) as { detail?: unknown };
      if (Array.isArray(parsed.detail)) {
        msg = JSON.stringify(parsed.detail);
      } else if (typeof parsed.detail === "string" && parsed.detail.trim()) {
        msg = parsed.detail.trim();
      }
    } catch {
      /* use msg */
    }
    throw new Error(msg);
  }
  return response.json();
}

export type ComposioDriveBrowseItem = {
  id: string;
  name: string;
  mime_type: string;
  is_folder: boolean;
};

export async function postComposioDriveBrowse(body: {
  folder_id?: string | null;
  query?: string | null;
  page_token?: string | null;
  page_size?: number;
}): Promise<{ items: ComposioDriveBrowseItem[]; next_page_token: string | null }> {
  const response = await fetch(`${API_URL_ROOT}/composio/drive/browse`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const raw = await response.text();
    let msg = raw || `Drive browse failed (${response.status})`;
    try {
      const parsed = JSON.parse(raw) as { detail?: unknown };
      if (Array.isArray(parsed.detail)) {
        msg = JSON.stringify(parsed.detail);
      } else if (typeof parsed.detail === "string" && parsed.detail.trim()) {
        msg = parsed.detail.trim();
      }
    } catch {
      /* use msg */
    }
    throw new Error(msg);
  }
  return response.json();
}

export async function postComposioFetch(body: {
  toolkit: string;
  file_id?: string;
  mime_type?: string;
  page_id?: string;
  include_transcript?: boolean;
}): Promise<{ sections: string[] }> {
  const response = await fetch(`${API_URL_ROOT}/composio/fetch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const raw = await response.text();
    let msg = raw || `Composio fetch failed (${response.status})`;
    try {
      const parsed = JSON.parse(raw) as { detail?: unknown };
      if (Array.isArray(parsed.detail)) {
        msg = JSON.stringify(parsed.detail);
      } else if (typeof parsed.detail === "string" && parsed.detail.trim()) {
        msg = parsed.detail.trim();
      }
    } catch {
      /* use msg */
    }
    throw new Error(msg);
  }
  return response.json();
}

export type AnalyzeAssetRole = "reference" | "sketch";

export async function postAnalyzeAssets(
  files: File[],
  options?: { roles?: AnalyzeAssetRole[]; signal?: AbortSignal },
): Promise<{ sections: string[]; warnings: string[] }> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file, file.name);
  }
  if (options?.roles && options.roles.length === files.length) {
    formData.append("roles_json", JSON.stringify(options.roles));
  }
  const headers: Record<string, string> = { ...authHeaders() } as Record<string, string>;
  // Don't set Content-Type; the browser sets the correct multipart boundary.
  /** Caller-supplied signal (e.g. user cancel) takes precedence so abort is not masked by timeout. */
  const signal = options?.signal ?? fetchTimeoutSignal();
  const response = await fetch(`${API_URL_ROOT}/assets/analyze`, {
    method: "POST",
    headers,
    signal,
    body: formData,
  });
  if (!response.ok) {
    const raw = await response.text();
    let msg = raw || `Asset analysis failed (${response.status})`;
    try {
      const parsed = JSON.parse(raw) as { detail?: unknown };
      if (Array.isArray(parsed.detail)) {
        msg = JSON.stringify(parsed.detail);
      } else if (typeof parsed.detail === "string" && parsed.detail.trim()) {
        msg = parsed.detail.trim();
      }
    } catch {
      /* use msg as-is */
    }
    throw new Error(msg);
  }
  return response.json();
}

export function outputUrl(path?: string): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${API_URL_ROOT}${path}`;
}
