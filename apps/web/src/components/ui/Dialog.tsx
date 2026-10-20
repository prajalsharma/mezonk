"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Native <dialog> as a modal: browser-provided focus trapping, Esc to close, inert background.
 * On small screens it docks to the bottom like a sheet.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby={titleId}
      className="glass m-0 mt-auto w-full max-w-none rounded-t-xl border p-0 text-ink shadow-3 backdrop:bg-[var(--overlay)] backdrop:backdrop-blur-sm sm:m-auto sm:max-w-lg sm:rounded-xl"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
        <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink">
          <X className="size-4" />
        </button>
      </div>
      <div className="max-h-[70dvh] overflow-y-auto px-5 py-4">{children}</div>
      {footer && <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3.5 sm:flex-row sm:justify-end">{footer}</div>}
    </dialog>
  );
}
