"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { erc20Abi, formatUnits, parseEventLogs, parseUnits, type Hash } from "viem";
import { useAccount, useBlock, usePublicClient, useWriteContract } from "wagmi";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Address } from "@/components/ui/Address";
import { Field, Hint, KeyValue, Notice, inputClass } from "@/components/ui/primitives";
import { ProbabilityBar } from "@/components/markets/Probability";
import { TxStatus } from "@/components/trading/TxStatus";
import { WalletButton } from "@/components/wallet/WalletButton";
import { useMusd } from "@/hooks/useMusd";
import { useProtocolConfig } from "@/hooks/useProtocolConfig";
import { useTx } from "@/hooks/useTx";
import { apiGet } from "@/lib/api/types";
import { deployment, TESTNET_FUNDING } from "@/lib/chain/config";
import { mezonkMarketsAbi } from "@/lib/contracts/abi";
import { formatDateTime, formatDuration, formatMusd, formatProb, formatShares } from "@/lib/format";
import { initialPool } from "@/lib/market/math";
import {
  CATEGORIES,
  categoryLabel,
  metadataHash,
  metadataSchema,
  serializeMetadata,
  type Category,
  type MarketMetadata,
  type QualityIssue,
} from "@/lib/market/metadata";

const STEPS = ["Question", "Resolution rules", "Market setup", "Review", "Publish"] as const;
const DRAFT_KEY = "mezonk:create-draft";

interface Form {
  question: string;
  category: Category;
  description: string;
  yes: string;
  no: string;
  invalid: string;
  ambiguity: string;
  sourceName: string;
  sourceUrl: string;
  resolvesAt: string; // "YYYY-MM-DDTHH:mm" interpreted as UTC
  closeAt: string; // same
  resolver: string;
  liquidity: string;
  probBps: number;
}

const empty: Form = {
  question: "",
  category: "crypto",
  description: "",
  yes: "",
  no: "",
  invalid: "",
  ambiguity: "If the source revises the figure, the first value published at the evaluation time counts.",
  sourceName: "",
  sourceUrl: "",
  resolvesAt: "",
  closeAt: "",
  resolver: "",
  liquidity: "100",
  probBps: 5000,
};

const utc = (local: string) => (local ? new Date(`${local}:00Z`) : null);
const toLocalUtc = (d: Date) => d.toISOString().slice(0, 16);

function toMetadata(f: Form): { ok: true; data: MarketMetadata } | { ok: false; errors: Record<string, string> } {
  const r = metadataSchema.safeParse({
    v: 1,
    question: f.question,
    category: f.category,
    description: f.description,
    rules: { yes: f.yes, no: f.no, invalid: f.invalid, ambiguity: f.ambiguity },
    source: { name: f.sourceName, url: f.sourceUrl },
    resolvesAt: utc(f.resolvesAt)?.toISOString() ?? "",
  });
  if (r.success) return { ok: true, data: r.data };
  const errors: Record<string, string> = {};
  for (const i of r.error.issues) errors[i.path.join(".")] ??= i.message;
  return { ok: false, errors };
}

const friendly: Record<string, string> = {
  question: "Write a question of 15 to 160 characters.",
  "rules.yes": "Describe the Yes condition in at least 20 characters.",
  "rules.no": "Describe the No condition in at least 20 characters.",
  "rules.invalid": "Describe when the market is Invalid in at least 20 characters.",
  "source.name": "Name the source.",
  "source.url": "Give an https:// link to the source.",
  resolvesAt: "Pick the date and time the event is evaluated.",
};

interface DraftResult {
  id: string;
  raw: string;
  hash: string;
  bytes: number;
  issues: QualityIssue[];
  similar: Array<{ id: number; question: string; score: number }>;
}

