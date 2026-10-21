"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { isAddress, type Hash } from "viem";
import { useAccount, useSendTransaction } from "wagmi";
import { Address, TxLink } from "@/components/ui/Address";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState, Field, KeyValue, Notice, Segmented, Skeleton, inputClass } from "@/components/ui/primitives";
import { WalletButton } from "@/components/wallet/WalletButton";
import { useMe, useSession } from "@/hooks/useSession";
import { apiAuth } from "@/lib/api/auth-client";
import { apiGet } from "@/lib/api/types";
import { deployment } from "@/lib/chain/config";
import { formatDateTime } from "@/lib/format";

interface Operation {
  id: string;
  fn: "setCreator" | "setCurator" | "addPolicy" | "setPolicyActive";
  params?: Record<string, unknown> | null;
  target: string;
  grant: boolean;
  status: "awaiting_signature" | "submitted" | "confirmed" | "failed";
  txHash: string | null;
  error: string | null;
  reason: string;
  calldata: string;
  contract: string | null;
  createdAt: string;
  owner?: string | null;
}
interface WalletInfo {
  wallet: string;
  profile: { username: string; displayName: string } | null;
  status: "active" | "suspended";
  statusReason: string | null;
  protocol: { owner: boolean; creator: boolean; curator: boolean; resolver: boolean; arbitrator: boolean };
  admin: boolean;
  assignments: Array<{ id: number; role: string; grantedBy: string; grantedAt: string; reason: string; revokedAt: string | null; revokedBy: string | null; revokeReason: string | null }>;
  activeSessions: number;
  liquidity: { openEscrowedOrders: number; seededMarkets: number };
  operations: Operation[];
  history: Array<{ actor: string; action: string; details: unknown; createdAt: string }>;
}

type Tab = "wallets" | "policies" | "incident" | "admins" | "audit";

