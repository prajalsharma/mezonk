import { expect, test } from "@playwright/test";

test("search closes on a click outside it, on Esc, and on its close button", async ({ page }) => {
  await page.goto("/");
  const open = () => page.getByRole("button", { name: /Search markets/ }).click();
  const dialog = page.getByRole("dialog", { name: "Search and navigate" });

  await open();
  await expect(dialog).toBeVisible();
  await page.mouse.click(10, page.viewportSize()!.height - 10); // the dimmed backdrop
  await expect(dialog).toBeHidden();

  await open();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await open();
  await dialog.getByRole("button", { name: "Close search" }).click();
  await expect(dialog).toBeHidden();
});
