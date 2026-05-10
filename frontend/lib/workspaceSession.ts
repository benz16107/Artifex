/**
 * Persists the active generation job and draft form fields so a refresh can
 * reload the same prototype from the API (artifacts live under outputs/{job_id}).
 */

export const WORKSPACE_SESSION_KEY = "artifex.workspace.v1";

export type MainTabId = "home" | "company";

export type WorkspaceSessionV1 = {
  v: 1;
  activeJobId: string | null;
  /** In-flight runs kept in the background while another prototype is focused (parallel runs). */
  sidecarJobIds: string[];
  historyJobIds: string[];
  prompt: string;
  company: string;
  /** Project-wide context (branding, Composio pulls, analyzed brand files). */
  companyContextText: string;
  /** Per-model / per-run context and reference file excerpts. */
  documentsText: string;
  fastReferenceImages: boolean;
  meshyFormats: string[];
  mainTab: MainTabId;
  /** When true, Home shows the composer while the active job keeps running in the background. */
  pipelineMinimized: boolean;
};

const DEFAULT_SESSION: WorkspaceSessionV1 = {
  v: 1,
  activeJobId: null,
  sidecarJobIds: [],
  historyJobIds: [],
  prompt: "",
  company: "",
  companyContextText: "",
  documentsText: "",
  fastReferenceImages: false,
  meshyFormats: ["glb"],
  mainTab: "home",
  pipelineMinimized: false,
};

export function readWorkspaceSession(): WorkspaceSessionV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WORKSPACE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorkspaceSessionV1>;
    if (parsed?.v !== 1) return null;
    const mainTab: MainTabId =
      parsed.mainTab === "company" || parsed.mainTab === "home" ? parsed.mainTab : "home";
    const pipelineMinimized = parsed.pipelineMinimized === true;
    const sidecarJobIds = Array.isArray(parsed.sidecarJobIds)
      ? parsed.sidecarJobIds.filter((id): id is string => typeof id === "string")
      : [];
    return {
      ...DEFAULT_SESSION,
      ...parsed,
      companyContextText: typeof parsed.companyContextText === "string" ? parsed.companyContextText : "",
      sidecarJobIds,
      historyJobIds: Array.isArray(parsed.historyJobIds)
        ? parsed.historyJobIds.filter((id): id is string => typeof id === "string")
        : [],
      meshyFormats: Array.isArray(parsed.meshyFormats) && parsed.meshyFormats.length > 0
        ? parsed.meshyFormats.filter((x): x is string => typeof x === "string")
        : ["glb"],
      mainTab,
      pipelineMinimized,
    };
  } catch {
    return null;
  }
}

export function writeWorkspaceSession(patch: Partial<WorkspaceSessionV1>): void {
  if (typeof window === "undefined") return;
  try {
    const prev = readWorkspaceSession() ?? DEFAULT_SESSION;
    const next: WorkspaceSessionV1 = { ...prev, ...patch, v: 1 };
    window.localStorage.setItem(WORKSPACE_SESSION_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearActiveJobInSession(): void {
  writeWorkspaceSession({ activeJobId: null });
}