export function AdminDashboard() {
  const { isConnected } = useAccount();
  const session = useSession();
  const me = useMe();
  const [tab, setTab] = useState<Tab>("wallets");

  if (!isConnected) return <Notice tone="info" title="Connect an administrator wallet" action={<WalletButton />} />;
  if (!session.signedIn)
    return (
      <Notice tone="info" title="Sign in to continue" action={<Button size="sm" loading={session.busy} onClick={() => session.ensure()}>Sign in</Button>}>
        {session.error ?? "Administration needs a signed-in wallet. Your role is checked on the server for every action."}
      </Notice>
    );
  if (me.isLoading) return <Skeleton className="h-32" />;
  if (!me.data?.roles.admin)
    return (
      <Notice tone="warn" title="This wallet isn't an administrator">
        Administrator roles are granted by another administrator (or once, at setup, by the server&apos;s bootstrap wallet). See docs/USER_PROFILES_AND_RBAC_ARCHITECTURE.md.
      </Notice>
    );

  return (
    <div className="space-y-6">
      <Segmented
        value={tab}
        onChange={setTab}
        label="Administration section"
        className="w-full sm:max-w-2xl"
        options={[
          { value: "wallets", label: "Wallets & roles" },
          { value: "policies", label: "Policies" },
          { value: "incident", label: "Compromised wallet" },
          { value: "admins", label: "Administrators" },
          { value: "audit", label: "Audit log" },
        ]}
      />
      {tab === "wallets" && <WalletsTab />}
      {tab === "policies" && <PoliciesTab />}
      {tab === "incident" && <IncidentTab />}
      {tab === "admins" && <AdminsTab />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}

function Source({ s }: { s: "chain" | "database" }) {
  return <span className={cx("mono rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-wide", s === "chain" ? "bg-info/12 text-info" : "bg-surface-2 text-ink-2 ring-1 ring-line")}>{s === "chain" ? "on-chain" : "backend"}</span>;
}

function ReasonDialog({ open, title, body, confirm, danger, onClose, onConfirm }: { open: boolean; title: string; body: string; confirm: string; danger?: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onClose={() => { setReason(""); setErr(null); onClose(); }}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={busy}
            disabled={reason.trim().length < 5}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await onConfirm(reason.trim());
                setReason("");
                onClose();
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-2">{body}</p>
        <Field label="Reason (recorded in the audit log)" htmlFor="rd-reason" hint="At least 5 characters.">
          <textarea id="rd-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} autoFocus />
        </Field>
        {err && <p className="text-sm text-danger" role="alert">{err}</p>}
      </div>
    </Dialog>
  );
}

type Pending = { kind: "platform"; action: string; title: string; body: string; confirm: string; danger?: boolean } | { kind: "chain"; fn: "setCreator" | "setCurator"; grant: boolean; title: string; body: string; confirm: string; danger?: boolean };

function WalletsTab() {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const q = useQuery({
    queryKey: ["admin", "wallet", target],
    enabled: !!target,
    queryFn: () => apiAuth<WalletInfo>(`/api/admin/wallets/${target}`),
  });
  const w = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "wallet", target] });

  async function confirm(reason: string) {
    if (!pending || !target) return;
    if (pending.kind === "platform") {
      await apiAuth(`/api/admin/wallets/${target}/actions`, { method: "POST", body: JSON.stringify({ action: pending.action, reason }) });
    } else {
      await apiAuth("/api/admin/role-ops", { method: "POST", body: JSON.stringify({ fn: pending.fn, target, grant: pending.grant, reason }) });
    }
    await refresh();
  }

  return (
    <div className="space-y-6">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (isAddress(input.trim(), { strict: false })) setTarget(input.trim().toLowerCase());
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Wallet address 0x…" aria-label="Wallet address" className={`${inputClass} mono pl-10 text-sm`} spellCheck={false} />
        </div>
        <Button type="submit" disabled={!isAddress(input.trim(), { strict: false })}>Inspect</Button>
      </form>
      {input && !isAddress(input.trim(), { strict: false }) && <p className="text-sm text-danger">Not a valid EVM address.</p>}

      {!target ? (
        <EmptyState title="Look up a wallet">See its profile, status, on-chain roles, platform roles, live sessions and history, and change them.</EmptyState>
      ) : q.isLoading ? (
        <Skeleton className="h-64" />
      ) : q.isError ? (
        <Notice tone="error" title="Couldn't load this wallet">{(q.error as Error).message}</Notice>
      ) : w ? (
        <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <section className="panel space-y-5 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{w.profile?.displayName ?? "No profile"}</p>
                <p className="flex items-center gap-2 text-sm text-ink-2">{w.profile && <span className="mono">@{w.profile.username}</span>}<Address address={w.wallet} label="Wallet" /></p>
              </div>
              <span className={cx("rounded-full px-2.5 py-1 text-xs font-medium", w.status === "suspended" ? "bg-danger-soft text-danger" : "bg-success-soft text-success")}>
                {w.status === "suspended" ? "Suspended" : "Active"}
              </span>
            </div>
            {w.statusReason && <p className="text-sm text-ink-2">Status reason: {w.statusReason}</p>}

            <dl className="divide-y divide-line">
              <KeyValue label={<span className="flex items-center gap-2">Contract owner <Source s="chain" /></span>}>{w.protocol.owner ? "Yes" : "No"}</KeyValue>
              <KeyValue label={<span className="flex items-center gap-2">Approved creator <Source s="chain" /></span>}>
                <span className="flex items-center justify-end gap-2">
                  {w.protocol.creator ? "Yes" : "No"}
                  <Button size="sm" variant="ghost" onClick={() => setPending({ kind: "chain", fn: "setCreator", grant: !w.protocol.creator, title: `${w.protocol.creator ? "Revoke" : "Grant"} creator (on-chain)`, body: "This records the request. The contract owner must sign setCreator; the change counts only after the transaction confirms.", confirm: "Create request", danger: w.protocol.creator })}>
                    {w.protocol.creator ? "Revoke" : "Grant"}
                  </Button>
                </span>
              </KeyValue>
              <KeyValue label={<span className="flex items-center gap-2">Curator <Source s="chain" /></span>}>
                <span className="flex items-center justify-end gap-2">
                  {w.protocol.curator ? "Yes" : "No"}
                  <Button size="sm" variant="ghost" onClick={() => setPending({ kind: "chain", fn: "setCurator", grant: !w.protocol.curator, title: `${w.protocol.curator ? "Revoke" : "Grant"} curator (on-chain)`, body: "This records the request. The contract owner must sign setCurator; the change counts only after the transaction confirms.", confirm: "Create request", danger: w.protocol.curator })}>
                    {w.protocol.curator ? "Revoke" : "Grant"}
                  </Button>
                </span>
              </KeyValue>
              <KeyValue label={<span className="flex items-center gap-2">Resolver / arbitrator <Source s="chain" /></span>}>{[w.protocol.resolver && "Resolver", w.protocol.arbitrator && "Arbitrator"].filter(Boolean).join(", ") || "No"}</KeyValue>
              <KeyValue label={<span className="flex items-center gap-2">Administrator <Source s="database" /></span>}>
                <span className="flex items-center justify-end gap-2">
                  {w.admin ? "Yes" : "No"}
                  <Button size="sm" variant="ghost" onClick={() => setPending({ kind: "platform", action: w.admin ? "revoke_admin" : "grant_admin", title: w.admin ? "Revoke administrator" : "Grant administrator", body: w.admin ? "Takes effect immediately." : "Administrators can grant roles, suspend accounts and read the audit log. Takes effect immediately.", confirm: w.admin ? "Revoke" : "Grant", danger: w.admin })}>
                    {w.admin ? "Revoke" : "Grant"}
                  </Button>
                </span>
              </KeyValue>
              <KeyValue label="Liquidity provider">
                {w.liquidity.openEscrowedOrders || w.liquidity.seededMarkets
                  ? `${w.liquidity.openEscrowedOrders} open escrowed orders · seeded ${w.liquidity.seededMarkets} markets`
                  : "No"}
              </KeyValue>
              <KeyValue label="Active sessions">
                <span className="flex items-center justify-end gap-2">
                  {w.activeSessions}
                  {w.activeSessions > 0 && <Button size="sm" variant="ghost" onClick={() => setPending({ kind: "platform", action: "revoke_sessions", title: "Sign this wallet out everywhere", body: "Every session is revoked now. The wallet can sign in again unless suspended.", confirm: "Revoke sessions" })}>Revoke</Button>}
                </span>
              </KeyValue>
            </dl>

            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              {w.status === "suspended" ? (
                <Button variant="secondary" onClick={() => setPending({ kind: "platform", action: "restore", title: "Restore account", body: "The wallet can sign in and act again. On-chain roles are unaffected either way.", confirm: "Restore" })}>Restore account</Button>
              ) : (
                <Button variant="danger" onClick={() => setPending({ kind: "platform", action: "suspend", title: "Suspend account", body: "Removes every backend capability and revokes all sessions immediately. On-chain creator/curator flags stay until revoked on-chain.", confirm: "Suspend", danger: true })}>Suspend account</Button>
              )}
            </div>
          </section>

          <div className="space-y-4">
            <section className="panel space-y-3 p-5">
              <h3 className="font-medium">On-chain role requests</h3>
              {w.operations.length === 0 ? <p className="text-sm text-muted">None.</p> : w.operations.map((op) => <OperationCard key={op.id} op={op} onChange={refresh} />)}
            </section>
            <section className="panel space-y-2 p-5">
              <h3 className="font-medium">History</h3>
              {w.history.length === 0 ? (
                <p className="text-sm text-muted">No recorded changes.</p>
              ) : (
                <ol className="mono space-y-1.5 text-xs">
                  {w.history.map((h, i) => (
                    <li key={i} className="flex flex-wrap gap-x-2 text-ink-2">
                      <span className="text-muted">{formatDateTime(new Date(h.createdAt))}</span>
                      <span className="text-ink">{h.action}</span>
                      <span>by {h.actor === "chain" || h.actor === "bootstrap" ? h.actor : `${h.actor.slice(0, 8)}…`}</span>
                      {(h.details as { reason?: string } | null)?.reason && <span className="font-sans">· {(h.details as { reason: string }).reason}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </div>
      ) : null}

      <ReasonDialog open={!!pending} title={pending?.title ?? ""} body={pending?.body ?? ""} confirm={pending?.confirm ?? "Confirm"} danger={pending?.danger} onClose={() => setPending(null)} onConfirm={confirm} />
    </div>
  );
}

/**
 * One protocol role change. If the connected wallet is the contract owner it can sign here; otherwise the
 * calldata can be proposed in a Safe and the hash pasted back. Status comes from the server's chain check.
 */
function OperationCard({ op, onChange }: { op: Operation; onChange: () => void }) {
  const { address } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const attach = async (h: string) => {
    await apiAuth(`/api/admin/role-ops/${op.id}`, { method: "POST", body: JSON.stringify({ txHash: h }) });
    onChange();
  };
  async function sign() {
    setErr(null);
    setBusy(true);
    try {
      // The exact calldata the server recorded, to the contract it names (factory for roles, exchange for policies).
      const h: Hash = await sendTransactionAsync({ to: op.contract as `0x${string}`, data: op.calldata as `0x${string}`, chainId: deployment.chainId });
      await attach(h);
      // Re-check until the server sees the receipt.
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const r = await apiAuth<{ operation: Operation }>(`/api/admin/role-ops/${op.id}`);
        if (r.operation.status !== "submitted") break;
      }
      onChange();
    } catch (e) {
      const m = (e as Error).message;
      setErr(/rejected|denied/i.test(m) ? "You declined in your wallet. Nothing changed." : m);
    } finally {
      setBusy(false);
    }
  }
  const label =
    op.fn === "addPolicy"
      ? `Add policy${op.params?.policyId ? ` #${String(op.params.policyId)}` : ""}`
      : op.fn === "setPolicyActive"
        ? `${op.grant ? "Re-enable" : "Retire"} policy #${String(op.params?.policyId ?? "?")}`
        : `${op.grant ? "Grant" : "Revoke"} ${op.fn === "setCreator" ? "creator" : "curator"}`;
  const tone = op.status === "confirmed" ? "text-success" : op.status === "failed" ? "text-danger" : "text-warn";
  return (
    <div className="space-y-2 rounded-md border border-line p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        <span className={cx("mono text-xs", tone)}>{op.status.replace("_", " ")}</span>
      </div>
      <p className="text-ink-2">{op.reason}</p>
      {op.txHash && <p className="flex items-center gap-2">Tx <TxLink hash={op.txHash} /></p>}
      {op.error && <p className="text-danger">{op.error}</p>}
      {op.status !== "confirmed" && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={busy} onClick={sign} disabled={!address}>Sign with connected owner wallet</Button>
            <Button size="sm" variant="ghost" onClick={async () => { await apiAuth(`/api/admin/role-ops/${op.id}`); onChange(); }}>Re-check chain</Button>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-ink-2">Owner is a Safe? Use the calldata and paste the hash</summary>
            <p className="mono mt-2 break-all text-muted">to: {op.contract}</p>
            <p className="mono break-all text-muted">data: {op.calldata}</p>
            <div className="mt-2 flex gap-2">
              <input value={hash} onChange={(e) => setHash(e.target.value.trim())} placeholder="0x… transaction hash" className={`${inputClass} mono py-1.5 text-xs`} aria-label="Transaction hash" />
              <Button size="sm" variant="secondary" disabled={!/^0x[0-9a-fA-F]{64}$/.test(hash)} onClick={async () => { try { await attach(hash); } catch (e) { setErr((e as Error).message); } }}>Attach</Button>
            </div>
          </details>
          <p className="text-xs text-muted">Only the contract owner can sign this. It counts as done only after the server sees the confirmed transaction and reads the new on-chain state.</p>
        </>
      )}
      {err && <p className="text-danger" role="alert">{err}</p>}
    </div>
  );
}

function IncidentTab() {
  const [oldW, setOldW] = useState("");
  const [newW, setNewW] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const valid = isAddress(oldW, { strict: false }) && isAddress(newW, { strict: false }) && reason.trim().length >= 10;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel space-y-4 p-5">
        <h3 className="font-medium">Replace a compromised wallet</h3>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
          <li>The old wallet is suspended and every session revoked, now.</li>
          <li>Its platform roles move to the new wallet; its open suggestions are withdrawn and review claims released.</li>
          <li>On-chain creator/curator changes are queued for the contract owner to sign.</li>
          <li>Published markets keep their original creator.</li>
        </ol>
        <Field label="Compromised wallet" htmlFor="inc-old">
          <input id="inc-old" value={oldW} onChange={(e) => setOldW(e.target.value.trim())} className={`${inputClass} mono text-sm`} spellCheck={false} />
        </Field>
        <Field label="Replacement wallet" htmlFor="inc-new" hint="Must have signed in to MEZONK once, proving its owner controls it.">
          <input id="inc-new" value={newW} onChange={(e) => setNewW(e.target.value.trim())} className={`${inputClass} mono text-sm`} spellCheck={false} />
        </Field>
        <Field label="What happened" htmlFor="inc-reason" hint="At least 10 characters. Recorded permanently.">
          <textarea id="inc-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
        </Field>
        {err && <Notice tone="error">{err}</Notice>}
        <Button
          variant="danger"
          loading={busy}
          disabled={!valid}
          onClick={async () => {
            if (!window.confirm("Suspend the old wallet and start the replacement now?")) return;
            setBusy(true);
            setErr(null);
            try {
              setReport((await apiAuth<{ report: Record<string, unknown> }>("/api/admin/wallets/replace", { method: "POST", body: JSON.stringify({ oldWallet: oldW, newWallet: newW, reason }) })).report);
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Start incident response
        </Button>
      </section>
      <section className="panel space-y-3 p-5">
        <h3 className="font-medium">Report</h3>
        {report ? (
          <>
            <Notice tone="success" title="Backend actions are done">Open the replacement wallet in “Wallets &amp; roles” to sign the pending on-chain changes.</Notice>
            <pre className="mono max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md bg-sunk p-3 text-xs text-ink-2">{JSON.stringify(report, null, 2)}</pre>
          </>
        ) : (
          <p className="text-sm text-muted">The report lists what was revoked now and what is still pending on-chain.</p>
        )}
      </section>
    </div>
  );
}

function AdminsTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "admins"], queryFn: () => apiAuth<{ admins: Array<{ wallet: string; grantedBy: string; grantedAt: string; reason: string }> }>("/api/admin/admins") });
  const b = useQuery({ queryKey: ["admin", "bootstrap"], queryFn: () => apiAuth<{ configured: number; closed: boolean }>("/api/admin/bootstrap") });
  const [closing, setClosing] = useState(false);
  if (q.isLoading) return <Skeleton className="h-24" />;
  return (
    <div className="space-y-4">
      <ul className="panel divide-y divide-line">
        {(q.data?.admins ?? []).map((a) => (
          <li key={a.wallet} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
            <Address address={a.wallet} label="Administrator" />
            <span className="text-ink-2">granted {formatDateTime(new Date(a.grantedAt))} by {a.grantedBy === "bootstrap" ? "bootstrap" : `${a.grantedBy.slice(0, 8)}…`}</span>
          </li>
        ))}
      </ul>
      {b.data && (
        <section className="panel space-y-2 p-5 text-sm">
          <h3 className="font-medium">First-administrator bootstrap</h3>
          <p className="text-ink-2">
            {b.data.closed
              ? "Closed. INITIAL_ADMIN_WALLETS no longer grants anything; administrators are managed here."
              : `Open: ${b.data.configured} wallet${b.data.configured === 1 ? "" : "s"} in INITIAL_ADMIN_WALLETS can still become administrator by signing in. It closes automatically on the first grant or revoke here.`}
          </p>
          {!b.data.closed && (
            <>
              <Button size="sm" variant="secondary" onClick={() => setClosing(true)}>Close bootstrap now</Button>
              <ReasonDialog
                open={closing}
                title="Close the bootstrap"
                body="After this, no wallet can become administrator from server configuration. Remove INITIAL_ADMIN_WALLETS from the host afterwards."
                confirm="Close"
                onClose={() => setClosing(false)}
                onConfirm={async (reason) => {
                  await apiAuth("/api/admin/bootstrap", { method: "POST", body: JSON.stringify({ reason }) });
                  await qc.invalidateQueries({ queryKey: ["admin", "bootstrap"] });
                }}
              />
            </>
          )}
        </section>
      )}
    </div>
  );
}

interface PolicyRow {
  policyId: number;
  active: boolean;
  params: Record<string, string | number>;
  addedAt: string;
  txHash: string;
}

const ONE = 10n ** 18n;
/** "12.5" → wei string (18 decimals), exact. */
function toWei(v: string): string | null {
  if (!/^\d{1,15}(\.\d{0,18})?$/.test(v.trim())) return null;
  const [w, f = ""] = v.trim().split(".");
  return (BigInt(w!) * ONE + BigInt((f + "0".repeat(18)).slice(0, 18))).toString();
}
const fromWei = (v: string | number) => {
  const x = BigInt(String(v));
  const frac = (x % ONE).toString().padStart(18, "0").replace(/0+$/, "");
  return `${x / ONE}${frac ? `.${frac}` : ""}`;
};
/** "1.25" (%) → 125 bps, exact. */
function pctToBps(v: string): number | null {
  if (!/^\d{1,3}(\.\d{0,2})?$/.test(v.trim())) return null;
  const [w, f = ""] = v.trim().split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2));
}

