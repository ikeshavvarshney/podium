"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * A modal for an action that is public, wide, or hard to take back. It is the
 * browser's own dialog element, so focus is held inside it, Escape closes it,
 * and everything behind it is inert. The confirm button names the action; the
 * body should say what it will touch and how many.
 */
export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "primary",
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={() => {
        if (open) onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCancel();
      }}
      className="w-[calc(100%-32px)] max-w-[520px] rounded-[14px] border border-line bg-surface p-0 text-text backdrop:bg-black/40"
    >
      <div className="p-6">
        <h2 id={titleId} className="m-0 text-title font-semibold tracking-head">
          {title}
        </h2>
        <div className="mt-3 text-ui leading-[1.6] text-muted">{children}</div>
        <div className="mt-6 flex flex-wrap justify-end gap-2.5">
          <button type="button" className="btn max-md:min-h-[44px]" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            className={`${tone === "danger" ? "btn border-danger text-danger hover:bg-danger-soft" : "btn-primary"} max-md:min-h-[44px] disabled:opacity-50`}
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
