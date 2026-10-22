"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useBlock } from "wagmi";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Field, KeyValue, Notice, inputClass } from "@/components/ui/primitives";
import { Select } from "@/components/ui/Select";
import { ImageUpload, type UploadedImage } from "@/components/ui/ImageUpload";
import { ProbabilityBar } from "@/components/markets/Probability";
import { WalletButton } from "@/components/wallet/WalletButton";
import { useMe, useSession } from "@/hooks/useSession";
import { apiAuth } from "@/lib/api/auth-client";
import { apiGet } from "@/lib/api/types";
import { deployment } from "@/lib/chain/config";
import type { ProposalDto } from "@/lib/governance/dto";
import { formatDateTime } from "@/lib/format";
import { CATEGORIES, categoryLabel, metadataSchema, type Category, type MarketMetadata, type QualityIssue } from "@/lib/market/metadata";

const STEPS = ["Question", "Outcome", "Resolution rules", "Sources", "Timing", "Disclosures", "Review", "Submit"] as const;
const DRAFT_KEY = "mezonk:suggest-draft";

interface Form {
  question: string;
  category: Category;
  description: string;
  projectId: string;
  outcomeType: "binary";
  yes: string;
  no: string;
  invalid: string;
  ambiguity: string;
  sourceName: string;
  sourceUrl: string;
  fallback: string;
  resolvesAt: string; // local "YYYY-MM-DDTHH:mm", read as UTC
  closeAt: string;
  launchWindow: string;
  liquidityPlan: string;
  sponsored: boolean;
  conflicts: string;
  rationale: string;
  references: Array<{ url: string; label: string }>;
  summary: string;
  cover: UploadedImage | null;
  contextImages: UploadedImage[];
}

const empty: Form = {
  question: "",
  category: "crypto",
  description: "",
  projectId: "",
  outcomeType: "binary",
  yes: "",
  no: "",
  invalid: "",
  ambiguity: "If the source revises the figure, the first value published at the evaluation time counts.",
  sourceName: "",
  sourceUrl: "",
  fallback: "",
  resolvesAt: "",
  closeAt: "",
  launchWindow: "",
  liquidityPlan: "",
  sponsored: false,
  conflicts: "",
  rationale: "",
  references: [{ url: "", label: "" }],
  summary: "",
  cover: null,
  contextImages: [],
};

const utc = (local: string) => (local ? new Date(`${local}:00Z`) : null);
const fromIso = (iso: string) => new Date(iso).toISOString().slice(0, 16);

/** Rebuilds the form from a saved proposal (editing after "changes requested", or resuming a server draft). */
function fromProposal(p: ProposalDto, media: Array<UploadedImage & { role: string }> = []): Form {
  const m = p.metadata;
  const fb = m.rules.ambiguity.match(/Fallback source: (.*)$/);
  return {
    ...empty,
    question: m.question,
    category: m.category,
    description: m.description,
    projectId: p.projectId ?? "",
    yes: m.rules.yes,
    no: m.rules.no,
    invalid: m.rules.invalid,
    ambiguity: fb ? m.rules.ambiguity.slice(0, fb.index).trim() : m.rules.ambiguity,
    fallback: fb?.[1] ?? "",
    sourceName: m.source.name,
    sourceUrl: m.source.url,
    resolvesAt: fromIso(m.resolvesAt),
    closeAt: fromIso(p.closeTime),
    launchWindow: p.launchWindow,
    liquidityPlan: p.liquidityPlan ?? "",
    sponsored: p.sponsored,
    conflicts: p.conflicts,
    rationale: p.rationale,
    references: p.references.length ? p.references : [{ url: "", label: "" }],
    summary: p.summary ?? "",
    cover: media.find((m) => m.role === "cover") ?? null,
    contextImages: media.filter((m) => m.role === "context"),
  };
}

