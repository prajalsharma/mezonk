import { expect, test } from "@playwright/test";
import { addr, client, connect, E, musdOf } from "./chain";

/**
 * Borrowing MUSD on Mezo from the /borrow page, signed by a test wallet against Mezo's real loan contracts on the fork.
 * Forks can't run Mezo's price oracle, so it's replaced with an always-fresh $82,000 mock
 * (runtime code of contracts/test/mocks/MockMezoOracle.sol).
 */
const ORACLE = "0x7b7c000000000000000000000000000000000015";
const MOCK_ORACLE = "0x608060405234801561001057600080fd5b50600436106100365760003560e01c8063313ce5671461003b578063feaf968c14610059575b600080fd5b61004361007b565b60405161005091906100ca565b60405180910390f35b610061610084565b60405161007295949392919061013c565b60405180910390f35b60006012905090565b6000806000806000600169115d3a99a9614f40000042426001945094509450945094509091929394565b600060ff82169050919050565b6100c4816100ae565b82525050565b60006020820190506100df60008301846100bb565b92915050565b600069ffffffffffffffffffff82169050919050565b610104816100e5565b82525050565b6000819050919050565b61011d8161010a565b82525050565b6000819050919050565b61013681610123565b82525050565b600060a08201905061015160008301886100fb565b61015e6020830187610114565b61016b604083018661012d565b610178606083018561012d565b61018560808301846100fb565b969550505050505056fea26469706673582212205c951ff9f6e80f9a9df5cb7fd87d0f701954e02271e68db71f61f4d8fee8aa8e64736f6c63430008190033";

test.beforeAll(async () => {
  await client.setCode({ address: ORACLE, bytecode: MOCK_ORACLE });
  await client.setBalance({ address: addr("creator"), value: E(1) });
});

test("a BTC holder borrows MUSD without selling BTC, and sees the terms first", async ({ page }) => {
  test.setTimeout(360_000);
  await page.goto("/borrow");
  await connect(page, "creator");
  const form = page.getByRole("region", { name: "Borrow MUSD against your BTC" });
  await expect(form).toBeVisible({ timeout: 90_000 }) // a cold fork fetches Mezo state slowly;
  await form.getByLabel("BTC to lock").fill("0.06");
  // Balanced = 200%: 0.06 BTC at $82,000 backs 2,257.74 MUSD after the 0.1% fee and 200 MUSD deposit.
  await expect(form.getByLabel("MUSD you receive")).toHaveValue("2257.74");
  await expect(form.getByText("200%", { exact: true })).toHaveCount(2); // the Balanced option and the ratio meter
  await expect(form.getByText("$45,100", { exact: true })).toHaveCount(2); // liquidation price, in the summary and the checkbox
  await expect(form.getByRole("button", { name: "Tick the box to continue" })).toBeDisabled();
  await form.getByRole("checkbox").check();
  const before = await musdOf(addr("creator"));
  await form.getByRole("button", { name: "Borrow 2,257.74 MUSD" }).click();
  await expect(page.getByText("Borrow MUSD: Confirmed on-chain.")).toBeVisible({ timeout: 180_000 }); // hint lookup reads many loans; slow on a cold fork, fast on Mezo
  expect((await musdOf(addr("creator"))) - before).toBe(E(2257.74));
  await expect(page.getByText("2,257.74 MUSD is in your wallet")).toBeVisible();
  await expect(page.getByRole("heading", { name: "While you're here" })).toBeVisible();
  // With a loan open, the page offers to borrow more on it instead of a second loan.
  await expect(page.getByRole("region", { name: "Your Mezo loan" })).toBeVisible({ timeout: 40_000 });
});

test("the form blocks loans under Mezo's minimum ratio and size", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/borrow");
  await connect(page, "carol");
  const form = page.getByRole("region", { name: "Borrow MUSD against your BTC" });
  await expect(form).toBeVisible({ timeout: 90_000 }) // a cold fork fetches Mezo state slowly;
  await form.getByLabel("BTC to lock").fill("0.02");
  await form.getByLabel("MUSD you receive").fill("1800");
  await expect(form.getByText("That's below Mezo's 110% minimum.", { exact: false })).toBeVisible();
  await form.getByLabel("BTC to lock").fill("1");
  await form.getByLabel("MUSD you receive").fill("1000");
  await expect(form.getByRole("button", { name: /^Minimum is/ })).toBeDisabled();
});
