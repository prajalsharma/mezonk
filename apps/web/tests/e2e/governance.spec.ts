import { expect, test, type Page } from "@playwright/test";
import { addr, call, chainNow, connect, read } from "./chain";
import { toContractApproval, type StoredApproval } from "../../src/lib/governance/approval";
import { serializeMetadata, type MarketMetadata } from "../../src/lib/market/metadata";

const API = process.env.APP_URL ?? "http://localhost:3000";
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 16);
const next = (page: Page) => page.getByRole("button", { name: "Continue", exact: true }).click();

/** Opens a clean wizard as `role` and walks it up to the review step (the mock wallet doesn't survive a reload, so connect after). */
async function suggest(page: Page, role: Parameters<typeof connect>[1], question: string, now: number) {
  await page.goto("/suggest");
  await page.evaluate(() => localStorage.removeItem("mezonk:suggest-draft"));
  await page.reload();
  await connect(page, role);
  await page.getByLabel("Question").fill(question);
  await next(page);
  await expect(page.getByRole("heading", { name: "Outcome type and project" })).toBeVisible();
  await next(page);
  await page.getByLabel("Resolves Yes if").fill("The CoinGecko MUSD page shows a price at or above 0.995 USD at the evaluation time.");
  await page.getByLabel("Resolves No if").fill("That page shows a price below 0.995 USD at the evaluation time.");
  await page.getByLabel("Invalid if").fill("CoinGecko shows no MUSD price at all at the evaluation time.");
  await next(page);
  await page.getByLabel("Primary source").fill("CoinGecko MUSD");
  await page.getByLabel("Source link").fill("https://www.coingecko.com/en/coins/mezo-usd");
  await next(page);
  await page.getByLabel("Event evaluated at (UTC)").fill(fmt(now + 5 * 86_400_000));
  await page.getByLabel("Trading closes at (UTC)").fill(fmt(now + 4 * 86_400_000));
  await next(page);
  await page.getByLabel("Why is this market useful?").fill("MUSD peg stability matters to everyone holding or borrowing it on Mezo.");
  await next(page);
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
}

