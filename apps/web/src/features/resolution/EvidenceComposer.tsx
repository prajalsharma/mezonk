"use client";

import { Plus, Trash2 } from "lucide-react";
import { useId } from "react";
import { Field, inputClass } from "@/components/ui/primitives";
import { cx } from "@/components/ui/cx";

export interface LinkDraft {
  url: string;
  label: string;
  sha256: string;
}

export interface EvidenceDraft {
  summary: string;
  links: LinkDraft[];
}

export const emptyEvidence = (): EvidenceDraft => ({ summary: "", links: [{ url: "", label: "", sha256: "" }] });

export function validateEvidence(d: EvidenceDraft): string | null {
  if (d.summary.trim().length < 20) return "Explain your reasoning in at least 20 characters.";
  const links = d.links.filter((l) => l.url.trim());
  if (!links.length) return "Add at least one evidence link.";
  for (const l of links) {
    try {
      const u = new URL(l.url.trim());
      if (u.protocol !== "https:" || u.username || u.password) return `Use a plain https:// link: ${l.url}`;
    } catch {
      return `Not a valid link: ${l.url}`;
    }
    if (l.sha256 && !/^[0-9a-fA-F]{64}$/.test(l.sha256.trim())) return "A SHA-256 must be 64 hex characters.";
  }
  return null;
}

/** Summary + up to five links. The result is serialized, hashed and committed on-chain. */
export function EvidenceComposer({
  value,
  onChange,
  summaryLabel,
  summaryHint,
}: {
  value: EvidenceDraft;
  onChange: (v: EvidenceDraft) => void;
  summaryLabel: string;
  summaryHint: string;
}) {
  const id = useId();
  const setLink = (i: number, patch: Partial<LinkDraft>) =>
    onChange({ ...value, links: value.links.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  return (
    <div className="space-y-4">
      <Field label={summaryLabel} hint={summaryHint} htmlFor={`${id}-summary`}>
        <textarea
          id={`${id}-summary`}
          rows={4}
          maxLength={2000}
          value={value.summary}
          onChange={(e) => onChange({ ...value, summary: e.target.value })}
          className={inputClass}
        />
      </Field>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Evidence links</legend>
        <p className="text-sm text-muted">
          https only. Prefer stable sources (official pages, archived snapshots). A link can change after you submit it;
          add the file&apos;s SHA-256 if you want to pin exact content.
        </p>
        {value.links.map((l, i) => (
          <div key={i} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_10rem]">
            <input
              aria-label={`Evidence link ${i + 1}`}
              placeholder="https://"
              inputMode="url"
              value={l.url}
              onChange={(e) => setLink(i, { url: e.target.value })}
              className={inputClass}
            />
            <input aria-label={`Label for link ${i + 1}`} placeholder="Label (optional)" maxLength={80} value={l.label} onChange={(e) => setLink(i, { label: e.target.value })} className={inputClass} />
            <input
              aria-label={`SHA-256 for link ${i + 1} (optional)`}
              placeholder="SHA-256 of the file (optional)"
              value={l.sha256}
              onChange={(e) => setLink(i, { sha256: e.target.value })}
              className={cx(inputClass, "font-mono text-xs sm:col-span-1")}
            />
            {value.links.length > 1 && (
              <button
                type="button"
                onClick={() => onChange({ ...value, links: value.links.filter((_, j) => j !== i) })}
                className="inline-flex items-center gap-1 justify-self-start text-sm text-ink-2 hover:text-danger"
              >
                <Trash2 className="size-3.5" /> Remove
              </button>
            )}
          </div>
        ))}
        {value.links.length < 5 && (
          <button
            type="button"
            onClick={() => onChange({ ...value, links: [...value.links, { url: "", label: "", sha256: "" }] })}
            className="inline-flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink"
          >
            <Plus className="size-3.5" /> Add another link
          </button>
        )}
      </fieldset>
    </div>
  );
}
