"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { apiAuth, getSession, setSession, signOutServer, subscribeSession } from "@/lib/api/auth-client";
import type { PlatformRole, Capability } from "@/lib/auth/capabilities";

const noSession = () => null;
import { apiGet } from "@/lib/api/types";

export interface Me {
  roles: {
    wallet: string;
    owner: boolean;
    curator: boolean;
    creator: boolean;
    resolver: boolean;
    arbitrator: boolean;
    admin: boolean;
    suspended: boolean;
    verifiedProjects: string[];
    platformRoles: PlatformRole[];
    capabilities: Capability[];
  };
  profile: {
    wallet: string;
    username: string | null;
    displayName: string | null;
    bio: string;
    avatarUrl: string | null;
  } | null;
  settings: null | {
    displayName: string | null;
    notifyProposals: boolean;
    notifyResolution: boolean;
    notifyClaims: boolean;
    numberFormat: string;
    hideBalances: boolean;
  };
}

/**
 * Wallet sign-in for governed actions (suggesting, reviewing, settings). Trading and claims never need it.
 * `ensure()` signs in lazily: nonce → one plain-text signature → HttpOnly session cookie (7 days).
 */
export function useSession() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const qc = useQueryClient();
  // Shared store: every instance of this hook sees the same session (SSR renders signed out).
  const session = useSyncExternalStore(subscribeSession, getSession, noSession);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A session belongs to one wallet; switching to a different wallet signs the old one out on the server.
  // (A disconnected or still-reconnecting wallet keeps the session: signedIn is false until it is back.)
  useEffect(() => {
    const s = getSession();
    if (s && address && s.wallet.toLowerCase() !== address.toLowerCase()) {
      void signOutServer();
      void qc.invalidateQueries({ queryKey: ["me"] });
    }
  }, [address, qc]);

  const signedIn = !!session && !!address && session.wallet.toLowerCase() === address.toLowerCase();

  const ensure = useCallback(async (): Promise<boolean> => {
    if (!address || !isConnected) {
      setError("Connect a wallet first.");
      return false;
    }
    if (getSession()?.wallet.toLowerCase() === address.toLowerCase()) return true;
    setBusy(true);
    setError(null);
    try {
      const n = await apiGet<{ nonce: string; issuedAt: string; message: string }>(`/api/auth/nonce?wallet=${address}`);
      const signature = await signMessageAsync({ message: n.message });
      const r = await fetch("/api/auth/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: address, nonce: n.nonce, issuedAt: n.issuedAt, signature }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? "Sign-in failed");
      setSession({ wallet: address, expiresAt: j.expiresAt as string });
      void qc.invalidateQueries({ queryKey: ["me"] });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sign-in failed";
      setError(/rejected|denied/i.test(msg) ? "You declined the sign-in request in your wallet." : msg);
      return false;
    } finally {
      setBusy(false);
    }
  }, [address, isConnected, signMessageAsync, qc]);

  const signOut = useCallback(async () => {
    await signOutServer();
    void qc.invalidateQueries({ queryKey: ["me"] });
  }, [qc]);

  return { signedIn, busy, error, ensure, signOut, wallet: address };
}

/** Roles and settings for the signed-in wallet (null when signed out). */
export function useMe() {
  const { signedIn, wallet } = useSession();
  return useQuery({
    queryKey: ["me", wallet, signedIn],
    enabled: signedIn,
    queryFn: () => apiAuth<Me>("/api/me"),
    staleTime: 30_000,
  });
}
