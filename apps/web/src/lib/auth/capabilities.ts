/**
 * The single permission policy (docs/USER_PROFILES_AND_RBAC_ARCHITECTURE.md §4). Pure and unit-tested.
 * Roles come from the server (chain reads + role_assignments); the client may use this to hide buttons,
 * but every route re-checks it server-side.
 */

export type PlatformRole = "MEMBER" | "CREATOR" | "CURATOR" | "ADMINISTRATOR";

export type Capability =
  | "profile:update:self"
  | "media:upload"
  | "market:submit"
  | "market:publish"
  | "market:review"
  | "comment:create"
  | "comment:edit:own"
  | "comment:delete:own"
  | "comment:report"
  | "comment:moderate"
  | "media:moderate"
  | "project:verify"
  | "role:grant:admin"
  | "role:revoke:admin"
  | "role:operation:create"
  | "account:suspend"
  | "account:restore"
  | "session:revoke:any"
  | "wallet:replace"
  | "audit:read";

/** No inheritance: a wallet's capabilities are the union of what each of its roles grants. */
export const ROLE_CAPABILITIES: Record<PlatformRole, readonly Capability[]> = {
  MEMBER: ["profile:update:self", "media:upload", "market:submit", "comment:create", "comment:edit:own", "comment:delete:own", "comment:report"],
  CREATOR: ["market:publish"],
  CURATOR: ["market:review", "comment:moderate", "media:moderate", "project:verify"],
  ADMINISTRATOR: [
    "comment:moderate",
    "media:moderate",
    "project:verify",
    "role:grant:admin",
    "role:revoke:admin",
    "role:operation:create",
    "account:suspend",
    "account:restore",
    "session:revoke:any",
    "wallet:replace",
    "audit:read",
  ],
};

/** Where each role's truth lives, shown in the admin UI. */
export const ROLE_SOURCE: Record<PlatformRole, "session" | "chain" | "database"> = {
  MEMBER: "session",
  CREATOR: "chain",
  CURATOR: "chain",
  ADMINISTRATOR: "database",
};

export interface RoleFlags {
  creator: boolean;
  curator: boolean;
  admin: boolean;
  suspended: boolean;
}

export function rolesOf(f: RoleFlags): PlatformRole[] {
  if (f.suspended) return [];
  const r: PlatformRole[] = ["MEMBER"];
  if (f.creator) r.push("CREATOR");
  if (f.curator) r.push("CURATOR");
  if (f.admin) r.push("ADMINISTRATOR");
  return r;
}

export function capabilitiesOf(f: RoleFlags): Set<Capability> {
  return new Set(rolesOf(f).flatMap((r) => ROLE_CAPABILITIES[r]));
}

export const can = (f: RoleFlags, c: Capability) => capabilitiesOf(f).has(c);
