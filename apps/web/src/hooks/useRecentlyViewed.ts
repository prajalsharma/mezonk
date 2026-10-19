"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "mezonk:recent";

/** Recently viewed market ids, stored only in this browser. No personal data. */
export function useRecentlyViewed() {
  const [ids, setIds] = useState<number[]>([]);
  useEffect(() => {
    try {
      setIds(JSON.parse(localStorage.getItem(KEY) ?? "[]").filter(Number.isInteger).slice(0, 8));
    } catch {
      setIds([]);
    }
  }, []);
  const add = useCallback((id: number) => {
    try {
      const next = [id, ...JSON.parse(localStorage.getItem(KEY) ?? "[]").filter((x: number) => x !== id)].slice(0, 8);
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: feature silently off */
    }
  }, []);
  return { ids, add };
}
