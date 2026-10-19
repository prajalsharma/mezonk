import { expect, test } from "@playwright/test";

for (const path of ["/", "/discover", "/markets", "/markets/4", "/markets/5", "/portfolio", "/activity"]) {
  test(`no horizontal overflow on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForTimeout(3000);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("resolution panel and bottom navigation are usable at phone width", async ({ page }) => {
  await page.goto("/markets/4");
  await expect(page.getByRole("heading", { name: "Resolution", exact: true })).toBeVisible();
  await expect(page.getByText(/^Challenged · /)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" }).last().getByRole("link", { name: "Portfolio" })).toBeVisible();
});
