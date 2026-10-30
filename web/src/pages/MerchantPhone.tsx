import { useCallback, useEffect, useRef, useState } from "react";
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

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

// /phone/M001 is the real-device view: full screen, one shop. It is a plain web page, the form a Paytm Mini App takes.
const fixedId = window.location.pathname.match(/^\/phone\/(M\d+)/)?.[1];

function Soundbox({ active }: { active: boolean }) {
  return (
    <div className={`relative h-16 w-16 shrink-0 rounded-full ${active ? "ring-pulse" : ""}`} aria-hidden>
      <div className="grid h-full w-full grid-cols-5 place-items-center rounded-full bg-navy p-3">
        {Array.from({ length: 25 }, (_, i) => <span key={i} className="h-1 w-1 rounded-full bg-white/50" />)}
      </div>
    </div>
  );
}

export default function MerchantPhone() {
  const [id, setId] = useState(fixedId ?? "M001");
  const [m, setM] = useState<Merchant | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [nudge, setNudge] = useState("");
  const [typed, setTyped] = useState("");
  const [showText, setShowText] = useState(false);
  const [armed, setArmed] = useState(false);
  const end = useRef<HTMLDivElement>(null);

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

  // On the laptop, the phone follows the shop picked in the console.
  useEffect(() => {
    if (fixedId) return;
    const channel = new BroadcastChannel("rishta");
    channel.onmessage = (e) => {
      setId(e.data as string);
      setLines([]);
      setNudge("");
    };
    return () => channel.close();
  }, []);

  useEffect(() => {
    if (ptt.error) setShowText(true);
  }, [ptt.error]);
  useEffect(() => {
    const box = end.current;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  }, [lines, ptt.thinking]);

  // Device faults come through the app because the Soundbox itself may be failing.
  const inApp = m?.channel === "app";
  const status = ptt.recording ? "सुन रही हूँ…" : ptt.thinking ? "देख रही हूँ…" : ptt.speaking ? "बोल रही हूँ…" : nudge || lines.length ? "बटन दबाकर रखें और बोलें" : "सब ठीक चल रहा है";
  const talking = nudge !== "" || lines.length > 0;

  return (
    <div className={`flex h-full items-center justify-center ${fixedId ? "" : "bg-[#e6eef6] p-3"}`}>
      <div className={fixedId ? "relative flex h-dvh w-full flex-col overflow-hidden bg-paper" : "relative flex h-[min(820px,calc(100dvh-24px))] w-[370px] flex-col overflow-hidden rounded-[36px] border-[7px] border-ink bg-paper shadow-xl"}>
        {!armed && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-white p-8 text-center">
            <div className="text-sm text-muted">Paytm for Business</div>
            <div className="text-2xl font-bold text-navy">{m?.name ?? " "}</div>
            <button onClick={() => setArmed(true)} className="rounded-full bg-navy px-6 py-3 font-semibold text-white">Open the app</button>
            <div className="text-xs text-muted">This turns on sound and the mic.</div>
          </div>
        )}

        <header className="bg-paytm px-5 pb-5 pt-5 text-navy">
          <div className="text-sm font-medium">{m?.name}</div>
          <div className="mt-2 text-sm">Today's collection</div>
          <div className="text-4xl font-extrabold leading-tight">{m ? inr(m.today) : " "}</div>
        </header>

        <div ref={end} className="flex-1 overflow-y-auto">
          <div className="flex items-baseline justify-between border-b border-line bg-white px-5 py-3">
            <div>
              <div className="text-sm text-muted">Latest settlement</div>
              {m && m.fee.feeInr > 0 && <div className="text-xs text-muted">Fee {inr(m.fee.feeInr)} + GST {inr(m.fee.gstInr)}</div>}
            </div>
            <div className="text-lg font-bold">{m ? inr(m.latestSettlementNetInr) : ""}</div>
          </div>

          {talking && (
            <div className="space-y-2 px-4 py-3" aria-live="polite">
              {nudge && lines.length === 0 && <div className="rise max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-[15px] shadow-sm">{nudge}</div>}
              {lines.map((l, i) => (
                <div key={i} className={`rise max-w-[85%] rounded-2xl px-3 py-2 text-[15px] ${l.role === "merchant" ? "ml-auto rounded-tr-sm bg-navy text-white" : "rounded-tl-sm bg-white shadow-sm"}`}>{l.text}</div>
              ))}
              {ptt.thinking && <div className="w-fit rounded-2xl bg-white px-3 py-2 text-muted shadow-sm">…</div>}
            </div>
          )}

          {(m?.tickets.length || m?.inbox.length) ? (
            <div className="space-y-2 px-4 py-3">
              {m.tickets.map((t) => <div key={t.id} className="rise rounded-xl border-l-4 border-kept bg-white px-3 py-2 text-sm"><b>Ticket {t.id} raised</b><div className="line-clamp-2 text-muted">{t.note}</div></div>)}
              {m.inbox.map((x, i) => <div key={i} className="rise rounded-xl bg-white px-3 py-2 text-sm">{x.text}</div>)}
            </div>
          ) : null}
        </div>

        <div className="border-t border-line bg-white px-4 pb-4 pt-3">
          {ptt.error && <div className="mb-2 text-sm text-callback">{ptt.error}</div>}
          {showText ? (
            <form className="mb-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { ptt.sendText(typed); setTyped(""); } }}>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="यहाँ लिखें" aria-label="Type your message" className="min-w-0 flex-1 rounded-full border border-line px-4 py-2" />
              <button className="rounded-full bg-navy px-4 font-semibold text-white">Send</button>
            </form>
          ) : null}
          <div className="flex items-center gap-3">
            <Soundbox active={ptt.speaking} />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted">{inApp ? "Paytm Assistant (AI)" : "Paytm Soundbox (AI)"}</div>
              <div className="truncate font-medium">{status}</div>
              <button className="text-xs text-muted underline" onClick={() => setShowText((v) => !v)}>{showText ? "Hide keyboard" : "Type instead"}</button>
            </div>
            <button
              onPointerDown={() => void ptt.start()}
              onPointerUp={ptt.release}
              onPointerLeave={ptt.release}
              onKeyDown={(e) => { if (e.key === " " && !e.repeat) { e.preventDefault(); void ptt.start(); } }}
              onKeyUp={(e) => { if (e.key === " ") ptt.release(); }}
              aria-label="Hold to talk"
              className={`h-[72px] w-[72px] shrink-0 touch-none select-none rounded-full text-sm font-bold transition-transform ${ptt.recording ? "scale-110 bg-callback text-white" : "bg-paytm text-navy"}`}
            >
              {ptt.recording ? "बोलिए" : "Paytm"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
