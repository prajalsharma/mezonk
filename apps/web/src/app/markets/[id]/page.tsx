import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Suspense } from "react";
import { isNumericId } from "@/lib/market/slug";
import { getMarket } from "@/server/queries";
import { marketIdForSlug, slugsFor } from "@/server/slugs";
import { marketPresentation } from "@/server/governance";
import { MarketView, type IndexedMarket } from "./MarketView";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * `/markets/{slug}` is canonical. `/markets/{id}` permanently redirects to the slug once one exists
 * (old links keep working); before the indexer assigns a slug the numeric URL renders directly.
 */
async function resolveParam(param: string): Promise<{ id: number; slug: string | null } | null> {
  if (isNumericId(param)) {
    const id = Number(param);
    if (id > 2 ** 31) return null;
    const slug = (await slugsFor([id]).catch(() => new Map<number, string>())).get(id) ?? null;
    return { id, slug };
  }
  if (!/^[a-z0-9-]{1,80}$/.test(param)) return null;
  const hit = await marketIdForSlug(param).catch(() => null);
  return hit ? { id: hit.id, slug: hit.current } : null;
}

async function load(id: number): Promise<{ indexed: IndexedMarket | null; dbError: boolean }> {
  try {
    const m = await getMarket(id);
    if (!m) return { indexed: null, dbError: false };
    const r = m.row;
    return {
      dbError: false,
      indexed: {
        question: r.question,
        category: r.category,
        structured: r.structured,
        metadataRaw: r.metadataRaw,
        metadataHash: r.metadataHash,
        creator: r.creator,
        createdAt: r.createdAt.toISOString(),
        createdTx: r.createdTx,
        volume: r.volume,
        tradeCount: r.tradeCount,
        traderCount: r.traderCount,
        priceYes24hAgo: m.summary.priceYes24hAgo,
        presentation: await marketPresentation(id, r.creator).catch(() => null),
      },
    };
  } catch {
    return { indexed: null, dbError: true };
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await resolveParam((await params).id);
  if (!r) return { title: "Market" };
  const { indexed } = await load(r.id);
  return {
    title: indexed?.question ?? `Market #${r.id}`,
    description: "Trade Yes or No with MUSD on Mezo.",
    alternates: r.slug ? { canonical: `/markets/${r.slug}` } : undefined,
  };
}

export default async function MarketPage({ params, searchParams }: Props) {
  const param = (await params).id;
  const r = await resolveParam(param);
  if (!r) notFound();
  if (r.slug && param !== r.slug) {
    const side = (await searchParams).side;
    permanentRedirect(`/markets/${r.slug}${side === "yes" || side === "no" ? `?side=${side}` : ""}`);
  }
  const id = r.id;
  const { indexed, dbError } = await load(id);
  return (
    <Suspense>
      <MarketView id={id} indexed={indexed} dbError={dbError} />
    </Suspense>
  );
}
