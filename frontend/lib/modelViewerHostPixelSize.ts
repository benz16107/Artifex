import { type RefObject, useLayoutEffect } from "react";

/**
 * Sync `<model-viewer>` host width/height to a frame so WebGL is not stuck at the
 * default 300×150 canvas (common when only percentages are used).
 */
export function syncModelViewerHostPixelSize(frameEl: HTMLElement, viewerEl: HTMLElement): () => void {
  const sync = () => {
    const { width, height } = frameEl.getBoundingClientRect();
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    viewerEl.style.width = `${w}px`;
    viewerEl.style.height = `${h}px`;
  };

  sync();
  const ro = new ResizeObserver(sync);
  ro.observe(frameEl);
  window.addEventListener("resize", sync);
  return () => {
    ro.disconnect();
    window.removeEventListener("resize", sync);
  };
}

export function useSyncModelViewerHostPixelSize(
  frameRef: RefObject<HTMLElement | null>,
  viewerRef: RefObject<HTMLElement | null>,
  syncKey: string | null,
): void {
  useLayoutEffect(() => {
    if (!syncKey) return;
    const frame = frameRef.current;
    const viewer = viewerRef.current;
    if (!frame || !viewer) return;
    return syncModelViewerHostPixelSize(frame, viewer);
  }, [syncKey]);
}
