import { expect, test } from "@playwright/test";
import { closedMarket, connect, disputeDirect, finalizeDirect, proposeDirect, read, stage, warp } from "./chain";

const STAGE = { Closed: 1, Proposed: 2, Disputed: 3, Finalized: 4 };

async function fillEvidence(page: import("@playwright/test").Page, summaryLabel: RegExp) {
  await page.getByLabel(summaryLabel).fill("The source page shows the figure that decides this market under the committed rules.");
  await page.getByLabel("Evidence link 1").fill("https://example.org/evidence");
}

test.describe("resolution lifecycle, role by role", () => {
  test("disconnected visitor can read everything and is told why no action applies", async ({ page }) => {
    const id = await closedMarket("visitor");
    await page.goto(`/markets/${id}`);
    const res = page.getByRole("region", { name: "Resolution" });
    await expect(res.getByText("Closed · awaiting proposal")).toBeVisible();
    await expect(res.getByText("Connect a wallet to participate in resolution or claim.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Evidence trail" })).toBeVisible();
    await expect(page.getByText("Market created, rules committed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Review proposal" })).toHaveCount(0);
  });

  test("ineligible wallet cannot propose; eligible resolver proposes on-chain", async ({ browser }) => {
    const id = await closedMarket("propose");

    const alice = await browser.newPage();
    await alice.goto(`/markets/${id}`);
    await connect(alice, "alice");
    await expect(alice.getByText("Only this market's designated resolver can propose an outcome.")).toBeVisible();
    await expect(alice.getByRole("button", { name: "Review proposal" })).toHaveCount(0);

    const page = await browser.newPage();
    await page.goto(`/markets/${id}`);
    await connect(page, "resolver");
    await page.getByRole("radio", { name: "Yes" }).last().click();
    await fillEvidence(page, /Why this outcome/);
    await page.getByRole("button", { name: "Review proposal" }).click();
    const dialog = page.getByRole("dialog", { name: "Review proposal" });
    await expect(dialog.getByText("25.00 MUSD")).toBeVisible();
    await dialog.getByRole("button", { name: "Publish evidence and sign" }).click();
    await expect(page.getByText("Outcome proposed. Confirmed on-chain.")).toBeVisible();
    expect(await stage(id)).toBe(STAGE.Proposed);
    const m = await read<{ proposedOutcome: number }>("getMarket", [id]);
    expect(m.proposedOutcome).toBe(1);
  });

  test("finalization unavailable during the window, then anyone can finalize", async ({ page }) => {
    const id = await closedMarket("finalize");
    await proposeDirect(id, "yes");
    await page.goto(`/markets/${id}`);
    await connect(page, "alice");
    await expect(page.getByText("Proposed · challenge window open")).toBeVisible();
    await expect(page.getByRole("button", { name: "Finalize outcome" })).toHaveCount(0);

    await warp(86_400 + 60);
    await page.reload();
    await connect(page, "alice");
    await page.getByRole("button", { name: "Finalize outcome" }).click();
    await page.getByRole("dialog", { name: "Finalize this market?" }).getByRole("button", { name: "Sign" }).click();
    await expect(page.getByText("Market finalized. Confirmed on-chain.")).toBeVisible();
    expect(await stage(id)).toBe(STAGE.Finalized);
  });

  test("resolver cannot challenge itself; another wallet challenges on-chain", async ({ browser }) => {
    const id = await closedMarket("challenge");
    await proposeDirect(id, "yes");

    const res = await browser.newPage();
    await res.goto(`/markets/${id}`);
    await connect(res, "resolver");
    await expect(res.getByText("The resolver cannot challenge its own proposal.")).toBeVisible();

    const page = await browser.newPage();
    await page.goto(`/markets/${id}`);
    await connect(page, "bob");
    await fillEvidence(page, /Reason for the challenge/);
    await page.getByRole("button", { name: "Review challenge" }).click();
    await page.getByRole("dialog", { name: "Review challenge" }).getByRole("button", { name: "Publish evidence and sign" }).click();
    await expect(page.getByText("Challenge filed. Confirmed on-chain.")).toBeVisible();
    expect(await stage(id)).toBe(STAGE.Disputed);
  });

  test("only the arbitrator sees the workspace and can rule", async ({ browser }) => {
    const id = await closedMarket("arbitrate");
    await proposeDirect(id, "yes");
    await disputeDirect(id);

    const alice = await browser.newPage();
    await alice.goto(`/markets/${id}`);
    await connect(alice, "alice");
    await expect(alice.getByText("Challenged · in arbitration")).toBeVisible();
    await expect(alice.getByRole("heading", { name: "Arbitration workspace" })).toHaveCount(0);
    await expect(alice.getByRole("button", { name: "Review ruling" })).toHaveCount(0);

    const page = await browser.newPage();
    await page.goto(`/markets/${id}`);
    await connect(page, "arbitrator");
    await expect(page.getByRole("heading", { name: "Arbitration workspace" })).toBeVisible();
    await page.getByRole("radiogroup", { name: "Final outcome" }).getByRole("radio", { name: "No" }).click();
    await expect(page.getByText(/This overturns the proposal/)).toBeVisible();
    await fillEvidence(page, /Rationale/);
    await page.getByRole("button", { name: "Review ruling" }).click();
    await page.getByRole("dialog", { name: "Confirm final ruling" }).getByRole("button", { name: "Publish rationale and sign" }).click();
    await expect(page.getByText("Ruling recorded. Confirmed on-chain.")).toBeVisible();
    const m = await read<{ finalized: boolean; finalOutcome: number }>("getMarket", [id]);
    expect(m.finalized).toBe(true);
    expect(m.finalOutcome).toBe(2);
  });

  test("winner claims exactly once; loser is told why there is nothing to claim", async ({ browser }) => {
    const id = await closedMarket("claim");
    await proposeDirect(id, "yes");
    await warp(86_400 + 60);
    await finalizeDirect(id);

    const loser = await browser.newPage();
    await loser.goto(`/markets/${id}`);
    await connect(loser, "bob");
    await expect(loser.getByText("Your shares are on the losing side, so there is nothing to claim.")).toBeVisible();

    const page = await browser.newPage();
    await page.goto(`/markets/${id}`);
    await connect(page, "alice");
    const expected = await read<bigint>("claimable", [id, "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"]);
    expect(expected).toBeGreaterThan(0n);
    await page.getByRole("button", { name: /^Claim payout/ }).click();
    const dialog = page.getByRole("dialog", { name: "Claim payout" });
    await expect(dialog.getByText("None. Claims are fee-free.")).toBeVisible();
    await dialog.getByRole("button", { name: "Sign" }).click();
    await expect(page.getByText(/Claim payout: .* MUSD sent\. Confirmed on-chain\./)).toBeVisible();
    expect(await read<bigint>("claimable", [id, "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"])).toBe(0n);
    await page.reload();
    await connect(page, "alice");
    await expect(page.getByText("This wallet holds no shares in this market.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Claim payout/ })).toHaveCount(0);
  });

  test("portfolio lists the claim with a status filter", async ({ page }) => {
    await page.goto("/portfolio");
    await connect(page, "alice");
    await expect(page.getByRole("heading", { name: "Positions and claims" })).toBeVisible();
    await page.getByRole("button", { name: "Claimed", exact: true }).click();
    await expect(page.getByText(/E2E claim:/).first()).toBeVisible();
    await expect(page.getByText("Claimed", { exact: true }).first()).toBeVisible();
  });

  test("keyboard users can reach the resolution actions", async ({ page }) => {
    const id = await closedMarket("keyboard");
    await page.goto(`/markets/${id}`);
    await connect(page, "resolver");
    const btn = page.getByRole("button", { name: "Review proposal" });
    await btn.focus();
    await expect(btn).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Explain your reasoning in at least 20 characters.")).toBeVisible();
  });
});
