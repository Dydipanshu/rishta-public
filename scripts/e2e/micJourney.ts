// The whole app in a real browser, spoken through a virtual microphone.
// Needs the app running on port 3000. Exits non-zero on any failure.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { SarvamAIClient } from "sarvamai";

process.loadEnvFile(".env");
const SHOTS = "out/e2e";
mkdirSync(SHOTS, { recursive: true });
const c = new SarvamAIClient({ apiSubscriptionKey: process.env.SARVAM_API_KEY! });
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};
const clip = async (text: string) =>
  ((await c.textToSpeech.convert({ text, language_code: "hi-IN", model: "bulbul:v4-flash", speaker: "aarti_hi_customer", speech_sample_rate: 24000, output_audio_codec: "wav" } as never)) as { audios: string[] }).audios[0]!;
const noise = () => {
  const n = 32000;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.floor((Math.random() - 0.5) * 12000), 44 + i * 2);
  return b.toString("base64");
};

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
const errors: string[] = [];
let played = 0, blocked = 0;
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.text() === "AUDIO ok") played++;
  else if (m.text() === "AUDIO blocked") blocked++;
  else if (m.type() === "error") errors.push(m.text());
});
await page.addInitScript(() => {
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  navigator.mediaDevices.getUserMedia = async () => dest.stream;
  (window as never as { say: (b: string) => Promise<number> }).say = async (b64) => {
    await ctx.resume();
    const buffer = await ctx.decodeAudioData(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)).buffer);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(dest);
    src.start();
    return buffer.duration;
  };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const r = play.call(this);
    r.then(() => console.log("AUDIO ok")).catch((e: Error) => { if (e.name === "NotAllowedError") console.log("AUDIO blocked"); });
    return r;
  };
});

const hold = async (b64: string | null, ms = 200) => {
  const box = (await page.getByRole("button", { name: /Paytm|Hold/ }).last().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(350);
  const seconds = b64 ? await page.evaluate((b) => (window as never as { say: (b: string) => Promise<number> }).say(b), b64) : 0;
  await page.waitForTimeout(seconds ? seconds * 1000 + 300 : ms);
  await page.mouse.up();
};
const bubbles = page.locator("div.bg-navy.ml-auto");
const body = () => page.locator("main").innerText();
const next = (name: string | RegExp) => page.getByRole("button", { name }).click({ timeout: 8000 });

await page.goto("http://localhost:3000/");
await page.getByRole("button", { name: "Start", exact: true }).click();
await page.waitForURL("**/today");
await next("See the first shop");
await next(/^Contact/);
await page.getByText("Tap to say this").first().waitFor({ timeout: 30_000 });
await page.waitForTimeout(9000);

await hold(null, 0);
await page.waitForTimeout(800);
check((await body()).includes("बटन दबाकर रखें, फिर बोलें"), "an accidental tap gets a hint, not a reply");

await hold(noise());
await page.waitForTimeout(9000);
const misheard = await bubbles.allInnerTexts();
check(misheard.length === 0, `noise is not treated as speech ${misheard.join(" / ")}`);

for (const [i, line] of ["मेरे settlement में पैसे कम क्यों आए?", "अच्छा समझ गया, मैं Soundbox रख लेता हूँ"].entries()) {
  const before = await bubbles.count();
  await hold(await clip(line));
  await bubbles.nth(before).waitFor({ timeout: 15_000 }).catch(() => undefined);
  const heard = (await bubbles.allInnerTexts()).at(before) ?? "";
  await page.waitForTimeout(i === 0 ? 14_000 : 1000);
  check(heard.includes(i === 0 ? "कम" : "रख"), `the mic heard "${line}" as "${heard}"`);
  await page.screenshot({ path: `${SHOTS}/talk-${i}.png` });
}
await page.getByRole("button", { name: "See what happened" }).waitFor({ timeout: 30_000 });
await next("See what happened");
await next(/Jump 30 days: did/);
await page.getByText("30 days later").waitFor({ timeout: 8000 });
await page.screenshot({ path: `${SHOTS}/result.png` });
check(true, "conversation finished and the result settled");
await next("See the proof");
await next("Why shops leave");
await next("The team");
check((await body()).length > 0, "reached the last page");

await next("Try Sharma Medicos");
await next(/^Contact/);
await page.getByText("Tap to say this").first().waitFor({ timeout: 30_000 });
await page.waitForTimeout(9000);
for (const line of ["मेरा Soundbox का battery बार बार खत्म हो जाता है", "हाँ replacement भेज दीजिए"]) {
  await hold(await clip(line));
  await page.waitForTimeout(14_000);
}
await page.getByRole("button", { name: "See what happened" }).waitFor({ timeout: 30_000 });
await next("See what happened");
check((await body()).includes("Sharma"), "a second shop works end to end");
await page.screenshot({ path: `${SHOTS}/sharma.png` });

for (const [path, text] of [["/voices", "Pick Rishta"], ["/sales", "Your list for today"], ["/phone/M001", "Ramesh General Store"]] as const) {
  await page.goto(`http://localhost:3000${path}`);
  check(await page.getByText(text).first().isVisible({ timeout: 5000 }).catch(() => false), `${path} opens`);
}

check(played > 3 && blocked === 0, `spoken replies played (${played} played, ${blocked} blocked)`);
check(errors.length === 0, `no browser errors ${errors.slice(0, 3).join(" / ")}`);
await browser.close();
await fetch("http://localhost:3000/api/reset", { method: "POST" });
console.log(failures.length ? `${failures.length} FAILED` : "ALL PASSED");
process.exit(failures.length ? 1 : 0);