const FIELDS: Array<{ k: string; label: string; unit: "shares" | "musd" | "int" | "cents" | "hours" | "minutes" | "days" | "pct" }> = [
  { k: "minBidDepth", label: "Min bid depth", unit: "shares" },
  { k: "minAskDepth", label: "Min ask depth", unit: "shares" },
  { k: "band", label: "Depth band", unit: "cents" },
  { k: "maxSpread", label: "Max spread", unit: "cents" },
  { k: "minSeeders", label: "Min seeders", unit: "int" },
  { k: "minSeederNotional", label: "Min per seeder", unit: "musd" },
  { k: "seedingPeriod", label: "Seeding period", unit: "hours" },
  { k: "minRest", label: "Seed order lock", unit: "minutes" },
  { k: "takerFeeBps", label: "Taker fee", unit: "pct" },
  { k: "rebateShareBps", label: "Seeder share of fee", unit: "pct" },
  { k: "referralShareBps", label: "Referrer share of fee", unit: "pct" },
  { k: "rebatePeriod", label: "Rebate period", unit: "days" },
  { k: "claimWindow", label: "Claim window", unit: "days" },
  { k: "rebateCapPerMarket", label: "Rebate cap / market", unit: "musd" },
  { k: "rebateCapPerWallet", label: "Rebate cap / wallet", unit: "musd" },
  { k: "rebateBudget", label: "Rebate budget (policy)", unit: "musd" },
  { k: "referralCapPerMarket", label: "Referral cap / referrer / market", unit: "musd" },
];
const SECS = { hours: 3600, minutes: 60, days: 86400 } as const;

