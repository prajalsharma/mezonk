"use client";

/**
 * Wallet session state in the browser. The session token itself lives in an HttpOnly cookie that page
 * scripts cannot read; this store only remembers which wallet the server says is signed in.
 */
export interface Session {
  wallet: string;
  expiresAt?: string;
}

let snapshot: Session | null | undefined;
const listeners = new Set<() => void>();
let probing: Promise<void> | null = null;

/** Asks the server once per page load whether the cookie is still a valid session. */
function probe() {
  probing ??= fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { wallet: null }))
    .then((j: { wallet: string | null }) => setSession(j.wallet ? { wallet: j.wallet } : null))
    .catch(() => setSession(null));
}

export function getSession(): Session | null {
  if (snapshot === undefined) {
    snapshot = null;
    if (typeof window !== "undefined") probe();
  }
  return snapshot;
}

export function setSession(s: Session | null) {
  snapshot = s;
  for (const l of listeners) l();
}

export function subscribeSession(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Same-origin JSON call with the session cookie. A 401 means the session is gone: drop local state. */
export async function apiAuth<T>(url: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: { ...(init.body instanceof FormData ? {} : { "content-type": "application/json" }), ...(init.headers ?? {}) },
  });
  const body = r.status === 204 ? null : await r.json().catch(() => null);
  if (r.status === 401) setSession(null);
  if (!r.ok) throw new Error(body?.error?.message ?? `Request failed (${r.status})`);
  return body as T;
}

export async function signOutServer() {
  await fetch("/api/auth/session", { method: "DELETE", credentials: "same-origin" }).catch(() => undefined);
  setSession(null);
}
