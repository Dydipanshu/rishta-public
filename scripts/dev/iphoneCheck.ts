// iPhone 13 in real WebKit: layout, sideways scroll, and every mic state. The mic and the talk
// endpoint are faked in the page, so this needs no microphone, no keys and makes no model calls.
import { devices, webkit, type Page } from "playwright";
const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "out/iphone";
const problems: string[] = [];
const check = (ok: boolean, what: string) => { console.log(ok ? "ok " : "BAD", what); if (!ok) problems.push(what); };

// Runs inside the page before the app loads.
const fakeMic = (denied: boolean) => {
  const w = window as unknown as Record<string, unknown>;
  w.__tracksStopped = 0;
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: async () => {
    if (denied) throw new DOMException("denied", "NotAllowedError");
    return { getTracks: () => [{ stop: () => { w.__tracksStopped = (w.__tracksStopped as number) + 1; } }] };
  } } });
  w.MediaRecorder = class {
    static isTypeSupported = (t: string) => t === "audio/mp4";
    state = "inactive";
    mimeType = "audio/mp4";
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["clip"], { type: "audio/mp4" }) });
      this.onstop?.();
    }
  };
};

const open = async (denied: boolean) => {
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ ...devices["iPhone 13"]! });
  await ctx.addInitScript("window.__name = (f) => f"); // tsx wraps functions with this helper
  await ctx.addInitScript(fakeMic, denied);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check(false, `page error: ${e.message}`));
  let talks = 0;
  let type = "";
  await page.route("**/api/talk/**", async (route) => {
    talks++;
    type = route.request().headers()["content-type"] ?? "";
    await route.fulfill({ contentType: "application/x-ndjson", body: `${JSON.stringify({ type: "transcript", text: "मेरा पैसा कम आया" })}\n${JSON.stringify({ type: "say", text: "जी, देख लिया।", audio: "/voice-samples/ishita_enhi_customer.mp3" })}\n${JSON.stringify({ type: "end" })}\n` });
  });
  await page.goto(`${BASE}/?shop=M001`);
  await page.getByText("Paytm Assistant").first().waitFor();
  return { browser, page, sent: () => ({ talks, type }) };
};
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const mic = (page: Page) => page.getByRole("button", { name: "Hold to talk" });
const listening = async (page: Page) => {
  await page.getByText(/सुन रही हूँ/).first().waitFor({ timeout: 8000 }).catch(async (e) => {
    await page.screenshot({ path: `${OUT}/stuck.png` });
    console.log("STUCK, page says:", (await page.locator("body").innerText()).slice(-300));
    throw e;
  });
};
const press = (page: Page, type: string) => mic(page).dispatchEvent(type, { pointerId: 1, pointerType: "touch", bubbles: true });

{
  const { browser, page, sent } = await open(false);
  await page.screenshot({ path: `${OUT}/shop.png` });
  check((await sideways(page)) <= 1, "shop page does not scroll sideways");
  const box = await mic(page).boundingBox();
  const view = page.viewportSize()!;
  check(!!box && box.y + box.height <= view.height && box.x + box.width <= view.width, "mic is on screen");
  check(!!box && box.height >= 44, "mic is big enough to press");
  const input = page.getByLabel("Type your message");
  check(parseFloat(await input.evaluate((e) => getComputedStyle(e).fontSize)) >= 16, "input text is 16px or more, so no zoom");
  check((await page.evaluate(() => document.querySelector('meta[name=viewport]')!.getAttribute("content")))!.includes("viewport-fit=cover"), "viewport reaches the screen edges");
  check(await page.evaluate(async () => { const links = [...document.querySelectorAll<HTMLLinkElement>("link[rel=stylesheet]")]; return (await Promise.all(links.map(async (l) => (await fetch(l.href)).text()))).join("").includes("touch-callout:none"); }), "long press shows no menu");

  // Tap once to listen, tap again to send.
  await mic(page).tap();
  await listening(page);
  await page.waitForTimeout(600);
  check(sent().talks === 0 && await page.getByText(/सुन रही हूँ/).first().isVisible(), "a tap keeps listening");
  await page.screenshot({ path: `${OUT}/listening.png` });
  await mic(page).tap();
  await page.getByText("जी, देख लिया।").waitFor();
  check(sent().talks === 1 && sent().type.includes("multipart"), "second tap sends the clip");
  check((await page.evaluate(() => (window as unknown as { __tracksStopped: number }).__tracksStopped)) > 0, "mic closes after the clip");

  // The phone takes the touch away during a hold: the clip must still go.
  await press(page, "pointerdown");
  await listening(page);
  await page.waitForTimeout(500);
  await press(page, "pointercancel");
  await page.waitForFunction(() => !document.body.innerText.includes("सुन रही हूँ…"), undefined, { timeout: 5000 }).catch(() => check(false, "cancelled hold left the mic on"));
  await page.waitForTimeout(800);
  check(sent().talks === 2, "a cancelled hold still sends");
  await page.screenshot({ path: `${OUT}/reply.png` });

  await page.getByRole("button", { name: "Change shop" }).click();
  await page.getByText("Sharma Medicos").first().waitFor();
  await page.screenshot({ path: `${OUT}/picker.png` });
  check((await sideways(page)) <= 1, "shop picker does not scroll sideways");
  for (const path of ["/", "/new", "/sales", "/demo/today"]) {
    await page.goto(BASE + path);
    await page.waitForTimeout(800);
    check((await sideways(page)) <= 1, `${path} does not scroll sideways`);
    await page.screenshot({ path: `${OUT}/page${path.replaceAll("/", "-")}.png` });
  }
  await browser.close();
}
{
  const { browser, page } = await open(true);
  await press(page, "pointerdown");
  await page.getByText(/Website Settings/).waitFor({ timeout: 5000 }).catch(() => check(false, "denied mic gave no help"));
  check(await page.getByText(/Website Settings/).isVisible(), "denied mic says how to allow it");
  await page.screenshot({ path: `${OUT}/denied.png` });
  await browser.close();
}
{
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ ...devices["iPhone SE"]! });
  await ctx.addInitScript("window.__name = (f) => f"); // tsx wraps functions with this helper
  await ctx.addInitScript(fakeMic, false);
  const page = await ctx.newPage();
  for (const path of ["/", "/?shop=M001", "/new", "/sales"]) {
    await page.goto(BASE + path);
    await page.waitForTimeout(900);
    check((await sideways(page)) <= 1, `small iPhone: ${path} does not scroll sideways`);
    await page.screenshot({ path: `${OUT}/se${path.replace(/\W/g, "-")}.png` });
  }
  const box = await mic(await (async () => { await page.goto(`${BASE}/?shop=M001`); await page.getByText("Paytm Assistant").first().waitFor(); return page; })()).boundingBox();
  check(!!box && box.y + box.height <= page.viewportSize()!.height, "small iPhone: mic is on screen");
  await browser.close();
}
console.log(problems.length ? `${problems.length} problems` : "All iPhone checks passed");
process.exit(problems.length ? 1 : 0);
