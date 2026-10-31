// Light check of the public site with plain fetch, no browser. Needs PUBLIC_SITE=true on the target.
//   tsx scripts/dev/visitors.ts            8 visitors talk at once, each must see only their own words
//   tsx scripts/dev/visitors.ts clip.m4a   sends a real m4a the way an iPhone does and prints the transcript
import { readFileSync } from "node:fs";
const BASE = process.env.E2E_URL ?? "http://localhost:3000";

const visitor = async () => {
  const first = await fetch(`${BASE}/api/site`);
  const cookie = first.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("No visitor cookie: is PUBLIC_SITE on?");
  return { "/": (path: string, init: RequestInit = {}) => fetch(BASE + path, { ...init, headers: { ...init.headers, cookie } }) }["/"];
};
const events = async (res: Response) => {
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string; text?: string; filler?: boolean; message?: string });
};
const transcript = async (get: Awaited<ReturnType<typeof visitor>>) => {
  const m = (await (await get("/api/merchant/M001")).json()) as { conversation: { transcript: { role: string; text: string }[] } | null };
  return m.conversation?.transcript ?? [];
};

const clip = process.argv[2];
if (clip) {
  const get = await visitor();
  const form = new FormData();
  form.append("audio", new Blob([readFileSync(clip)], { type: "audio/mp4" }), "clip.m4a");
  const started = performance.now();
  const out = await events(await get("/api/talk/M001", { method: "POST", body: form }));
  console.log(`${Math.round(performance.now() - started)} ms`);
  for (const e of out) console.log(e.type, e.filler ? "(filler)" : "", e.text ?? e.message ?? "");
  if (!out.some((e) => e.type === "transcript" && e.text)) process.exit(1);
} else {
  const people = [];
  for (let i = 0; i < 8; i++) people.push({ code: `कोड${9100 + i}`, get: await visitor() });
  const started = performance.now();
  const replies = await Promise.all(people.map(async ({ code, get }) => {
    const res = await get("/api/talk/M001", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: `आज का collection कितना है? ${code}` }) });
    return events(res);
  }));
  console.log(`8 turns at once: ${Math.round(performance.now() - started)} ms`);
  let bad = 0;
  for (const [i, { code, get }] of people.entries()) {
    const lines = await transcript(get);
    const text = lines.map((l) => l.text).join(" ");
    const leaked = people.filter((p) => p.code !== code && text.includes(p.code)).map((p) => p.code);
    const ok = text.includes(code) && leaked.length === 0 && replies[i]!.some((e) => e.type === "say" && !e.filler);
    if (!ok) bad++;
    console.log(ok ? "ok " : "BAD", code, `${lines.length} lines`, leaked.join(" "), lines.at(-1)?.text.slice(0, 60) ?? "");
  }
  if (bad) process.exit(1);
  console.log("Each visitor saw only their own conversation");
}
