import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the LOCAL FORK stack. Start it first:
 *   ./scripts/dev-chain.sh   (repo root)   then   pnpm dev   (apps/web)
 * Tests sign real transactions with anvil test wallets and verify results on-chain.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.APP_URL ?? "http://localhost:3000", trace: "retain-on-failure", screenshot: "only-on-failure", actionTimeout: 30_000 },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile/ },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" }, testMatch: /mobile/ },
  ],
});
