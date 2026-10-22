"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

/**
 * One button, two states. The site starts on the visitor's system theme; a click picks the other one.
 * No third "system" state: it read as a mystery icon and an extra click.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  const next = dark ? "light" : "dark";
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
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="press inline-flex size-10 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink"
    >
      {dark ? <Sun className="size-[1.125rem]" aria-hidden /> : <Moon className="size-[1.125rem]" aria-hidden />}
    </button>
  );
}
