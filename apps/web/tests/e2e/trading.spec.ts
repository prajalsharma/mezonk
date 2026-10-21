import { expect, test } from "@playwright/test";
import { addr, call, connect, E, exStage, liveMarket, musdOf, NO, read, seedingMarket, waitIndexed, warp, YES, BUY } from "./chain";

const API = process.env.APP_URL ?? "http://localhost:3000";

test.describe("seeding and launch", () => {
  test("a seeding market isn't tradable, shows its launch conditions, and takes a funded seed order", async ({ page }) => {
    const id = await seedingMarket("seed-ui");
    await waitIndexed(id);
    await page.goto(`/markets/${id}`);
    await connect(page, "carol");
    const status = page.getByRole("region", { name: "Launch status" });
    await expect(status.getByRole("heading", { name: "Seeding: not trading yet" })).toBeVisible();
    await expect(status.getByText(/Bids and offers on both sides/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Buy (Yes|No)$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Launch market" })).toHaveCount(0);

    const form = page.getByRole("region", { name: "Commit a seed order" });
    await form.getByRole("radio", { name: "Buy Yes" }).click();
    await form.getByLabel("Price (¢)").fill("44");
    await form.getByLabel("Shares").fill("50");
    await expect(form.getByText("22.00 MUSD").first()).toBeVisible(); // 50 x 0.44 locked
    const before = await musdOf(addr("carol"));
    await form.getByRole("button", { name: /^Lock/ }).click();
    await expect(form.getByText("Commit seed order: Confirmed on-chain.")).toBeVisible();
    expect(before - (await musdOf(addr("carol")))).toBe(E(22));
    expect(await read<bigint>("seedWeight", [id, addr("carol")])).toBe(E(22));
    expect(await exStage(id)).toBe(0); // still seeding: one side is not enough
  });

  test("launch needs funded depth on both sides; then anyone can launch it", async ({ page }) => {
    const id = await seedingMarket("launch-ui");
    await call("alice", "placeOrder", [id, YES, BUY, 45, E(80)]);
    await waitIndexed(id);
    await page.goto(`/markets/${id}`);
    await connect(page, "carol");
    await expect(page.getByRole("button", { name: "Launch market" })).toHaveCount(0);

    await call("bob", "placeOrder", [id, NO, BUY, 45, E(80)]); // Yes ask 55: spread 10, two seeders
    await expect(page.getByRole("button", { name: "Launch market" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Launch market" }).click();
    // On success the seeding panel is replaced by the trade ticket: the market is live.
    await expect(page.locator("aside").getByRole("region", { name: "Trade" })).toBeVisible({ timeout: 30_000 });
    expect(await exStage(id)).toBe(1);
    const m = await read<{ graduatedAt: bigint }>("getMarket", [id]);
    expect(m.graduatedAt).toBeGreaterThan(0n);
  });

  test("a market that fails to launch refunds every seeder exactly", async ({ page }) => {
    const id = await seedingMarket("refund-ui");
    const before = await musdOf(addr("alice"));
    await call("alice", "placeOrder", [id, YES, BUY, 30, E(20)]); // 6 MUSD, one-sided: can't launch
    expect(before - (await musdOf(addr("alice")))).toBe(E(6));
    await warp(2 * 3600 + 120); // past the local 2h seeding period
    expect(await exStage(id)).toBe(2); // failed
    await waitIndexed(id);
    await page.goto(`/markets/${id}`);
    await connect(page, "alice");
    await expect(page.getByRole("heading", { name: "This market didn't launch" })).toBeVisible();
    await page.getByRole("button", { name: /^Refund/ }).click();
    await expect(page.getByText("Refund: Confirmed on-chain.")).toBeVisible();
    expect(await musdOf(addr("alice"))).toBe(before);
    expect(await read<bigint>("escrowedCollateral", [])).toBeGreaterThanOrEqual(0n);
  });
});

test.describe("live trading", () => {
  test("a big market buy fills only real liquidity, says so, and settles exactly", async ({ page }) => {
    const id = await liveMarket("market-buy");
    // Asks left: bob's No bid at 45 has 60 of 80 shares remaining (alice bought 20) = 60 Yes at 55¢.
    await page.goto(`/markets/${id}`);
    await connect(page, "carol");
    const ticket = page.getByRole("region", { name: "Trade" });
    await ticket.locator("#tt-qty").fill("1000");
    await expect(ticket.getByText("Not enough liquidity at this price")).toBeVisible();
    await expect(ticket.getByText(/Only 60 shares are offered/)).toBeVisible();

    const musd0 = await musdOf(addr("carol"));
    const yes0 = await read<bigint>("sharesOf", [id, YES, addr("carol")]);
    await ticket.getByRole("button", { name: "Buy Yes" }).click();
    await expect(ticket.getByText("Buy Yes: Confirmed on-chain.")).toBeVisible();
    expect((await read<bigint>("sharesOf", [id, YES, addr("carol")])) - yes0).toBe(E(60));
    expect(musd0 - (await musdOf(addr("carol")))).toBe(E(33) + E(0.33)); // 60 x 0.55 + 1% taker fee
  });

  test("all-or-nothing refuses to trade when the book can't fill everything", async ({ page }) => {
    const id = await liveMarket("fok");
    await page.goto(`/markets/${id}`);
    await connect(page, "carol");
    const ticket = page.getByRole("region", { name: "Trade" });
    await ticket.getByLabel(/All or nothing/).check();
    await ticket.locator("#tt-qty").fill("500");
    await expect(ticket.getByRole("button", { name: "Can't fill all of it" })).toBeDisabled();
  });

  test("a limit order that doesn't cross rests on the book as a signed order, then can be removed", async ({ page }) => {
    const id = await liveMarket("limit");
    await page.goto(`/markets/${id}`);
    await connect(page, "carol");
    const ticket = page.getByRole("region", { name: "Trade" });
    await ticket.getByRole("radio", { name: "Limit" }).click();
    await ticket.locator("#tt-qty").fill("10");
    await ticket.locator("#tt-price").fill("50");
    await expect(ticket.getByText(/10 rests at 50¢ \(signed\)/)).toBeVisible();
    await ticket.getByRole("button", { name: "Place order" }).click();
    await expect(page.getByText(/is on the book \(signed, funds stay in your wallet\)\. It has not traded yet\./)).toBeVisible();

    const r = await (await fetch(`${API}/api/orders?maker=${addr("carol")}&market=${id}`)).json();
    expect(r.signed.find((o: { price: number; status: string }) => o.price === 50)?.status).toBe("open");
    const bookNow = async () => (await fetch(`${API}/api/markets/${id}/book`)).json();
    // The last real trade: bob bought No against the 45¢ Yes bid (polled: the indexer runs every 2s).
    await expect.poll(async () => (await bookNow()).lastPrice, { timeout: 20_000 }).toBe(45);
    expect((await bookNow()).bids[0].yes).toBe(50); // the signed bid now leads the escrowed 45

    const orders = page.getByRole("region", { name: "Your open orders" });
    await expect(orders.getByText("10 @ 50¢")).toBeVisible();
    await orders.getByRole("button", { name: "Remove" }).click();
    await expect(orders).toHaveCount(0, { timeout: 20_000 });
  });

  test("the order book shows real levels and the mid is labelled indicative", async ({ page }) => {
    const id = await liveMarket("book");
    await page.goto(`/markets/${id}`);
    const book = page.getByRole("region", { name: "Order book" });
    await expect(book.getByRole("list", { name: /Asks/ }).getByText("55¢")).toBeVisible();
    await expect(book.getByRole("list", { name: /Bids/ }).getByText("45¢")).toBeVisible();
    await expect(book.getByText("Spread 10¢")).toBeVisible();
    await expect(book.getByTitle(/Indicative only, not a trade/)).toBeVisible();
  });
});
