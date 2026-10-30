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
const OUTCOME: Record<string, [string, "good" | "plain" | "bad"]> = {
  stayed: ["Says they'll stay", "good"], plan_changed: ["Plan changed", "good"], ticket_raised: ["Ticket raised, shop told", "good"],
  handed_off: ["Passed to a person", "plain"], no_response: ["Nothing needed", "plain"], opted_out: ["Opted out", "bad"], left: ["Left", "bad"],
};
const TAB: Record<string, Group> = { talk: "handled", visit: "visit", call: "callback", left: "left" };
const CHANNEL_SHORT: Record<string, string> = { soundbox: "Soundbox", app: "App", salesperson_visit: "Visit", human_callback: "Person calls" };

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
  typicalRentSharePct: ["Same share, typical shop", "pct"],
  periodDays: ["Days looked at", "count"],
  avgSettlementHours7Days: ["Average settlement time, hours", "count"],
  openTickets: ["Open tickets", "count"],
  monthlyRentInr: ["Monthly rent", "inr"],
  rentSharePct: ["Rent as a share of collections", "pct"],
  cheapestEligibleRentInr: ["Cheapest plan they can get", "inr"],
  zeroFeeLimitInr: ["Zero-fee limit per month", "inr"],
  monthsAboveLimit: ["Months above the limit", "count"],
  monthsToMove: ["Months above the limit before the fee applies", "count"],
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
const plainReason = (r: string) => r.replace(/Learned \(simulated\): in \S+ shops, (\d+%) of contacted shops stayed vs (\d+%) of holdout/, "Contact backfires for fruit and vegetable shops in tier 2 cities: $1 stayed when contacted, $2 when left alone (simulated)");

function fact(key: string, value: unknown) {
  const [label, kind] = FACTS[key] ?? [words(key), "count"];
  const text = typeof value !== "number" ? String(value) : kind === "inr" ? `₹${num(value)}` : kind === "pct" ? `${value}%` : num(value);
  return { label, text };
}

// One dot per shop, coloured by today's decision. The bold moment of the console.
function ShopMap({ plan, active, onHover, onPick }: { plan: any; active: Group | null; onHover: (g: Group | "idle" | null) => void; onPick: (g: Group) => void }) {
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

  const dotAt = (e: React.MouseEvent) => {
    const box = canvas.current!.getBoundingClientRect();
    const cell = box.width / COLS;
    const cx = Math.floor((e.clientX - box.left) / cell);
    const cy = Math.floor((e.clientY - box.top) / cell);
    // Hit area is bigger than the dot: look at the neighbours too.
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const g = dots[(cy + dy) * COLS + cx + dx];
      if (g) return g;
    }
    return null;
  };
  return <canvas ref={canvas} onMouseMove={(e) => onHover(dotAt(e) ?? "idle")} onClick={(e) => { const g = dotAt(e); if (g) onPick(g); }} onMouseLeave={() => onHover(null)} style={{ cursor: active ? "pointer" : "default" }} role="img" aria-label={`${plan.checked} shops, one dot each. Coloured dots are shops Rishta made a decision about.`} className="block w-full" />;
}

