"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { Address } from "@/components/ui/Address";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Field, Notice, Segmented, inputClass } from "@/components/ui/primitives";
import { WalletButton } from "@/components/wallet/WalletButton";
import { useMe, useSession, type Me } from "@/hooks/useSession";
import { apiAuth } from "@/lib/api/auth-client";

type Prefs = NonNullable<Me["settings"]>;
const defaults: Prefs = { displayName: null, notifyProposals: true, notifyResolution: true, notifyClaims: true, numberFormat: "compact", hideBalances: false };

export function SettingsView() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { address, isConnected } = useAccount();
  const session = useSession();
  const me = useMe();
  const qc = useQueryClient();
  const [prefs, setPrefs] = useState<Prefs>(defaults);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (me.data?.settings && !dirty) setPrefs({ ...defaults, ...me.data.settings });
  }, [me.data, dirty]);

  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setPrefs((p) => ({ ...p, [k]: v }));
    setDirty(true);
    setMsg(null);
  };

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      if (!(await session.ensure())) return;
      await apiAuth("/api/settings", { method: "PUT", body: JSON.stringify(prefs) });
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ["me"] });
      setMsg({ tone: "success", text: "Saved." });
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const roles = me.data?.roles;
  const roleList = roles ? (["owner", "curator", "creator", "resolver", "arbitrator"] as const).filter((r) => roles[r]) : [];

  return (
    <div className="max-w-xl space-y-10">
      <section className="space-y-3" aria-labelledby="appearance">
        <h2 id="appearance" className="text-lg font-semibold">Appearance</h2>
        {mounted ? (
          <Segmented
            value={(theme as "light" | "dark" | "system") ?? "system"}
            onChange={setTheme}
            label="Theme"
            options={[
              { value: "light", label: <span className="inline-flex items-center gap-1.5"><Sun className="size-4" aria-hidden />Light</span> },
              { value: "dark", label: <span className="inline-flex items-center gap-1.5"><Moon className="size-4" aria-hidden />Dark</span> },
              { value: "system", label: <span className="inline-flex items-center gap-1.5"><Monitor className="size-4" aria-hidden />System</span> },
            ]}
          />
        ) : (
          <div className="h-11 rounded-md bg-surface-2" aria-hidden />
        )}
        <p className="text-sm text-muted">Motion follows your system&apos;s reduce-motion setting automatically.</p>
      </section>

      <section className="space-y-4" aria-labelledby="account">
        <h2 id="account" className="text-lg font-semibold">Wallet</h2>
        {!isConnected ? (
          <Notice tone="info" title="No wallet connected" action={<WalletButton />}>Connect to store preferences for your wallet.</Notice>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="flex flex-wrap items-center gap-2">Connected as <Address address={address!} label="Wallet" /></p>
            {roleList.length > 0 && <p className="text-ink-2">Protocol roles (from the contract): {roleList.join(", ")}.</p>}
            {roles && roles.verifiedProjects.length > 0 && <p className="text-ink-2">Verified representative of: {roles.verifiedProjects.join(", ")}.</p>}
            {session.signedIn ? (
              <Button size="sm" variant="ghost" onClick={session.signOut}>Sign out of this tab</Button>
            ) : (
              <Button size="sm" variant="secondary" loading={session.busy} onClick={() => session.ensure()}>Sign in to load preferences</Button>
            )}
            {session.error && <p className="text-danger">{session.error}</p>}
          </div>
        )}
      </section>

      <section className={cx("space-y-5", !session.signedIn && "opacity-60")} aria-labelledby="prefs">
        <h2 id="prefs" className="text-lg font-semibold">Preferences</h2>
        <fieldset disabled={!session.signedIn} className="space-y-5">
          <Field label="Display name (optional)" htmlFor="dn" hint="Shown next to your address on suggestions you author. Not a verified identity.">
            <input id="dn" maxLength={40} value={prefs.displayName ?? ""} onChange={(e) => set("displayName", e.target.value || null)} className={inputClass} />
          </Field>
          <Field label="Numbers" htmlFor="nf">
            <Segmented value={prefs.numberFormat as "compact" | "full"} onChange={(v) => set("numberFormat", v)} label="Number format" className="sm:max-w-xs" options={[{ value: "compact", label: "Compact (1.2k)" }, { value: "full", label: "Full (1,234.00)" }]} />
          </Field>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--ink)]" checked={prefs.hideBalances} onChange={(e) => set("hideBalances", e.target.checked)} />
            <span>Hide balances in the header and portfolio until hovered</span>
          </label>
          <div className="space-y-2">
            <p className="text-sm font-semibold">In-app notifications</p>
            {(
              [
                ["notifyProposals", "Decisions on my suggestions"],
                ["notifyResolution", "Resolution steps on markets I hold"],
                ["notifyClaims", "Payouts and refunds ready to claim"],
              ] as Array<[keyof Prefs, string]>
            ).map(([k, label]) => (
              <label key={k} className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--ink)]" checked={!!prefs[k]} onChange={(e) => set(k, e.target.checked as never)} />
                <span>{label}</span>
              </label>
            ))}
            <p className="text-xs text-muted">Shown in the app only. MEZONK never asks for an email or sends push messages.</p>
          </div>
        </fieldset>
        <div className="flex items-center gap-3">
          <Button onClick={save} loading={saving} disabled={!dirty || !session.signedIn}>Save</Button>
          {msg && <span className={msg.tone === "success" ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</span>}
        </div>
      </section>
    </div>
  );
}
