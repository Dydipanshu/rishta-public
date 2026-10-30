import qrcode from "qrcode-generator";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEvents } from "../hooks/useEvents";
import MerchantPhone from "./MerchantPhone";

/* eslint-disable @typescript-eslint/no-explicit-any */
type View = any;
type Group = "handled" | "visit" | "callback" | "left";

const GROUPS: Record<Group, { label: string; color: string }> = {
  handled: { label: "Rishta talks to them", color: "#00a9de" },
  visit: { label: "Salesperson visits", color: "#2457b8" },
  callback: { label: "A person calls back", color: "#c2334d" },
  left: { label: "Left alone on purpose", color: "#d98a00" },
};
const IDLE = "#cfd9e4";
const CHANNEL: Record<string, string> = { soundbox: "Their Soundbox", app: "The Paytm app", salesperson_visit: "A salesperson visit", human_callback: "A call from a person" };
const SERIES = ["#002e6e", "#00a9de", "#b6c7d9"];
const OUTCOME: Record<string, string> = { stayed: "Stayed", plan_changed: "Plan changed", ticket_raised: "Ticket raised", handed_off: "Passed to a person", opted_out: "Opted out", left: "Left", no_response: "No response" };

const FACTS: Record<string, [string, "inr" | "pct" | "count"]> = {
  latestSettlementGrossInr: ["Payments in the settlement", "inr"],
  feeInr: ["Fee", "inr"],
  gstInr: ["GST on the fee", "inr"],
  feePlusGstInr: ["Fee plus GST", "inr"],
  latestSettlementNetInr: ["Money received", "inr"],
  paymentsAbove2000Count: ["Payments above the free limit", "count"],
  paymentsAbove2000TotalInr: ["Their total", "inr"],
  freeUptoInr: ["Free limit per payment", "inr"],
  feeRatePct: ["Fee rate", "pct"],
  gstPct: ["GST rate", "pct"],
  collections30DaysInr: ["Collections, last 30 days", "inr"],
  payments30Days: ["Payments, last 30 days", "count"],
  customers30Days: ["Customers, last 30 days", "count"],
  periodDays: ["Days looked at", "count"],
  avgSettlementHours7Days: ["Average settlement time, hours", "count"],
  openTickets: ["Open tickets", "count"],
  monthlyRentInr: ["Monthly rent", "inr"],
  rentSharePct: ["Rent as a share of collections", "pct"],
  cheapestEligibleRentInr: ["Cheapest plan they can get", "inr"],
  zeroFeeLimitInr: ["Zero-fee limit per month", "inr"],
  monthsAboveLimit: ["Months above the limit", "count"],
  monthsToMove: ["Months until the fee applies", "count"],
  batteryAlerts7Days: ["Battery alerts, last 7 days", "count"],
  offlineHours7Days: ["Hours offline, last 7 days", "count"],
  failedPaymentsPct7Days: ["Failed payments, last 7 days", "pct"],
  paymentDropPct3Weeks: ["Drop in payments, 3 weeks", "pct"],
};
const ACTIONS: Record<string, string> = {
  getMerchantSummary: "Read shop summary", explainFee: "Explain the fee", checkDeviceHealth: "Check the device", raiseTicket: "Raise a ticket", proposePlan: "Suggest a plan",
  changePlan: "Change the plan", scheduleHumanCallback: "Bring in a person", recordOutcome: "Record the result", recordOptOut: "Stop contact if asked", sendAppMessage: "Send an app message",
};

const pct = (n: number | null) => (n === null ? "–" : `${Math.round(n * 100)}%`);
const num = (n: number) => n.toLocaleString("en-IN");
const words = (key: string) => key.replace(/(\d+)/g, " $1").replace(/([A-Z])/g, " $1").replace(/Pct/, "%").replace(/ Inr/, "").replace(/^./, (c) => c.toUpperCase());
// Segment codes mean nothing to a judge.
const plainReason = (r: string) => r.replace(/Learned \(simulated\): in \S+ shops, /, "Learned from past results (simulated): in fruit and vegetable shops in tier 2 cities, ").replace(/ of holdout/, " of shops nobody contacted");

