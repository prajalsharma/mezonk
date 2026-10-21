import { describe, expect, it } from "vitest";
import { can, capabilitiesOf, rolesOf, ROLE_CAPABILITIES } from "../../src/lib/auth/capabilities";
import { slugForMarket, slugify } from "../../src/lib/market/slug";
import { sniffImage } from "../../src/lib/media/sniff";
import { cleanComment, commentProblem } from "../../src/lib/comments/text";
import { displayNameProblem, profileInputSchema, usernameProblem } from "../../src/lib/profile/username";

const flags = (o: Partial<{ creator: boolean; curator: boolean; admin: boolean; suspended: boolean }> = {}) => ({
  creator: false,
  curator: false,
  admin: false,
  suspended: false,
  ...o,
});

describe("capability policy", () => {
  it("members can participate but not publish, review, moderate or administer", () => {
    const m = flags();
    expect(can(m, "comment:create")).toBe(true);
    expect(can(m, "market:submit")).toBe(true);
    for (const c of ["market:publish", "market:review", "comment:moderate", "role:grant:admin", "account:suspend", "audit:read"] as const) {
      expect(can(m, c)).toBe(false);
    }
  });
  it("creators publish but cannot review or administer", () => {
    const c = flags({ creator: true });
    expect(can(c, "market:publish")).toBe(true);
    expect(can(c, "market:review")).toBe(false);
    expect(can(c, "role:grant:admin")).toBe(false);
  });
  it("curators review and moderate but cannot grant roles or suspend", () => {
    const c = flags({ curator: true });
    expect(can(c, "market:review")).toBe(true);
    expect(can(c, "comment:moderate")).toBe(true);
    expect(can(c, "role:grant:admin")).toBe(false);
    expect(can(c, "account:suspend")).toBe(false);
    expect(can(c, "market:publish")).toBe(false);
  });
  it("administrators administer but do not review or publish markets", () => {
    const a = flags({ admin: true });
    expect(can(a, "role:grant:admin")).toBe(true);
    expect(can(a, "wallet:replace")).toBe(true);
    expect(can(a, "market:review")).toBe(false);
    expect(can(a, "market:publish")).toBe(false);
  });
  it("suspension removes every capability regardless of roles", () => {
    expect(capabilitiesOf(flags({ creator: true, curator: true, admin: true, suspended: true })).size).toBe(0);
    expect(rolesOf(flags({ admin: true, suspended: true }))).toEqual([]);
  });
  it("roles do not inherit from each other", () => {
    expect(ROLE_CAPABILITIES.ADMINISTRATOR).not.toContain("market:review");
    expect(ROLE_CAPABILITIES.CURATOR).not.toContain("market:publish");
  });
});

describe("slugs", () => {
  it("are deterministic, URL-safe and bounded", () => {
    const q = "Will Mezo reach $1B TVL by December?";
    expect(slugify(q)).toBe("will-mezo-reach-1b-tvl-by-december");
    expect(slugify(q)).toBe(slugify(q));
    expect(slugify("x".repeat(200)).length).toBeLessThanOrEqual(72);
    expect(slugify("Will BTC close above 100k? 🚀🚀 Yes!!")).toBe("will-btc-close-above-100k-yes");
    expect(slugify("Will ETH/BTC ≥ 0.04 — on 20 Oct?")).toBe("will-eth-btc-0-04-on-20-oct");
    expect(slugify("Crème brûlée café")).toBe("creme-brulee-cafe");
  });
  it("fall back for text with no Latin letters or digits and never look like numeric ids", () => {
    expect(slugForMarket("比特币会涨吗？", 7, () => false)).toBe("market-7");
    expect(slugForMarket("🚀🚀🚀", 8, () => false)).toBe("market-8");
    expect(slugForMarket("2026", 9, () => false)).toBe("market-9");
  });
  it("resolve collisions with the market id", () => {
    const taken = new Set(["will-it-rain"]);
    expect(slugForMarket("Will it rain?", 42, (s) => taken.has(s))).toBe("will-it-rain-42");
  });
});

describe("image signatures", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  it("accept real raster headers only", () => {
    expect(sniffImage(png)).toBe("image/png");
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("image/jpeg");
  });
  it("reject SVG, HTML and spoofed content regardless of the declared type", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(sniffImage(enc('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImage(enc("<!doctype html><html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImage(enc("GIF87 not really a gif"))).toBeNull();
  });
});

describe("text rules", () => {
  it("usernames: format, reserved and impersonation", () => {
    expect(usernameProblem("satoshi_21")).toBeNull();
    expect(usernameProblem("ab")).not.toBeNull();
    expect(usernameProblem("1abc")).not.toBeNull();
    expect(usernameProblem("admin")).not.toBeNull();
    expect(usernameProblem("mezo_team")).not.toBeNull();
    expect(usernameProblem("realmezonk")).not.toBeNull();
    expect(displayNameProblem("Mezo Team")).not.toBeNull();
    expect(displayNameProblem("Ada")).toBeNull();
  });
  it("normalises profile input and strips invisible characters", () => {
    const p = profileInputSchema.parse({ username: "Satoshi_21", displayName: " Ada​  L ", bio: "hi" });
    expect(p.username).toBe("satoshi_21");
    expect(p.displayName).toBe("Ada L");
  });
  it("comments are plain text, bounded, with control characters removed", () => {
    expect(cleanComment("a\u0000b\r\n\n\n\nc")).toBe("ab\n\nc");
    expect(commentProblem("")).not.toBeNull();
    expect(commentProblem("x".repeat(2001))).not.toBeNull();
    expect(cleanComment("<script>alert(1)</script>")).toBe("<script>alert(1)</script>"); // stored literally, rendered as text
  });
});
