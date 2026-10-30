import { useCallback, useEffect, useState } from "react";
import { useEvents } from "../hooks/useEvents";

/* eslint-disable @typescript-eslint/no-explicit-any */
const RESULTS = [["stayed", "Stayed"], ["plan_changed", "Plan changed"], ["left", "Left"]] as const;

// The salesperson's list. Each result goes through the same /v1/outcomes as the AI's, so it teaches the playbook too.
function Job({ job, onDone }: { job: any; onDone: () => void }) {
  const [note, setNote] = useState("");
  const close = async (outcome: string) => {
    await fetch("/v1/outcomes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ briefId: job.briefId, outcome, reasons: note ? [{ code: job.problem, quote: note }] : [], actionsTaken: [], durationSec: 0, numbersVerified: false, summary: note || "Closed by salesperson", handledBy: "human" }),
    });
    onDone();
  };
  return (
    <article className="border-b border-line bg-white px-4 py-4">
      <h3 className="text-lg font-bold leading-snug">{job.name}{job.city && <span className="font-normal text-muted">, {job.city}</span>}</h3>
      <p className="mt-1">{job.why ?? job.reason}</p>
      {job.say && <p className="mt-2 text-sm"><span className="font-semibold">Say this: </span>{job.say}</p>}
      {(job.tried ?? job.summary) && <p className="mt-2 text-sm text-muted">{job.tried ?? job.summary}</p>}
      {job.closed ? <p className="mt-3 font-semibold text-kept">✓ Result sent to Rishta</p> : (
        <div className="mt-3 space-y-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did the shop say?" aria-label={`What ${job.name} said`} className="w-full rounded-lg border border-line px-3 py-2" />
          <div className="flex gap-2">{RESULTS.map(([id, label]) => <button key={id} onClick={() => void close(id)} className="flex-1 rounded-lg bg-navy py-2.5 text-sm font-semibold text-white">{label}</button>)}</div>
        </div>
      )}
    </article>
  );
}

export default function Sales() {
  const [v, setV] = useState<any>(null);
  const load = useCallback(() => void fetch("/api/console").then((r) => r.json()).then(setV), []);
  useEffect(load, [load]);
  useEvents((e) => { if (e.type === "changed") load(); });
  const callbacks = (v?.needsHuman ?? []).filter((h: any) => h.briefId);
  return (
    <div className="mx-auto min-h-dvh max-w-md bg-paper">
      <header className="bg-navy px-4 py-4 text-white">
        <div className="text-sm opacity-80">Paytm sales app</div>
        <h1 className="text-2xl font-bold">Your list for today</h1>
        {v && <p className="text-sm opacity-80">{callbacks.length} calls and {v.visits.length} visits. Rishta handled the rest.</p>}
      </header>
      <h2 className="px-4 pb-1 pt-4 font-semibold text-muted">Call back first</h2>
      {callbacks.map((j: any) => <Job key={j.briefId} job={j} onDone={load} />)}
      <h2 className="px-4 pb-1 pt-4 font-semibold text-muted">Visit</h2>
      {v?.visits.map((j: any) => <Job key={j.briefId} job={j} onDone={load} />)}
    </div>
  );
}