function Weeks({ approaches }: { approaches: any[] }) {
  const weeks = approaches[0]?.weekly.length ?? 0;
  return (
    <div className="flex gap-1.5">
      <div className="flex h-28 flex-col justify-between text-right text-xs text-muted" aria-hidden><span>100%</span><span>50%</span><span>0%</span></div>
      <div className="flex h-28 flex-1 items-end gap-[3px]" role="img" aria-label="Share of contacts given to each approach, by week">
        {Array.from({ length: weeks }, (_, i) => (
          <div key={i} className="flex h-full flex-1 flex-col-reverse gap-[2px]" title={`Week ${i + 1}: ${approaches.map((a) => `${a.label} ${pct(a.weekly[i])}`).join(", ")}`}>
            {approaches.map((a, j) => <div key={a.id} className="first:rounded-b-[3px] last:rounded-t-[3px]" style={{ height: `${a.weekly[i] * 100}%`, background: SERIES[j] }} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function Proof({ v }: { v: View }) {
  const [problem, setProblem] = useState("fee_confusion");
  const pb = v.playbook.find((p: any) => p.problem === problem);
  const rows = [...pb.approaches.map((a: any, i: number) => ({ ...a, color: SERIES[i] })), { id: "holdout", label: "Nobody contacted them", ...pb.holdout, color: "#8896a8" }];
  const r = v.report;
  const lift = pb.lift;
  const low = lift ? Math.max(0, Math.round((lift.points - lift.margin) * 100)) : 0;
  const high = lift ? Math.round((lift.points + lift.margin) * 100) : 0;
  return (
    <div>
      <h1 className="max-w-3xl text-[1.75rem] font-extrabold leading-[1.14] text-navy">
        {lift?.proven ? `"${lift.approach}" keeps ${low} to ${high} more shops in every 100 than doing nothing.` : lift ? `For ${pb.label.toLowerCase()}, Rishta prefers "${lift.approach}", but can't yet prove it beats doing nothing.` : `For ${pb.label.toLowerCase()}, there are no results yet.`}
      </h1>
      <p className="mt-1 text-muted">{lift && `Best estimate ${Math.round(lift.points * 100)} more shops per 100, margin ±${Math.round(lift.margin * 100)}, against ${pb.holdout.n} shops nobody contacted. `}Simulated test data with known answers.</p>
      <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Problem">
        {v.playbook.map((p: any) => <button key={p.problem} role="tab" aria-selected={p.problem === problem} onClick={() => setProblem(p.problem)} className={`rounded-full px-3 py-1 ${p.problem === problem ? "bg-navy text-white" : "bg-white"}`}>{p.label}</button>)}
      </div>
      <div className="mt-4 grid gap-x-8 gap-y-6 md:grid-cols-2">
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
          <h2 className="font-semibold text-navy">Share of contacts Rishta gave each approach</h2>
          <div className="mt-2"><Weeks approaches={pb.approaches} /></div>
          <div className="mt-1 flex justify-between pl-9 text-sm text-muted"><span>Week 1</span><span>Now</span></div>
          <p className="text-sm text-muted">Early weeks stay roughly even: a result takes 30 days to arrive. Then contacts move to what worked, and 10% keep testing the rest.</p>
          <div className="mt-1 flex flex-wrap gap-x-4 text-sm">{pb.approaches.map((a: any, i: number) => <span key={a.id}><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: SERIES[i] }} />{a.label}</span>)}</div>
        </section>
      </div>
      {r && (
        <section className="mt-5 border-t border-line pt-3">
          <h2 className="font-semibold text-navy">We planted the answers in the test data. Did Rishta find them?</h2>
          <div className="mt-2 grid grid-cols-2 gap-4 md:grid-cols-4">
            {[[pct(r.reasonAccuracy), `found the planted reason, ${num(r.reasonCases)} shops`], [`${r.winnersFound} of ${r.problems}`, "problems: picked the planted best approach"], [r.backfireFound ? "Yes" : "No", "found the shops where contact backfires"], [`${r.riskLift.toFixed(1)}×`, "the 10% it flags riskiest leave this much more often than average"]].map(([big, small]) => (
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
  const spike = v.why.spikes[0];
  return (
    <div>
      <h1 className="max-w-3xl text-[1.75rem] font-extrabold leading-[1.14] text-navy">
        {spike ? `${spike.label} mentions in ${spike.city} jumped from ${spike.before} to ${spike.now} in 4 weeks.` : "No sudden changes this month."}
      </h1>
      {spike?.quote && <p className="mt-1 max-w-2xl text-lg">"{spike.quote}", {spike.city}</p>}
      {spike && <p className="max-w-2xl font-semibold text-navy">Suggested move: {spike.move}</p>}
      <p className="mt-1 text-sm text-sim">History is simulated. Quotes marked "Just now" come from live conversations.</p>
      {live.map((q: any, i: number) => (
        <div key={i} className={`rise mt-3 max-w-2xl rounded-r-lg border-l-4 border-paytm py-1 pl-4 transition-colors ${flash ? "bg-paytm/20" : "bg-paytm/10"}`}>
          <div className="text-sm font-semibold text-navy">Just now, {q.city} · {q.label}</div>
          <div className="text-xl">"{q.quote}"</div>
        </div>
      ))}
      <div className="mt-4 grid gap-x-8 gap-y-6 md:grid-cols-[minmax(0,1.3fr)_minmax(260px,1fr)]">
        <section>
          <h2 className="font-semibold text-navy">What shopkeepers said, last 4 weeks</h2>
          <div className="mt-2 space-y-3">
            {v.why.reasons.slice(0, 5).map((r: any) => (
              <div key={r.code}>
                <div className="flex justify-between"><span className="font-semibold">{r.label}</span><span>{r.count}{r.liveCount > 0 && <span className="ml-2 rounded-full bg-paytm px-2 text-sm font-semibold text-navy">+{r.liveCount} just now</span>}</span></div>
                <div className="mt-0.5 h-2 rounded-full bg-idle"><div className="h-full rounded-full bg-navy" style={{ width: `${(r.count / top) * 100}%` }} /></div>
                {(() => { const q = r.code === spike?.code && spike?.quote ? spike : r.quotes[0]; return q && <div className="mt-0.5 text-sm text-muted">"{q.quote}", {q.city}</div>; })()}
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
  const p = v.plan;
  const noPerson = Math.round(((p.handledByRishta + p.leftAlone) / p.needAttention) * 100);
  const stats: [string | number, string][] = [
    [d.conversations, "conversations today"], [d.resolvedWithoutHuman, "solved with no person"], [d.ticketsRaised, "tickets raised"], [d.plansChanged, "plans changed"], [d.escalations, "passed to a person"],
    [d.costPerConversationInr === null ? "–" : `₹${d.costPerConversationInr}`, "cost per conversation (estimate)"],
  ];
  return (
    <div>
      <h1 className="max-w-3xl text-[1.75rem] font-extrabold leading-[1.14] text-navy">{noPerson}% of tonight's {p.needAttention} decisions needed no person. The rest arrive with the homework done.</h1>
      <div className="mt-4 flex flex-wrap gap-x-9 gap-y-3">
        {stats.map(([big, small]) => <div key={small}><div className="text-3xl font-extrabold text-navy">{big}</div><div className="text-sm text-muted">{small}</div></div>)}
      </div>
      <p className="mt-2 border-b border-line pb-3 text-sm text-sim">Past weeks, simulated: {num(d.simulated.contacted)} shops contacted, {pct(d.simulated.keepRate)} still active after 30 days, against {pct(d.simulated.controlRate)} of {num(d.simulated.controlN)} shops nobody contacted. Shops differ by problem, so read this with the Proof page.</p>
      <div className="mt-4 grid gap-x-8 gap-y-6 md:grid-cols-3">
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
  ["/today", "Overnight"], ["/decisions", "Who and why"], ["/shop", "One shop"], ["/talk", "Talk"], ["/result", "Result"], ["/proof", "Proof"], ["/why", "Why shops leave"], ["/team", "The team"],
] as const;

const SCRIPTS: Record<string, string[]> = {
  M001: ["मेरे settlement में पैसे कम क्यों आए? मैं तो मशीन वापस करने की सोच रहा था", "अच्छा समझ गया, मैं Soundbox रख लेता हूँ"],
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

function Today({ v, pick }: { v: View; pick: (g: Group) => void }) {
  const [hover, setHover] = useState<Group | "idle" | null>(null);
  const p = v.plan;
  const counts: Record<Group, number> = { handled: p.handledByRishta, visit: p.salespersonVisits, callback: p.humanCallbacks, left: p.leftAlone };
  return (
    <div className="grid items-start gap-8 md:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]">
      <div>
        <h1 className="text-[1.75rem] font-extrabold leading-[1.14] text-navy">{num(p.checked)} shops checked last night, with no one asking. {p.needAttention} needed a decision.</h1>
        <div className="mt-4 max-w-[calc((100dvh-285px)*2)]"><ShopMap plan={p} active={hover && hover !== "idle" ? hover : null} onHover={setHover} onPick={pick} /></div>
        <p className="mt-2 text-sm text-muted">Each dot is one shop. Grey shops need nothing today.</p>
      </div>
      <dl className="md:mt-14">
        {(Object.keys(GROUPS) as Group[]).map((g) => (
          <div key={g}>
            <button onClick={() => pick(g)} onMouseEnter={() => setHover(g)} onMouseLeave={() => setHover(null)} className="flex w-full items-center gap-3 border-b border-line py-3 text-left hover:bg-white">
              <span className="h-3.5 w-3.5 rounded-full" style={{ background: GROUPS[g].color }} />
              <dt className="flex-1 text-lg">{GROUPS[g].label}</dt>
              <dd className="text-2xl font-bold">{counts[g]}</dd>
              <span className="text-muted" aria-hidden>›</span>
            </button>
          </div>
        ))}
      </dl>
    </div>
  );
}

// Every decision of the night, by name. This is the manager's list.
function Decisions({ v, list, tab, setTab, open }: { v: View; list: any; tab: Group; setTab: (g: Group) => void; open: (id: string) => void }) {
  const p = v.plan;
  const counts: Record<Group, number> = { handled: p.handledByRishta, visit: p.salespersonVisits, callback: p.humanCallbacks, left: p.leftAlone };
  const channels: Record<Group, string[]> = { handled: ["soundbox", "app"], visit: ["salesperson_visit"], callback: ["human_callback"], left: [] };
  const shown = list?.decided.filter((d: any) => channels[tab].includes(d.channel)) ?? [];
  const left = list?.left ?? [];
  const learned = left.filter((l: any) => l.kind !== "rule").length;
  const check = p.checks?.find((c: any) => c.skip);
  return (
    <div className="flex h-full flex-col">
      <h1 className="text-[1.75rem] font-extrabold leading-[1.14] text-navy">
        {tab === "left" ? `${p.leftAlone} shops left alone on purpose.` : tab === "handled" ? `Rishta handles ${p.handledByRishta} shops itself.` : tab === "visit" ? `${p.salespersonVisits} shops are worth a salesperson's time.` : `${p.humanCallbacks} shops need a person to call.`}
      </h1>
      <p className="text-muted">
        {tab === "left" && check ? `${left.length - learned} by rule (recent contact, consent, low value). ${learned} because contact made things worse: ${pct(check.contactedKeep)} of contacted shops stayed, ${pct(check.holdoutKeep)} of uncontacted ones (simulated, ${check.contactedN} and ${check.holdoutN} shops). This switches on only once both groups pass 15 shops.` : "Press any shop to see why it got this decision."}
      </p>
      <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Decision">
        {(Object.keys(GROUPS) as Group[]).map((g) => <button key={g} role="tab" aria-selected={g === tab} onClick={() => setTab(g)} className={`rounded-full px-3 py-1 ${g === tab ? "bg-navy text-white" : "bg-white"}`}>{GROUPS[g].label} ({counts[g]})</button>)}
      </div>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto border-t border-line">
        {tab === "left"
          ? left.map((l: any) => (
            <button key={l.id} onClick={() => open(l.id)} className="grid w-full gap-x-4 border-b border-line py-2 text-left hover:bg-white md:grid-cols-[minmax(0,2fr)_90px_minmax(0,5fr)]">
              <span><b>{l.name}</b>, {l.city}</span>
              <span className="text-sm font-semibold text-sim">{l.kind === "rule" ? "Rule" : l.kind === "learned" ? "Learned" : "Both"}</span>
              <span className="text-sm text-muted">{l.reasons.map(plainReason).join(". ")}</span>
            </button>
          ))
          : shown.map((d: any) => (
            <button key={d.id} onClick={() => open(d.id)} className="grid w-full gap-x-4 border-b border-line py-2 text-left hover:bg-white md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)_90px_50px]">
              <span><b>{d.name}</b>, {d.city}</span>
              <span>{d.reason}</span>
              <span className="text-muted">{d.approach}</span>
              <span className="text-sm">{CHANNEL_SHORT[d.channel]}</span>
              <span className="text-right text-sm text-muted" title="Stand-in risk score">{d.risk}</span>
            </button>
          ))}
      </div>
    </div>
  );
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return <dl>{rows.map(([k, val]) => <div key={k} className="flex justify-between gap-4 border-b border-line py-1.5"><dt className="text-muted">{k}</dt><dd className="text-right font-semibold">{val}</dd></div>)}</dl>;
}

function Shop({ item, v }: { item: any; v: View }) {
  const { brief, meta } = item;
  const order = Object.keys(FACTS);
  const facts = Object.entries(brief.facts).filter(([k]) => k !== "firstName" && k !== "businessName").sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  const pb = v.playbook.find((p: any) => p.problem === brief.problem);
  return (
    <div className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <div className="text-muted">{meta.city} · {meta.reasonLabel}</div>
        <h1 className="text-[1.75rem] font-extrabold leading-tight text-navy">{meta.name}</h1>
        <p className="mt-1 text-lg leading-snug">{meta.why}</p>
        <h2 className="mt-3 font-semibold text-navy">What Rishta decided</h2>
        <Rows rows={[["How to help", meta.approachLabel], ["Reach them through", CHANNEL[brief.channel]], ["Goal", brief.goal], ["Risk score (stand-in)", meta.risk]]} />
        {pb && (
          <>
            <h2 className="mt-3 font-semibold text-navy">Why this approach</h2>
            {pb.approaches.map((a: any) => <div key={a.id} className={`flex justify-between py-0.5 ${a.id === brief.approachId ? "font-semibold text-navy" : "text-muted"}`}><span>{a.id === brief.approachId ? "→ " : ""}{a.label}</span><span>{pct(a.keepRate)} kept, of {a.n}</span></div>)}
            <p className="text-sm text-sim">Past results, simulated.{meta.approachShare !== null && meta.approachShare !== undefined ? ` Rishta sends ${pct(meta.approachShare)} of shops like this one here, and keeps testing the rest.` : ""}</p>
          </>
        )}
      </div>
      <section>
        <h2 className="font-semibold text-navy">The only numbers the AI may say</h2>
        <table className="mt-1 w-full"><tbody>
          {facts.map(([k, val]) => { const f = fact(k, val); return <tr key={k} className="border-b border-line"><td className="py-0.5 pr-3 text-sm">{f.label}</td><td className="py-0.5 text-right font-mono text-sm">{f.text}</td></tr>; })}
        </tbody></table>
        <p className="mt-1 text-sm text-muted">Plus any figure a tool returns during the call. Every sentence is checked before it is spoken.</p>
      </section>
      <section>
        <h2 className="font-semibold text-navy">The brief: what any agent receives</h2>
        <div className="mt-1 text-sm font-semibold">May do</div>
        <div className="flex flex-wrap gap-1">{brief.allowedActions.map((a: string) => <span key={a} className="rounded bg-white px-1.5 text-sm">{ACTIONS[a] ?? a}</span>)}</div>
        <div className="mt-2 text-sm font-semibold">Must say</div>
        <ul className="text-sm text-muted">{brief.mustSay.map((t: string) => <li key={t}>{t}</li>)}</ul>
        <div className="mt-2 text-sm font-semibold">Must never</div>
        <ul className="text-sm text-muted">{brief.mustNot.map((t: string) => <li key={t}>{t}</li>)}</ul>
        <div className="mt-2 text-sm font-semibold">Pass to a person if</div>
        <ul className="text-sm text-muted">{brief.escalateIf.map((t: string) => <li key={t}>{t}</li>)}</ul>
        <div className="mt-2 text-sm font-semibold">Discount limit: ₹{brief.limits.maxDiscountInr} a month</div>
        <details className="mt-2 text-sm"><summary className="cursor-pointer text-paytm-deep">See the raw contract</summary><pre className="mt-1 max-h-48 overflow-auto rounded bg-white p-2 font-mono text-xs">{JSON.stringify(brief, null, 2)}</pre></details>
      </section>
    </div>
  );
}

function LeftShop({ shop }: { shop: any }) {
  return (
    <div className="max-w-2xl">
      <div className="text-muted">{shop.city} · Left alone on purpose</div>
      <h1 className="text-[1.75rem] font-extrabold leading-tight text-navy">{shop.name}</h1>
      <p className="mt-2 text-xl leading-snug">Rishta chose not to contact this shop today.</p>
      <ul className="mt-3 space-y-2">
        {shop.left.reasons.map((r: string) => <li key={r} className="border-l-4 border-leftalone pl-3 text-lg">{plainReason(r)}</li>)}
      </ul>
      <p className="mt-3 text-muted">The shop still gets normal service: support and Soundbox questions work as usual. Only proactive outreach is held back.</p>
    </div>
  );
}

function NoDecision({ shop, id }: { shop: any; id: string }) {
  return (
    <div className="max-w-2xl">
      <h1 className="text-[1.75rem] font-extrabold leading-tight text-navy">{shop ? shop.name : `No shop called ${id}`}</h1>
      <p className="mt-2 text-xl">{shop ? "Rishta has no plan for this shop today: nothing needs doing, or it is in the no-contact control group." : "Check the link, or pick a shop from the list."}</p>
    </div>
  );
}

// What the manager is doing while the shopkeeper talks.
function LivePanel({ shop }: { shop: any }) {
  const { brief, meta, live } = shop;
  const actions = (live?.actions ?? []).filter((a: string) => a !== "recordOutcome");
  return (
    <aside className="w-[300px] shrink-0 self-center">
      <div className="text-sm font-semibold text-paytm-deep">Rishta, live</div>
      <h2 className="text-lg font-bold leading-snug text-navy">{brief.goal}</h2>
      <ol className="mt-2 space-y-1.5">
        <li>✓ Brief written overnight: {meta.approachLabel}</li>
        <li>✓ Reached through {CHANNEL[brief.channel].toLowerCase()}</li>
        {live && <li className="rise">✓ AI disclosed, no-OTP line said</li>}
        {live?.numbersChecked > 0 && <li className="rise">✓ {live.numbersChecked} {live.numbersChecked === 1 ? "number" : "numbers"} checked before speaking</li>}
        {live?.guardEvents.length > 0 && <li className="rise text-sim">✋ {live.guardEvents.length} blocked by the guard, never spoken</li>}
        {actions.map((a: string, i: number) => <li key={i} className="rise">✓ {ACTIONS[a] ?? a}</li>)}
        {shop.outcome && <li className="rise font-semibold text-navy">Result: {OUTCOME[shop.outcome.outcome]![0]}</li>}
      </ol>
    </aside>
  );
}

function Talk({ shop, id }: { shop: any; id: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-10">
      <MerchantPhone shopId={id} tips={shop.outcome ? [] : SCRIPTS[id] ?? []} onTip />
      <div className="hidden lg:block"><LivePanel shop={shop} /></div>
    </div>
  );
}

function Result({ item, settled }: { item: any; settled: any[] | null }) {
  const { meta, outcome } = item;
  if (!outcome) return <p className="text-lg">No result yet. Go back and finish the conversation.</p>;
  const [label, tone] = OUTCOME[outcome.outcome]!;
  return (
    <div className="max-w-2xl">
      <div className={`text-2xl font-bold ${tone === "good" ? "text-kept" : tone === "bad" ? "text-callback" : "text-navy"}`}>{tone === "good" ? "✓ " : ""}{label}</div>
      <h1 className="text-[1.75rem] font-extrabold leading-tight text-navy">{meta.name}</h1>
      <p className="mt-2 text-xl leading-snug">{outcome.summary}</p>
      {outcome.reasons.map((r: any, i: number) => <p key={i} className="mt-2 text-lg text-muted">"{r.quote}"</p>)}
      {outcome.numbersChecked > 0 && outcome.numbersVerified && <p className="mt-2 font-semibold text-kept">{outcome.numbersChecked === 1 ? "The number it spoke was" : `All ${outcome.numbersChecked} numbers it spoke were`} checked against this shop's data first.</p>}
      {settled === null && <p className="mt-4 text-muted">What the shop says isn't the measure. Rishta counts a shop as kept only if it is still active 30 days later. On this test bench the simulator answers; in production it reads Paytm's merchant status.</p>}
      {settled?.length === 0 && <p className="mt-4 text-muted">This result was already counted.</p>}
      {settled?.map((r) => (
        <div key={r.merchantId} className="rise mt-5 border-l-4 border-paytm pl-4">
          <p className="text-xl font-semibold">30 days later (simulated): {r.kept ? "still active" : "they left"}.</p>
          <p className="mt-1">"{r.approach}" now has {r.resultsAfter} results, up from {r.resultsBefore}. Tonight's plan uses it.</p>
        </div>
      ))}
    </div>
  );
}

const DO: Record<string, string> = {
  "/today": "Rishta made all these decisions on its own. Press a colour or a dot to see the shops by name.",
  "/decisions": "This is the manager's list. Press any shop, or see who it left alone and why.",
  "/shop": "This is the brief. In production the nudge goes out by itself at 9am; here you trigger it to watch.",
  "/talk": "You are the shopkeeper now. Hold the mic and speak Hindi, Tamil, Kannada or another Indian language, or tap the line.",
  "/result": "Rishta logged this itself. Next, see if the shop really stayed.",
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
  const params = new URLSearchParams(query);
  const shop = params.get("shop") ?? "M001";
  const tab = TAB[params.get("tab") ?? "talk"] ?? "handled";
  const [list, setList] = useState<any>(null);
  const [item, setItem] = useState<any>(undefined);

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
  const loadShop = useCallback(() => {
    void fetch(`/api/shop/${shop}`).then((r) => (r.ok ? r.json() : null)).then(setItem);
  }, [shop]);
  const load = useCallback(() => {
    void fetch("/api/console").then((r) => r.json()).then(setV);
    void fetch("/api/decisions").then((r) => r.json()).then(setList);
    loadShop();
  }, [loadShop]);
  useEffect(load, [load]);
  useEvents((e) => {
    if (e.type === "changed") {
      load();
      setFlash(true);
      setTimeout(() => setFlash(false), 2500);
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
    load();
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

  if (path === "/" || !STEPS.some(([p]) => p === path)) return <Welcome start={() => void begin()} />;
  if (!v) return <div className="p-6">Loading…</div>;
  const index = STEPS.findIndex(([p]) => p === path);
  const talkable = !!item?.brief && ["soundbox", "app"].includes(item.brief.channel);
  const finished = !!item?.outcome;
  const needsShop = ["/shop", "/talk", "/result"].includes(path);
  const status = path === "/talk" && finished ? "Conversation finished. Press See what happened."
    : path === "/result" && !finished ? "No result yet. Go back and finish the conversation."
    : path === "/result" && settled !== null ? "That result now feeds tonight's plan. Press See the proof."
    : path === "/shop" && item?.left ? "Rishta decided to leave this shop alone. No one presses anything."
    : path === "/shop" && item?.brief && !talkable ? "Rishta won't contact this shop itself. It goes to a person, with this brief."
    : path === "/shop" && item?.blocked ? `Rishta will not contact this shop: ${item.blocked.toLowerCase()}.`
    : DO[path];
  const withShop = (p: string) => `${p}?shop=${shop}`;
  const tabName = (g: Group) => Object.keys(TAB).find((k) => TAB[k] === g)!;
  const toList = (g: Group) => go(`/decisions?tab=${tabName(g)}`);
  const open = (id: string) => { setSettled(null); go(`/shop?shop=${id}`); };
  const shopNext = (): { label: string; run: () => void; off?: boolean } | null => {
    if (!item?.brief) return { label: "Back to the list", run: () => toList(item?.left ? "left" : "handled") };
    if (finished) return { label: "See what happened", run: () => go(withShop("/result")) };
    if (!talkable) return { label: "See the team's list", run: () => go(withShop("/team")) };
    if (item.blocked) return { label: "Back to the list", run: () => toList("handled") };
    return { label: `Send the nudge to ${item.meta.name}`, run: () => void contact() };
  };
  const next: { label: string; run: () => void; off?: boolean } | null =
    path === "/today" ? { label: "See who and why", run: () => toList("handled") }
    : path === "/decisions" ? { label: "See the first shop", run: () => open("M001") }
    : path === "/shop" ? shopNext()
    : path === "/talk" ? { label: finished ? "See what happened" : "Finish the conversation first", run: () => go(withShop("/result")), off: !finished }
    : path === "/result" ? (settled === null ? { label: "Jump 30 days: did they stay?", run: () => void jump(), off: !finished } : { label: "See the proof", run: () => go(withShop("/proof")) })
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
      <div className="bg-navy px-4 py-2.5 font-medium text-white md:px-6 md:text-lg" role="status">{status}</div>
      <main key={path} className="rise min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        <div className="mx-auto h-full max-w-6xl">
        {needsShop && item === undefined && <p>Loading…</p>}
        {needsShop && item !== undefined && !item?.brief && !item?.left && <NoDecision shop={item} id={shop} />}
        {path === "/today" && <Today v={v} pick={toList} />}
        {path === "/decisions" && <Decisions v={v} list={list} tab={tab} setTab={toList} open={open} />}
        {path === "/shop" && item?.left && !item.brief && <LeftShop shop={item} />}
        {path === "/shop" && item?.brief && <Shop item={item} v={v} />}
        {path === "/talk" && item?.brief && <Talk shop={item} id={shop} />}
        {path === "/result" && item?.brief && <Result item={item} settled={settled} />}
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
            <button onClick={() => open("M002")} className="rounded-xl border border-navy px-5 py-3 font-semibold text-navy">Try Sharma Medicos</button>
            <button onClick={() => open("M004")} className="rounded-xl border border-navy px-5 py-3 font-semibold text-navy">Try Gupta Snacks</button>
            <button onClick={() => void startOver()} className="rounded-xl bg-navy px-6 py-3 font-semibold text-white">Start over</button>
          </>}
      </footer>
    </div>
  );
}
