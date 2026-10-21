import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { isAddress } from "viem";
import { Profile } from "@/features/profile/Profile";
import { shortAddress } from "@/lib/format";
import { publicProfile } from "@/server/profiles";

export const dynamic = "force-dynamic";
const HANDLE = /^(0x[0-9a-fA-F]{40}|[a-zA-Z][a-zA-Z0-9_]{2,19})$/;

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  if (!HANDLE.test(handle)) return { title: "Profile" };
  const p = await publicProfile(handle).catch(() => null);
  const name = p?.profile.displayName ?? (isAddress(handle) ? shortAddress(handle) : handle);
  return { title: name, description: p?.profile.bio || "A MEZONK profile." };
}

/** `/u/{username}` is canonical; `/u/{address}` redirects there once the wallet has a username. */
export default async function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  if (!HANDLE.test(handle)) notFound();
  const p = await publicProfile(handle).catch(() => null);
  if (!p) notFound();
  if (isAddress(handle) && p.profile.username) permanentRedirect(`/u/${p.profile.username}`);
  return <Profile data={p} />;
}
