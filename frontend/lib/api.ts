export type JobStatus =
  | "queued"
  | "running"
  | "awaiting_concept_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

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

export type JobPayload = {
  job_id: string;
  user_id?: string;
  status: JobStatus;
  prompt: string;
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
  fast_reference_images?: boolean;
  /** Server job metadata update time (ISO8601); used when merging polls after regenerate. */
  updated_at?: string | null;
  /** Last Meshy export formats from confirm or regenerate-3d. */
  meshy_target_formats?: string[] | null;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
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
  const response = await fetch(`${API_URL}/generate`, {
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
  const response = await fetch(`${API_URL}/generate`, {
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
  const response = await fetch(`${API_URL}/jobs/${jobId}`, {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Could not fetch job ${jobId}`);
  }
  return response.json();
}

export async function regenerateConceptArt(jobId: string): Promise<{ job_id: string; status: "queued" }> {
  const response = await fetch(`${API_URL}/jobs/${jobId}/regenerate-concept`, {
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
  const response = await fetch(`${API_URL}/jobs/${jobId}/regenerate-3d`, {
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

export async function confirmConcept(
  jobId: string,
  options?: { targetFormats?: string[] },
): Promise<{ job_id: string; status: "queued" }> {
  const target_formats = options?.targetFormats?.length
    ? options.targetFormats
    : ["glb"];
  const response = await fetch(`${API_URL}/jobs/${jobId}/confirm-concept`, {
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
  const response = await fetch(`${API_URL}/jobs/${jobId}/cancel`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Cancel failed (${response.status})`);
  }
  return response.json();
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
  const response = await fetch(`${API_URL}/composio/toolkits`, {
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
  const response = await fetch(`${API_URL}/composio/connect`, {
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
  const response = await fetch(`${API_URL}/composio/disconnect`, {
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
  const response = await fetch(`${API_URL}/composio/drive/browse`, {
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
  const response = await fetch(`${API_URL}/composio/fetch`, {
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
  const response = await fetch(`${API_URL}/assets/analyze`, {
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
  return `${API_URL}${path}`;
}
