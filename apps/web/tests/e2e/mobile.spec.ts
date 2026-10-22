import { expect, test } from "@playwright/test";

for (const path of ["/", "/discover", "/markets", "/markets/2", "/markets/5", "/markets/8", "/suggest", "/proposals", "/resolve", "/settings", "/portfolio", "/activity", "/docs", "/status"]) {
  test(`no horizontal overflow on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForTimeout(7000); // after the book, quotes and chart have loaded
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("resolution panel and bottom navigation are usable at phone width", async ({ page }) => {
  await page.goto("/markets/5"); // the seeded disputed market
  await expect(page.getByRole("heading", { name: "Resolution", exact: true })).toBeVisible();
  await expect(page.getByText(/^Challenged · /)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" }).last().getByRole("link", { name: "Portfolio" })).toBeVisible();
});

test("search can be dismissed by tapping outside it at phone width", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Search markets/ }).click();
  const dialog = page.getByRole("dialog", { name: "Search and navigate" });
  await expect(dialog).toBeVisible();
  await page.mouse.click(10, page.viewportSize()!.height - 10);
  await expect(dialog).toBeHidden();
});
