import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isAddress } from "viem";
import { Profile } from "@/features/profile/Profile";
import { shortAddress } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  return { title: isAddress(address) ? shortAddress(address) : "Profile", robots: { index: false } };
}

export default async function ProfilePage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  return <Profile address={address.toLowerCase()} />;
}
