"use client";

/** Bearer token for wallet sessions, kept in sessionStorage (cleared when the tab closes). */
const KEY = "mezonk:session";

export function getSession(): { token: string; wallet: string; expiresAt: string } | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (new Date(s.expiresAt).getTime() < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}
export function setSession(s: { token: string; wallet: string; expiresAt: string } | null) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

export async function apiAuth<T>(url: string, init: RequestInit = {}): Promise<T> {
  const s = getSession();
  const r = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(s ? { authorization: `Bearer ${s.token}` } : {}), ...(init.headers ?? {}) },
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.error?.message ?? `Request failed (${r.status})`);
  return body as T;
}
