import { expect, test } from "@playwright/test";
import { chainNow, connect, read } from "./chain";

const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 16);

async function fillRules(page: import("@playwright/test").Page, question: string, evalAt: number) {
  await page.getByLabel("Question").fill(question);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Resolves Yes if").fill("The CoinGecko MUSD page shows a price at or above 0.995 USD at the evaluation time.");
  await page.getByLabel("Resolves No if").fill("That page shows a price below 0.995 USD at the evaluation time.");
  await page.getByLabel("Invalid if").fill("CoinGecko shows no MUSD price at all at the evaluation time.");
  await page.getByLabel("Primary source").fill("CoinGecko MUSD");
  await page.getByLabel("Source link").fill("https://www.coingecko.com/en/coins/mezo-usd");
  await page.getByLabel("Event evaluated at (UTC)").fill(fmt(evalAt));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}

test.describe("create a market", () => {
  test("blocking review issues stop publishing", async ({ page }) => {
    const now = await chainNow();
    await page.goto("/create");
    await page.evaluate(() => localStorage.removeItem("mezonk:create-draft"));
    await page.reload();
    await connect(page, "creator");
    await fillRules(page, "Will MUSD trade soon at a significant premium", now + 5 * 86_400_000);
    await page.getByLabel("Trading closes at (UTC)").fill(fmt(now + 4 * 86_400_000));
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByText("Must fix").first()).toBeVisible();
    await expect(page.getByText(/ending in “\?”/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue to publish" })).toBeDisabled();
  });

  test("creator publishes a market and its rules hash matches on-chain", async ({ page }) => {
    const now = await chainNow();
    const before = await read<bigint>("marketCount", []);
    const question = `Will MUSD trade at or above $0.995 on CoinGecko at ${fmt(now + 5 * 86_400_000).replace("T", " ")} UTC?`;
    await page.goto("/create");
    await page.evaluate(() => localStorage.removeItem("mezonk:create-draft"));
    await page.reload();
    await connect(page, "creator");
    await fillRules(page, question, now + 5 * 86_400_000);
    await page.getByLabel("Trading closes at (UTC)").fill(fmt(now + 4 * 86_400_000));
    await page.getByLabel("Seed liquidity (MUSD)").fill("120");
    await expect(page.getByText("Pool starts with")).toBeVisible();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByText("Rules hash")).toBeVisible();
    for (const box of await page.getByRole("checkbox").all()) await box.check();
    await page.getByRole("button", { name: "Continue to publish" }).click();
    await page.getByRole("button", { name: /Create market · 120.00 MUSD/ }).click();
    await expect(page.getByText(/Market #\d+ is live/)).toBeVisible();

    const id = await read<bigint>("marketCount", []);
    expect(id).toBe(before + 1n);
    const m = await read<{ metadataHash: string; collateral: bigint; creator: string }>("getMarket", [id]);
    expect(m.collateral).toBe(120n * 10n ** 18n);
    expect(m.creator.toLowerCase()).toBe("0x90f79bf6eb2c4f870365e785982e1f101e93b906");
    // The market page shows the rules and confirms the on-chain hash matches them.
    await page.getByRole("link", { name: "Open the market" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(question, { timeout: 60_000 });
    await expect(page.getByText("These rules match the hash committed on-chain at creation.")).toBeVisible();
  });
});