async function waitStatus(id: string, status: string) {
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${API}/api/proposals/${id}`);
    if (r.ok && (await r.json()).proposal.status === status) return;
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(`proposal ${id} never reached ${status}`);
}

test.describe("governed market creation", () => {
  test("blocking wording stops a suggestion before it reaches curators", async ({ page }) => {
    const now = await chainNow();
    await suggest(page, "alice", "Will MUSD trade soon at a significant premium", now);
    await expect(page.getByText("Must fix").first()).toBeVisible();
    await expect(page.getByText(/ending in “\?”/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
  });

  test("suggest → curator signs approval → publisher creates the market on-chain → indexer links it", async ({ browser }) => {
    const now = await chainNow();
    const tag = Date.now().toString(36).slice(-5);
    const question = `Will MUSD (${tag}) trade at or above $0.995 on CoinGecko at ${fmt(now + 5 * 86_400_000).replace("T", " ")} UTC?`;

    // 1. The approved creator suggests (any wallet could; using the creator keeps the publisher = author).
    const creator = await browser.newPage();
    await suggest(creator, "creator", question, now);
    await expect(creator.getByText("Must fix")).toHaveCount(0);
    for (const box of await creator.getByRole("checkbox").all()) await box.check();
    await next(creator);
    await creator.getByRole("button", { name: "Submit for review" }).click();
    await creator.waitForURL(/\/proposals\/[0-9a-f-]{36}/);
    await expect(creator.getByText("A curator will pick this up.")).toBeVisible();
    const id = creator.url().match(/\/proposals\/([0-9a-f-]{36})/)![1]!;

    // Public page shows the submission without a wallet.
    const visitor = await browser.newPage();
    await visitor.goto(`/proposals/${id}`);
    await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(question);
    await expect(visitor.getByText("Submitted", { exact: true }).first()).toBeVisible();
    await expect(visitor.getByRole("button", { name: "Pick up for review" })).toHaveCount(0);

    // 2. The curator claims it from the dashboard and approves with an EIP-712 signature.
    const curator = await browser.newPage();
    await curator.goto("/curate");
    await connect(curator, "curator");
    await expect(curator.getByRole("heading", { name: "Unclaimed" })).toBeVisible();
    await curator.getByRole("link", { name: question.slice(0, 30) }).first().click();
    await curator.getByRole("button", { name: "Pick up for review" }).click();
    await expect(curator.getByText("You're reviewing this.")).toBeVisible();
    await curator.getByRole("button", { name: "Approve", exact: true }).click();
    for (const box of await curator.getByRole("checkbox").all()) await box.check();
    await curator.getByLabel("Resolver").selectOption(addr("resolver").toLowerCase());
    await curator.getByRole("button", { name: "Sign and approve" }).click();
    await expect(curator.getByRole("status").getByText("Approved and signed")).toBeVisible();

    const detail = await (await fetch(`${API}/api/proposals/${id}`)).json();
    const approval = detail.proposal.approval as StoredApproval;
    expect(approval.curator.toLowerCase()).toBe(addr("curator").toLowerCase());
    expect(approval.creator.toLowerCase()).toBe(addr("creator").toLowerCase());

    // 3. A wallet that isn't the publisher can't use the approval, in the UI or on-chain.
    const alice = await browser.newPage();
    await alice.goto(`/proposals/${id}`);
    await connect(alice, "alice");
    await expect(alice.getByText("Waiting for the publisher")).toBeVisible();
    await expect(alice.getByRole("button", { name: /Publish ·/ })).toHaveCount(0);
    const params = {
      metadata: serializeMetadata(detail.proposal.metadata as MarketMetadata),
      closeTime: BigInt(approval.closeTime),
      resolver: approval.resolver,
      initialLiquidity: 100n * 10n ** 18n,
      initialYesProbBps: 5000,
    };
    await expect(call("alice", "createMarket", [params, toContractApproval(approval), approval.curator, approval.signature])).rejects.toThrow();

    // 4. The publisher seeds and publishes; the contract verifies the signature.
    const before = await read<bigint>("marketCount", []);
    await creator.goto(`/proposals/${id}`);
    await connect(creator, "creator");
    await expect(creator.getByRole("heading", { name: "Publish this market" })).toBeVisible();
    await creator.getByRole("button", { name: /Publish · 100.00 MUSD/ }).click();
    await expect(creator.getByText(/Market #\d+ is live/)).toBeVisible({ timeout: 90_000 });
    const marketId = await read<bigint>("marketCount", []);
    expect(marketId).toBe(before + 1n);
    const m = await read<{ metadataHash: string; creator: string; resolver: string }>("getMarket", [marketId]);
    expect(m.metadataHash.toLowerCase()).toBe(approval.metadataHash.toLowerCase());
    expect(m.creator.toLowerCase()).toBe(addr("creator").toLowerCase());
    expect(m.resolver.toLowerCase()).toBe(addr("resolver").toLowerCase());
    expect(await read<boolean>("approvalUsed", [approval.nonce])).toBe(true);

    // 5. The indexer links MarketApprovalUsed back to the suggestion; replaying the approval reverts.
    await waitStatus(id, "published");
    await visitor.reload();
    await expect(visitor.getByText(`Live as market #${marketId}`)).toBeVisible();
    await expect(call("creator", "createMarket", [params, toContractApproval(approval), approval.curator, approval.signature])).rejects.toThrow();
  });

  test("curators can request changes with a public reason and the author resubmits a new version", async ({ browser }) => {
    const now = await chainNow();
    const question = `Will the Mezo testnet block height exceed 9,${Date.now().toString().slice(-3)},000 by ${fmt(now + 6 * 86_400_000).slice(0, 10)}?`;
    const author = await browser.newPage();
    await suggest(author, "bob", question, now);
    for (const box of await author.getByRole("checkbox").all()) await box.check();
    await next(author);
    await author.getByRole("button", { name: "Submit for review" }).click();
    await author.waitForURL(/\/proposals\/[0-9a-f-]{36}/);
    const id = author.url().match(/\/proposals\/([0-9a-f-]{36})/)![1]!;

    const curator = await browser.newPage();
    await curator.goto(`/proposals/${id}`);
    await connect(curator, "curator");
    await curator.getByRole("button", { name: "Sign in to review" }).click();
    await curator.getByRole("button", { name: "Pick up for review" }).click();
    await curator.getByRole("button", { name: "Request changes" }).click();
    await curator.getByLabel("Reason (shown to the author)").fill("Name the explorer page you will read the block height from.");
    await curator.getByRole("button", { name: "Request changes" }).last().click();
    await expect(curator.getByText("Changes requested").first()).toBeVisible();

    // The reason is public, and the author edits and resubmits as version 2.
    await author.goto(`/proposals/${id}`);
    await connect(author, "bob");
    await expect(author.getByRole("status").getByText("Name the explorer page you will read the block height from.")).toBeVisible();
    await author.getByRole("link", { name: "Edit and resubmit" }).click();
    await expect(author.getByText("Editing after a change request")).toBeVisible();
    await expect(author.getByLabel("Question")).toHaveValue(question);
    for (let i = 0; i < 3; i++) await next(author);
    await author.getByLabel("Primary source").fill("Mezo testnet explorer");
    await author.getByLabel("Source link").fill("https://explorer.test.mezo.org/");
    await next(author);
    await next(author);
    await next(author);
    await expect(author.getByRole("heading", { name: "Review" })).toBeVisible();
    for (const box of await author.getByRole("checkbox").all()) await box.check();
    await next(author);
    await author.getByRole("button", { name: "Submit for review" }).click();
    await author.waitForURL(/\/proposals\/[0-9a-f-]{36}\?submitted=1/);
    await expect(author.getByText("A curator will pick this up.")).toBeVisible();
    const d = await (await fetch(`${API}/api/proposals/${id}`)).json();
    expect(d.proposal.version).toBe(2);
    expect(d.reviews.map((r: { action: string }) => r.action)).toEqual(["submit", "claim", "request_changes", "resubmit"]);
  });
});
