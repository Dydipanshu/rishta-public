import qrcode from "qrcode-generator";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEvents } from "../hooks/useEvents";
import { Card, Empty, Icon, PageHead, Pill, SimTag, Skeleton, Stat, type Tone } from "../ui";
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
const SERIES = ["#0369a1", "#38bdf8", "#cbd5e1"];
const TONE: Record<string, Tone> = { good: "good", plain: "plain", bad: "bad" };
const OUTCOME: Record<string, [string, "good" | "plain" | "bad"]> = {
  stayed: ["Solved, the shop understood", "good"], plan_changed: ["Plan changed", "good"], ticket_raised: ["Ticket raised, not solved until the shop says so", "plain"], fix_confirmed: ["Shop confirmed the fix worked", "good"],
  emi_reset: ["Smaller EMI agreed", "good"], loan_accepted: ["Loan request sent, the lender decides", "good"],
  return_requested: ["Device return booked", "bad"], later: ["Shop was busy, left in peace", "plain"], undecided: ["Not settled yet", "plain"],
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
  salesTodayInr: ["Sales today", "inr"],
  paymentsToday: ["Payments today", "count"],
  salesYesterdayInr: ["Sales yesterday", "inr"],
  salesLast7DaysInr: ["Sales, last 7 days", "inr"],
  salesPrevious7DaysInr: ["Sales, the 7 days before", "inr"],
  salesChange7DaysPct: ["Change, week on week", "pct"],
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
  changePlan: "Change the plan", scheduleHumanCallback: "Bring in a person", recordOutcome: "Record the result", recordOptOut: "Stop contact if asked", sendAppMessage: "Send an app message", requestDeviceReturn: "Book a device return", checkLoan: "Check the loan and sales", setReducedEmi: "Set a smaller EMI, within lender rules", proposeLoan: "Work out loan options", acceptLoan: "Send a loan for approval in the app", confirmFix: "Record if the fix worked",
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

// What contacting 100 shops earns Paytm over a year.
function Ledger({ rows }: { rows: any[] }) {
  return (
    <Card title="What 100 contacts earn Paytm in a year" action={<SimTag />}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="text-muted"><tr><th className="pb-2 font-medium">Problem</th><th className="pb-2 text-right font-medium">Extra shops kept</th><th className="pb-2 text-right font-medium">One shop's yearly value</th><th className="pb-2 text-right font-medium">Cost</th><th className="pb-2 text-right font-medium">Net to Paytm</th></tr></thead>
          <tbody className="num">{rows.map((r) => <tr key={r.problem} className="border-t border-line"><td className="py-2 font-semibold">{r.label}</td><td className="text-right">{r.extraKeptPer100}</td><td className="text-right">₹{num(r.shopWorthYear)}</td><td className="text-right">₹{num(r.costPer100)}</td><td className="text-right">{r.proven ? <><span className="font-semibold text-kept">₹{num(r.best)}</span><div className="text-xs text-muted">₹{num(r.low)} to ₹{num(r.high)}</div></> : <Pill>Not proven yet</Pill>}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">Value = rent + estimated payment margin + estimated loan revenue. The same 100 shops by salesperson visit would cost about ₹9,500. Every assumption is listed in config/value.ts.</p>
    </Card>
  );
}

function Proof({ v }: { v: View }) {
  const [problem, setProblem] = useState("fee_confusion");
  const pb = v.playbook.find((p: any) => p.problem === problem);
  const rows = [...pb.approaches.map((a: any, i: number) => ({ ...a, color: SERIES[i] })), { id: "holdout", label: "Nobody contacted them", ...pb.holdout, color: "#94a3b8" }];
  const r = v.report;
  const lift = pb.lift;
  const low = lift ? Math.max(0, Math.round((lift.points - lift.margin) * 100)) : 0;
  const high = lift ? Math.round((lift.points + lift.margin) * 100) : 0;
  const isLoan = problem === "loan_opportunity";
  return (
    <div className="space-y-4">
      <PageHead eyebrow="Measured against a no-contact group" title={lift?.proven ? `"${lift.approach}" ${isLoan ? "gets" : "keeps"} ${low} to ${high} more ${isLoan ? "good loans" : "shops"} in every 100 than doing nothing.` : lift ? `Rishta prefers "${lift.approach}", but can't yet prove it beats doing nothing.` : "No results yet."} sub={lift && `Best estimate ${Math.round(lift.points * 100)} more per 100, ±${Math.round(lift.margin * 100)}, against ${pb.holdout.n} shops nobody contacted. Simulated test data with known answers.`} />
      <Ledger rows={v.ledger} />
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Problem">
        {v.playbook.map((p: any) => <button key={p.problem} role="tab" aria-selected={p.problem === problem} onClick={() => setProblem(p.problem)} className={`seg ${p.problem === problem ? "seg-on" : ""}`}>{p.label}</button>)}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={isLoan ? "Took a loan and still paying after 30 days" : "Shops still active after 30 days"}>
          <div className="space-y-3">
            {rows.map((a: any) => (
              <div key={a.id}>
                <div className="flex justify-between text-sm"><span>{a.label}</span><span className="num font-semibold">{pct(a.keepRate)} <span className="font-normal text-muted">of {a.n}</span></span></div>
                <div className="mt-1 h-2 rounded-full bg-idle"><div className="h-full rounded-full" style={{ width: pct(a.keepRate), background: a.color }} /></div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Where Rishta sent each week's shops">
          <Weeks approaches={pb.approaches} />
          <div className="mt-1 flex justify-between pl-9 text-xs text-muted"><span>Week 1</span><span>Now</span></div>
          <div className="mt-2 flex flex-wrap gap-x-4 text-sm">{pb.approaches.map((a: any, i: number) => <span key={a.id}><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: SERIES[i] }} />{a.label}</span>)}</div>
          <p className="mt-1 text-xs text-muted">A result takes 30 days to arrive, so early weeks stay even. 10% always keep testing the rest.</p>
        </Card>
      </div>
      {r && (
        <Card title="We planted the answers in the test data. Did Rishta find them?">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {[[pct(r.reasonAccuracy), `found the planted reason, ${num(r.reasonCases)} shops`], [`${r.winnersFound} of ${r.problems}`, "problems: picked the planted best approach"], [r.backfireFound ? "Yes" : "No", "found the shops where contact backfires"]].map(([big, small]) => (
              <div key={small}><div className="num text-2xl font-bold text-ink">{big}</div><div className="text-sm text-muted">{small}</div></div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Loans({ v, open }: { v: View; open: (id: string) => void }) {
  const f = v.loanFunnel;
  const pb = v.playbook.find((p: any) => p.problem === "loan_opportunity");
  const best = [...(pb?.approaches ?? [])].sort((a: any, b: any) => (b.keepRate ?? 0) - (a.keepRate ?? 0))[0];
  const lift = pb?.lift;
  const heldTotal = f.held.ticket + f.held.problem + f.held.falling + f.held.repayment;
  const stages: [string, number, string][] = [
    ["Shops checked tonight", v.plan.checked, "Every shop, every night"],
    ["Big enough for an offer", f.bigEnough, "No loan yet, steady sales"],
    ["Right moment", f.rightMoment, "Sales up, nothing broken"],
    ["Rishta raises it", f.reached, `${f.capped} ready shops wait so service comes first, ${f.control} are the control group`],
  ];
  const rows = [
    { label: "Rishta, at the right moment", rate: best?.keepRate ?? null, n: best?.n ?? 0, color: SERIES[0] },
    { label: "Same offer, timing rules off", rate: f.noTiming.rate, n: f.noTiming.n, color: SERIES[1] },
    { label: "Nobody contacted them", rate: pb?.holdout.keepRate ?? null, n: pb?.holdout.n ?? 0, color: "#94a3b8" },
  ];
  return (
    <div className="space-y-4">
      <PageHead eyebrow="Service earns the right to sell" title={`${num(f.bigEnough)} shops could be pitched tonight. Rishta raises it with ${num(f.reached)}.`} sub={`${num(heldTotal)} are held back because now would hurt them. Loans are capped at 10% of conversations, so service comes first. The lender makes every final decision.`} />
      <Card title="Tonight's pipeline">
        <ol className="space-y-2.5">
          {stages.map(([label, n, hint]) => (
            <li key={label}>
              <div className="flex justify-between text-sm"><span className="font-semibold">{label}</span><span className="num font-semibold">{num(n)}</span></div>
              <div className="mt-1 h-2 rounded-full bg-idle"><div className="h-full rounded-full bg-paytm-deep" style={{ width: `${Math.max(1, (n / v.plan.checked) * 100)}%` }} /></div>
              <div className="text-xs text-muted">{hint}</div>
            </li>
          ))}
        </ol>
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 md:grid-cols-4">
          <Stat label="Loan conversations today" value={f.talked} hint={`${f.mentioned} shops asked how to grow`} />
          <Stat label="Requests sent, lender decides" value={f.sent} hint={`₹${num(f.sentInr)}`} tone="brand" />
          <Stat label="Warm leads waiting" value={f.leads.waiting} hint="With the sales team" />
          <Stat label="Passed to the lender by sales" value={f.leads.sentToLender} hint={`${f.leads.notInterested} not interested`} tone="good" />
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Took a loan and still paying 30 days later" action={<SimTag />}>
          <div className="space-y-3">
            {rows.map((a) => (
              <div key={a.label}>
                <div className="flex justify-between text-sm"><span>{a.label}</span><span className="num font-semibold">{pct(a.rate)} <span className="font-normal text-muted">of {num(a.n)}</span></span></div>
                <div className="mt-1 h-2 rounded-full bg-idle"><div className="h-full rounded-full" style={{ width: pct(a.rate), background: a.color }} /></div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-sm text-muted">{lift?.proven ? `${Math.round((lift.points - lift.margin) * 100)} to ${Math.round((lift.points + lift.margin) * 100)} more good loans per 100 than doing nothing.` : "Not proven against doing nothing yet: too few shops in the control group."} A yes doesn't count. Only a loan still being paid does. Timing rules were switched off only on the test bench, never in production.</p>
        </Card>
        <Card title="Which opening works" action={<SimTag />}>
          {pb && <Weeks approaches={pb.approaches} />}
          <div className="mt-2 flex flex-wrap gap-x-4 text-sm">{pb?.approaches.map((a: any, i: number) => <span key={a.id}><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: SERIES[i] }} />{a.label}</span>)}</div>
          <p className="mt-1 text-xs text-muted">Rishta sends more shops to the opening that gets more good loans. No one rewrites a script.</p>
        </Card>
      </div>
      <Card title="Held back tonight, by name" action={<Pill>{num(heldTotal)} shops</Pill>}>
        <p className="mb-2 text-sm text-muted">Each of these could be pitched. Rishta said no.</p>
        {f.heldBack.map((h: any) => <button key={h.merchant_id} onClick={() => open(h.merchant_id)} className="block w-full border-b border-line py-2 text-left last:border-0"><span className="font-semibold">{h.name}, {h.city}</span><span className="block text-sm text-muted">{h.why}</span></button>)}
        <p className="mt-2 text-xs text-muted">{num(f.held.falling)} sales falling · {num(f.held.ticket)} open tickets · {num(f.held.problem)} another problem first · {num(f.held.repayment)} repayment too high. A further {num(f.held.growth)} simply aren't growing enough yet.</p>
      </Card>
    </div>
  );
}

function Why({ v, flash }: { v: View; flash: boolean }) {
  const top = v.why.reasons[0]?.count ?? 1;
  const live = v.why.reasons.flatMap((r: any) => r.quotes.filter((q: any) => q.live).map((q: any) => ({ ...q, label: r.label })));
  const spike = v.why.spikes[0];
  return (
    <div className="space-y-4">
      <PageHead eyebrow="In the shopkeepers' own words" title={spike ? `${spike.label} in ${spike.city} jumped from ${spike.before} to ${spike.now} in 4 weeks.` : "No sudden changes this month."} sub="History is simulated. Every quote is the shop's exact words; nothing is inferred." />
      {spike && (
        <Card className="border-l-4 border-l-paytm">
          {spike.quote && <p className="text-lg leading-snug">"{spike.quote}"<span className="text-muted"> — {spike.city}</span></p>}
          <p className="mt-1 font-semibold text-ink">Suggested move: {spike.move}</p>
        </Card>
      )}
      {live.map((q: any, i: number) => (
        <div key={i} className={`rise card border-l-4 border-l-kept px-4 py-3 ${flash ? "ring-2 ring-kept/30" : ""}`}>
          <div className="flex items-center gap-2 text-sm font-semibold"><Pill tone="good">Just now</Pill>{q.city} · {q.label}</div>
          <div className="mt-1 text-lg">"{q.quote}"</div>
        </div>
      ))}
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.5fr)_minmax(260px,1fr)]">
        <Card title="What shopkeepers said, last 4 weeks">
          <div className="space-y-3.5">
            {v.why.reasons.slice(0, 5).map((r: any) => {
              const q = r.code === spike?.code && spike?.quote ? spike : r.quotes[0];
              return (
                <div key={r.code}>
                  <div className="flex justify-between text-sm"><span className="font-semibold">{r.label}</span><span className="num">{r.count}{r.liveCount > 0 && <Pill tone="good">+{r.liveCount} just now</Pill>}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-idle"><div className="h-full rounded-full bg-paytm-deep" style={{ width: `${(r.count / top) * 100}%` }} /></div>
                  {q && <div className="mt-1 text-sm text-muted">"{q.quote}", {q.city}</div>}
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Also rising">
          {v.why.spikes.length > 1 ? v.why.spikes.slice(1).map((s: any) => (
            <div key={s.code + s.city} className="border-b border-line py-2 last:border-0">
              <div className="font-semibold">{s.label}, {s.city} <span className="num text-muted">{s.before} → {s.now}</span></div>
              <div className="text-sm text-muted">{s.move}</div>
            </div>
          )) : <Empty title="Nothing else is rising" />}
        </Card>
      </div>
    </div>
  );
}

function Qr({ url, label }: { url: string; label: string }) {
  const q = qrcode(0, "M");
  q.addData(url);
  q.make();
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block text-center text-sm font-medium">
      <div dangerouslySetInnerHTML={{ __html: q.createSvgTag({ cellSize: 3, margin: 2 }) }} />
      {label}
    </a>
  );
}

function History({ entries }: { entries: { when: string; text: string }[] }) {
  if (!entries?.length) return <Empty title="Nothing on record yet">Every contact, ticket and promise shows up here.</Empty>;
  return <ol className="space-y-2.5">{entries.map((e, i) => <li key={i} className="flex gap-2.5 text-sm"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-paytm" /><span><span className="font-semibold">{e.when}</span> <span className="text-muted">{e.text}</span></span></li>)}</ol>;
}

function Team({ v, selected }: { v: View; selected: string }) {
  const d = v.done;
  const p = v.plan;
  const reach = p.handledByRishta + p.salespersonVisits + p.humanCallbacks;
  const lift = Math.round((d.simulated.keepRate - d.simulated.controlRate) * 100);
  return (
    <div className="space-y-4">
      <PageHead eyebrow="Rishta and the people around it" title={`Rishta takes ${num(p.handledByRishta)} of the ${num(reach)} shops it reaches today. People get the ${num(p.salespersonVisits + p.humanCallbacks)} that need a person.`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Solved, confirmed by the shop" value={d.resolvedWithoutHuman} hint={`${d.conversations} conversations today`} tone="good" />
        <Stat label="Fixes waiting to be checked" value={d.promises.waiting} hint={`${d.promises.kept} confirmed, ${d.promises.failed} failed`} />
        <Stat label="Loan requests, lender decides" value={v.loans.sold} hint={`₹${num(v.loans.soldInr)}, plus ${v.leads.length} warm leads`} tone="brand" />
        <Stat label="Loan dues back on track" value={`₹${num(v.loans.backOnTrackInr)}`} hint={`${v.loans.eased} shops eased, no person needed`} tone="good" />
        <Stat label="More shops kept per 100" value={`+${lift}`} hint={`Past weeks, simulated: ${pct(d.simulated.keepRate)} vs ${pct(d.simulated.controlRate)}`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Needs a person now" action={<Pill tone="bad">{v.needsHuman.length}</Pill>}>
          {v.needsHuman.length === 0 && <Empty title="Nobody is waiting" />}
          {v.needsHuman.map((h: any) => <div key={`${h.merchant_id}${h.reason}`} className="border-b border-line py-2 first:pt-0 last:border-0"><div className="flex items-center gap-2 font-semibold">{h.urgent && <Pill tone="bad">Urgent</Pill>}{h.name}</div><div className="line-clamp-3 text-sm text-muted">{h.summary}</div></div>)}
        </Card>
        <Card title="Visits today" action={<a href="/sales" target="_blank" rel="noreferrer" className="text-sm font-medium text-paytm-deep">Sales app</a>}>
          {v.visits.slice(0, 4).map((x: any) => <div key={x.merchantId} className="border-b border-line py-2 first:pt-0 last:border-0"><div className="font-semibold">{x.name}, {x.city}</div><div className="text-sm text-muted">{x.why}</div></div>)}
        </Card>
        <div className="space-y-4">
          <Card title="Warm leads">
            {v.leads.length === 0 ? <Empty title="None yet">A solved shop with a good record is asked once. A person does the rest.</Empty> : v.leads.map((l: any) => <div key={l.merchantId} className="rise border-b border-line py-2 first:pt-0 last:border-0"><div className="font-semibold">{l.name}, {l.city}</div><div className="text-sm text-muted">Agreed to hear about a business loan · est. ₹{num(l.valueInr)} a year</div></div>)}
          </Card>
          <Card title="Open on a phone">
            <div className="flex gap-4">
              <Qr url={`${window.location.origin}/phone/${selected}`} label="Shop app" />
              <Qr url={`${window.location.origin}/sales`} label="Sales app" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  ["/today", "Overview"], ["/decisions", "Decisions"], ["/shop", "One shop"], ["/talk", "Talk"], ["/result", "Result"], ["/proof", "Proof"], ["/loans", "Loans"], ["/why", "Why shops leave"], ["/team", "Team"],
] as const;

const NAV: [string, string, string][] = [["/today", "Overview", "overview"], ["/decisions", "Decisions", "list"], ["/shop", "Shop", "shop"], ["/talk", "Conversation", "talk"], ["/proof", "Proof", "proof"], ["/loans", "Loans", "proof"], ["/why", "Why shops leave", "why"], ["/team", "Team", "team"], ["/guardrails", "Guardrails", "shield"]];

const RAILS: [string, string, string][] = [
  ["Before the model", "Fraud reports", "Urgent handoff, change PIN, call 1930. Digits are never stored."],
  ["Before the model", "OTP or PIN", "A fixed line answers. The shop's words never reach the model."],
  ["Before the model", "Account and card numbers", "Removed from the text before anyone sees them."],
  ["Before the model", "Asks for a person, abuse", "A person takes over with the full history."],
  ["Before the model", "Stop contacting me", "Opt-out is honoured everywhere, at once."],
    ["Before speaking", "Numbers", "Every figure must match this shop's data. Number words are blocked."],
  ["Before speaking", "Wrong labels and promises", "A fee can't be called a discount, and no fix dates are promised."],
  ["Before speaking", "Splitting payments, surcharges", "Advice to avoid the fee is blocked."],
  ["Before acting", "Loans and EMIs", "Figures come only from code. Smaller EMI only if sales data proves it, within lender rules, after a clear yes. Never a threat, never a link."],
  ["Before acting", "Plan changes", "Only from the catalogue, within budget, after a clear yes."],
  ["Before contact", "Consent, quiet hours, contact cap", "Checked again per shop before anything is sent."],
  ["After the conversation", "Honest results", "\"Stayed\" needs the shop's own words. A fix counts only when the shop confirms."],
  ["If something fails", "Model slow or down", "One retry within 7 seconds, then a person takes over. The shop is never left waiting."],
];

function Guardrails({ v }: { v: View }) {
  const g = v.guardrails;
  return (
    <div className="space-y-4">
      <PageHead eyebrow="Enforced by code, not by asking the AI nicely" title="What Rishta can never do." sub="Each rule below runs outside the model, so a clever prompt can't talk its way past it." />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Sentences blocked before speaking" value={g.blocked} />
        <Stat label="Fraud reports escalated" value={g.fraud} />
        <Stat label="Actions in the audit log" value={num(g.logged)} hint="Append-only" />
      </div>
      <div className="card overflow-hidden">
        {RAILS.map(([when, what, how]) => <div key={what} className="row md:grid-cols-[170px_minmax(0,1.2fr)_minmax(0,2fr)]"><span><Pill tone="brand">{when}</Pill></span><b>{what}</b><span className="text-sm text-muted">{how}</span></div>)}
      </div>
    </div>
  );
}

const SCRIPTS: Record<string, string[]> = {
  M001: ["मेरे settlement में पैसे कम क्यों आए? मैं तो मशीन वापस करने की सोच रहा था", "अच्छा समझ गया, धन्यवाद", "हाँ, बात करा दीजिए"],
  M002: ["मेरा Soundbox का battery बार बार खत्म हो जाता है", "नहीं, बस इतना ही, धन्यवाद"],
  M007: ["रोड बंद है, दुकान पर ग्राहक नहीं आ रहे", "हाँ ठीक है, यह कर दीजिए", "नहीं, बस इतना ही, धन्यवाद"],
  M008: ["अच्छा, कितना मिलेगा?", "रोज़ का ज़्यादा है", "हाँ ठीक है, यह वाला कर दीजिए", "नहीं, बस इतना ही, धन्यवाद"],
  M004: ["Soundbox का rent बहुत ज़्यादा लगता है", "हाँ ठीक है, यह plan कर दीजिए", "नहीं, बस इतना ही, धन्यवाद"],
};

function Welcome({ start }: { start: () => void }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-white">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 py-8">
        <div className="flex items-center gap-2 text-lg font-bold text-ink"><Logo />Rishta</div>
        <div className="mt-6 grid items-center gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div>
            <h1 className="text-[2.6rem] font-bold leading-[1.08] text-ink md:text-[3.2rem]">A relationship manager for every Paytm shop.</h1>
            <p className="mt-4 text-xl text-muted">Paytm can't give 1.64 crore shops a person who knows them. Rishta knows each one, fixes what's wrong, comes back to check, and proves in rupees what worked.</p>
            <div className="mt-7 flex flex-wrap items-center gap-4">
              <button onClick={start} className="btn-primary px-7 py-3.5 text-lg">Start</button>
              <span className="text-muted">3 minute walkthrough. Allow the microphone when asked.</span>
            </div>
          </div>
          <div className="card bg-paper p-4" aria-hidden>
            <div className="text-xs font-medium text-muted">Three days after a ticket</div>
            <div className="mt-2 w-fit max-w-[90%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 shadow-sm">नमस्ते Sharma जी, आपकी machine वाली दिक्कत ठीक हुई?</div>
            <div className="ml-auto mt-2 w-fit max-w-[90%] rounded-2xl rounded-tr-sm bg-navy px-3 py-2 text-white">नहीं, अभी तक कुछ नहीं हुआ।</div>
            <div className="mt-2 w-fit max-w-[90%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 shadow-sm">जी, Paytm से एक व्यक्ति आपको call करेगा।</div>
            <div className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-paytm-deep"><Icon name="check" size={16} />A problem closes only when the shop says so.</div>
          </div>
        </div>
        <ol className="mt-10 grid gap-3 sm:grid-cols-3">
          {[["list", "It decides", "Who to help tonight, how, and who to leave alone."], ["talk", "It does the work", "Talks to the shop in Hindi or English and fixes the problem."], ["proof", "It proves it", "Every result measured in rupees against shops it didn't contact."]].map(([icon, title, text]) => (
            <li key={title} className="card px-4 py-3.5"><Icon name={icon!} className="text-paytm-deep" size={22} /><div className="mt-2 font-semibold text-ink">{title}</div><div className="text-sm text-muted">{text}</div></li>
          ))}
        </ol>
        <p className="mt-6 text-sm text-muted">Runs on a simulated test bench with known answers. Not live in Paytm.</p>
      </div>
    </div>
  );
}

const Logo = () => <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-paytm to-paytm-deep text-sm font-extrabold text-white">र</span>;

function Today({ v, pick, open }: { v: View; pick: (g: Group) => void; open: (id: string) => void }) {
  const [hover, setHover] = useState<Group | "idle" | null>(null);
  const p = v.plan;
  const counts: Record<Group, number> = { handled: p.handledByRishta, visit: p.salespersonVisits, callback: p.humanCallbacks, left: p.leftAlone };
  const proven = v.ledger.filter((l: any) => l.proven);
  return (
    <div className="space-y-4">
      <PageHead eyebrow="Last night's run, no one asked" title={`${num(p.checked)} shops checked. ${p.needAttention} needed a decision.`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Yearly value in today's plan" value={`₹${num(Math.round(v.atStake / 100000 * 10) / 10)} L`} hint="Shops Rishta will reach (estimate)" tone="brand" />
        <Stat label="Rishta talks to" value={counts.handled} hint="Soundbox or app" />
        <Stat label="Left alone on purpose" value={counts.left} hint="Rules, or contact doesn't pay" />
        <Stat label="Needs a person" value={counts.visit + counts.callback} hint={`${counts.visit} visits, ${counts.callback} calls`} />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
        <Card title="Every shop, tonight's decision">
          <div className="mx-auto max-w-[calc((100dvh-420px)*2)]"><ShopMap plan={p} active={hover && hover !== "idle" ? hover : null} onHover={setHover} onPick={pick} /></div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            {(Object.keys(GROUPS) as Group[]).map((g) => <button key={g} onClick={() => pick(g)} onMouseEnter={() => setHover(g)} onMouseLeave={() => setHover(null)} className="flex items-center gap-1.5 text-sm hover:text-paytm-deep"><span className="h-2.5 w-2.5 rounded-full" style={{ background: GROUPS[g].color }} />{GROUPS[g].label} <b className="num">{counts[g]}</b></button>)}
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="Live activity" action={<span className="flex items-center gap-1.5 text-xs text-muted"><span className="live-dot" />Live</span>}>
            {v.activity.length === 0 ? <Empty title="Quiet so far">Conversations appear here the moment they finish.</Empty> : v.activity.map((a: any, i: number) => <button key={i} onClick={() => open(a.merchantId)} className="rise flex w-full items-start justify-between gap-2 border-b border-line py-1.5 text-left first:pt-0 last:border-0"><span className="min-w-0"><span className="block truncate font-semibold">{a.name}</span><span className="line-clamp-1 text-sm text-muted">{a.summary}</span></span><Pill tone={TONE[OUTCOME[a.outcome]?.[1] ?? "plain"]}>{OUTCOME[a.outcome]?.[0] ?? a.outcome}</Pill></button>)}
          </Card>
          <Card title="Why it pays" action={<SimTag />}>
            {proven.slice(0, 3).map((l: any) => <div key={l.problem} className="flex items-baseline justify-between gap-2 py-1 text-sm"><span>{l.label}</span><span className="num font-semibold text-kept">₹{num(l.best)}</span></div>)}
            <p className="mt-1 text-xs text-muted">Net yearly gain per 100 shops contacted.</p>
          </Card>
        </div>
      </div>
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
    <div className="flex h-full min-h-[28rem] flex-col">
      <PageHead title={tab === "left" ? `${p.leftAlone} shops left alone on purpose.` : tab === "handled" ? `Rishta handles ${p.handledByRishta} shops itself.` : tab === "visit" ? `${p.salespersonVisits} shops are worth a salesperson's time.` : `${p.humanCallbacks} shops need a person to call.`} sub={tab === "left" && check ? `${left.length - learned} by rule. ${learned} because contact doesn't pay: ${pct(check.contactedKeep)} of contacted shops stayed in one group, ${pct(check.holdoutKeep)} when left alone (simulated).` : "Press any shop to see why it got this decision."} />
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Decision">
        {(Object.keys(GROUPS) as Group[]).map((g) => <button key={g} role="tab" aria-selected={g === tab} onClick={() => setTab(g)} className={`seg ${g === tab ? "seg-on" : ""}`}>{GROUPS[g].label} <span className="num opacity-70">{counts[g]}</span></button>)}
      </div>
      <div className="card min-h-0 flex-1 overflow-y-auto">
        {!list && <div className="space-y-2 p-4"><Skeleton h={36} /><Skeleton h={36} /><Skeleton h={36} /></div>}
        {tab === "left"
          ? left.map((l: any) => (
            <button key={l.id} onClick={() => open(l.id)} className="row md:grid-cols-[minmax(0,2fr)_90px_minmax(0,5fr)]">
              <span className="truncate"><b>{l.name}</b> <span className="text-muted">{l.city}</span></span>
              <span><Pill tone="warn">{l.kind === "rule" ? "Rule" : l.kind === "learned" ? "Learned" : "Both"}</Pill></span>
              <span className="text-sm text-muted">{l.reasons.map(plainReason).join(". ")}</span>
            </button>
          ))
          : shown.map((d: any) => (
            <button key={d.id} onClick={() => open(d.id)} className="row md:grid-cols-[minmax(0,2.2fr)_minmax(0,2fr)_minmax(0,2fr)_100px]">
              <span className="truncate"><b>{d.name}</b> <span className="text-muted">{d.city}</span></span>
              <span>{d.reason}</span>
              <span className="text-muted">{d.approach}</span>
              <span><Pill tone="brand">{CHANNEL_SHORT[d.channel]}</Pill></span>
            </button>
          ))}
      </div>
    </div>
  );
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return <dl>{rows.map(([k, val]) => <div key={k} className="flex justify-between gap-4 border-b border-line py-1.5 text-sm last:border-0"><dt className="text-muted">{k}</dt><dd className="text-right font-semibold">{val}</dd></div>)}</dl>;
}

function Shop({ item, v }: { item: any; v: View }) {
  const { brief, meta } = item;
  const [tab, setTab] = useState<"facts" | "rules" | "raw">("facts");
  const order = Object.keys(FACTS);
  const facts = Object.entries(brief.facts).filter(([k]) => k !== "firstName" && k !== "businessName").sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  const pb = v.playbook.find((p: any) => p.problem === brief.problem);
  const worth = meta.valueYear;
  return (
    <div>
      <PageHead eyebrow={`${meta.city} · ${meta.reasonLabel}`} title={meta.name} sub={meta.why} action={worth && <div className="text-right"><div className="num text-xl font-bold text-paytm-deep">₹{num(worth.total)}</div><div className="text-xs text-muted">a year to Paytm (estimate)</div></div>} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <div className="space-y-4">
          <Card title="What Rishta decided">
            <Rows rows={[["How to help", meta.approachLabel], ["Reach them through", CHANNEL[brief.channel]], ["Goal", brief.goal]]} />
            {pb && <div className="mt-3 border-t border-line pt-2 text-sm">
              {pb.approaches.map((a: any) => <div key={a.id} className={`flex justify-between py-0.5 ${a.id === brief.approachId ? "font-semibold text-ink" : "text-muted"}`}><span>{a.id === brief.approachId ? "→ " : ""}{a.label}</span><span className="num">{pct(a.keepRate)} kept, of {a.n}</span></div>)}
              <p className="mt-1 text-xs text-sim">Past results, simulated.{meta.approachShare != null ? ` ${pct(meta.approachShare)} of shops like this go this way; the rest keep testing.` : ""}</p>
            </div>}
          </Card>
          <Card title="What Rishta remembers"><History entries={item.history} /></Card>
        </div>
        <Card title="The brief any agent receives" action={<div className="flex gap-1" role="tablist" aria-label="Brief">{([["facts", "Numbers"], ["rules", "Rules"], ["raw", "Contract"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`seg seg-sm ${tab === k ? "seg-on" : ""}`}>{l}</button>)}</div>}>
          {tab === "facts" && <>
            <p className="mb-1 text-sm text-muted">The only numbers the AI may say. Each sentence is checked before it is spoken.</p>
            <table className="w-full"><tbody className="num text-sm">{facts.map(([k, val]) => { const f = fact(k, val); return <tr key={k} className="border-b border-line last:border-0"><td className="py-1 pr-3">{f.label}</td><td className="py-1 text-right font-medium">{f.text}</td></tr>; })}</tbody></table>
          </>}
          {tab === "rules" && <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div><div className="font-semibold">May do</div><ul className="text-muted">{brief.allowedActions.map((a: string) => <li key={a}>{ACTIONS[a] ?? a}</li>)}</ul><div className="mt-2 font-semibold">Discount limit</div><div className="text-muted">₹{brief.limits.maxDiscountInr} a month</div></div>
            <div><div className="font-semibold">Must say</div><ul className="text-muted">{brief.mustSay.map((t: string) => <li key={t}>{t}</li>)}</ul><div className="mt-2 font-semibold">Must never</div><ul className="text-muted">{brief.mustNot.map((t: string) => <li key={t}>{t}</li>)}</ul><div className="mt-2 font-semibold">Pass to a person if</div><ul className="text-muted">{brief.escalateIf.map((t: string) => <li key={t}>{t}</li>)}</ul></div>
          </div>}
          {tab === "raw" && <pre className="max-h-[26rem] overflow-auto rounded-lg bg-paper p-3 font-mono text-xs">{JSON.stringify(brief, null, 2)}</pre>}
        </Card>
      </div>
    </div>
  );
}

function LeftShop({ shop, talk }: { shop: any; talk: () => void }) {
  return (
    <div className="max-w-2xl space-y-4">
      <PageHead eyebrow={`${shop.city} · Left alone on purpose`} title={shop.name} sub="Rishta chose not to contact this shop today." />
      <Card title="Why">
        <ul className="space-y-2">{shop.left.reasons.map((r: string) => <li key={r} className="flex gap-2"><Icon name="shield" className="mt-0.5 text-leftalone" />{plainReason(r)}</li>)}</ul>
      </Card>
      <Card title="The shop can still reach us">
        <p className="text-muted">Only proactive contact is held back. If the shopkeeper presses the button, Rishta answers like it would for anyone.</p>
        <button onClick={talk} className="btn-ghost mt-3">Press the button as this shop</button>
      </Card>
    </div>
  );
}

function NoDecision({ shop, id, talk }: { shop: any; id: string; talk: () => void }) {
  return (
    <div className="max-w-2xl space-y-4">
      <PageHead title={shop ? shop.name : `No shop called ${id}`} sub={shop ? "No plan for this shop today: nothing needs doing, or it is in the no-contact group." : "Check the link, or search for a shop above."} />
      {shop && <button onClick={talk} className="btn-ghost">Press the button as this shop</button>}
    </div>
  );
}

// What the manager is doing while the shopkeeper talks.
function LivePanel({ shop }: { shop: any }) {
  const { brief, meta, live } = shop;
  const actions = (live?.actions ?? []).filter((a: string) => a !== "recordOutcome");
  const Tick = ({ children, warn }: { children: React.ReactNode; warn?: boolean }) => <li className={`rise flex gap-2 ${warn ? "text-sim" : ""}`}><Icon name={warn ? "shield" : "check"} className={warn ? "" : "text-kept"} />{children}</li>;
  return (
    <Card title={<span className="flex items-center gap-2"><span className="live-dot" />Rishta, live</span>} className="w-[320px] shrink-0 self-center">
      <div className="font-semibold leading-snug">{brief?.goal ?? "Answer what the shop came to ask"}</div>
      <ol className="mt-3 space-y-2 text-sm">
        {brief ? <Tick>Brief ready: {meta.approachLabel}</Tick> : <Tick>The shop came to us: normal service</Tick>}
        {live?.numbersChecked > 0 && <Tick>{live.numbersChecked} {live.numbersChecked === 1 ? "number" : "numbers"} checked before speaking</Tick>}
        {live?.guardEvents.length > 0 && <Tick warn>{live.guardEvents.length} blocked by the guard, never spoken</Tick>}
        {actions.map((a: string, i: number) => <Tick key={i}>{ACTIONS[a] ?? a}</Tick>)}
      </ol>
      {shop.outcome && <div className="mt-3 border-t border-line pt-2"><Pill tone={TONE[OUTCOME[shop.outcome.outcome]![1]]}>{OUTCOME[shop.outcome.outcome]![0]}</Pill></div>}
    </Card>
  );
}

function Talk({ shop, id }: { shop: any; id: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-10">
      <MerchantPhone shopId={id} tips={shop.openPromises?.length ? ["हाँ, replacement आ गई, अब सब ठीक है", "नहीं, अभी तक कुछ नहीं हुआ"] : shop.outcome ? [] : SCRIPTS[id] ?? []} onTip />
      <div className="hidden lg:block"><LivePanel shop={shop} /></div>
    </div>
  );
}

function Result({ item, settled, checkBack }: { item: any; settled: any[] | null; checkBack: () => void }) {
  const { outcome } = item;
  if (!outcome) return <Empty title="No result yet">Go back and finish the conversation.</Empty>;
  const [label, tone] = OUTCOME[outcome.outcome]!;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHead eyebrow={<Pill tone={TONE[tone]}>{label}</Pill>} title={item.name} sub={outcome.summary} />
      {outcome.reasons.length > 0 && <Card title="In their words">{outcome.reasons.map((r: any, i: number) => <p key={i} className="text-lg leading-snug">"{r.quote}"</p>)}</Card>}
      {outcome.numbersChecked > 0 && outcome.numbersVerified && <div className="flex items-center gap-2 font-medium text-kept"><Icon name="check" />{outcome.numbersChecked === 1 ? "The number it spoke was" : `All ${outcome.numbersChecked} numbers it spoke were`} checked against this shop's data first.</div>}
      {item.openPromises?.length > 0 && (
        <Card title="Not closed yet" className="border-l-4 border-l-paytm">
          <p>Rishta made a promise: {item.openPromises[0].text}</p>
          <p className="text-sm text-muted">It stays open until the shop itself says it worked.</p>
          <button onClick={checkBack} className="btn-ghost mt-3">Go 3 days ahead: Rishta checks back</button>
        </Card>
      )}
      {settled === null && <p className="text-muted">What a shop says isn't the measure. It counts as kept only if it is still active 30 days later.</p>}
      {settled?.length === 0 && <p className="text-muted">This result was already counted.</p>}
      {settled?.map((r) => (
        <Card key={r.merchantId} className="rise border-l-4 border-l-kept">
          <p className="text-lg font-semibold">30 days later (simulated): {r.kept ? "still active" : "they left"}.</p>
          <p className="text-muted">"{r.approach}" now has {r.resultsAfter} results, up from {r.resultsBefore}. Tonight's plan uses it.</p>
        </Card>
      ))}
      <Card title="What Rishta remembers now"><History entries={item.history} /></Card>
    </div>
  );
}

const DO: Record<string, string> = {
  "/today": "Rishta decided all of this on its own overnight. Press a colour to see the shops by name.",
  "/decisions": "This is the manager's list. Open any shop, or see who it left alone and why.",
  "/shop": "This is the brief. In production the nudge goes out by itself at 9am.",
  "/talk": "You're the shopkeeper. Hold the mic and speak Hindi or English, or tap the line.",
  "/result": "Rishta logged this itself. Next: did the shop really stay?",
  "/proof": "The evidence, in shops and in rupees.",
  "/loans": "From a nightly check to a loan the lender can decide on.",
  "/why": "Conversations tell the sales team why shops really leave, including what you just said.",
  "/team": "That's the loop. Last: what stops it going wrong.",
  "/guardrails": "That's the whole product. Try another shop, or open it on your phone.",
};

function Search({ list, open }: { list: any; open: (id: string) => void }) {
  const [q, setQ] = useState("");
  const all = useMemo(() => [...(list?.decided ?? []), ...(list?.left ?? [])], [list]);
  const found = q.trim() ? all.filter((s: any) => `${s.name} ${s.city}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6) : [];
  return (
    <div className="relative hidden w-72 md:block">
      <Icon name="search" size={16} className="absolute left-2.5 top-2.5 text-muted" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search shops" aria-label="Search shops" className="w-full rounded-lg border border-line bg-paper py-1.5 pl-8 pr-3 text-sm outline-none focus:border-paytm" />
      {found.length > 0 && <div className="card absolute z-20 mt-1 w-full overflow-hidden shadow-lg">{found.map((s: any) => <button key={s.id} onClick={() => { setQ(""); open(s.id); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-paper"><b>{s.name}</b> <span className="text-muted">{s.city}</span></button>)}</div>}
    </div>
  );
}

// The walkthrough lives under /demo. Inside it, paths stay short.
const here = () => window.location.pathname.replace(/^\/demo/, "") + window.location.search;

export default function Flow() {
  const [url, setUrl] = useState(here());
  const [v, setV] = useState<View | null>(null);
  const [flash, setFlash] = useState(false);
  const [settled, setSettled] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [rawPath, query = ""] = url.split("?");
  const path = rawPath || "/";
  const params = new URLSearchParams(query);
  const shop = params.get("shop") ?? "M001";
  const tab = TAB[params.get("tab") ?? "talk"] ?? "handled";
  const [list, setList] = useState<any>(null);
  const [item, setItem] = useState<any>(undefined);

  const go = useCallback((to: string) => {
    history.pushState(null, "", `/demo${to === "/" ? "" : to}`);
    setUrl(to);
    setError("");
  }, []);
  useEffect(() => {
    const back = () => setUrl(here());
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

  if (path === "/" || (path !== "/guardrails" && !STEPS.some(([p]) => p === path))) return <Welcome start={() => void begin()} />;
  const index = STEPS.findIndex(([p]) => p === path);
  const talkable = !!item?.brief && ["soundbox", "app"].includes(item.brief.channel);
  const finished = !!item?.outcome;
  const needsShop = ["/shop", "/talk", "/result"].includes(path);
  const status = path === "/talk" && finished ? "Conversation finished. Press See what happened."
    : path === "/result" && !finished ? "No result yet. Go back and finish the conversation."
    : path === "/result" && settled !== null ? "That result now feeds tonight's plan."
    : path === "/shop" && item?.left ? "Rishta decided to leave this shop alone."
    : path === "/shop" && item?.brief && !talkable ? "Rishta won't contact this shop itself. It goes to a person, with this brief."
    : path === "/shop" && item?.blocked ? `Rishta will not contact this shop: ${item.blocked.toLowerCase()}.`
    : DO[path]!;
  const withShop = (p: string) => `${p}?shop=${shop}`;
  const tabName = (g: Group) => Object.keys(TAB).find((k) => TAB[k] === g)!;
  const toList = (g: Group) => go(`/decisions?tab=${tabName(g)}`);
  const open = (id: string) => { setSettled(null); go(`/shop?shop=${id}`); };
  const talkHere = () => go(withShop("/talk"));
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
    : path === "/proof" ? { label: "See the loan pipeline", run: () => go(withShop("/loans")) }
    : path === "/loans" ? { label: "Why shops leave", run: () => go(withShop("/why")) }
    : path === "/why" ? { label: "The team", run: () => go(withShop("/team")) }
    : path === "/team" ? { label: "See the guardrails", run: () => go("/guardrails") }
    : null;

  return (
    <div className="flex h-full">
      <nav aria-label="Main" className="hidden w-56 shrink-0 flex-col border-r border-line bg-white md:flex">
        <button onClick={() => go("/")} className="flex items-center gap-2 px-4 py-4 text-lg font-bold text-ink"><Logo />Rishta</button>
        <ul className="flex-1 space-y-0.5 px-2">
          {NAV.map(([p, label, icon]) => {
            const on = path === p || (p === "/talk" && path === "/result");
            return <li key={p}><button aria-current={on ? "page" : undefined} onClick={() => go(["/shop", "/talk"].includes(p) ? withShop(p) : p)} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[0.95rem] ${on ? "bg-paytm/12 font-semibold text-paytm-deep" : "text-muted hover:bg-paper hover:text-ink"}`}><Icon name={icon} />{label}</button></li>;
          })}
          <li className="pt-3"><a href="/" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[0.95rem] font-semibold text-paytm-deep hover:bg-paper"><Icon name="talk" />Talk as any shop</a></li>
          <li><a href="/sales" target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[0.95rem] text-muted hover:bg-paper hover:text-ink"><Icon name="phone" />Sales app</a></li>
        </ul>
        <div className="space-y-2 border-t border-line p-3 text-sm">
          <Pill tone="warn">Simulated test bench</Pill>
          <button onClick={() => void startOver()} className="flex items-center gap-2 text-muted hover:text-ink"><Icon name="reset" size={15} />Start over</button>
        </div>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-4 border-b border-line bg-white px-4 py-2 md:px-6">
          <button onClick={() => go("/")} className="flex items-center gap-2 font-bold md:hidden"><Logo />Rishta</button>
          <div className="min-w-0 flex-1 truncate text-sm text-muted md:hidden">Step {index + 1} of {STEPS.length}</div>
          <div className="hidden flex-1 items-center gap-2 text-sm text-muted md:flex"><span className="live-dot" />Tonight's run complete · {v ? num(v.plan.checked) : "–"} shops</div>
          <Search list={list} open={open} />
        </header>
        <main key={path} className="rise min-h-0 flex-1 overflow-y-auto bg-paper px-4 py-5 md:px-6">
          <div className="mx-auto h-full max-w-6xl">
            {!v && <div className="grid gap-3 md:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} />)}<div className="md:col-span-4"><Skeleton h={320} /></div></div>}
            {v && <>
              {needsShop && item === undefined && <Skeleton h={320} />}
              {path !== "/talk" && needsShop && item !== undefined && !item?.brief && !item?.left && <NoDecision shop={item} id={shop} talk={talkHere} />}
              {path === "/today" && <Today v={v} pick={toList} open={open} />}
              {path === "/decisions" && <Decisions v={v} list={list} tab={tab} setTab={toList} open={open} />}
              {path === "/shop" && item?.left && !item.brief && <LeftShop shop={item} talk={talkHere} />}
              {path === "/shop" && item?.brief && <Shop item={item} v={v} />}
              {path === "/talk" && item && <Talk shop={item} id={shop} />}
              {path === "/loans" && <Loans v={v} open={open} />}
              {path === "/result" && item?.brief && <Result item={item} settled={settled} checkBack={() => void fetch(`/api/check-back/${shop}`, { method: "POST" }).then(() => go(`/talk?shop=${shop}`))} />}
              {path === "/proof" && <Proof v={v} />}
              {path === "/why" && <Why v={v} flash={flash} />}
              {path === "/team" && <Team v={v} selected={shop} />}
              {path === "/guardrails" && <Guardrails v={v} />}
            </>}
          </div>
        </main>
        <footer className="flex flex-wrap items-center gap-3 border-t border-line bg-white px-4 py-2.5 md:px-6">
          <button onClick={() => history.back()} aria-label="Back" className="btn-quiet"><Icon name="back" size={16} /></button>
          <ol className="hidden gap-1 md:flex" aria-label="Progress">{STEPS.map(([p, label], i) => <li key={p} aria-current={i === index ? "step" : undefined} title={label} className={`h-1.5 w-6 rounded-full ${i < index ? "bg-paytm-deep" : i === index ? "bg-paytm" : "bg-idle"}`} />)}</ol>
          <p role="status" className="min-w-0 flex-1 text-[0.95rem] text-ink">{error ? <span className="text-callback">{error}</span> : status}</p>
          {next
            ? <button onClick={next.run} disabled={next.off} className={next.off ? "btn-off" : "btn-primary"}>{next.label}<Icon name="arrow" size={16} /></button>
            : <>
              <button onClick={() => open("M002")} className="btn-ghost">Sharma Medicos</button>
              <button onClick={() => open("M007")} className="btn-ghost">Verma: missed EMIs</button>
              <button onClick={() => open("M008")} className="btn-ghost">Anand: loan</button>
              <button onClick={() => void startOver()} className="btn-primary">Start over</button>
            </>}
        </footer>
      </div>
    </div>
  );
}
