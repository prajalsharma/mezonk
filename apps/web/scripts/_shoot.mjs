import { chromium } from "@playwright/test";
// usage: node _shoot.mjs <outDir> <base> <comma paths> [themes]
const [out, base, pathsArg, themesArg] = process.argv.slice(2);
const pages = pathsArg.split(",");
const themes = (themesArg ?? "light,dark").split(",");
const vps = [["desktop", 1440, 900], ["tablet", 820, 1180], ["mobile", 390, 844]];
const browser = await chromium.launch();
for (const theme of themes) {
  for (const [name, w, h] of vps) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" });
    await ctx.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch {} }, theme);
    const page = await ctx.newPage();
    for (const p of pages) {
      try {
        await page.goto(base + p, { waitUntil: "load", timeout: 45000 });
        await page.waitForTimeout(2500);
        const slug = p === "/" ? "home" : p.replace(/^\//, "").replace(/[\/?=&]/g, "_");
        await page.screenshot({ path: `${out}/${theme}-${name}-${slug}.png`, fullPage: name !== "mobile", timeout: 30000 });
      } catch (e) { console.log("skip", p, name, theme, e.message.slice(0, 100)); }
    }
    await ctx.close();
  }
}
await browser.close(); console.log("done");
