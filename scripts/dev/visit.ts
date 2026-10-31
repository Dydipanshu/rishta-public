// Walks the public site as real visitors on a phone and a laptop, and saves what each one sees.
import { chromium, devices, webkit, type Browser } from "playwright";
const OUT = process.argv[2] ?? "out/visit";
const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const problems: string[] = [];
const watch = (page: import("playwright").Page, who: string) => {
  page.on("pageerror", (e) => problems.push(`${who}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.text())) problems.push(`${who}: ${m.text()}`); });
};
const noScroll = async (page: import("playwright").Page, where: string) => {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (wide > 1) problems.push(`${where}: page scrolls sideways by ${wide}px`);
};
async function phone(browser: Browser, name: string, device: (typeof devices)[string]) {
  const ctx = await browser.newContext({ ...device, permissions: name === "android" ? ["microphone"] : [] });
  const page = await ctx.newPage();
  watch(page, name);
  await page.goto(BASE);
  await page.getByRole("heading", { name: /Rishta is one/ }).waitFor();
  await noScroll(page, `${name} home`);
  await page.screenshot({ path: `${OUT}/${name}-home.png` });
  await page.locator("#shops").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${name}-shops.png` });
  await page.getByRole("link", { name: /Ramesh General Store/ }).click();
  await page.getByText("Ramesh General Store").first().waitFor();
  await page.waitForTimeout(800);
  await noScroll(page, `${name} shop`);
  await page.screenshot({ path: `${OUT}/${name}-chat.png` });
  await page.getByRole("button", { name: /settlement में पैसे/ }).click();
  await page.getByText(/44\.84/).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${name}-reply.png` });
  await page.getByRole("button", { name: "Change shop" }).click();
  await page.getByText("Sharma Medicos").first().waitFor();
  await page.screenshot({ path: `${OUT}/${name}-picker.png` });
  await page.getByRole("button", { name: /Sharma Medicos/ }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}-switched.png` });
  await page.getByRole("button", { name: /^Rishta/ }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}-rishta.png` });
  await page.getByRole("button", { name: "Close" }).click();
  await page.goto(`${BASE}/new`);
  await page.getByPlaceholder("Asha Kirana Store").fill("Asha Kirana Store");
  await page.getByPlaceholder("Asha", { exact: true }).fill("Asha");
  await page.getByPlaceholder("Lucknow").fill("Lucknow");
  await noScroll(page, `${name} new shop`);
  await page.screenshot({ path: `${OUT}/${name}-new.png`, fullPage: true });
  await page.getByRole("button", { name: /Soundbox keeps failing/ }).click();
  await page.getByRole("button", { name: "Open my shop" }).click();
  await page.waitForURL(/shop=MY/);
  await page.getByText("What Rishta sees").waitFor();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}-mine.png` });
  for (const p of ["today", "decisions", "loans", "proof", "why", "team"]) {
    await page.goto(`${BASE}/demo/${p}`);
    await page.waitForTimeout(900);
    await noScroll(page, `${name} /demo/${p}`);
    await page.screenshot({ path: `${OUT}/${name}-demo-${p}.png` });
  }
  await ctx.close();
}
const chrome = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
await phone(chrome, "android", devices["Pixel 7"]!);
try {
  const safari = await webkit.launch();
  await phone(safari, "iphone", devices["iPhone 13"]!);
  await safari.close();
} catch (e) {
  problems.push(`iphone run: ${(e as Error).message.split("\n")[0]}`);
}
const laptop = await (await chrome.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
watch(laptop, "laptop");
for (const [p, f] of [["/", "home"], ["/new", "new"], ["/?shop=M001", "shop"]] as const) {
  await laptop.goto(BASE + p);
  await laptop.waitForTimeout(1000);
  await laptop.screenshot({ path: `${OUT}/laptop-${f}.png` });
}
await chrome.close();
console.log(problems.length ? `PROBLEMS\n${[...new Set(problems)].join("\n")}` : "No problems");
