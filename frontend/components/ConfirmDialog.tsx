"use client";

import { useEffect, useId, useRef } from "react";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  children: React.ReactNode;
  cancelLabel?: string;
  confirmLabel: string;
  /** When true, confirm uses destructive styling. */
  danger?: boolean;
  isWorking?: boolean;
  workingConfirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  open,
  title,
  children,
  cancelLabel = "Cancel",
  confirmLabel,
  danger,
  isWorking,
  workingConfirmLabel = "Working…",
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open || isWorking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isWorking, onCancel]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLButtonElement>(".confirmDialog__cancel")?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open) return null;

  return (
    <div className="confirmDialogRoot" role="presentation">
      <button
        type="button"
        className="confirmDialogBackdrop"
        aria-label="Close dialog"
        disabled={isWorking}
        onClick={() => {
          if (!isWorking) onCancel();
        }}
      />
      <div
        ref={panelRef}
        className="confirmDialogPanel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="confirmDialogTitle">
          {title}
        </h2>
        <div className="confirmDialogBody">{children}</div>
        <div className="confirmDialogFooter">
          <button type="button" className="button button--ghost confirmDialog__cancel" disabled={isWorking} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={["button", danger ? "button--dangerSolid" : "button--primary", "confirmDialog__confirm"].join(
              " ",
            )}
            disabled={isWorking}
            onClick={() => {
              void onConfirm();
            }}
          >
            {isWorking ? workingConfirmLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