function toForm(p: Record<string, string | number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of FIELDS) {
    const v = p[f.k];
    if (v === undefined) continue;
    if (f.unit === "shares" || f.unit === "musd") out[f.k] = fromWei(v);
    else if (f.unit === "pct") out[f.k] = String(Number(v) / 100);
    else if (f.unit in SECS) out[f.k] = String(Number(v) / SECS[f.unit as keyof typeof SECS]);
    else out[f.k] = String(v);
  }
  return out;
}

function fromForm(f: Record<string, string>): { policy?: Record<string, string | number>; error?: string } {
  const p: Record<string, string | number> = {};
  for (const x of FIELDS) {
    const v = (f[x.k] ?? "").trim();
    if (x.unit === "shares" || x.unit === "musd") {
      const w = toWei(v);
      if (!w) return { error: `${x.label}: enter a number` };
      p[x.k] = w;
    } else if (x.unit === "pct") {
      const b = pctToBps(v);
      if (b === null) return { error: `${x.label}: enter a percentage with up to 2 decimals` };
      p[x.k] = b;
    } else {
      if (!/^\d{1,6}$/.test(v)) return { error: `${x.label}: enter a whole number` };
      p[x.k] = x.unit in SECS ? Number(v) * SECS[x.unit as keyof typeof SECS] : Number(v);
    }
  }
  return { policy: p };
}

