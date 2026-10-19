"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./cx";

interface Toast {
  id: number;
  tone: "success" | "error" | "info";
  title: string;
  body?: ReactNode;
}

const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(Ctx);

/** Toasts are announced through a polite live region; errors use assertive. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.tone === "error" ? 9000 : 6000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[var(--z-toast)] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:px-6"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={cx(
              "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border bg-surface px-4 py-3 shadow-2",
              t.tone === "error" ? "border-no/50" : t.tone === "success" ? "border-yes/50" : "border-line",
            )}
          >
            <span
              aria-hidden
              className={cx("mt-1.5 size-2 shrink-0 rounded-full", t.tone === "error" ? "bg-no" : t.tone === "success" ? "bg-yes" : "bg-info")}
            />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold">{t.title}</p>
              {t.body && <div className="mt-0.5 text-ink-2">{t.body}</div>}
            </div>
            <button
              aria-label="Dismiss"
              onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}
              className="text-muted hover:text-ink"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
