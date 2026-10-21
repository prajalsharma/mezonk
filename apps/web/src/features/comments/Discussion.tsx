"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { EyeOff, Flag, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useAccount } from "wagmi";
import { UserChip, type PublicPerson } from "@/components/profile/UserChip";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Notice, Skeleton, inputClass } from "@/components/ui/primitives";
import { WalletButton } from "@/components/wallet/WalletButton";
import { useSession } from "@/hooks/useSession";
import { apiAuth } from "@/lib/api/auth-client";
import { COMMENT_MAX } from "@/lib/comments/text";
import { relativeTime } from "@/lib/format";

interface CommentDto {
  id: number;
  author: PublicPerson;
  body: string | null;
  status: "visible" | "hidden" | "deleted";
  createdAt: string;
  editedAt: string | null;
  moderationReason: string | null;
  canEdit: boolean;
  canDelete: boolean;
  canModerate: boolean;
}
interface Page {
  items: CommentDto[];
  nextCursor: number | null;
  total: number;
}

/**
 * Persistent discussion for one market, keyed by the numeric market id. Bodies are plain text rendered
 * by React (no HTML is ever interpreted). Writes wait for the server; nothing is shown as posted until it is.
 */
export function Discussion({ marketId }: { marketId: number }) {
  const qc = useQueryClient();
  const { isConnected } = useAccount();
  const session = useSession();
  const key = ["comments", marketId, session.signedIn];
  const q = useInfiniteQuery({
    queryKey: key,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => apiAuth<Page>(`/api/markets/${marketId}/comments${pageParam ? `?before=${pageParam}` : ""}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 30_000,
  });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["comments", marketId] });

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      if (!(await session.ensure())) return;
      await apiAuth(`/api/markets/${marketId}/comments`, { method: "POST", body: JSON.stringify({ body: draft }) });
      setDraft("");
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const total = q.data?.pages[0]?.total ?? 0;
  return (
    <section id="discussion" aria-labelledby="discussion-h" className="panel scroll-mt-32 space-y-5 p-5 md:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="discussion-h" className="text-xl font-semibold">Discussion</h2>
        <span className="mono text-xs text-muted">{total} comment{total === 1 ? "" : "s"}</span>
      </div>

      {!isConnected ? (
        <Notice tone="info" title="Connect a wallet to join the discussion" action={<WalletButton />}>Reading is open to everyone.</Notice>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor={`c-${marketId}`} className="sr-only">Write a comment</label>
          <textarea
            id={`c-${marketId}`}
            rows={3}
            maxLength={COMMENT_MAX}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={session.signedIn ? "Share evidence or reasoning. Be specific; link sources." : "Sign in to comment. One free signature, no transaction."}
            className={inputClass}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="mono text-xs text-muted">{draft.length}/{COMMENT_MAX.toLocaleString()} · plain text</span>
            <Button type="submit" size="sm" loading={busy || session.busy} disabled={!draft.trim()}>
              {session.signedIn ? "Post comment" : "Sign in and post"}
            </Button>
          </div>
          {(err || session.error) && <p className="text-sm text-danger" role="alert">{err ?? session.error}</p>}
        </form>
      )}

      {q.isLoading ? (
        <div className="space-y-4" aria-busy>
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : q.isError ? (
        <Notice tone="error" title="Couldn't load comments" action={<Button size="sm" variant="secondary" onClick={() => q.refetch()}>Retry</Button>} />
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No comments yet. Start the discussion with evidence or a question about the rules.</p>
      ) : (
        <ol className="divide-y divide-line">
          {items.map((c) => <CommentItem key={c.id} c={c} onChanged={refresh} />)}
        </ol>
      )}
      {q.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="secondary" size="sm" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Load older comments</Button>
        </div>
      )}
    </section>
  );
}

function CommentItem({ c, onChanged }: { c: CommentDto; onChanged: () => Promise<unknown> }) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(c.body ?? "");
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    setMenu(false);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const ask = (label: string) => window.prompt(label)?.trim() ?? "";

  if (c.status === "deleted") {
    return <li className="py-4 text-sm italic text-muted">Comment deleted by its author.</li>;
  }
  return (
    <li className={cx("space-y-2 py-4", c.status === "hidden" && "opacity-70")}>
      <div className="flex items-start justify-between gap-3">
        <UserChip person={c.author} size={30} sub={<>{relativeTime(new Date(c.createdAt))}{c.editedAt ? " · edited" : ""}</>} />
        {(
          <div className="relative">
            <button type="button" aria-label="Comment actions" aria-expanded={menu} onClick={() => setMenu((m) => !m)} className="rounded-sm p-1 text-muted hover:bg-surface-2 hover:text-ink">
              <MoreHorizontal className="size-4" />
            </button>
            {menu && (
              <div role="menu" className="glass absolute right-0 top-8 z-[var(--z-dropdown)] w-48 rounded-md border p-1 text-sm shadow-3">
                {c.canEdit && (
                  <button role="menuitem" type="button" onClick={() => { setMenu(false); setEditing(true); }} className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 hover:bg-surface-2"><Pencil className="size-3.5" /> Edit</button>
                )}
                {c.canDelete && (
                  <button role="menuitem" type="button" onClick={() => window.confirm("Delete this comment?") && run(() => apiAuth(`/api/comments/${c.id}`, { method: "DELETE" }))} className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 hover:bg-surface-2"><Trash2 className="size-3.5" /> Delete</button>
                )}
                {c.canModerate && c.status === "visible" && (
                  <button role="menuitem" type="button" onClick={() => { const r = ask("Why hide this comment? (shown to the author)"); if (r) void run(() => apiAuth(`/api/comments/${c.id}/moderate`, { method: "POST", body: JSON.stringify({ action: "hide", reason: r }) })); }} className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 hover:bg-surface-2"><EyeOff className="size-3.5" /> Hide (moderate)</button>
                )}
                {c.canModerate && c.status === "hidden" && (
                  <button role="menuitem" type="button" onClick={() => { const r = ask("Why restore this comment?"); if (r) void run(() => apiAuth(`/api/comments/${c.id}/moderate`, { method: "POST", body: JSON.stringify({ action: "restore", reason: r }) })); }} className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 hover:bg-surface-2"><RotateCcw className="size-3.5" /> Restore</button>
                )}
                {!c.canEdit && !c.canDelete && (
                  <button role="menuitem" type="button" onClick={() => { const r = ask("What's wrong with this comment?"); if (r) void run(() => apiAuth(`/api/comments/${c.id}/report`, { method: "POST", body: JSON.stringify({ reason: r }) })); }} className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 hover:bg-surface-2"><Flag className="size-3.5" /> Report</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {editing ? (
        <div className="space-y-2 pl-10">
          <textarea rows={3} maxLength={COMMENT_MAX} value={text} onChange={(e) => setText(e.target.value)} className={inputClass} aria-label="Edit comment" />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => run(() => apiAuth(`/api/comments/${c.id}`, { method: "PATCH", body: JSON.stringify({ body: text }) })).then(() => setEditing(false))}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : c.status === "hidden" ? (
        <p className="pl-10 text-sm text-muted">
          Hidden by a moderator{c.moderationReason ? `: ${c.moderationReason}` : "."}
          {c.body && <span className="mt-1 block whitespace-pre-wrap break-words text-ink-2">{c.body}</span>}
        </p>
      ) : (
        <p className="whitespace-pre-wrap break-words pl-10 text-[0.9375rem] text-ink">{c.body}</p>
      )}
      {err && <p className="pl-10 text-sm text-danger" role="alert">{err}</p>}
    </li>
  );
}
