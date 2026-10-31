import { useCallback, useEffect, useState } from "react";
import { Empty, RoleTabs, Skeleton } from "../ui";
import { useEvents } from "../hooks/useEvents";

/* eslint-disable @typescript-eslint/no-explicit-any */
const RESULTS = [["stayed", "Stayed"], ["plan_changed", "Plan changed"], ["left", "Left"]] as const;

const KIND = { call: ["Call", "bg-callback/10 text-callback"], lead: ["Loan lead", "bg-kept/10 text-kept"], visit: ["Visit", "bg-paytm/15 text-paytm-deep"] } as const;
type Kind = keyof typeof KIND;

// The salesperson's list. Each result goes through the same /v1/outcomes as the AI's, so it teaches the playbook too.
function Job({ job, kind, n, open, toggle, onDone }: { job: any; kind: Kind; n: number; open: boolean; toggle: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const close = async (outcome: string) => {
    await fetch("/v1/outcomes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ briefId: job.briefId, outcome, reasons: note ? [{ code: job.problem, quote: note }] : [], actionsTaken: [], durationSec: 0, numbersVerified: false, summary: note || "Closed by salesperson", handledBy: "human" }),
    });
    onDone();
  };
  const [label, tone] = KIND[kind];
  return (
    <li className={`card mb-2 overflow-hidden ${job.closed ? "opacity-60" : ""}`}>
      <button onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-3 text-left">
        <span className="num grid h-8 w-8 shrink-0 place-items-center rounded-full bg-paper font-bold text-ink">{job.closed ? "✓" : n}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold text-ink">{job.name}</span>
          <span className="line-clamp-2 block text-sm text-muted">{job.city ? `${job.city} · ` : ""}{job.why ?? job.reason}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{label}</span>
      </button>
      {open && (
        <div className="border-t border-line px-4 py-3">
          {job.say && <p className="text-sm"><span className="font-semibold">Say this: </span>{job.say}</p>}
          {job.summary && <p className="mt-2 text-sm text-muted">{job.summary}</p>}
          <div className="mt-2 text-sm"><span className="font-semibold">Already tried: </span>{job.history?.length ? <ul className="list-disc pl-4 text-muted">{job.history.map((h: any, i: number) => <li key={i}>{h.when}: {h.text}</li>)}</ul> : <span className="text-muted">Nothing yet</span>}</div>
          {kind === "lead" && !job.closed && (
            <div className="mt-3 flex gap-2">{([["sent_to_lender", "Sent to lender"], ["not_interested", "Not interested"]] as const).map(([status, text]) => <button key={status} onClick={() => void fetch(`/api/leads/${job.merchantId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }).then(onDone)} className="flex-1 rounded-lg bg-paytm-deep py-2.5 text-sm font-semibold text-white">{text}</button>)}</div>
          )}
          {job.closed ? <p className="mt-3 font-semibold text-kept">✓ Result sent to Rishta</p> : job.briefId && (
            <div className="mt-3 space-y-2">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did the shop say?" aria-label={`What ${job.name} said`} className="w-full rounded-lg border border-line px-3 py-2" />
              <div className="flex gap-2">{RESULTS.map(([id, text]) => <button key={id} onClick={() => void close(id)} className="flex-1 rounded-lg bg-paytm-deep py-2.5 text-sm font-semibold text-white">{text}</button>)}</div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function Sales() {
  const [v, setV] = useState<any>(null);
  // The top job starts open, so the brief is the first thing seen.
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const load = useCallback(() => void fetch("/api/console").then((r) => r.json()).then(setV), []);
  useEffect(load, [load]);
  useEvents((e) => { if (e.type === "changed") load(); });
  const jobs: { job: any; kind: Kind }[] = [
    ...(v?.needsHuman ?? []).filter((h: any) => h.briefId).map((job: any) => ({ job, kind: "call" as const })),
    ...(v?.leads ?? []).map((job: any) => ({ job, kind: "lead" as const })),
    ...(v?.visits ?? []).map((job: any) => ({ job, kind: "visit" as const })),
  ];
  const todo = jobs.filter((j) => !j.job.closed);
  const list = [...todo, ...jobs.filter((j) => j.job.closed)];
  const keyOf = ({ job, kind }: (typeof jobs)[number]) => `${kind}${job.merchantId ?? job.briefId}`;
  const open = chosen === undefined ? (list[0] ? keyOf(list[0]) : null) : chosen;
  const count = (k: Kind) => todo.filter((j) => j.kind === k).length;
  return (
    <div className="h-dvh overflow-y-auto bg-paper">
      <div className="bg-white px-2 py-1.5"><div className="mx-auto flex max-w-2xl items-center gap-2"><a href="/" aria-label="Home" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-paytm to-paytm-deep font-extrabold text-white">र</a><div className="min-w-0 flex-1"><RoleTabs on="sales" /></div></div></div>
      <header className="bg-gradient-to-br from-[#012a72] to-[#0369a1] text-white">
        <div className="mx-auto max-w-2xl px-4 py-5">
          <div className="text-sm opacity-80">Paytm sales app</div>
          <h1 className="min-h-9 text-[1.7rem] font-extrabold leading-tight">{v ? `${todo.length} shops to talk to today` : " "}</h1>
          {v && <p className="mt-0.5 text-white/80">Most urgent first. Rishta is handling the other {v.plan.handledByRishta} itself, and wrote a brief for each of these.</p>}
          {v && <div className="mt-3 grid grid-cols-3 gap-2 text-center">{([["call", "Calls"], ["lead", "Loan leads"], ["visit", "Visits"]] as const).map(([k, l]) => <div key={k} className="rounded-xl bg-white/12 py-1.5"><div className="num text-xl font-bold leading-tight">{count(k)}</div><div className="text-xs text-white/75">{l}</div></div>)}</div>}
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-3 pb-6 pt-3">
        {!v && <div className="space-y-2"><Skeleton h={72} /><Skeleton h={72} /><Skeleton h={72} /></div>}
        {v && list.length === 0 && <div className="card"><Empty title="Nothing for a person today">Rishta is handling every shop it reached.</Empty></div>}
        <ol>
          {list.map((j, i) => {
            const key = keyOf(j);
            return <Job key={key} job={j.job} kind={j.kind} n={i + 1} open={open === key} toggle={() => setChosen(open === key ? null : key)} onDone={load} />;
          })}
        </ol>
        <p className="mt-3 text-center text-xs text-muted">Simulated shops. Each result you record teaches Rishta, just like its own conversations.</p>
      </div>
    </div>
  );
}
