import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMarket } from "@/server/queries";
import { MarketView, type IndexedMarket } from "./MarketView";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

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
      },
    };
  } catch {
    return { indexed: null, dbError: true };
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return { title: "Market" };
  const { indexed } = await load(id);
  return { title: indexed?.question ?? `Market #${id}`, description: "Trade Yes or No with MUSD on Mezo." };
}

export default async function MarketPage({ params }: Props) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0 || id > 2 ** 31) notFound();
  const { indexed, dbError } = await load(id);
  return <MarketView id={id} indexed={indexed} dbError={dbError} />;
}