export function CreateWizard() {
  const { address, isConnected } = useAccount();
  const client = usePublicClient({ chainId: deployment.chainId });
  const { writeContractAsync } = useWriteContract();
  const musd = useMusd();
  const proto = useProtocolConfig();
  const tx = useTx();
  const qc = useQueryClient();
  const block = useBlock({ chainId: deployment.chainId, watch: true, query: { enabled: deployment.ready } });

  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>(empty);
  const [touched, setTouched] = useState(false);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [accept, setAccept] = useState({ rules: false, policy: false, liquidity: false });
  const [created, setCreated] = useState<{ id: bigint; hash: Hash } | null>(null);

  const resolvers = useQuery({
    queryKey: ["resolvers"],
    queryFn: () => apiGet<{ resolvers: Array<{ address: string }> }>("/api/resolvers"),
  });

  // Restore and autosave the draft (this browser only).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) setF({ ...empty, ...JSON.parse(saved) });
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(f));
    } catch {
      /* storage unavailable */
    }
  }, [f]);
  useEffect(() => {
    if (!f.resolver && resolvers.data?.resolvers[0]) setF((x) => ({ ...x, resolver: resolvers.data!.resolvers[0]!.address }));
  }, [resolvers.data, f.resolver]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setDraft(null);
  };
  const meta = useMemo(() => toMetadata(f), [f]);
  const err = (k: string) => (touched && !meta.ok ? (meta.errors[k] ? friendly[k] ?? meta.errors[k] : null) : null);

  const cfg = proto.config;
  const liquidity = (() => {
    try {
      return parseUnits(f.liquidity || "0", 18);
    } catch {
      return 0n;
    }
  })();
  const close = utc(f.closeAt);
  const resolves = utc(f.resolvesAt);
  // Durations are enforced against block.timestamp, so validate against chain time.
  const nowMs = block.data ? Number(block.data.timestamp) * 1000 : Date.now();

  // Step validity
  const step0 = f.question.trim().length >= 15 && f.question.trim().length <= 160;
  const step1 = meta.ok;
  const setupErrors: string[] = [];
  if (cfg) {
    if (!close) setupErrors.push("Pick when trading closes.");
    else {
      const secs = (close.getTime() - nowMs) / 1000;
      if (secs < cfg.minDuration + 300) setupErrors.push(`Trading must stay open at least ${formatDuration(cfg.minDuration)} (plus a 5-minute margin for confirmation).`);
      if (secs > cfg.maxDuration) setupErrors.push(`Trading can stay open at most ${formatDuration(cfg.maxDuration)}.`);
      if (resolves && close.getTime() > resolves.getTime()) setupErrors.push("Trading must close at or before the time the event is evaluated.");
    }
    if (liquidity < cfg.minLiquidity) setupErrors.push(`Seed at least ${formatMusd(cfg.minLiquidity)} MUSD of liquidity.`);
    if (!f.resolver) setupErrors.push("Pick a resolver.");
    if (musd.balance !== undefined && liquidity > musd.balance) setupErrors.push("Your MUSD balance is lower than the seed amount.");
  }
  const step2 = !!cfg && setupErrors.length === 0;
  const blocking = draft?.issues.filter((i) => i.blocking) ?? [];
  const step3 = !!draft && blocking.length === 0 && accept.rules && accept.policy && accept.liquidity;

  const pool = initialPool(liquidity > 0n ? liquidity : 1n, f.probBps);
  const creatorShareBps = cfg ? 10_000 - cfg.protocolFeeShareBps : 0;

  async function runReview() {
    if (!meta.ok || !close) return;
    setChecking(true);
    setDraftError(null);
    try {
      const r = await fetch("/api/market-drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metadata: meta.data, closeTime: close.toISOString(), author: address }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? "The draft check failed.");
      // Never trust the server's serialization: it must equal ours byte for byte.
      const local = serializeMetadata(meta.data);
      if (j.raw !== local || metadataHash(local) !== j.hash) throw new Error("The draft service returned different bytes than this app produced.");
      setDraft(j);
    } catch (e) {
      setDraftError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  function go(next: number) {
    setTouched(true);
    if (next > step) {
      if (step === 0 && !step0) return;
      if (step === 1 && !step1) return;
      if (step === 2 && !step2) return;
      if (step === 3 && !step3) return;
    }
    setTouched(false);
    setStep(next);
    if (next === 3) void runReview();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function publish() {
    if (!meta.ok || !close || !deployment.marketsAddress || !client || !cfg) return;
    const raw = serializeMetadata(meta.data);
    const args = {
      metadata: raw,
      closeTime: BigInt(Math.floor(close.getTime() / 1000)),
      resolver: f.resolver as `0x${string}`,
      initialLiquidity: liquidity,
      initialYesProbBps: f.probBps,
    };
    const allowance = await client
      .readContract({ address: deployment.musd, abi: erc20Abi, functionName: "allowance", args: [address!, deployment.marketsAddress] })
      .catch(() => 0n);
    if (allowance < liquidity) {
      const ok = await tx.run({
        label: "Approve MUSD",
        send: () =>
          writeContractAsync({
            address: deployment.musd,
            abi: erc20Abi,
            functionName: "approve",
            args: [deployment.marketsAddress!, liquidity],
            chainId: deployment.chainId,
          }),
      });
      if (!ok) return;
    }
    await tx.run({
      label: "Create market",
      validate: async () => {
        const [block, isRes, bal, paused] = await Promise.all([
          client.getBlock(),
          client.readContract({ address: deployment.marketsAddress!, abi: mezonkMarketsAbi, functionName: "isResolver", args: [args.resolver] }),
          client.readContract({ address: deployment.musd, abi: erc20Abi, functionName: "balanceOf", args: [address!] }),
          client.readContract({ address: deployment.marketsAddress!, abi: mezonkMarketsAbi, functionName: "paused" }),
        ]);
        if (paused) throw new Error("Market creation is paused right now.");
        if (!isRes) throw new Error("The chosen resolver is no longer approved. Pick another one.");
        if (bal < liquidity) throw new Error("Your MUSD balance is lower than the seed amount.");
        const left = Number(args.closeTime - block.timestamp);
        if (left < cfg.minDuration + 60) throw new Error("The close time is now too soon. Move it later and review again.");
        if (left > cfg.maxDuration) throw new Error("The close time is too far out.");
      },
      send: () =>
        writeContractAsync({
          address: deployment.marketsAddress!,
          abi: mezonkMarketsAbi,
          functionName: "createMarket",
          args: [args],
          chainId: deployment.chainId,
        }),
      onConfirmed: async (hash) => {
        const receipt = await client.getTransactionReceipt({ hash });
        const ev = parseEventLogs({ abi: mezonkMarketsAbi, logs: receipt.logs, eventName: "MarketCreated" })[0];
        if (ev) setCreated({ id: ev.args.marketId, hash });
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch {
          /* ignore */
        }
        void fetch(`/api/markets/${ev?.args.marketId}/refresh`, { method: "POST" });
        void qc.invalidateQueries({ queryKey: ["markets"] });
        void musd.refetch();
      },
    });
  }

  if (!deployment.ready) {
    return <Notice tone="warn" title="Market creation is unavailable">The market contract isn&apos;t deployed on this network.</Notice>;
  }

  if (created) {
    return (
      <div className="mx-auto max-w-xl space-y-5 py-8 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-yes-soft text-yes">
          <Check className="size-6" aria-hidden />
        </span>
        <h2 className="text-2xl font-semibold">Market #{created.id.toString()} is live</h2>
        <p className="text-ink-2">Its rules are committed on-chain and trading is open until {close && formatDateTime(close)}.</p>
        <div className="flex justify-center gap-2">
          <ButtonLink href={`/markets/${created.id}`}>Open the market</ButtonLink>
          <ButtonLink href="/portfolio" variant="secondary">Portfolio</ButtonLink>
        </div>
        <TxStatus state={tx.state} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <nav aria-label="Steps" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1">
          {STEPS.map((s, i) => (
            <li key={s} className="shrink-0">
              <button
                type="button"
                onClick={() => i < step && go(i)}
                disabled={i > step}
                aria-current={i === step ? "step" : undefined}
                className={cx(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-semibold",
                  i === step ? "bg-surface-2 text-ink" : i < step ? "text-ink-2 hover:text-ink" : "text-muted",
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    "tnum flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
                    i < step ? "border-yes bg-yes text-bg" : i === step ? "border-ink" : "border-line",
                  )}
                >
                  {i < step ? <Check className="size-3.5" /> : i + 1}
                </span>
                {s}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="min-w-0 max-w-2xl space-y-6">
        {!isConnected && (
          <Notice tone="info" title="You can draft without a wallet" action={<WalletButton />}>
            Connect when you&apos;re ready to publish. Creating a market seeds its pool with your MUSD.
          </Notice>
        )}
        {proto.paused && <Notice tone="warn" title="Market creation is paused">Drafts still save; publishing is disabled until the protocol is unpaused.</Notice>}

        {step === 0 && (
          <section className="space-y-5" aria-labelledby="s0">
            <h2 id="s0" className="text-xl font-semibold">What should people predict?</h2>
            <Field label="Question" htmlFor="q" hint={`${f.question.trim().length}/160. A yes/no question with a date, ending in "?".`} error={touched && !step0 ? friendly.question : null}>
              <input id="q" value={f.question} maxLength={160} onChange={(e) => set("question", e.target.value)} placeholder="Will BTC close above $150,000 on Coinbase on 31 Dec 2026 (UTC)?" className={inputClass} />
            </Field>
            <Field label="Category" htmlFor="cat">
              <select id="cat" value={f.category} onChange={(e) => set("category", e.target.value as Category)} className={inputClass}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{categoryLabel[c]}</option>
                ))}
              </select>
            </Field>
            <Field label="Context (optional)" htmlFor="desc" hint="Background traders should know. Up to 1,200 characters.">
              <textarea id="desc" rows={3} maxLength={1200} value={f.description} onChange={(e) => set("description", e.target.value)} className={inputClass} />
            </Field>
            {f.question.trim() && (
              <div className="rounded-lg border border-line bg-surface p-4">
                <p className="text-xs text-muted">Preview</p>
                <p className="mt-1 font-semibold">{f.question}</p>
                <div className="mt-3 flex items-center gap-3">
                  <span className="tnum text-sm font-semibold">{formatProb(f.probBps / 10_000)}</span>
                  <ProbabilityBar priceYes={f.probBps / 10_000} size="sm" className="flex-1" />
                </div>
              </div>
            )}
          </section>
        )}

        {step === 1 && (
          <section className="space-y-5" aria-labelledby="s1">
            <div className="space-y-1">
              <h2 id="s1" className="text-xl font-semibold">How will it be decided?</h2>
              <p className="text-sm text-ink-2">These rules are hashed into the contract and can never be edited. Write them so a stranger would reach the same answer.</p>
            </div>
            <Field label="Resolves Yes if" htmlFor="yes" error={err("rules.yes")} hint="Name the exact figure, threshold, date and timezone.">
              <textarea id="yes" rows={2} value={f.yes} onChange={(e) => set("yes", e.target.value)} placeholder="The Coinbase BTC-USD daily candle for 31 Dec 2026 UTC closes above 150,000.00 USD." className={inputClass} />
            </Field>
            <Field label="Resolves No if" htmlFor="no" error={err("rules.no")}>
              <textarea id="no" rows={2} value={f.no} onChange={(e) => set("no", e.target.value)} placeholder="That candle closes at or below 150,000.00 USD." className={inputClass} />
            </Field>
            <Field label="Invalid if" htmlFor="inv" error={err("rules.invalid")} hint="When the question can't be answered fairly. Invalid refunds 0.5 MUSD per share.">
              <textarea id="inv" rows={2} value={f.invalid} onChange={(e) => set("invalid", e.target.value)} placeholder="Coinbase publishes no daily candle for that date within 7 days." className={inputClass} />
            </Field>
            <Field label="Conflicting, late or revised data" htmlFor="amb" hint="What counts if sources disagree or the figure is revised.">
              <textarea id="amb" rows={2} value={f.ambiguity} onChange={(e) => set("ambiguity", e.target.value)} className={inputClass} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Primary source" htmlFor="sn" error={err("source.name")}>
                <input id="sn" value={f.sourceName} onChange={(e) => set("sourceName", e.target.value)} placeholder="Coinbase BTC-USD" className={inputClass} />
              </Field>
              <Field label="Source link" htmlFor="su" error={err("source.url")}>
                <input id="su" inputMode="url" value={f.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} placeholder="https://" className={inputClass} />
              </Field>
            </div>
            <Field label="Event evaluated at (UTC)" htmlFor="ra" error={err("resolvesAt")} hint="The moment the source is checked. Trading must close at or before this.">
              <input id="ra" type="datetime-local" value={f.resolvesAt} onChange={(e) => set("resolvesAt", e.target.value)} className={inputClass} />
            </Field>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-5" aria-labelledby="s2">
            <h2 id="s2" className="text-xl font-semibold">Market setup</h2>
            {!cfg ? (
              <Notice tone={proto.isError ? "error" : "info"}>{proto.isError ? "Couldn't read protocol settings from the chain." : "Reading protocol settings…"}</Notice>
            ) : (
              <>
                <Field label="Trading closes at (UTC)" htmlFor="ca" hint={`Between ${formatDuration(cfg.minDuration)} and ${formatDuration(cfg.maxDuration)} from now.`}>
                  <div className="flex flex-wrap gap-2">
                    <input id="ca" type="datetime-local" value={f.closeAt} onChange={(e) => set("closeAt", e.target.value)} className={cx(inputClass, "sm:max-w-xs")} />
                    {f.resolvesAt && (
                      <Button type="button" variant="secondary" size="md" onClick={() => set("closeAt", f.resolvesAt)}>
                        Same as evaluation time
                      </Button>
                    )}
                    {!f.closeAt && (
                      <Button type="button" variant="ghost" onClick={() => set("closeAt", toLocalUtc(new Date(nowMs + 7 * 86_400_000)))}>
                        In 7 days
                      </Button>
                    )}
                  </div>
                </Field>
                <Field label="Resolver" htmlFor="res" hint="Proposes the outcome after close. Only owner-approved resolvers can be chosen.">
                  {resolvers.data?.resolvers.length ? (
                    <select id="res" value={f.resolver} onChange={(e) => set("resolver", e.target.value)} className={cx(inputClass, "font-mono text-sm")}>
                      {resolvers.data.resolvers.map((r) => (
                        <option key={r.address} value={r.address}>{r.address}</option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-sm text-warn">{resolvers.isLoading ? "Loading approved resolvers…" : "No approved resolvers are indexed yet."}</p>
                  )}
                </Field>
                <Field label="Seed liquidity (MUSD)" htmlFor="liq" hint={`Minimum ${formatMusd(cfg.minLiquidity)}. Balance: ${musd.balance === undefined ? "connect a wallet" : formatMusd(musd.balance)}.`}>
                  <input id="liq" inputMode="decimal" value={f.liquidity} onChange={(e) => /^\d*\.?\d{0,18}$/.test(e.target.value) && set("liquidity", e.target.value)} className={cx(inputClass, "tnum sm:max-w-xs")} />
                </Field>
                <div className="space-y-2">
                  <label htmlFor="prob" className="flex items-center gap-1.5 text-sm font-semibold">
                    Starting chance of Yes: <span className="tnum">{formatProb(f.probBps / 10_000)}</span>
                    <Hint label="starting chance">Where trading starts. Set it to your honest estimate. Any side you lean toward is given to you as shares, so you start with a position.</Hint>
                  </label>
                  <input id="prob" type="range" min={500} max={9500} step={100} value={f.probBps} onChange={(e) => set("probBps", Number(e.target.value))} className="w-full accent-[var(--accent)]" />
                </div>

                <dl className="divide-y divide-line rounded-lg border border-line bg-surface px-4">
                  <KeyValue label="Pool starts with">{formatShares(pool.poolYes)} Yes · {formatShares(pool.poolNo)} No</KeyValue>
                  {(pool.lpYes > 0n || pool.lpNo > 0n) && (
                    <KeyValue label="You also receive outright">{pool.lpYes > 0n ? `${formatShares(pool.lpYes)} Yes` : `${formatShares(pool.lpNo)} No`} shares</KeyValue>
                  )}
                  <KeyValue label="Trading fee">{cfg.feeBps / 100}% per trade</KeyValue>
                  <KeyValue label="Your share of fees">{creatorShareBps / 100}% (protocol keeps {cfg.protocolFeeShareBps / 100}%)</KeyValue>
                  <KeyValue label="Resolver bond · challenge bond">{formatMusd(cfg.proposerBond)} · {formatMusd(cfg.disputeBond)} MUSD</KeyValue>
                  <KeyValue label="Proposal · challenge · arbitration windows">{formatDuration(cfg.proposalWindow)} · {formatDuration(cfg.challengeWindow)} · {formatDuration(cfg.arbitrationWindow)}</KeyValue>
                  <KeyValue label="Arbitrator"><Address address={cfg.arbitrator} label="Arbitrator" /></KeyValue>
                  <KeyValue label="Cost to you now">{formatMusd(liquidity)} MUSD + network fee</KeyValue>
                </dl>
                <p className="text-sm text-ink-2">
                  How the seed works: your MUSD mints Yes/No pairs that sit in the pool and trade against everyone. When the market settles you
                  withdraw what the pool holds at the final rate. If traders were right against the pool, that can be worth less than you put in.
                  Fees you earn are separate and claimable any time.
                </p>
                {touched && setupErrors.length > 0 && (
                  <Notice tone="error" title="Fix before continuing">
                    <ul className="list-disc pl-4">{setupErrors.map((e) => <li key={e}>{e}</li>)}</ul>
                  </Notice>
                )}
              </>
            )}
          </section>
        )}

        {step === 3 && (
          <section className="space-y-5" aria-labelledby="s3">
            <h2 id="s3" className="text-xl font-semibold">Review</h2>
            {checking && <Notice tone="info">Checking wording, duplicates and policy…</Notice>}
            {draftError && <Notice tone="error" title="Couldn't check the draft" action={<Button size="sm" variant="secondary" onClick={runReview}>Retry</Button>}>{draftError}</Notice>}
            {draft && (
              <>
                {draft.issues.map((i) => (
                  <Notice key={i.message} tone={i.blocking ? "error" : "warn"} title={i.blocking ? "Must fix" : "Worth a second look"}>{i.message}</Notice>
                ))}
                {draft.similar.length > 0 && (
                  <Notice tone="warn" title="Similar open markets exist">
                    <ul className="space-y-1">
                      {draft.similar.map((s) => (
                        <li key={s.id}><Link className="underline" href={`/markets/${s.id}`} target="_blank">{s.question}</Link></li>
                      ))}
                    </ul>
                    <p className="mt-1">Duplicates split liquidity. Make sure yours asks something different.</p>
                  </Notice>
                )}
                {!draft.issues.length && !draft.similar.length && <Notice tone="success">No wording, duplicate or policy problems found.</Notice>}

                {meta.ok && (
                  <dl className="divide-y divide-line rounded-lg border border-line bg-surface px-4">
                    <KeyValue label="Question">{meta.data.question}</KeyValue>
                    <KeyValue label="Category">{categoryLabel[meta.data.category]}</KeyValue>
                    <KeyValue label="Trading closes">{close && formatDateTime(close)}</KeyValue>
                    <KeyValue label="Event evaluated">{resolves && formatDateTime(resolves)}</KeyValue>
                    <KeyValue label="Source">{meta.data.source.name}</KeyValue>
                    <KeyValue label="Seed · starting chance">{formatMusd(liquidity)} MUSD · {formatProb(f.probBps / 10_000)}</KeyValue>
                    <KeyValue label="Resolver"><Address address={f.resolver} label="Resolver" /></KeyValue>
                    <KeyValue label="Rules hash"><span className="break-all font-mono text-xs">{draft.hash}</span></KeyValue>
                    <KeyValue label="Size on-chain">{draft.bytes.toLocaleString()} / {proto.maxMetadataBytes.toLocaleString()} bytes</KeyValue>
                  </dl>
                )}

                <fieldset className="space-y-3">
                  <legend className="text-sm font-semibold">Before you publish</legend>
                  {(
                    [
                    ["rules", "The rules above are complete and final. I understand they can't be changed after publishing."],
                    ["policy", "This market is not about violence or harm, does not target a private individual, and follows the MEZONK market policy."],
                    ["liquidity", "I understand my seed liquidity trades against everyone and I may withdraw less than I deposit."],
                    ] as Array<[keyof typeof accept, string]>
                  ).map(([k, label]) => (
                    <label key={k} className="flex items-start gap-3 text-sm">
                      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--ink)]" checked={accept[k]} onChange={(e) => setAccept((a) => ({ ...a, [k]: e.target.checked }))} />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>
              </>
            )}
          </section>
        )}

        {step === 4 && (
          <section className="space-y-5" aria-labelledby="s4">
            <h2 id="s4" className="text-xl font-semibold">Publish</h2>
            <p className="text-ink-2">
              {musd.allowance !== undefined && musd.allowance < liquidity ? "Two transactions: approve MUSD, then create the market." : "One transaction creates the market and seeds its pool."}
            </p>
            {!isConnected ? (
              <WalletButton block />
            ) : (
              <Button size="lg" className="w-full" loading={tx.busy} disabled={proto.paused || tx.busy} onClick={publish}>
                Create market · {formatMusd(liquidity)} MUSD
              </Button>
            )}
            <TxStatus state={tx.state} onRetry={publish} />
            {deployment.chain.testnet && musd.balance !== undefined && musd.balance < liquidity && (
              <p className="text-sm text-ink-2">
                Not enough MUSD. <a className="underline" href={TESTNET_FUNDING.borrowMusd} target="_blank" rel="noreferrer">Borrow testnet MUSD</a>.
              </p>
            )}
          </section>
        )}

        <div className="flex items-center justify-between border-t border-line pt-5">
          <Button variant="ghost" onClick={() => go(step - 1)} disabled={step === 0 || tx.busy}>Back</Button>
          {step < 4 && (
            <Button onClick={() => go(step + 1)} disabled={(step === 3 && !step3) || checking}>
              {step === 3 ? "Continue to publish" : "Continue"}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted">Drafts save automatically in this browser only. {liquidity > 0n && `Seed: ${formatUnits(liquidity, 18)} MUSD.`}</p>
      </div>
    </div>
  );
}
