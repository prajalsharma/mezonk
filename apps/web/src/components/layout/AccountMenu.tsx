"use client";

import { LogOut, Pencil, Settings, Shield, User } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { Avatar } from "@/components/profile/Avatar";
import { profileHref } from "@/components/profile/UserChip";
import { Button } from "@/components/ui/Button";
import { ProfileEditor } from "@/features/profile/ProfileEditor";
import { useMe, useSession } from "@/hooks/useSession";


/**
 * Sign-in and account actions. Connecting a wallet alone does not sign in: the user signs one message.
 * First-time profiles are invited once per browser session.
 */
export function AccountMenu() {
  const { address, isConnected } = useAccount();
  const session = useSession();
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!isConnected || !address) return null;
  if (!session.signedIn) {
    return (
      <Button size="sm" variant="secondary" loading={session.busy} onClick={() => session.ensure()} title={session.error ?? "Sign one message to prove this wallet is yours. No transaction, no fee."}>
        Sign in
      </Button>
    );
  }
  const p = me.data?.profile;
  const isAdmin = !!me.data?.roles.admin;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={p?.username ? "Your profile and settings" : "Your profile and settings (profile not set up)"}
        className="press relative rounded-full ring-offset-2 ring-offset-bg focus-visible:ring-2 focus-visible:ring-focus"
      >
        <Avatar address={address} url={p?.avatarUrl} size={32} />
        {/* A quiet nudge instead of a modal that interrupts whatever the user is doing. */}
        {me.data && !p?.username && <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-accent ring-2 ring-bg" />}
      </button>
      {open && (
        <div role="menu" className="glass fade absolute right-0 top-11 z-[var(--z-dropdown)] w-64 overflow-hidden rounded-lg border shadow-3">
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-medium">{p?.displayName ?? "No profile yet"}</p>
            <p className="mono truncate text-xs text-muted">{p?.username ? `@${p.username}` : `${address.slice(0, 6)}…${address.slice(-4)}`}</p>
          </div>
          <ul className="p-1.5 text-sm">
            <li>
              <Link role="menuitem" href={profileHref({ wallet: address, username: p?.username ?? null })} onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-sm px-3 py-2 hover:bg-surface-2">
                <User className="size-4 text-muted" /> Your profile
              </Link>
            </li>
            <li>
              <button role="menuitem" type="button" onClick={() => { setOpen(false); setFirstRun(!p?.username); setEditing(true); }} className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-left hover:bg-surface-2">
                <Pencil className="size-4 text-muted" /> {p?.username ? "Edit profile" : "Set up profile"}
              </button>
            </li>
            <li>
              <Link role="menuitem" href="/settings" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-sm px-3 py-2 hover:bg-surface-2">
                <Settings className="size-4 text-muted" /> Settings
              </Link>
            </li>
            {isAdmin && (
              <li>
                <Link role="menuitem" href="/admin" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-sm px-3 py-2 hover:bg-surface-2">
                  <Shield className="size-4 text-muted" /> Administration
                </Link>
              </li>
            )}
            <li className="mt-1 border-t border-line pt-1">
              <button role="menuitem" type="button" onClick={() => { setOpen(false); void session.signOut(); }} className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-left hover:bg-surface-2">
                <LogOut className="size-4 text-muted" /> Sign out
              </button>
            </li>
          </ul>
        </div>
      )}
      <ProfileEditor open={editing} firstRun={firstRun} onClose={() => setEditing(false)} />
    </div>
  );
}
