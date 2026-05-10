import JSZip from "jszip";

/** model-viewer custom element (subset used for screenshots). */
export type ModelViewerCaptureElement = HTMLElement & {
  loaded?: boolean;
  cameraOrbit?: string;
  jumpCameraToGoal?: () => void;
  toDataURL?: (mimeType?: string, quality?: number) => string;
};

export type ModelViewShot = { file: string; orbit: string; label: string };

/** Orbits are model-viewer `camera-orbit` strings: `azimuth elevation radius`. */
export const MODEL_VIEW_SHOTS: ModelViewShot[] = [
  { file: "front", label: "Front", orbit: "0deg 75deg 102%" },
  { file: "right", label: "Right", orbit: "-90deg 75deg 102%" },
  { file: "left", label: "Left", orbit: "90deg 75deg 102%" },
  { file: "back", label: "Back", orbit: "180deg 75deg 102%" },
  { file: "top", label: "Top", orbit: "0deg 89deg 108%" },
  { file: "bottom", label: "Bottom", orbit: "0deg -89deg 108%" },
  { file: "quarter_front_right", label: "Quarter (front-right)", orbit: "-45deg 68deg 108%" },
  { file: "quarter_front_left", label: "Quarter (front-left)", orbit: "45deg 68deg 108%" },
  { file: "quarter_back_right", label: "Quarter (back-right)", orbit: "-135deg 68deg 108%" },
  { file: "quarter_back_left", label: "Quarter (back-left)", orbit: "135deg 68deg 108%" },
  { file: "angle_a", label: "Angle A", orbit: "38deg 58deg 118%" },
  { file: "angle_b", label: "Angle B", orbit: "-142deg 52deg 118%" },
];

export function modelViewerWhenLoaded(el: ModelViewerCaptureElement): Promise<void> {
  if (el.loaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    el.addEventListener("load", () => resolve(), { once: true });
    el.addEventListener("error", () => reject(new Error("Failed to load model for capture.")), { once: true });
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/** Wait until model-viewer has applied the latest camera + rendered a frame (avoids multi-second fixed sleeps). */
async function settleAfterCameraMove(el: ModelViewerCaptureElement): Promise<void> {
  const lit = el as ModelViewerCaptureElement & { updateComplete?: Promise<unknown> };
  const p = lit.updateComplete;
  if (p && typeof p.then === "function") {
    try {
      await p;
    } catch {
      /* ignore */
    }
  }
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
  await new Promise((r) => setTimeout(r, 32));
}

/**
 * Moves the camera through fixed orbits and builds a ZIP of PNG screenshots.
 * Caller should use a dedicated off-screen model-viewer at the desired pixel size.
 */
export async function captureModelViewsToZip(
  el: ModelViewerCaptureElement,
  shots: ModelViewShot[] = MODEL_VIEW_SHOTS,
  options?: { settleMs?: number; signal?: AbortSignal },
): Promise<Blob> {
  /** Fallback if `updateComplete` / rAF is not enough on a given GPU (ms after each orbit). */
  const settleMs = options?.settleMs ?? 0;
  const signal = options?.signal;
  const toDataURL = el.toDataURL;
  if (typeof toDataURL !== "function") {
    throw new Error("This browser build of model-viewer does not support toDataURL().");
  }

  const zip = new JSZip();
  for (const { file, orbit } of shots) {
    if (signal?.aborted) {
      throw new DOMException("Capture cancelled.", "AbortError");
    }
    el.cameraOrbit = orbit;
    if (typeof el.jumpCameraToGoal === "function") {
      el.jumpCameraToGoal();
    }
    await settleAfterCameraMove(el);
    if (settleMs > 0) {
      await new Promise((r) => setTimeout(r, settleMs));
    }
    const dataUrl = toDataURL.call(el, "image/png");
    const blob = await dataUrlToBlob(dataUrl);
    zip.file(`${file}.png`, blob);
  }

  // PNGs are already compressed; STORE avoids slow DEFLATE over multi‑MB buffers.
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}
