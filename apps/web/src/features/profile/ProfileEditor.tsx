"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ImageUpload, type UploadedImage } from "@/components/ui/ImageUpload";
import { Field, inputClass } from "@/components/ui/primitives";
import { useMe } from "@/hooks/useSession";
import { apiAuth } from "@/lib/api/auth-client";
import { usernameProblem } from "@/lib/profile/username";

/** Create or edit the signed-in wallet's profile. The server re-validates everything. */
export function ProfileEditor({ open, onClose, firstRun = false }: { open: boolean; onClose: () => void; firstRun?: boolean }) {
  const me = useMe();
  const qc = useQueryClient();
  const p = me.data?.profile;
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState<UploadedImage | null>(null);
  const [check, setCheck] = useState<{ available: boolean; problem: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUsername(p?.username ?? "");
    setDisplayName(p?.displayName ?? "");
    setBio(p?.bio ?? "");
    setAvatar(p?.avatarUrl ? { id: "", url: p.avatarUrl, width: 0, height: 0 } : null);
    setErr(null);
  }, [open, p]);

  useEffect(() => {
    const u = username.trim();
    if (!u || u.toLowerCase() === p?.username) return setCheck(null);
    const local = usernameProblem(u);
    if (local) return setCheck({ available: false, problem: local });
    const t = setTimeout(async () => {
      try {
        setCheck(await apiAuth(`/api/profile/check?username=${encodeURIComponent(u)}`));
      } catch {
        setCheck(null);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [username, p?.username]);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      // The existing avatar has no id here: omitting the field keeps it; null removes it; an id replaces it.
      const body: Record<string, unknown> = { username, displayName, bio };
      if (!avatar) body.avatarMediaId = null;
      else if (avatar.id) body.avatarMediaId = avatar.id;
      await apiAuth("/api/profile", { method: "PUT", body: JSON.stringify(body) });
      await qc.invalidateQueries({ queryKey: ["me"] });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const blocked = !username || !displayName || (check !== null && !check.available);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={firstRun ? "Set up your profile" : "Edit profile"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{firstRun ? "Later" : "Cancel"}</Button>
          <Button onClick={save} loading={busy} disabled={blocked}>Save profile</Button>
        </>
      }
    >
      <div className="space-y-5">
        {firstRun && <p className="text-sm text-ink-2">Pick a name people will see on your markets and comments. Your wallet stays your identity; you can change the name later.</p>}
        <ImageUpload kind="avatar" shape="round" label="Avatar" value={avatar} onChange={setAvatar} hint="PNG, JPEG, WebP or GIF, up to 5 MB. Cropped to a square." />
        <Field label="Display name" htmlFor="pe-dn" hint="2–40 characters.">
          <input id="pe-dn" value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} className={inputClass} autoComplete="nickname" />
        </Field>
        <Field label="Username" htmlFor="pe-un" error={check && !check.available ? check.problem : null} hint={check?.available ? "Available." : "3–20 letters, numbers or underscores. Your profile lives at /u/username."}>
          <div className="relative">
            <span className="mono pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">@</span>
            <input id="pe-un" value={username} maxLength={20} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))} className={`${inputClass} pl-8`} autoCapitalize="none" spellCheck={false} />
          </div>
        </Field>
        <Field label="Bio (optional)" htmlFor="pe-bio" hint={`${bio.length}/280`}>
          <textarea id="pe-bio" rows={3} maxLength={280} value={bio} onChange={(e) => setBio(e.target.value)} className={inputClass} />
        </Field>
        {err && <p className="text-sm text-danger" role="alert">{err}</p>}
      </div>
    </Dialog>
  );
}