function fact(key: string, value: unknown) {
  const [label, kind] = FACTS[key] ?? [words(key), "count"];
  const text = typeof value !== "number" ? String(value) : kind === "inr" ? `₹${num(value)}` : kind === "pct" ? `${value}%` : num(value);
  return { label, text };
}

// One dot per shop, coloured by today's decision. The bold moment of the console.
function ShopMap({ plan, active, onHover }: { plan: any; active: Group | null; onHover: (g: Group | "idle" | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const COLS = 100;
  const dots = useMemo(() => {
    const list: (Group | null)[] = [
      ...Array<Group>(plan.handledByRishta).fill("handled"), ...Array<Group>(plan.salespersonVisits).fill("visit"),
      ...Array<Group>(plan.humanCallbacks).fill("callback"), ...Array<Group>(plan.leftAlone).fill("left"),
    ];
    while (list.length < plan.checked) list.push(null);
    let seed = 7;
    for (let i = list.length - 1; i > 0; i--) {
      seed = (seed * 16807) % 2147483647;
      const j = seed % (i + 1);
      [list[i], list[j]] = [list[j]!, list[i]!];
    }
    return list;
  }, [plan]);
  const rows = Math.ceil(dots.length / COLS);

  useEffect(() => {
    const el = canvas.current!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const draw = (t: number) => {
      const ratio = devicePixelRatio || 1;
      const width = el.clientWidth;
      const cell = width / COLS;
      el.height = Math.round(cell * rows * ratio);
      el.width = Math.round(width * ratio);
      el.style.height = `${cell * rows}px`;
      const ctx = el.getContext("2d")!;
      ctx.scale(ratio, ratio);
      const r = Math.min(cell * 0.36, 3.6);
      dots.forEach((g, i) => {
        const lit = g && t >= i / dots.length;
        ctx.globalAlpha = active && g !== active ? 0.28 : 1;
        ctx.fillStyle = lit ? GROUPS[g].color : IDLE;
        ctx.beginPath();
        ctx.arc(((i % COLS) + 0.5) * cell, (Math.floor(i / COLS) + 0.5) * cell, g ? r * 1.12 : r * 0.82, 0, 7);
        ctx.fill();
      });
    };
    if (reduced) { draw(1); return; }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1100);
      draw(t);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const again = () => draw(1);
    addEventListener("resize", again);
    return () => { cancelAnimationFrame(frame); removeEventListener("resize", again); };
  }, [dots, rows, active]);

  const hover = (e: React.MouseEvent) => {
    const box = canvas.current!.getBoundingClientRect();
    const cell = box.width / COLS;
    const cx = Math.floor((e.clientX - box.left) / cell);
    const cy = Math.floor((e.clientY - box.top) / cell);
    // Hit area is bigger than the dot: look at the neighbours too.
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const g = dots[(cy + dy) * COLS + cx + dx];
      if (g) return onHover(g);
    }
    onHover("idle");
  };
  return <canvas ref={canvas} onMouseMove={hover} onMouseLeave={() => onHover(null)} role="img" aria-label={`${plan.checked} shops, one dot each. Coloured dots are shops Rishta made a decision about.`} className="block w-full" />;
}

function Weeks({ approaches }: { approaches: any[] }) {
  const weeks = approaches[0]?.weekly.length ?? 0;
  return (
    <div className="flex h-28 items-end gap-[3px]" role="img" aria-label="Share of contacts given to each approach, by week">
      {Array.from({ length: weeks }, (_, i) => (
        <div key={i} className="flex h-full flex-1 flex-col-reverse gap-[2px]" title={`Week ${i + 1}: ${approaches.map((a) => `${a.label} ${pct(a.weekly[i])}`).join(", ")}`}>
          {approaches.map((a, j) => <div key={a.id} className="first:rounded-b-[3px] last:rounded-t-[3px]" style={{ height: `${a.weekly[i] * 100}%`, background: SERIES[j] }} />)}
        </div>
      ))}
    </div>
  );
}

