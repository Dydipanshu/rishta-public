import qrcode from "qrcode-generator";
import { useCallback, useEffect, useState } from "react";
import { useEvents } from "../hooks/useEvents";

/* eslint-disable @typescript-eslint/no-explicit-any */
type View = any;

const pct = (n: number | null) => (n === null ? "-" : `${Math.round(n * 100)}%`);
const CHANNEL: Record<string, string> = { soundbox: "Soundbox", app: "App card", salesperson_visit: "Visit", human_callback: "Callback" };
const COLORS = ["#002e6e", "#00baf2", "#b6c7d9"];
const COMPLIANCE = [
  "AI disclosed in the first line", "Never asks for OTP or PIN", "Consent checked before outreach", "Contact cap and quiet hours (9am–7pm)",
  "Opt-out honoured everywhere", "Holdout keeps normal service", "LLM sees only the brief", "Full audit log", "Plan changes need explicit consent", "A human is always available",
];

function Panel({ title, note, children, className = "" }: { title: string; note?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl bg-white p-3 shadow-sm ${className}`}>
      <h2 className="mb-2 text-sm font-semibold text-navy">{title}{note && <span className="ml-2 text-[10px] font-normal text-amber-700">{note}</span>}</h2>
      {children}
    </section>
  );
}

function Qr({ url, label }: { url: string; label: string }) {
  const q = qrcode(0, "M");
  q.addData(url);
  q.make();
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block text-center text-[11px] text-slate-600">
      <div dangerouslySetInnerHTML={{ __html: q.createSvgTag({ cellSize: 3, margin: 2 }) }} />
      {label}
    </a>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xl font-bold text-navy">{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}

function ShareChart({ approaches }: { approaches: any[] }) {
  const weeks = approaches[0]?.weekly.length ?? 0;
  const w = 100 / Math.max(1, weeks);
  return (
    <svg viewBox="0 0 100 34" className="h-24 w-full" preserveAspectRatio="none" role="img" aria-label="Traffic share by week">
      {Array.from({ length: weeks }, (_, i) => {
        let y = 34;
        return approaches.map((a, j) => {
          const h = a.weekly[i] * 34;
          y -= h;
          return <rect key={`${i}-${j}`} x={i * w} y={y} width={w - 0.4} height={h} fill={COLORS[j]} />;
        });
      })}
    </svg>
  );
}

function BriefCard({ item, onOutreach }: { item: any; onOutreach: () => void }) {
  const { brief, meta, outcome } = item;
  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-navy">{meta.name}, {meta.city}</div>
          <div className="text-slate-600">{meta.why}</div>
        </div>
        {!outcome && (brief.channel === "soundbox" || brief.channel === "app") && <button onClick={onOutreach} className="shrink-0 rounded bg-paytm px-3 py-1.5 font-semibold text-white">Send outreach</button>}
      </div>
      <div className="grid grid-cols-2 gap-1 text-[11px]">
        <div><b>Approach:</b> {meta.approachLabel}{meta.approachShare !== null && ` (${pct(meta.approachShare)} of traffic)`}</div>
        <div><b>Channel:</b> {CHANNEL[brief.channel]}</div>
        <div className="col-span-2"><b>Goal:</b> {brief.goal}</div>
      </div>
      <div className="rounded bg-slate-50 p-2">
        <div className="mb-1 text-[10px] font-semibold uppercase text-slate-500">Facts: the only numbers the agent may say</div>
        <div className="grid grid-cols-2 gap-x-3">
          {Object.entries(brief.facts).filter(([k]) => k !== "firstName" && k !== "businessName").map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 text-[11px]"><span className="truncate text-slate-500">{k}</span><span className="font-mono">{String(v)}</span></div>
          ))}
        </div>
      </div>
      <div className="text-[11px]"><b>Allowed actions:</b> {brief.allowedActions.join(", ")}</div>
      <div className="text-[11px]"><b>Must not:</b> {brief.mustNot.join("; ")}</div>
      {outcome && (
        <div className="rounded bg-green-50 p-2 text-[11px]">
          <b>Outcome: {outcome.outcome}</b> {outcome.numbersVerified && <span className="text-green-700">✓ numbers verified</span>}
          <div>{outcome.summary}</div>
          {outcome.reasons.map((r: any, i: number) => <div key={i} className="italic">"{r.quote}"</div>)}
        </div>
      )}
    </div>
  );
}

export default function Console() {
  const [v, setV] = useState<View | null>(null);
  const [selected, setSelected] = useState("M001");
  const [flash, setFlash] = useState(false);
  const [problem, setProblem] = useState("fee_confusion");
  const [settled, setSettled] = useState<any[] | null>(null);

  const load = useCallback(() => {
    void fetch("/api/console").then((r) => r.json()).then(setV);
  }, []);
  useEffect(load, [load]);
  useEvents((e) => {
    if (e.type === "reset") setSettled(null);
    if (e.type === "changed") {
      load();
      setFlash(true);
      setTimeout(() => setFlash(false), 1500);
    }
  });

  if (!v) return <div className="p-6">Loading…</div>;
  const item = v.queue.find((q: any) => q.brief.merchantId === selected) ?? v.queue[0];
  const pb = v.playbook.find((p: any) => p.problem === problem);
  const best = [...pb.approaches].sort((a: any, b: any) => (b.keepRate ?? 0) - (a.keepRate ?? 0))[0];

  return (
    <div className="min-h-screen space-y-3 p-3">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-navy">Rishta <span className="text-sm font-normal text-slate-500">the manager between prediction and voice</span></h1>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="rounded bg-amber-100 px-2 py-1 text-amber-800">Test bench: simulated data with known answers</span>
          <button onClick={() => void fetch("/api/demo/fast-forward", { method: "POST" }).then((r) => r.json()).then((r) => setSettled(r.settled))} className="rounded bg-navy px-2 py-1 text-white">Jump 30 days</button>
          <button onClick={() => void fetch("/api/reset", { method: "POST" })} className="rounded bg-slate-200 px-2 py-1">Reset demo</button>
        </div>
      </header>

      {settled && (
        <section className="rounded-xl border border-paytm bg-paytm/10 p-3 text-xs text-navy">
          <b>30 days later (simulated):</b> {settled.length === 0 && "no live results to count yet. Finish a conversation first."}
          {settled.map((r) => (
            <div key={r.merchantId}>{r.name}: {r.kept ? "still active" : "left"}. "{r.approach}" now has {r.resultsAfter} results, up from {r.resultsBefore}. The next plan uses it.</div>
          ))}
        </section>
      )}

      <Panel title="Today's plan">
        <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
          <Stat label="shops checked" value={v.plan.checked.toLocaleString("en-IN")} />
          <Stat label="need attention" value={v.plan.needAttention} />
          <Stat label="Rishta handles" value={v.plan.handledByRishta} />
          <Stat label="salesperson visits" value={v.plan.salespersonVisits} />
          <Stat label="human callbacks" value={v.plan.humanCallbacks} />
          <Stat label="left alone on purpose" value={v.plan.leftAlone} />
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
        <Panel title={`Queue (${v.queueTotal})`}>
          <div className="max-h-[340px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-white text-[10px] uppercase text-slate-500">
                <tr><th className="py-1">Shop</th><th>Reason</th><th>Approach</th><th>Via</th><th className="text-right">Risk</th></tr>
              </thead>
              <tbody>
                {v.queue.map((q: any) => (
                  <tr key={q.brief.briefId} onClick={() => setSelected(q.brief.merchantId)} className={`cursor-pointer border-t border-slate-100 ${q.brief.merchantId === selected ? "bg-paytm/10" : ""}`}>
                    <td className="py-1 pr-2 font-medium">{q.meta.name}{q.outcome && <span className="ml-1 rounded bg-green-100 px-1 text-[10px] text-green-700">{q.outcome.outcome}</span>}</td>
                    <td className="pr-2">{q.meta.reasonLabel}</td>
                    <td className="pr-2">{q.meta.approachLabel}</td>
                    <td className="pr-2">{CHANNEL[q.brief.channel]}</td>
                    <td className="text-right text-slate-400">{q.meta.risk.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Brief"><BriefCard item={item} onOutreach={() => void fetch(`/api/outreach/${item.brief.merchantId}`, { method: "POST" })} /></Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Why shops are leaving" note="history simulated" className={flash ? "ring-2 ring-paytm" : ""}>
          {v.why.spikes.map((s: any) => (
            <div key={s.code + s.city} className="mb-2 rounded bg-amber-50 p-2 text-[11px]">
              <b>{s.label} rising in {s.city}:</b> {s.before} → {s.now} in 4 weeks. <span className="text-slate-600">{s.move}</span>
            </div>
          ))}
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {v.why.reasons.map((r: any) => (
              <div key={r.code} className="text-xs">
                <div className="flex justify-between"><span className="font-medium">{r.label}{r.liveCount > 0 && <span className="ml-1 rounded bg-green-100 px-1 text-[10px] text-green-700">+{r.liveCount} live</span>}</span><span>{r.count}</span></div>
                {r.quotes.slice(0, 1).map((q: any, i: number) => <div key={i} className={`text-[11px] italic ${q.live ? "text-green-700" : "text-slate-500"}`}>"{q.quote}", {q.city}</div>)}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Playbook" note="simulated, labelled">
          <div className="mb-2 flex flex-wrap gap-1">
            {v.playbook.map((p: any) => <button key={p.problem} onClick={() => setProblem(p.problem)} className={`rounded px-1.5 py-0.5 text-[10px] ${p.problem === problem ? "bg-navy text-white" : "bg-slate-100"}`}>{p.label}</button>)}
          </div>
          <ShareChart approaches={pb.approaches} />
          <div className="mb-1 flex justify-between text-[10px] text-slate-400"><span>week 1</span><span>traffic share by approach</span><span>now</span></div>
          <table className="w-full text-xs">
            <tbody>
              {pb.approaches.map((a: any, i: number) => (
                <tr key={a.id}><td><span className="mr-1 inline-block h-2 w-2" style={{ background: COLORS[i] }} />{a.label}</td><td className="text-right">{pct(a.keepRate)} kept</td><td className="text-right text-slate-400">n={a.n}</td></tr>
              ))}
              <tr className="border-t"><td>Holdout (not contacted)</td><td className="text-right">{pct(pb.holdout.keepRate)} kept</td><td className="text-right text-slate-400">n={pb.holdout.n}</td></tr>
            </tbody>
          </table>
          <div className="mt-1 text-[11px] text-slate-600">Rishta now sends most {pb.label.toLowerCase()} cases to "{best.label}".</div>
          {pb.lift && <div className="mt-1 text-[11px] font-semibold text-navy">{pb.lift.proven ? "Proven:" : "Not proven yet:"} {Math.round(pb.lift.points * 100)} points above no contact, margin ±{Math.round(pb.lift.margin * 100)}</div>}
        </Panel>

        {v.report && (
          <Panel title="Did Rishta find the planted answers?" note="test bench">
            <div className="grid grid-cols-2 gap-2">
              <Stat label={`right reason, ${v.report.reasonCases} cases`} value={pct(v.report.reasonAccuracy)} />
              <Stat label="best approach found" value={`${v.report.winnersFound} of ${v.report.problems}`} />
              <Stat label="backfire segment found" value={v.report.backfireFound ? "Yes" : "No"} />
              <Stat label="risk score, top 10%" value={`${v.report.riskLift.toFixed(1)}×`} />
            </div>
          </Panel>
        )}

        <Panel title="On a real phone">
          <div className="flex justify-around">
            <Qr url={`${window.location.origin}/phone/${selected}`} label="Shop app" />
            <Qr url={`${window.location.origin}/sales`} label="Sales app" />
          </div>
        </Panel>

        <Panel title="Done today">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="resolved, no human" value={v.done.resolvedWithoutHuman} />
            <Stat label="tickets raised" value={v.done.ticketsRaised} />
            <Stat label="plans changed" value={v.done.plansChanged} />
            <Stat label="escalations" value={v.done.escalations} />
            <Stat label="visits saved" value={v.done.visitsSaved} />
            <Stat label="₹ per conversation" value={v.done.costPerConversationInr ?? "-"} />
          </div>
          <div className="mt-2 text-[11px] text-green-700">✓ numbers verified on {v.done.verified} of {v.done.conversations} conversations · {v.done.humanClosed} closed by salespeople</div>
          <div className="text-[10px] text-slate-400">Cost estimated at ₹{v.done.costPerMinuteInr}/minute, list prices.</div>
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Left alone on purpose">
          <div className="max-h-52 space-y-1 overflow-y-auto">
            {v.leftAlone.map((l: any) => (
              <div key={l.merchant_id} className="text-xs"><b>{l.name}</b>, {l.city} <span className="text-[10px] text-slate-400">{l.kind}</span>
                {l.reasons.map((r: string, i: number) => <div key={i} className="text-[11px] text-slate-600">{r}</div>)}
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Needs a human">
          <div className="max-h-52 space-y-2 overflow-y-auto">
            {v.needsHuman.map((h: any, i: number) => (
              <div key={i} className={`rounded p-2 text-[11px] ${h.live ? "bg-green-50" : "bg-slate-50"}`}><b className="text-xs">{h.name}</b> {h.live && <span className="text-green-700">live handoff</span>}<div>{h.reason}</div><div className="whitespace-pre-line text-slate-600">{h.summary}</div></div>
            ))}
          </div>
        </Panel>
        <Panel title="Salesperson visit list">
          <div className="max-h-52 space-y-2 overflow-y-auto">
            {v.visits.map((x: any) => (
              <div key={x.merchantId} className="text-[11px]"><b className="text-xs">{x.name}</b>, {x.city}<div className="text-slate-600">Why: {x.why}</div><div className="text-slate-600">Tried: {x.tried}</div></div>
            ))}
          </div>
        </Panel>
      </div>

      <footer className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
        {COMPLIANCE.map((c) => <span key={c}>✓ {c}</span>)}
      </footer>
    </div>
  );
}
