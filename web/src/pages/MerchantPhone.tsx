import { useCallback, useEffect, useState } from "react";
import { useEvents } from "../hooks/useEvents";
import { usePushToTalk, type Line } from "../hooks/usePushToTalk";

interface Merchant {
  id: string;
  name: string;
  city: string;
  today: number;
  collections30DaysInr: number;
  latestSettlementGrossInr: number;
  latestSettlementNetInr: number;
  fee: { feeInr: number; gstInr: number; feePlusGstInr: number };
  plan: { rent: number };
  channel: string | null;
  inbox: { text: string; created_at: string }[];
  tickets: { id: string; type: string; status: string; note: string }[];
}

const DEMO = [["M001", "Ramesh"], ["M002", "Sharma"], ["M004", "Gupta"], ["M003", "Raju"], ["M005", "Mobile Hub"]] as const;
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

// /phone/M001 is the real-device view: full screen, one shop. It is a plain web page, the form a Paytm Mini App takes.
const fixedId = window.location.pathname.match(/^\/phone\/(M\d+)/)?.[1];

export default function MerchantPhone() {
  const [id, setId] = useState(fixedId ?? "M001");
  const [m, setM] = useState<Merchant | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [nudge, setNudge] = useState("");
  const [typed, setTyped] = useState("");
  const [showText, setShowText] = useState(false);
  const [armed, setArmed] = useState(false);

  const load = useCallback(() => {
    void fetch(`/api/merchant/${id}`).then((r) => r.json()).then(setM);
  }, [id]);
  useEffect(load, [load]);

  const onLine = useCallback((l: Line) => setLines((x) => [...x, l]), []);
  const ptt = usePushToTalk(id, onLine, load);

  useEvents((e) => {
    if (e.type === "reset") {
      setLines([]);
      setNudge("");
      ptt.stop();
    }
    if (e.type === "changed") load();
    if (e.type === "nudge" && e.merchantId && (!fixedId || e.merchantId === fixedId)) {
      setId(e.merchantId);
      setLines([]);
      setNudge(e.card ?? "");
      e.lines?.forEach((l) => ptt.push(l.audio));
    }
  });

  // Device faults come through the app because the Soundbox itself may be failing.
  const inApp = m?.channel === "app";
  useEffect(() => {
    if (ptt.error) setShowText(true);
  }, [ptt.error]);

  return (
    <div className={`flex min-h-screen flex-col items-center ${fixedId ? "" : "gap-2 p-3"}`}>
      {!fixedId && <div className="flex gap-1 text-xs">
        {DEMO.map(([mid, label]) => (
          <button key={mid} onClick={() => { setId(mid); setLines([]); setNudge(""); }} className={`rounded px-2 py-1 ${id === mid ? "bg-navy text-white" : "bg-white"}`}>{label}</button>
        ))}
      </div>}

      <div className={fixedId ? "relative flex h-dvh w-full flex-col overflow-hidden bg-[#f4f7fb]" : "relative flex h-[820px] w-[390px] flex-col overflow-hidden rounded-[32px] border-8 border-slate-900 bg-[#f4f7fb] shadow-xl"}>
        {!armed && (
          <button onClick={() => setArmed(true)} className="absolute inset-0 z-10 bg-navy/90 text-lg font-semibold text-white">Tap to start demo<br /><span className="text-sm font-normal">enables sound</span></button>
        )}
        <header className="bg-paytm px-4 pb-3 pt-4 text-white">
          <div className="text-xs opacity-90">Paytm for Business</div>
          <div className="font-semibold">{m?.name}</div>
        </header>

        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white p-3">
              <div className="text-[11px] text-slate-500">Today's collection</div>
              <div className="text-lg font-bold text-navy">{m ? inr(m.today) : "-"}</div>
            </div>
            <div className="rounded-xl bg-white p-3">
              <div className="text-[11px] text-slate-500">Latest settlement</div>
              <div className="text-lg font-bold text-navy">{m ? inr(m.latestSettlementNetInr) : "-"}</div>
              {m && m.fee.feeInr > 0 && <div className="text-[10px] text-slate-500">Fee {inr(m.fee.feeInr)} + GST {inr(m.fee.gstInr)}</div>}
            </div>
          </div>

          <div className="rounded-xl bg-navy p-4 text-center text-white">
            <div className="mb-1 flex items-center justify-center gap-2 text-xs">
              <span className={`h-2 w-2 rounded-full ${ptt.speaking ? "animate-pulse bg-green-400" : "bg-slate-400"}`} />
              {inApp ? "Paytm Assistant" : "Paytm Soundbox"}
            </div>
            <div className="mb-3 min-h-8 text-xs opacity-90">{nudge || (ptt.speaking ? "बोल रहा है…" : "")}</div>
            <button
              onPointerDown={() => void ptt.start()}
              onPointerUp={ptt.release}
              onPointerLeave={ptt.release}
              className={`h-24 w-24 touch-none select-none rounded-full text-sm font-bold shadow-lg ${ptt.recording ? "scale-110 bg-red-500" : "bg-paytm"}`}
            >
              {ptt.recording ? "बोलिए…" : ptt.thinking ? "…" : inApp ? "बोलें" : "Paytm"}
            </button>
            <div className="mt-2 text-[11px] opacity-80">दबाकर रखें और बोलें</div>
          </div>

          {ptt.error && <div className="rounded bg-red-100 p-2 text-xs text-red-700">{ptt.error}</div>}

          <div className="rounded-xl bg-white p-3">
            <div className="mb-1 flex justify-between text-xs font-semibold text-navy">
              <span>Paytm Assistant <span className="font-normal text-slate-500">(AI)</span></span>
              <button className="font-normal text-slate-500 underline" onClick={() => setShowText((v) => !v)}>{showText ? "voice" : "type"}</button>
            </div>
            <div className="max-h-44 space-y-1 overflow-y-auto">
              {lines.length === 0 && <div className="text-xs text-slate-400">Paytm कभी OTP या PIN नहीं माँगता।</div>}
              {lines.map((l, i) => (
                <div key={i} className={`rounded-lg px-2 py-1 text-xs ${l.role === "merchant" ? "ml-6 bg-paytm/15" : "mr-6 bg-slate-100"}`}>{l.text}</div>
              ))}
            </div>
            {showText && (
              <form className="mt-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { ptt.sendText(typed); setTyped(""); } }}>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="यहाँ लिखें" className="flex-1 rounded border px-2 py-1 text-xs" />
                <button className="rounded bg-navy px-2 text-xs text-white">Send</button>
              </form>
            )}
          </div>

          <div className="rounded-xl bg-white p-3">
            <div className="mb-1 text-xs font-semibold text-navy">Inbox</div>
            {m?.inbox.length === 0 && m.tickets.length === 0 && <div className="text-xs text-slate-400">कोई नया संदेश नहीं</div>}
            {m?.tickets.map((t) => <div key={t.id} className="mb-1 rounded bg-green-50 p-2 text-xs">Ticket {t.id} raised: {t.note}</div>)}
            {m?.inbox.map((x, i) => <div key={i} className="mb-1 rounded bg-slate-50 p-2 text-xs">{x.text}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}