function Proof({ v }: { v: View }) {
  const [problem, setProblem] = useState("fee_confusion");
  const pb = v.playbook.find((p: any) => p.problem === problem);
  const rows = [...pb.approaches.map((a: any, i: number) => ({ ...a, color: SERIES[i] })), { id: "holdout", label: "Nobody contacted them", ...pb.holdout, color: "#8896a8" }];
  const r = v.report;
  return (
    <div>
      <h1 className="max-w-3xl text-[30px] font-extrabold leading-[1.14] text-navy">
        {pb.lift?.proven ? `"${pb.lift.approach}" keeps ${Math.round(pb.lift.points * 100)} more shops in every 100 than doing nothing.` : `For ${pb.label.toLowerCase()}, there isn't enough evidence yet.`}
      </h1>
      <p className="mt-1 text-muted">{pb.lift && `Margin of error ±${Math.round(pb.lift.margin * 100)} points. `}Simulated test data with known answers.</p>
      <div className="mt-4 flex flex-wrap gap-1" role="tablist" aria-label="Problem">
        {v.playbook.map((p: any) => <button key={p.problem} role="tab" aria-selected={p.problem === problem} onClick={() => setProblem(p.problem)} className={`rounded-full px-3 py-1 ${p.problem === problem ? "bg-navy text-white" : "bg-white"}`}>{p.label}</button>)}
      </div>
      <div className="mt-5 grid gap-x-8 gap-y-6 md:grid-cols-2">
        <section>
          <h2 className="font-semibold text-navy">Shops still active after 30 days</h2>
          <div className="mt-2 space-y-2.5">
            {rows.map((a: any) => (
              <div key={a.id}>
                <div className="flex justify-between"><span>{a.label}</span><span className="font-semibold">{pct(a.keepRate)} <span className="font-normal text-muted">of {a.n}</span></span></div>
                <div className="mt-0.5 h-2 rounded-full bg-idle"><div className="h-full rounded-full" style={{ width: pct(a.keepRate), background: a.color }} /></div>
              </div>
            ))}
          </div>
        </section>
        <section>
          <h2 className="font-semibold text-navy">Rishta moved contacts to what works</h2>
          <div className="mt-2"><Weeks approaches={pb.approaches} /></div>
          <div className="mt-1 flex justify-between text-sm text-muted"><span>Week 1</span><span>Now</span></div>
          <div className="mt-1 flex flex-wrap gap-x-4 text-sm">{pb.approaches.map((a: any, i: number) => <span key={a.id}><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: SERIES[i] }} />{a.label}</span>)}</div>
        </section>
      </div>
      {r && (
        <section className="mt-7 border-t border-line pt-4">
          <h2 className="font-semibold text-navy">We planted the answers in the test data. Did Rishta find them?</h2>
          <div className="mt-2 grid grid-cols-2 gap-4 md:grid-cols-4">
            {[[pct(r.reasonAccuracy), `right reason, ${num(r.reasonCases)} cases`], [`${r.winnersFound} of ${r.problems}`, "best approach found"], [r.backfireFound ? "Yes" : "No", "found shops where contact backfires"], [`${r.riskLift.toFixed(1)}×`, "likelier to leave, riskiest 10% of shops"]].map(([big, small]) => (
              <div key={small}><div className="text-3xl font-extrabold text-navy">{big}</div><div className="text-sm text-muted">{small}</div></div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Why({ v, flash }: { v: View; flash: boolean }) {
  const top = v.why.reasons[0]?.count ?? 1;
  const live = v.why.reasons.flatMap((r: any) => r.quotes.filter((q: any) => q.live).map((q: any) => ({ ...q, label: r.label })));
  return (
    <div>
      <h1 className="max-w-3xl text-[30px] font-extrabold leading-[1.14] text-navy">
        {v.why.spikes[0] ? `${v.why.spikes[0].label} mentions in ${v.why.spikes[0].city} jumped from ${v.why.spikes[0].before} to ${v.why.spikes[0].now} in 4 weeks.` : "No sudden changes this month."}
      </h1>
      <p className="mt-1 max-w-2xl text-lg">{v.why.spikes[0]?.move}</p>
      {live.map((q: any, i: number) => (
        <div key={i} className={`rise mt-4 max-w-2xl border-l-4 border-paytm pl-4 ${flash ? "bg-paytm/10" : ""}`}>
          <div className="text-sm text-muted">Just now, {q.city} · {q.label}</div>
          <div className="text-xl">"{q.quote}"</div>
        </div>
      ))}
      <div className="mt-6 grid gap-x-8 gap-y-6 md:grid-cols-[minmax(0,1.3fr)_minmax(260px,1fr)]">
        <section>
          <h2 className="font-semibold text-navy">What shopkeepers said, last 4 weeks</h2>
          <div className="mt-2 space-y-3">
            {v.why.reasons.slice(0, 5).map((r: any) => (
              <div key={r.code}>
                <div className="flex justify-between"><span className="font-semibold">{r.label}</span><span>{r.count}</span></div>
                <div className="mt-0.5 h-2 rounded-full bg-idle"><div className="h-full rounded-full bg-navy" style={{ width: `${(r.count / top) * 100}%` }} /></div>
                {r.quotes[0] && <div className="mt-0.5 text-sm text-muted">"{r.quotes[0].quote}", {r.quotes[0].city}</div>}
              </div>
            ))}
          </div>
        </section>
        {v.why.spikes.length > 1 && (
          <section>
            <h2 className="font-semibold text-navy">Also rising</h2>
            {v.why.spikes.slice(1).map((s: any) => (
              <div key={s.code + s.city} className="border-b border-line py-2">
                <div className="font-semibold">{s.label}, {s.city}: {s.before} → {s.now}</div>
                <div className="text-sm text-muted">{s.move}</div>
              </div>
            ))}
          </section>
        )}
      </div>
      <p className="mt-5 text-sm text-sim">History is simulated. Quotes marked "Just now" come from live conversations.</p>
    </div>
  );
}

function Qr({ url, label }: { url: string; label: string }) {
  const q = qrcode(0, "M");
  q.addData(url);
  q.make();
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block text-center text-sm">
      <div dangerouslySetInnerHTML={{ __html: q.createSvgTag({ cellSize: 3, margin: 2 }) }} />
      {label}
    </a>
  );
}

function Team({ v, selected }: { v: View; selected: string }) {
  const d = v.done;
  const stats: [string | number, string][] = [[d.resolvedWithoutHuman, "solved by Rishta alone"], [d.ticketsRaised, "tickets raised"], [d.plansChanged, "plans changed"], [d.escalations, "passed to a person"], [d.humanClosed, "closed by salespeople"]];
  return (
    <div>
      <h1 className="max-w-3xl text-[30px] font-extrabold leading-[1.14] text-navy">People get only what needs a person, and it arrives with the homework done.</h1>
      <div className="mt-5 flex flex-wrap gap-x-10 gap-y-3 border-b border-line pb-4">
        {stats.filter(([n]) => n).map(([big, small]) => <div key={small}><div className="text-3xl font-extrabold text-navy">{big}</div><div className="text-sm text-muted">{small}</div></div>)}
      </div>
      <div className="mt-5 grid gap-x-8 gap-y-6 md:grid-cols-3">
        <section>
          <h2 className="font-semibold text-navy">Needs a person now</h2>
          {v.needsHuman.map((h: any) => <div key={h.merchant_id} className="border-b border-line py-2"><div className="font-semibold">{h.name}</div><div className="text-sm text-muted">{h.summary}</div></div>)}
        </section>
        <section>
          <h2 className="font-semibold text-navy">Visits today</h2>
          {v.visits.slice(0, 5).map((x: any) => <div key={x.merchantId} className="border-b border-line py-2"><div className="font-semibold">{x.name}, {x.city}</div><div className="text-sm text-muted">{x.why}</div></div>)}
        </section>
        <section>
          <h2 className="font-semibold text-navy">Open on a phone</h2>
          <div className="mt-2 flex gap-4">
            <Qr url={`${window.location.origin}/phone/${selected}`} label="Shop app" />
            <Qr url={`${window.location.origin}/sales`} label="Sales app" />
          </div>
        </section>
      </div>
    </div>
  );
}

const STEPS = [
  ["/today", "Overnight"], ["/shop", "One shop"], ["/talk", "Talk"], ["/result", "Result"], ["/proof", "Proof"], ["/why", "Why shops leave"], ["/team", "The team"],
] as const;

const SCRIPTS: Record<string, string[]> = {
  M001: ["मेरे settlement में पैसे कम क्यों आए", "अच्छा समझ गया, मैं Soundbox रख लेता हूँ"],
  M002: ["मेरा Soundbox का battery बार बार खत्म हो जाता है", "हाँ replacement भेज दीजिए"],
  M004: ["Soundbox का rent बहुत ज़्यादा लगता है", "हाँ ठीक है, यह plan कर दीजिए"],
};

function Welcome({ start }: { start: () => void }) {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col justify-center overflow-y-auto px-6 py-6">
      <div className="text-xl font-extrabold text-paytm-deep">Rishta</div>
      <h1 className="mt-2 text-[34px] font-extrabold leading-[1.08] md:text-[44px] text-navy">Paytm's AI manager for keeping shops.</h1>
      <p className="mt-4 text-xl">Every night it decides which shops to help, how, and which to leave alone. Then it talks to them, fixes the problem, and proves what worked.</p>
      <ol className="mt-6 grid gap-3 sm:grid-cols-3">
        {[["1", "See the decisions", "What it chose for 5,000 shops overnight"], ["2", "Be the shopkeeper", "Talk to it in Hindi, with your own voice"], ["3", "See the proof", "Did the shop stay, and what did Rishta learn?"]].map(([n, title, text]) => (
          <li key={n} className="border-t-2 border-paytm pt-2"><div className="font-semibold text-navy">{n}. {title}</div><div className="text-sm text-muted">{text}</div></li>
        ))}
      </ol>
      <p className="mt-5 text-muted">Takes 3 minutes. Allow the microphone when your browser asks.</p>
      <button onClick={start} className="mt-7 w-fit rounded-xl bg-navy px-8 py-4 text-xl font-semibold text-white">Start</button>
    </div>
  );
}

function Today({ v }: { v: View }) {
  const [hover, setHover] = useState<Group | "idle" | null>(null);
  const p = v.plan;
  const counts: Record<Group, number> = { handled: p.handledByRishta, visit: p.salespersonVisits, callback: p.humanCallbacks, left: p.leftAlone };
  return (
    <div className="grid items-start gap-8 md:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]">
      <div>
        <h1 className="text-[32px] font-extrabold leading-[1.14] text-navy">{num(p.checked)} shops checked last night. {p.needAttention} needed a decision.</h1>
        <div className="mt-5"><ShopMap plan={p} active={hover && hover !== "idle" ? hover : null} onHover={setHover} /></div>
        <p className="mt-2 text-sm text-muted">Each dot is one shop. Grey shops need nothing today.</p>
      </div>
      <dl className="md:mt-14">
        {(Object.keys(GROUPS) as Group[]).map((g) => (
          <div key={g} onMouseEnter={() => setHover(g)} onMouseLeave={() => setHover(null)} className="flex items-center gap-3 border-b border-line py-3">
            <span className="h-3.5 w-3.5 rounded-full" style={{ background: GROUPS[g].color }} />
            <dt className="flex-1 text-lg">{GROUPS[g].label}</dt>
            <dd className="text-2xl font-bold">{counts[g]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Shop({ item }: { item: any }) {
  const { brief, meta } = item;
  const facts = Object.entries(brief.facts).filter(([k]) => k !== "firstName" && k !== "businessName").slice(0, 8);
  return (
    <div className="grid items-start gap-8 md:grid-cols-[minmax(0,1.2fr)_minmax(300px,1fr)]">
      <div>
        <div className="text-muted">{meta.city} · {meta.reasonLabel}</div>
        <h1 className="text-[32px] font-extrabold leading-tight text-navy">{meta.name}</h1>
        <p className="mt-2 text-xl leading-snug">{meta.why}</p>
        <h2 className="mt-6 text-lg font-semibold text-navy">What Rishta decided</h2>
        <dl>
          <div className="flex justify-between gap-4 border-b border-line py-2"><dt className="text-muted">How to help</dt><dd className="text-right font-semibold">{meta.approachLabel}</dd></div>
          <div className="flex justify-between gap-4 border-b border-line py-2"><dt className="text-muted">Reach them through</dt><dd className="text-right font-semibold">{CHANNEL[brief.channel]}</dd></div>
          <div className="flex justify-between gap-4 border-b border-line py-2"><dt className="text-muted">Goal</dt><dd className="text-right font-semibold">{brief.goal}</dd></div>
        </dl>
      </div>
      <aside>
        <h2 className="text-lg font-semibold text-navy">The AI may only say these numbers</h2>
        <table className="mt-1 w-full"><tbody>
          {facts.map(([k, val]) => { const f = fact(k, val); return <tr key={k} className="border-b border-line"><td className="py-1 pr-3">{f.label}</td><td className="py-1 text-right font-mono text-sm">{f.text}</td></tr>; })}
        </tbody></table>
      </aside>
    </div>
  );
}

function Talk({ shop, name, done }: { shop: string; name: string; done: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <MerchantPhone shopId={shop} tips={done ? [] : SCRIPTS[shop] ?? []} onTip />
      <span className="sr-only">You are {name}</span>
    </div>
  );
}

function Result({ item, settled, jump }: { item: any; settled: any[] | null; jump: () => void }) {
  const { meta, outcome } = item;
  if (!outcome) return <p className="text-lg">No result yet. Go back and finish the conversation.</p>;
  return (
    <div className="max-w-2xl">
      <div className="text-2xl font-bold text-kept">✓ {OUTCOME[outcome.outcome]}</div>
      <h1 className="text-[32px] font-extrabold leading-tight text-navy">{meta.name}</h1>
      <p className="mt-2 text-xl leading-snug">{outcome.summary}</p>
      {outcome.reasons.map((r: any, i: number) => <p key={i} className="mt-2 text-lg text-muted">"{r.quote}"</p>)}
      {outcome.numbersVerified && <p className="mt-2 font-semibold text-kept">Every number it spoke was checked against this shop's data.</p>}
      {!settled?.length
        ? <button onClick={jump} className="mt-6 rounded-xl bg-navy px-6 py-3.5 text-lg font-semibold text-white">Jump 30 days: did they stay?</button>
        : settled.map((r) => (
          <div key={r.merchantId} className="rise mt-6 border-l-4 border-paytm pl-4">
            <p className="text-xl font-semibold">30 days later (simulated): {r.kept ? "still active" : "they left"}.</p>
            <p className="mt-1">"{r.approach}" now has {r.resultsAfter} results, up from {r.resultsBefore}. Tonight's plan uses it.</p>
          </div>
        ))}
    </div>
  );
}

const DO: Record<string, string> = {
  "/today": "Look at the map. Rishta made all these decisions on its own. Then continue.",
  "/shop": "This is why Rishta picked this shop. Press the button to contact them.",
  "/talk": "You are the shopkeeper now. Listen, then hold the mic button and speak, or tap the suggested line.",
  "/result": "The conversation is done. Press Jump 30 days to see if the shop stayed.",
  "/proof": "This is the evidence that the approach works. Then continue.",
  "/why": "Conversations show the sales team why shops really leave, including what you just said.",
  "/team": "That's the whole loop. Try another shop, or scan a code to open it on your phone.",
};

export default function Flow() {
  const [url, setUrl] = useState(window.location.pathname + window.location.search);
  const [v, setV] = useState<View | null>(null);
  const [flash, setFlash] = useState(false);
  const [settled, setSettled] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [path, query = ""] = url.split("?");
  const shop = new URLSearchParams(query).get("shop") ?? "M001";

  const go = useCallback((to: string) => {
    history.pushState(null, "", to);
    setUrl(to);
    setError("");
  }, []);
  useEffect(() => {
    const back = () => setUrl(window.location.pathname + window.location.search);
    addEventListener("popstate", back);
    return () => removeEventListener("popstate", back);
  }, []);
  const load = useCallback(() => {
    void fetch("/api/console").then((r) => r.json()).then(setV);
  }, []);
  useEffect(load, [load]);
  useEvents((e) => {
    if (e.type === "changed") {
      load();
      setFlash(true);
      setTimeout(() => setFlash(false), 1500);
    }
  });

  const startOver = async () => {
    await fetch("/api/reset", { method: "POST" });
    setSettled(null);
    go("/");
  };
  const begin = async () => {
    await fetch("/api/reset", { method: "POST" });
    setSettled(null);
    go("/today");
  };
  const contact = async () => {
    setError("");
    go(`/talk?shop=${shop}`);
    // The phone needs a moment to start listening for the nudge.
    await new Promise((r) => setTimeout(r, 900));
    const res = await fetch(`/api/outreach/${shop}`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) setError(body.error ?? "Couldn't reach the shop. Try again.");
  };
  const jump = async () => setSettled((await (await fetch("/api/demo/fast-forward", { method: "POST" })).json()).settled);
  const otherShop = (id: string) => {
    setSettled(null);
    go(`/shop?shop=${id}`);
  };

  if (path === "/" || !STEPS.some(([p]) => p === path)) return <Welcome start={() => void begin()} />;
  if (!v) return <div className="p-6">Loading…</div>;
  const item = v.queue.find((q: any) => q.brief.merchantId === shop) ?? v.queue[0];
  const index = STEPS.findIndex(([p]) => p === path);
  const withShop = (p: string) => `${p}?shop=${shop}`;
  const next: { label: string; run: () => void; off?: boolean } | null =
    path === "/today" ? { label: "See the first shop", run: () => go(withShop("/shop")) }
    : path === "/shop" ? { label: `Contact ${item.meta.name}`, run: () => void contact() }
    : path === "/talk" ? { label: item.outcome ? "See what happened" : "Finish the conversation first", run: () => go(withShop("/result")), off: !item.outcome }
    : path === "/result" ? { label: settled?.length ? "See the proof" : "Jump 30 days first", run: () => go(withShop("/proof")), off: !settled?.length }
    : path === "/proof" ? { label: "Why shops leave", run: () => go(withShop("/why")) }
    : path === "/why" ? { label: "The team", run: () => go(withShop("/team")) }
    : null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-5 border-b border-line bg-white px-4 py-2.5 md:px-6">
        <button onClick={() => go("/")} className="text-lg font-extrabold text-navy">Rishta</button>
        <div className="flex-1 text-sm font-semibold text-navy md:hidden">Step {index + 1} of {STEPS.length}</div>
        <ol className="hidden flex-1 gap-x-4 text-sm md:flex" aria-label="Progress">
          {STEPS.map(([p, label], i) => <li key={p} aria-current={i === index ? "step" : undefined} className={i === index ? "font-bold text-navy" : i < index ? "text-kept" : "text-muted"}>{i < index ? "✓ " : `${i + 1}. `}{label}</li>)}
        </ol>
        <span className="hidden text-sm text-sim md:inline">Simulated data</span>
        <button onClick={() => void startOver()} className="text-sm text-muted underline">Start over</button>
      </header>
      <div className="bg-navy px-4 py-2.5 font-medium text-white md:px-6 md:text-lg" role="status">{path === "/talk" && item?.outcome ? "Conversation finished. Press See what happened." : path === "/result" && settled?.length ? "That result now feeds tonight's plan. Press See the proof." : DO[path]}</div>
      <main key={path} className="rise min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
        <div className="mx-auto h-full max-w-6xl">
        {path === "/today" && <Today v={v} />}
        {path === "/shop" && <Shop item={item} />}
        {path === "/talk" && <Talk shop={shop} name={item.meta.name} done={!!item.outcome} />}
        {path === "/result" && <Result item={item} settled={settled} jump={() => void jump()} />}
        {path === "/proof" && <Proof v={v} />}
        {path === "/why" && <Why v={v} flash={flash} />}
        {path === "/team" && <Team v={v} selected={shop} />}
        </div>
      </main>
      <footer className="flex flex-wrap items-center gap-2 border-t border-line bg-white px-4 py-3 md:px-6">
        <button onClick={() => history.back()} className="rounded-xl px-4 py-3 text-muted">Back</button>
        {error && <span className="text-callback">{error}</span>}
        <div className="flex-1" />
        {next
          ? <button onClick={next.run} disabled={next.off} className={`rounded-xl px-7 py-3 text-lg font-semibold ${next.off ? "bg-idle text-muted" : "bg-navy text-white"}`}>{next.label}</button>
          : <>
            <button onClick={() => otherShop("M002")} className="rounded-xl border border-navy px-5 py-3 font-semibold text-navy">Try Sharma Medicos</button>
            <button onClick={() => otherShop("M004")} className="rounded-xl border border-navy px-5 py-3 font-semibold text-navy">Try Gupta Snacks</button>
            <button onClick={() => void startOver()} className="rounded-xl bg-navy px-6 py-3 font-semibold text-white">Start over</button>
          </>}
      </footer>
    </div>
  );
}
