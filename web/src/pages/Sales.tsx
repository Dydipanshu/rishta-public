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
    <div className="space-y-1 rounded-xl bg-white p-3 text-sm">
      <div className="font-semibold text-navy">{job.name}{job.city && `, ${job.city}`}</div>
      <div className="text-slate-600">{job.why ?? job.reason}</div>
      {job.say && <div className="text-xs"><b>Say:</b> {job.say}</div>}
      {(job.tried ?? job.summary) && <div className="text-xs text-slate-500"><b>So far:</b> {job.tried ?? job.summary}</div>}
      {job.closed ? <div className="text-xs font-semibold text-green-700">✓ Result sent to Rishta</div> : (
        <>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did the shop say?" className="w-full rounded border px-2 py-1 text-xs" />
          <div className="flex gap-1">{RESULTS.map(([id, label]) => <button key={id} onClick={() => void close(id)} className="flex-1 rounded bg-navy py-1.5 text-xs text-white">{label}</button>)}</div>
        </>
      )}
    </div>
  );
}

export default function Sales() {
  const [v, setV] = useState<any>(null);
  const load = useCallback(() => void fetch("/api/console").then((r) => r.json()).then(setV), []);
  useEffect(load, [load]);
  useEvents((e) => { if (e.type === "changed") load(); });
  const callbacks = (v?.needsHuman ?? []).filter((h: any) => h.briefId);
  return (
    <div className="mx-auto min-h-dvh max-w-md bg-[#f4f7fb]">
      <header className="bg-navy px-4 py-3 text-white"><div className="text-xs opacity-80">Paytm sales app</div><div className="font-semibold">Today's list from Rishta</div></header>
      <div className="space-y-2 p-3">
        <h2 className="text-xs font-semibold text-slate-500">CALL BACK ({callbacks.length})</h2>
        {callbacks.map((j: any) => <Job key={j.briefId} job={j} onDone={load} />)}
        <h2 className="text-xs font-semibold text-slate-500">VISIT ({v?.visits.length ?? 0})</h2>
        {v?.visits.map((j: any) => <Job key={j.briefId} job={j} onDone={load} />)}
      </div>
    </div>
  );
}
