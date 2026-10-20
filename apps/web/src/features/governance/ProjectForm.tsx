"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/Button";
import { Field, Notice, inputClass } from "@/components/ui/primitives";
import { WalletButton } from "@/components/wallet/WalletButton";
import { useSession } from "@/hooks/useSession";
import { apiAuth } from "@/lib/api/auth-client";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export function ProjectForm() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const session = useSession();
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const finalId = idTouched ? id : slug(name);
  const valid = name.trim().length >= 2 && /^[a-z0-9-]{2,40}$/.test(finalId) && (!website || /^https:\/\//.test(website)) && (!proofUrl || /^https:\/\//.test(proofUrl));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      if (!(await session.ensure())) return;
      await apiAuth("/api/projects", {
        method: "POST",
        body: JSON.stringify({ id: finalId, name: name.trim(), website: website || undefined, description: description || undefined, proofUrl: proofUrl || undefined }),
      });
      setDone(true);
      setTimeout(() => router.push("/suggest"), 1500);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Notice tone="success" title="Project registered">Your representative claim is pending. A curator will check the proof link. Taking you back to the suggestion form…</Notice>;

  return (
    <form onSubmit={submit} className="max-w-xl space-y-5">
      {!isConnected && <Notice tone="info" title="Connect the wallet that will represent the project" action={<WalletButton />} />}
      <Field label="Project name" htmlFor="pn">
        <input id="pn" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={inputClass} required />
      </Field>
      <Field label="Identifier" htmlFor="pid" hint="Lowercase letters, numbers and dashes. Used in links." error={finalId && !/^[a-z0-9-]{2,40}$/.test(finalId) ? "Only a-z, 0-9 and dashes, 2 to 40 characters." : null}>
        <input id="pid" value={finalId} onChange={(e) => { setIdTouched(true); setId(e.target.value); }} className={`${inputClass} font-mono text-sm`} />
      </Field>
      <Field label="Website" htmlFor="pw" hint="https:// only.">
        <input id="pw" inputMode="url" value={website} onChange={(e) => setWebsite(e.target.value.trim())} placeholder="https://" className={inputClass} />
      </Field>
      <Field label="What the project does" htmlFor="pd">
        <textarea id="pd" rows={3} maxLength={600} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Proof you represent it" htmlFor="pp" hint="A public page controlled by the project that mentions this wallet address, e.g. a docs page, a signed post or an ENS/DNS record.">
        <input id="pp" inputMode="url" value={proofUrl} onChange={(e) => setProofUrl(e.target.value.trim())} placeholder="https://" className={inputClass} />
      </Field>
      {session.error && <Notice tone="error">{session.error}</Notice>}
      {err && <Notice tone="error">{err}</Notice>}
      <Button type="submit" size="lg" loading={busy || session.busy} disabled={!valid || !isConnected}>Register and claim</Button>
    </form>
  );
}
