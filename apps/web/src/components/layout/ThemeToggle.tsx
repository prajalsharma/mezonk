"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const ORDER = ["light", "dark", "system"] as const;

/** Cycles light → dark → system. A short cross-fade is applied while the theme switches. */
export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = (theme ?? "system") as (typeof ORDER)[number];
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!;
  const Icon = !mounted ? Sun : current === "system" ? Monitor : resolvedTheme === "dark" ? Moon : Sun;
  const label = !mounted ? "Theme" : current === "system" ? "Theme: follows your system" : `Theme: ${current}`;
  return (
    <button
      type="button"
      onClick={() => {
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          document.documentElement.classList.add("theme-transition");
          setTimeout(() => document.documentElement.classList.remove("theme-transition"), 260);
        }
        setTheme(next);
      }}
      aria-label={`${label}. Switch to ${next}.`}
      title={label}
      className="press inline-flex size-9 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink"
    >
      <Icon className="size-4" />
    </button>
  );
}
