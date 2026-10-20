"use client";

/** Bearer token for wallet sessions, kept in sessionStorage (cleared when the tab closes). */
const KEY = "mezonk:session";

export interface Session {
  token: string;
  wallet: string;
  expiresAt: string;
}

// One in-memory snapshot shared by every hook instance, so a sign-in in one component is seen by all.
let snapshot: Session | null | undefined;
const listeners = new Set<() => void>();

function readStorage(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (new Date(s.expiresAt).getTime() < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export function getSession(): Session | null {
  if (snapshot === undefined) snapshot = readStorage();
  else if (snapshot && new Date(snapshot.expiresAt).getTime() < Date.now()) snapshot = null;
  return snapshot;
}

export function setSession(s: Session | null) {
  snapshot = s;
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
  for (const l of listeners) l();
}

/** For useSyncExternalStore. */
export function subscribeSession(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
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