function toMetadata(f: Form): { ok: true; data: MarketMetadata } | { ok: false; errors: Record<string, string> } {
  const ambiguity = [f.ambiguity.trim(), f.fallback.trim() ? `Fallback source: ${f.fallback.trim()}` : ""].filter(Boolean).join(" ");
  const r = metadataSchema.safeParse({
    v: 1,
    question: f.question,
    category: f.category,
    description: f.description,
    rules: { yes: f.yes, no: f.no, invalid: f.invalid, ambiguity },
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

interface CheckDto {
  issues: QualityIssue[];
  similarMarkets: Array<{ id: number; question: string }>;
  similarProposals: Array<{ id: string; question: string; status: string }>;
}

export function SuggestWizard() {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const editId = params.get("edit");
  const prefill = params.get("q");
  const { isConnected } = useAccount();
  const session = useSession();
  const me = useMe();
  const block = useBlock({ chainId: deployment.chainId, watch: true, query: { enabled: deployment.ready } });
  const nowMs = block.data ? Number(block.data.timestamp) * 1000 : Date.now();

  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>(empty);
  const [touched, setTouched] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [check, setCheck] = useState<CheckDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [accept, setAccept] = useState({ rules: false, policy: false, review: false });

  const projects = useQuery({ queryKey: ["projects"], queryFn: () => apiGet<{ projects: Array<{ id: string; name: string; status: string }> }>("/api/projects") });
  const myProjects = me.data?.roles.verifiedProjects ?? [];

  const [editStatus, setEditStatus] = useState<string | null>(null);
  useEffect(() => {
    if (editId) return; // editing a server copy: don't restore the browser draft over it
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const s = JSON.parse(saved);
        setF({ ...empty, ...s.form });
        if (s.draftId) setDraftId(s.draftId);
      }
    } catch {
      /* storage unavailable */
    }
    // A question typed on the landing page arrives as ?q= and wins over an older draft's question.
    if (prefill) setF((x) => ({ ...x, question: prefill.slice(0, 160) }));
  }, [editId, prefill]);
  // Edit mode: load the proposal once signed in (its private fields need the author's session).
  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    (async () => {
      if (!(await session.ensure())) return;
      try {
        const d = await apiAuth<{ proposal: ProposalDto; media: Array<UploadedImage & { role: string }> }>(`/api/proposals/${editId}`);
        if (cancelled) return;
        setF(fromProposal(d.proposal, d.media));
        setDraftId(d.proposal.id);
        setEditStatus(d.proposal.status);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, session.wallet]);
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ form: f, draftId }));
    } catch {
      /* storage unavailable */
    }
  }, [f, draftId]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setCheck(null);
  };
  const meta = useMemo(() => toMetadata(f), [f]);
  const err1 = (k: string) => (touched && !meta.ok ? (meta.errors[k] ? friendly[k] ?? meta.errors[k] : null) : null);
  const close = utc(f.closeAt);
  const resolves = utc(f.resolvesAt);

  const stepOk = [
    f.question.trim().length >= 15 && f.question.trim().length <= 160,
    true,
    meta.ok || (!meta.errors["rules.yes"] && !meta.errors["rules.no"] && !meta.errors["rules.invalid"] && f.yes.length >= 20 && f.no.length >= 20 && f.invalid.length >= 20),
    f.sourceName.trim().length >= 2 && /^https:\/\//.test(f.sourceUrl.trim()),
    !!close && !!resolves && close.getTime() <= resolves.getTime() && close.getTime() > nowMs + 3600_000,
    (!f.sponsored || f.conflicts.trim().length >= 10) && f.rationale.trim().length >= 20,
    !!check && check.issues.every((i) => !i.blocking) && accept.rules && accept.policy && accept.review,
    true,
  ];

  const payload = () =>
    meta.ok && close
      ? {
          metadata: meta.data,
          outcomeType: f.outcomeType,
          projectId: f.projectId || null,
          closeTime: close.toISOString(),
          launchWindow: f.launchWindow,
          liquidityPlan: f.liquidityPlan,
          conflicts: f.conflicts,
          rationale: f.rationale,
          references: f.references.filter((r) => r.url.trim()).map((r) => ({ url: r.url.trim(), label: r.label.trim() })),
          summary: f.summary.trim(),
          coverMediaId: f.cover?.id ?? null,
          contextMediaIds: f.contextImages.map((m) => m.id),
          sponsored: f.sponsored,
        }
      : null;

  /** Saves the draft server-side (creating it on first save) and returns the duplicate/policy check. */
  async function saveAndCheck() {
    const body = payload();
    if (!body) return;
    if (!(await session.ensure())) return;
    setSaving(true);
    setErr(null);
    try {
      let id = draftId;
      if (id) {
        try {
          await apiAuth(`/api/proposals/${id}`, { method: "PUT", body: JSON.stringify(body) });
        } catch (e) {
          // A locked (submitted) proposal can't be edited: start a fresh draft rather than fail silently.
          if (/current state|Only the author/.test((e as Error).message)) id = null;
          else throw e;
        }
      }
      if (!id) {
        const r = await apiAuth<{ id: string }>("/api/proposals", { method: "POST", body: JSON.stringify(body) });
        id = r.id;
        setDraftId(id);
      }
      const d = await apiAuth<{ check: CheckDto | null }>(`/api/proposals/${id}`);
      setCheck(d.check ?? { issues: [], similarMarkets: [], similarProposals: [] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    if (!draftId) return;
    setSaving(true);
    setErr(null);
    try {
      await apiAuth(`/api/proposals/${draftId}/actions`, { method: "POST", body: JSON.stringify({ action: "submit" }) });
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      // The proposal page may hold a cached copy from before this edit; drop it so it shows the new status at once.
      qc.removeQueries({ queryKey: ["proposal", draftId] });
      void qc.invalidateQueries({ queryKey: ["proposals"] });
      router.push(`/proposals/${draftId}?submitted=1`);
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }

  function go(next: number) {
    setTouched(true);
    if (next > step && !stepOk[step]) return;
    setTouched(false);
    setStep(next);
    if (next === 6) void saveAndCheck();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 16);

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
                className={cx("flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-semibold", i === step ? "bg-surface-2 text-ink" : i < step ? "text-ink-2 hover:text-ink" : "text-muted")}
              >
                <span aria-hidden className={cx("tnum flex size-6 shrink-0 items-center justify-center rounded-full border text-xs", i < step ? "border-success bg-success text-bg" : i === step ? "border-ink" : "border-line")}>
                  {i < step ? <Check className="size-3.5" /> : i + 1}
                </span>
                {s}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="min-w-0 max-w-2xl space-y-6">
        {editStatus === "changes_requested" && (
          <Notice tone="warn" title="Editing after a change request">
            The curator&apos;s reason is on the <Link href={`/proposals/${editId}`} className="underline">suggestion page</Link>. Resubmitting sends it back to the queue as a new version.
          </Notice>
        )}
        {editId && err && !editStatus && <Notice tone="error" title="Couldn't load the suggestion to edit">{err}</Notice>}
        <Notice tone="info" title="Suggestions are reviewed before they go live">
          Any wallet can suggest a market. A curator checks the rules against the market policy, and an approved creator publishes it
          with seed liquidity. You&apos;ll see every decision and reason on your suggestion&apos;s page.
        </Notice>

        {step === 0 && (
          <section className="space-y-5" aria-labelledby="s0">
            <h2 id="s0" className="text-xl font-semibold">What should people predict?</h2>
            <Field label="Question" htmlFor="q" hint={`${f.question.trim().length}/160. A yes/no question with a date, ending in "?".`} error={touched && !stepOk[0] ? friendly.question : null}>
              <input id="q" value={f.question} maxLength={160} onChange={(e) => set("question", e.target.value)} placeholder="Will Mezo mainnet TVL exceed $500M on 31 Mar 2027 (UTC)?" className={inputClass} />
            </Field>
            <Field label="Category" htmlFor="cat">
              <Select id="cat" value={f.category} onChange={(e) => set("category", e.target.value as Category)} className="w-full">
                {CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel[c]}</option>)}
              </Select>
            </Field>
            <Field label="One-line summary (optional)" htmlFor="sum" hint={`${f.summary.length}/280. Shown under the question on the market page. Not part of the rules.`}>
              <input id="sum" value={f.summary} maxLength={280} onChange={(e) => set("summary", e.target.value)} className={inputClass} />
            </Field>
            <Field label="Context (optional)" htmlFor="desc" hint="Background traders should know. Up to 1,200 characters. Becomes part of the on-chain rules.">
              <textarea id="desc" rows={3} maxLength={1200} value={f.description} onChange={(e) => set("description", e.target.value)} className={inputClass} />
            </Field>
            <ImageUpload kind="cover" label="Cover image (optional)" value={f.cover} onChange={(v) => set("cover", v)} hint="Shown at the top of the market page. PNG, JPEG, WebP or GIF up to 5 MB. Sign-in needed to upload." />
          </section>
        )}

        {step === 1 && (
          <section className="space-y-5" aria-labelledby="s1">
            <h2 id="s1" className="text-xl font-semibold">Outcome type and project</h2>
            <Field label="Outcome type" htmlFor="ot" hint="Binary Yes/No is the only type supported today.">
              <Select id="ot" value={f.outcomeType} disabled className="w-full"><option value="binary">Yes / No</option></Select>
            </Field>
            <Field label="Related project (optional)" htmlFor="proj" hint="Markets about a project show that project. If you represent it, say so in Disclosures.">
              <Select id="proj" value={f.projectId} onChange={(e) => set("projectId", e.target.value)} className="w-full">
                <option value="">None</option>
                {(projects.data?.projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.status === "verified" ? "" : " (unverified)"}{myProjects.includes(p.id) ? " · you represent this" : ""}</option>
                ))}
              </Select>
            </Field>
            <p className="text-sm text-ink-2">
              Don&apos;t see your project? <Link href="/projects/new" className="underline">Register it</Link> and a curator can verify your wallet as a representative.
            </p>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-5" aria-labelledby="s2">
            <div className="space-y-1">
              <h2 id="s2" className="text-xl font-semibold">How will it be decided?</h2>
              <p className="text-sm text-ink-2">Written so a stranger would reach the same answer. Once published, these are hashed on-chain and can never be edited.</p>
            </div>
            <Field label="Resolves Yes if" htmlFor="yes" error={err1("rules.yes")} hint="Name the exact figure, threshold, date and timezone.">
              <textarea id="yes" rows={2} value={f.yes} onChange={(e) => set("yes", e.target.value)} placeholder="DefiLlama's Mezo chain page shows TVL above 500,000,000 USD at 31 Mar 2027 00:00 UTC." className={inputClass} />
            </Field>
            <Field label="Resolves No if" htmlFor="no" error={err1("rules.no")}>
              <textarea id="no" rows={2} value={f.no} onChange={(e) => set("no", e.target.value)} placeholder="That page shows TVL at or below 500,000,000 USD at that time." className={inputClass} />
            </Field>
            <Field label="Invalid if" htmlFor="inv" error={err1("rules.invalid")} hint="When the question can't be answered fairly. Invalid refunds 0.5 MUSD per share.">
              <textarea id="inv" rows={2} value={f.invalid} onChange={(e) => set("invalid", e.target.value)} placeholder="DefiLlama stops tracking Mezo, or shows no figure for 7 days after the date." className={inputClass} />
            </Field>
            <Field label="Conflicting, late or revised data" htmlFor="amb" hint="What counts if sources disagree or the figure is revised.">
              <textarea id="amb" rows={2} value={f.ambiguity} onChange={(e) => set("ambiguity", e.target.value)} className={inputClass} />
            </Field>
          </section>
        )}

        {step === 3 && (
          <section className="space-y-5" aria-labelledby="s3">
            <h2 id="s3" className="text-xl font-semibold">Sources</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Primary source" htmlFor="sn" error={err1("source.name")}>
                <input id="sn" value={f.sourceName} onChange={(e) => set("sourceName", e.target.value)} placeholder="DefiLlama, Mezo chain" className={inputClass} />
              </Field>
              <Field label="Source link" htmlFor="su" error={err1("source.url")}>
                <input id="su" inputMode="url" value={f.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} placeholder="https://" className={inputClass} />
              </Field>
            </div>
            <Field label="Fallback source and rule (optional)" htmlFor="fb" hint="Used only if the primary source is unavailable. Say which one and how.">
              <textarea id="fb" rows={2} value={f.fallback} onChange={(e) => set("fallback", e.target.value)} placeholder="If DefiLlama is down, use the Mezo explorer's TVL figure at the same time." className={inputClass} />
            </Field>
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">Context images (optional, up to 6)</legend>
              <p className="text-sm text-muted">Screenshots or charts that help traders. They illustrate; only the written rules decide the outcome.</p>
              <div className="flex flex-wrap gap-3">
                {f.contextImages.map((img, i) => (
                  <ImageUpload key={img.id} kind="context" shape="square" label={`Image ${i + 1}`} value={img} onChange={(v) => set("contextImages", v ? f.contextImages.map((x, j) => (j === i ? v : x)) : f.contextImages.filter((_, j) => j !== i))} />
                ))}
                {f.contextImages.length < 6 && (
                  <ImageUpload key={`new-${f.contextImages.length}`} kind="context" shape="square" label="Add image" value={null} onChange={(v) => v && set("contextImages", [...f.contextImages, v])} />
                )}
              </div>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">Supporting references (optional)</legend>
              {f.references.map((r, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_10rem]">
                  <input aria-label={`Reference ${i + 1}`} placeholder="https://" value={r.url} onChange={(e) => set("references", f.references.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} className={inputClass} />
                  <input aria-label={`Label ${i + 1}`} placeholder="Label" maxLength={80} value={r.label} onChange={(e) => set("references", f.references.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className={inputClass} />
                </div>
              ))}
              {f.references.length < 8 && (
                <button type="button" className="text-sm font-semibold text-ink-2 hover:text-ink" onClick={() => set("references", [...f.references, { url: "", label: "" }])}>+ Add reference</button>
              )}
            </fieldset>
          </section>
        )}

        {step === 4 && (
          <section className="space-y-5" aria-labelledby="s4">
            <h2 id="s4" className="text-xl font-semibold">Timing</h2>
            <Field label="Event evaluated at (UTC)" htmlFor="ra" error={err1("resolvesAt")} hint="The moment the source is checked. All times are UTC.">
              <input id="ra" type="datetime-local" value={f.resolvesAt} onChange={(e) => set("resolvesAt", e.target.value)} className={cx(inputClass, "sm:max-w-xs")} />
            </Field>
            <Field label="Trading closes at (UTC)" htmlFor="ca" hint="At or before the evaluation time, and at least an hour from now." error={touched && !stepOk[4] && f.closeAt ? "Must be at least 1 hour ahead and not after the evaluation time." : null}>
              <div className="flex flex-wrap gap-2">
                <input id="ca" type="datetime-local" value={f.closeAt} onChange={(e) => set("closeAt", e.target.value)} className={cx(inputClass, "sm:max-w-xs")} />
                {f.resolvesAt && <Button type="button" variant="secondary" onClick={() => set("closeAt", f.resolvesAt)}>Same as evaluation</Button>}
                {!f.closeAt && <Button type="button" variant="ghost" onClick={() => set("closeAt", fmt(nowMs + 7 * 86_400_000))}>In 7 days</Button>}
              </div>
            </Field>
            <Field label="Expected launch window (optional)" htmlFor="lw" hint="When it should go live, if that matters (e.g. 'before the announcement on 12 Nov').">
              <input id="lw" maxLength={200} value={f.launchWindow} onChange={(e) => set("launchWindow", e.target.value)} className={inputClass} />
            </Field>
            <Field label="Liquidity (optional)" htmlFor="lp" hint="Who you expect to commit seed orders, and roughly how much. The market only goes live once funded orders meet its launch policy.">
              <textarea id="lp" rows={2} maxLength={600} value={f.liquidityPlan} onChange={(e) => set("liquidityPlan", e.target.value)} className={inputClass} />
            </Field>
          </section>
        )}

        {step === 5 && (
          <section className="space-y-5" aria-labelledby="s5">
            <h2 id="s5" className="text-xl font-semibold">Disclosures</h2>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--ink)]" checked={f.sponsored} onChange={(e) => set("sponsored", e.target.checked)} />
              <span>This market is proposed or sponsored by the project it measures, or I have a stake in its outcome.</span>
            </label>
            <Field label={f.sponsored ? "Describe the relationship" : "Conflicts of interest (optional)"} htmlFor="ci" hint="Shown publicly on the market. Reviewers reject undisclosed conflicts." error={touched && !stepOk[5] ? "Describe the relationship in at least 10 characters." : null}>
              <textarea id="ci" rows={3} maxLength={600} value={f.conflicts} onChange={(e) => set("conflicts", e.target.value)} className={inputClass} />
            </Field>
            <Field label="Why is this market useful?" htmlFor="rat" hint="At least 20 characters. Helps reviewers prioritise." error={touched && f.rationale.trim().length < 20 ? "Explain in at least 20 characters." : null}>
              <textarea id="rat" rows={3} maxLength={1200} value={f.rationale} onChange={(e) => set("rationale", e.target.value)} className={inputClass} />
            </Field>
          </section>
        )}

        {step === 6 && (
          <section className="space-y-5" aria-labelledby="s6">
            <h2 id="s6" className="text-xl font-semibold">Review</h2>
            {!isConnected && <Notice tone="info" title="Connect a wallet to save and check your draft" action={<WalletButton />}>Your draft is kept in this browser until then.</Notice>}
            {isConnected && !session.signedIn && (
              <Notice tone="info" title="Sign in to save your suggestion" action={<Button size="sm" loading={session.busy} onClick={saveAndCheck}>Sign in and check</Button>}>
                One free signature proves you control this wallet. No transaction.
              </Notice>
            )}
            {session.error && <Notice tone="error">{session.error}</Notice>}
            {saving && <Notice tone="info">Saving and checking for duplicates and policy issues…</Notice>}
            {err && <Notice tone="error" title="Couldn't check the draft" action={<Button size="sm" variant="secondary" onClick={saveAndCheck}>Retry</Button>}>{err}</Notice>}
            {check && (
              <>
                {check.issues.map((i) => <Notice key={i.message} tone={i.blocking ? "error" : "warn"} title={i.blocking ? "Must fix" : "Worth a second look"}>{i.message}</Notice>)}
                {(check.similarMarkets.length > 0 || check.similarProposals.length > 0) && (
                  <Notice tone="warn" title="Similar questions already exist">
                    <ul className="space-y-1">
                      {check.similarMarkets.map((m) => <li key={m.id}><Link className="underline" href={`/markets/${m.id}`} target="_blank">{m.question}</Link> (live)</li>)}
                      {check.similarProposals.map((p) => <li key={p.id}><Link className="underline" href={`/proposals/${p.id}`} target="_blank">{p.question}</Link> ({p.status.replace("_", " ")})</li>)}
                    </ul>
                    <p className="mt-1">Reviewers reject duplicates. Make sure yours asks something different.</p>
                  </Notice>
                )}
                {check.issues.length === 0 && check.similarMarkets.length === 0 && check.similarProposals.length === 0 && <Notice tone="success">No wording, duplicate or policy problems found.</Notice>}
              </>
            )}

            {meta.ok && (
              <div className="space-y-4">
                <p className="text-sm font-semibold">How it will appear</p>
                <div className="rounded-lg border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
                    <span>{categoryLabel[meta.data.category]}</span>
                    <span>Suggestion</span>
                    {f.sponsored && <span className="text-warn">Proposed by the project measured</span>}
                  </div>
                  <p className="mt-1 font-semibold">{meta.data.question}</p>
                  <div className="mt-3 flex items-center gap-3">
                    <span className="tnum text-sm font-semibold">50%</span>
                    <ProbabilityBar priceYes={0.5} size="sm" className="flex-1" />
                  </div>
                  <p className="mt-2 text-xs text-muted">There are no opening odds: the first prices come from real seed orders.</p>
                </div>
                <dl className="divide-y divide-line rounded-lg border border-line bg-surface px-4">
                  <KeyValue label="Trading closes">{close && formatDateTime(close)}</KeyValue>
                  <KeyValue label="Event evaluated">{resolves && formatDateTime(resolves)}</KeyValue>
                  <KeyValue label="Source">{meta.data.source.name}</KeyValue>
                  {f.projectId && <KeyValue label="Project">{f.projectId}</KeyValue>}
                </dl>
              </div>
            )}

            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold">Before you submit</legend>
              {(
                [
                  ["rules", "The rules are complete. If approved and published they can't be changed."],
                  ["policy", "This market follows the market policy: no violence or harm, no private individuals, nothing illegal."],
                  ["review", "I understand a curator may reject this or ask for changes, and that an approved creator decides whether to seed and publish it."],
                ] as Array<[keyof typeof accept, string]>
              ).map(([k, label]) => (
                <label key={k} className="flex items-start gap-3 text-sm">
                  <input type="checkbox" className="mt-0.5 size-4 accent-[var(--ink)]" checked={accept[k]} onChange={(e) => setAccept((a) => ({ ...a, [k]: e.target.checked }))} />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
          </section>
        )}

        {step === 7 && (
          <section className="space-y-5" aria-labelledby="s7">
            <h2 id="s7" className="text-xl font-semibold">Submit for review</h2>
            <p className="text-ink-2">
              Your suggestion goes into the public review queue. You can edit it until a curator picks it up, and withdraw it at any time before approval.
            </p>
            {me.data?.roles.creator && (
              <Notice tone="info" title="You're an approved creator">
                Review still applies: a different curator must approve this before you can publish it. You&apos;ll find the publish button on the suggestion page once it&apos;s approved.
              </Notice>
            )}
            {err && <Notice tone="error">{err}</Notice>}
            <Button size="lg" className="w-full" loading={saving} onClick={submit} disabled={!draftId}>Submit for review</Button>
          </section>
        )}

        <div className="flex items-center justify-between border-t border-line pt-5">
          <Button variant="ghost" onClick={() => go(step - 1)} disabled={step === 0 || saving}>Back</Button>
          {step < 7 && (
            <Button onClick={() => go(step + 1)} disabled={step === 6 ? !stepOk[6] : false}>
              {step === 6 ? "Continue" : "Continue"}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted">
          Drafts save in this browser, and on the server once you sign in. <Link href="/proposals?mine=1" className="underline">Your suggestions</Link>
        </p>
        {!deployment.ready && <p className="text-xs text-warn">The market contract isn&apos;t deployed on this network, so approved suggestions can&apos;t be published yet.</p>}
        <ButtonLink href="/docs#creators" variant="ghost" size="sm">How review works</ButtonLink>
      </div>
    </div>
  );
}
