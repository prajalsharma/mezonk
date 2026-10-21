import { expect, test } from "@playwright/test";
import { client, closedMarket, connect, evidenceFor, proposeDirect, readRes, sendNoWait, setAutomine, stage } from "./chain";

test.describe("transaction failures are reported honestly", () => {
  test("a rejected signature leaves state unchanged and offers a retry", async ({ page }) => {
    const id = await closedMarket("reject");
    await proposeDirect(id, "yes");
    await page.goto(`/markets/${id}`);
    await connect(page, "rejects");
    await page.getByLabel(/Reason for the challenge/).fill("The source contradicts the proposal for the stated date and threshold.");
    await page.getByLabel("Evidence link 1").fill("https://example.org/evidence");
    await page.getByRole("button", { name: "Review challenge" }).click();
    await page.getByRole("dialog", { name: "Review challenge" }).getByRole("button", { name: "Publish evidence and sign" }).click();
    await expect(page.getByText("You declined the request in your wallet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByText(/Confirmed on-chain/)).toHaveCount(0);
    expect(await stage(id)).toBe(2); // still Proposed
  });

  test("a transaction that reverts on-chain is shown as failed, not successful", async ({ page }) => {
    const id = await closedMarket("revert");
    await proposeDirect(id, "yes");
    await page.goto(`/markets/${id}`);
    await connect(page, "bob");
    await page.getByLabel(/Reason for the challenge/).fill("The source contradicts the proposal for the stated date and threshold.");
    await page.getByLabel("Evidence link 1").fill("https://example.org/evidence");
    await page.getByRole("button", { name: "Review challenge" }).click();

    await setAutomine(false);
    try {
      await page.getByRole("dialog", { name: "Review challenge" }).getByRole("button", { name: "Publish evidence and sign" }).click();
      await expect(page.getByText("Challenge: Submitted. Waiting for confirmation…")).toBeVisible();
      // Alice's challenge pays a higher tip, so it is ordered first in the block; bob's then reverts with WrongStage.
      const ev = await evidenceFor(id, "alice");
      await sendNoWait("alice", "dispute", [id, ev.hash, ev.uri], 500);
      await client.mine({ blocks: 1 });
    } finally {
      await setAutomine(true);
    }
    await expect(page.getByText("The transaction reverted on-chain. No funds moved.")).toBeVisible();
    await expect(page.getByText("Challenge filed. Confirmed on-chain.")).toHaveCount(0);
    const st = await readRes<readonly [number, bigint, bigint, string, boolean]>("states", [id]);
    expect(st[3].toLowerCase()).toBe("0x15d34aaf54267db7d7c367839aaf71a00a2c6a65"); // alice won the race
  });
});
