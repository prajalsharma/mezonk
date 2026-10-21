import Link from "next/link";
import { cx } from "@/components/ui/cx";
import { shortAddress } from "@/lib/format";
import { Avatar } from "./Avatar";

export interface PublicPerson {
  wallet: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export const profileHref = (p: Pick<PublicPerson, "wallet" | "username">) => `/u/${p.username ?? p.wallet}`;

/** Avatar + name linking to the profile. Attribution is by wallet, so it survives name changes. */
export function UserChip({ person, size = 28, className, sub }: { person: PublicPerson; size?: number; className?: string; sub?: React.ReactNode }) {
  return (
    <Link href={profileHref(person)} className={cx("group inline-flex min-w-0 items-center gap-2.5", className)}>
      <Avatar address={person.wallet} url={person.avatarUrl} size={size} />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-medium text-ink group-hover:underline decoration-line underline-offset-4">
          {person.displayName ?? shortAddress(person.wallet)}
        </span>
        {(person.username || sub) && (
          <span className="block truncate text-xs text-muted">
            {person.username ? `@${person.username}` : null}
            {person.username && sub ? " · " : null}
            {sub}
          </span>
        )}
      </span>
    </Link>
  );
}