/** Graduation and fee policy versions. New versions apply to markets approved after they exist; old markets never change. */
function PoliciesTab() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["policies"], queryFn: () => apiGet<{ policies: PolicyRow[] }>("/api/policies") });
  const ops = useQuery({ queryKey: ["admin", "policy-ops"], queryFn: () => apiAuth<{ operations: Operation[] }>("/api/admin/policy-ops"), refetchInterval: 10_000 });
  const latest = list.data?.policies.at(-1);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [pending, setPending] = useState<{ title: string; body: string; run: (reason: string) => Promise<void> } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const f = form ?? (latest ? toForm(latest.params) : null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["admin", "policy-ops"] }), qc.invalidateQueries({ queryKey: ["policies"] })]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <section className="panel space-y-4 p-5">
        <h3 className="font-medium">On-chain policies</h3>
        {list.isLoading ? (
          <Skeleton className="h-24" />
        ) : !list.data?.policies.length ? (
          <p className="text-sm text-muted">None indexed yet.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {list.data.policies.map((p) => (
              <li key={p.policyId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span>
                  <span className="font-medium">#{p.policyId}</span>{" "}
                  <span className={p.active ? "text-success" : "text-muted"}>{p.active ? "active" : "retired"}</span>
                  <span className="block text-xs text-ink-2">
                    fee {Number(p.params.takerFeeBps) / 100}% · seed {Number(p.params.seedingPeriod) / 3600}h · depth {fromWei(p.params.minBidDepth!)}/{fromWei(p.params.minAskDepth!)} · spread ≤ {p.params.maxSpread}¢ · {p.params.minSeeders} seeders
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setPending({
                      title: `${p.active ? "Retire" : "Re-enable"} policy #${p.policyId}`,
                      body: p.active ? "New markets can no longer be published on it. Markets already on it are unaffected." : "New approvals may bind it again.",
                      run: async (reason) => {
                        await apiAuth("/api/admin/policy-ops", { method: "POST", body: JSON.stringify({ fn: "setPolicyActive", policyId: p.policyId, active: !p.active, reason }) });
                        await refresh();
                      },
                    })
                  }
                >
                  {p.active ? "Retire" : "Re-enable"}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <h3 className="border-t border-line pt-4 font-medium">Propose a new policy version</h3>
        <p className="text-sm text-ink-2">Prefilled from the newest policy. The exchange owner signs it; it becomes a new, immutable version.</p>
        {f && (
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((x) => (
              <Field key={x.k} label={`${x.label} (${x.unit === "pct" ? "%" : x.unit === "musd" ? "MUSD" : x.unit === "cents" ? "¢" : x.unit === "int" ? "#" : x.unit})`} htmlFor={`pol-${x.k}`}>
                <input id={`pol-${x.k}`} value={f[x.k] ?? ""} onChange={(e) => setForm({ ...f, [x.k]: e.target.value })} className={`${inputClass} mono text-sm`} inputMode="decimal" />
              </Field>
            ))}
          </div>
        )}
        {err && <Notice tone="error">{err}</Notice>}
        <Button
          disabled={!f}
          onClick={() => {
            setErr(null);
            const r = fromForm(f!);
            if (r.error) return setErr(r.error);
            setPending({
              title: "Request a new policy",
              body: "This records the request. The exchange owner must sign addPolicy; it counts only after the chain confirms it.",
              run: async (reason) => {
                await apiAuth("/api/admin/policy-ops", { method: "POST", body: JSON.stringify({ fn: "addPolicy", policy: r.policy, reason }) });
                await refresh();
              },
            });
          }}
        >
          Create request
        </Button>
      </section>
      <section className="panel space-y-3 p-5">
        <h3 className="font-medium">Policy requests</h3>
        {(ops.data?.operations ?? []).length === 0 ? <p className="text-sm text-muted">None.</p> : ops.data!.operations.map((op) => <OperationCard key={op.id} op={op} onChange={refresh} />)}
      </section>
      <ReasonDialog
        open={!!pending}
        title={pending?.title ?? ""}
        body={pending?.body ?? ""}
        confirm="Create request"
        onClose={() => setPending(null)}
        onConfirm={async (reason) => {
          try {
            await pending!.run(reason);
          } catch (e) {
            setErr((e as Error).message);
            throw e;
          }
        }}
      />
    </div>
  );
}

function AuditTab() {
  const [before, setBefore] = useState<number | undefined>(undefined);
  const q = useQuery({
    queryKey: ["admin", "audit", before],
    queryFn: () => apiAuth<{ entries: Array<{ id: number; actor: string; action: string; subjectType: string; subjectId: string; details: unknown; createdAt: string }> }>(`/api/admin/audit?limit=50${before ? `&before=${before}` : ""}`),
  });
  const rows = q.data?.entries ?? [];
  return (
    <div className="space-y-3">
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="label border-b border-line">
            <tr>
              <th className="px-4 py-2.5">When</th>
              <th className="px-4 py-2.5">Actor</th>
              <th className="px-4 py-2.5">Action</th>
              <th className="px-4 py-2.5">Subject</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono whitespace-nowrap px-4 py-2 text-xs text-muted">{formatDateTime(new Date(r.createdAt))}</td>
                <td className="mono px-4 py-2 text-xs">{r.actor.length > 12 ? `${r.actor.slice(0, 8)}…` : r.actor}</td>
                <td className="px-4 py-2">{r.action}</td>
                <td className="mono px-4 py-2 text-xs text-ink-2">{r.subjectType}:{r.subjectId.length > 14 ? `${r.subjectId.slice(0, 10)}…` : r.subjectId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        {before && <Button size="sm" variant="ghost" onClick={() => setBefore(undefined)}>Newest</Button>}
        {rows.length === 50 && <Button size="sm" variant="secondary" onClick={() => setBefore(rows.at(-1)!.id)}>Older</Button>}
      </div>
    </div>
  );
}
