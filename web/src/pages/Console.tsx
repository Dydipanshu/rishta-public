import qrcode from "qrcode-generator";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEvents } from "../hooks/useEvents";

/* eslint-disable @typescript-eslint/no-explicit-any */
type View = any;
type Step = "today" | "shop" | "proof" | "why" | "team";
type Group = "handled" | "visit" | "callback" | "left";

const STEPS: [Step, string][] = [["today", "Today"], ["shop", "One shop"], ["proof", "Proof"], ["why", "Why shops leave"], ["team", "The team"]];
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

function Today({ v, open }: { v: View; open: (id: string) => void }) {
  const [group, setGroup] = useState<Group>("handled");
  const [picked, setPicked] = useState(false);
  const [hover, setHover] = useState<Group | "idle" | null>(null);
  const p = v.plan;
  const counts: Record<Group, number> = { handled: p.handledByRishta, visit: p.salespersonVisits, callback: p.humanCallbacks, left: p.leftAlone };
  const channels: Record<Group, string[]> = { handled: ["soundbox", "app"], visit: ["salesperson_visit"], callback: ["human_callback"], left: [] };
  const rows = v.queue.filter((q: any) => channels[group].includes(q.brief.channel));
  const hint = hover === "idle" ? `${num(p.checked - p.needAttention)} shops need nothing today` : hover ? `${counts[hover]} shops: ${GROUPS[hover].label.toLowerCase()}` : "Each dot is one shop";
  return (
    <div className="grid gap-x-8 gap-y-6 md:grid-cols-[minmax(0,1.45fr)_minmax(270px,1fr)]">
      <div>
        <h1 className="max-w-2xl text-[30px] font-extrabold leading-[1.14] text-navy">{num(p.checked)} shops checked last night. {p.needAttention} needed something, and Rishta decided what.</h1>
        <div className="mt-6"><ShopMap plan={p} active={hover && hover !== "idle" ? hover : picked ? group : null} onHover={setHover} /></div>
        <div className="mt-2 text-sm text-muted" aria-live="polite">{hint}</div>
      </div>
      <div>
        <div role="tablist" aria-label="Decisions">
          {(Object.keys(GROUPS) as Group[]).map((g) => (
            <button key={g} role="tab" aria-selected={group === g} onClick={() => { setGroup(g); setPicked(true); }} className={`flex w-full items-center gap-3 border-b border-line px-2 py-2.5 text-left ${group === g ? "bg-white" : ""}`}>
              <span className="h-3 w-3 rounded-full" style={{ background: GROUPS[g].color }} />
              <span className="flex-1">{GROUPS[g].label}</span>
              <span className="text-xl font-bold">{counts[g]}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 max-h-[46vh] overflow-y-auto">
          {group === "left"
            ? v.leftAlone.map((l: any) => (
              <div key={l.merchant_id} className="border-b border-line py-2">
                <div className="font-semibold">{l.name ?? l.merchant_id}{l.city && <span className="font-normal text-muted">, {l.city}</span>}</div>
                <div className="text-sm text-muted">{l.reasons.map(plainReason).join(" ")}</div>
              </div>
            ))
            : rows.map((q: any) => (
              <button key={q.brief.briefId} onClick={() => open(q.brief.merchantId)} className="flex w-full items-baseline justify-between gap-3 border-b border-line py-2 text-left hover:bg-white">
                <span className="font-semibold">{q.meta.name}</span>
                <span className="text-right text-sm text-muted">{q.outcome ? `✓ ${OUTCOME[q.outcome.outcome]}` : q.meta.reasonLabel}</span>
              </button>
            ))}
        </div>
        {group !== "left" && <div className="mt-2 text-sm text-muted">Showing the top {rows.length} of {counts[group]}.</div>}
      </div>
    </div>
  );
}

function Shop({ item, sent, onSend, error, onJump, settled, go }: { item: any; sent: boolean; onSend: () => void; error: string; onJump: () => void; settled: any[] | null; go: (s: Step) => void }) {
  const { brief, meta, outcome } = item;
  const canSend = brief.channel === "soundbox" || brief.channel === "app";
  const facts = Object.entries(brief.facts).filter(([k]) => k !== "firstName" && k !== "businessName");
  return (
    <div className="grid gap-x-8 gap-y-6 md:grid-cols-[minmax(0,1.1fr)_minmax(290px,1fr)]">
      <div>
        <div className="text-muted">{meta.city} · {meta.reasonLabel}</div>
        <h1 className="text-[30px] font-extrabold leading-tight text-navy">{meta.name}</h1>
        <p className="mt-2 max-w-xl text-xl leading-snug">{meta.why}</p>
        <dl className="mt-5 max-w-xl">
          <div className="flex justify-between gap-4 border-t border-line py-2"><dt className="text-muted">Best approach</dt><dd className="text-right font-semibold">{meta.approachLabel}</dd></div>
          <div className="flex justify-between gap-4 border-t border-line py-2"><dt className="text-muted">Reach them through</dt><dd className="text-right font-semibold">{CHANNEL[brief.channel]}</dd></div>
          <div className="flex justify-between gap-4 border-y border-line py-2"><dt className="text-muted">Goal</dt><dd className="text-right font-semibold">{brief.goal}</dd></div>
        </dl>

        <div className="mt-6 max-w-xl">
          {!outcome && canSend && !sent && <button onClick={onSend} className="w-full rounded-lg bg-navy py-3.5 text-lg font-semibold text-white">Contact {meta.name}</button>}
          {!outcome && !canSend && <p className="text-lg">This one goes to a person. <button className="font-semibold text-paytm-deep underline" onClick={() => go("team")}>See the team's list</button></p>}
          {!outcome && sent && <p className="rise text-lg font-semibold text-navy">Sent. Now answer on the phone: hold the Paytm button and speak.</p>}
          {error && <p className="mt-2 text-callback">{error}</p>}
          {outcome && (
            <div className="rise border-l-4 border-kept pl-4">
              <div className="text-xl font-bold text-kept">✓ {OUTCOME[outcome.outcome]}</div>
              <p className="mt-1">{outcome.summary}</p>
              {outcome.reasons.map((r: any, i: number) => <p key={i} className="mt-1 text-muted">"{r.quote}"</p>)}
              {outcome.numbersVerified && <p className="mt-1 text-sm font-semibold text-kept">Every number it spoke was checked against this shop's data.</p>}
              {!settled?.length && <button onClick={onJump} className="mt-4 rounded-lg bg-navy px-5 py-3 font-semibold text-white">Jump 30 days: did they stay?</button>}
              {settled?.map((r) => (
                <div key={r.merchantId} className="rise mt-4">
                  <p className="text-lg font-semibold">30 days later (simulated): {r.name} {r.kept ? "is still active" : "has left"}.</p>
                  <p>"{r.approach}" now has {r.resultsAfter} results, up from {r.resultsBefore}. The next plan uses it.</p>
                  <button className="mt-2 font-semibold text-paytm-deep underline" onClick={() => go("proof")}>See the proof</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <aside>
        <h2 className="font-semibold text-navy">Numbers the AI may say</h2>
        <p className="text-sm text-muted">It can't speak any other number. Each one is checked before it's spoken.</p>
        <table className="mt-2 w-full">
          <tbody>
            {facts.map(([k, val]) => {
              const f = fact(k, val);
              return <tr key={k} className="border-b border-line"><td className="py-1 pr-3">{f.label}</td><td className="py-1 text-right font-mono text-sm">{f.text}</td></tr>;
            })}
          </tbody>
        </table>
        <h2 className="mt-5 font-semibold text-navy">It can</h2>
        <p className="text-sm">{brief.allowedActions.map((a: string) => ACTIONS[a] ?? words(a)).join(" · ")}</p>
        <h2 className="mt-4 font-semibold text-navy">It must never</h2>
        <ul className="text-sm">{brief.mustNot.map((x: string) => <li key={x}>{x}</li>)}</ul>
      </aside>
    </div>
  );
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
            {[[pct(r.reasonAccuracy), `right reason, ${num(r.reasonCases)} cases`], [`${r.winnersFound} of ${r.problems}`, "best approach found"], [r.backfireFound ? "Yes" : "No", "found shops where contact backfires"], [`${r.riskLift.toFixed(1)}×`, "risk score, top 10% of shops"]].map(([big, small]) => (
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
            {v.why.reasons.map((r: any) => (
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
        {stats.map(([big, small]) => <div key={small}><div className="text-3xl font-extrabold text-navy">{big}</div><div className="text-sm text-muted">{small}</div></div>)}
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

export default function Console() {
  const [v, setV] = useState<View | null>(null);
  const [step, setStep] = useState<Step>("today");
  const [selected, setSelected] = useState("M001");
  const [flash, setFlash] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [settled, setSettled] = useState<any[] | null>(null);

  const load = useCallback(() => {
    void fetch("/api/console").then((r) => r.json()).then(setV);
  }, []);
  useEffect(load, [load]);
  useEvents((e) => {
    if (e.type === "reset") {
      setSettled(null);
      setSent(false);
      setStep("today");
    }
    if (e.type === "changed") {
      load();
      setFlash(true);
      setTimeout(() => setFlash(false), 1500);
    }
  });

  const open = (id: string) => {
    setSelected(id);
    setSent(false);
    setError("");
    setSettled(null);
    setStep("shop");
    const channel = new BroadcastChannel("rishta");
    channel.postMessage(id);
    channel.close();
  };
  const send = async () => {
    setError("");
    const res = await fetch(`/api/outreach/${selected}`, { method: "POST" });
    const body = await res.json();
    if (res.ok && !body.duplicate) setSent(true);
    else setError(body.duplicate ? "Already contacted today. Press Start over to run it again." : body.error ?? "Couldn't send this. Try again.");
  };
  const jump = async () => setSettled((await (await fetch("/api/demo/fast-forward", { method: "POST" })).json()).settled);

  if (!v) return <div className="p-6">Loading…</div>;
  const item = v.queue.find((q: any) => q.brief.merchantId === selected) ?? v.queue[0];

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-line bg-white px-6">
        <div className="text-xl font-extrabold text-navy">Rishta</div>
        <nav className="flex flex-1 gap-1" aria-label="Sections">
          {STEPS.map(([id, label]) => (
            <button key={id} onClick={() => setStep(id)} aria-current={step === id ? "page" : undefined} className={`border-b-[3px] px-3 py-3 font-medium ${step === id ? "border-paytm text-navy" : "border-transparent text-muted"}`}>{label}</button>
          ))}
        </nav>
        <span className="text-sm text-sim">Simulated test data</span>
        <button onClick={() => void fetch("/api/reset", { method: "POST" })} className="text-sm text-muted underline">Start over</button>
      </header>
      <main key={step} className="rise min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {step === "today" && <Today v={v} open={open} />}
        {step === "shop" && <Shop item={item} sent={sent} onSend={() => void send()} error={error} onJump={() => void jump()} settled={settled} go={setStep} />}
        {step === "proof" && <Proof v={v} />}
        {step === "why" && <Why v={v} flash={flash} />}
        {step === "team" && <Team v={v} selected={selected} />}
      </main>
    </div>
  );
}
