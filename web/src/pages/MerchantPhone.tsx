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
  conversation: { id: string; transcript: Line[]; ended: boolean } | null;
  inbox: { text: string; created_at: string }[];
  tickets: { id: string; type: string; status: string; note: string; promise: string | null }[];
  savedYearInr: number;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

// /phone/M001 is the real-device view: full screen, one shop. It is a plain web page, the form a Paytm Mini App takes.
const fixedId = window.location.pathname.match(/^\/phone\/([^/]+)/)?.[1];

// A drawing of the real device: speaker grille, status light, Paytm button.
function Soundbox({ active }: { active: boolean }) {
  return (
    <div className={`relative h-[74px] w-[62px] shrink-0 rounded-[14px] ${active ? "ring-pulse" : ""}`} aria-hidden>
      <div className="flex h-full w-full flex-col items-center rounded-[14px] bg-gradient-to-b from-[#123a78] to-navy px-2 pb-1 pt-2 shadow-md">
        <div className="grid w-full grid-cols-7 gap-[3px]">
          {Array.from({ length: 28 }, (_, i) => <span key={i} className="h-[3px] w-[3px] rounded-full bg-white/45" />)}
        </div>
        <span className={`mt-1.5 h-1.5 w-1.5 rounded-full ${active ? "bg-paytm" : "bg-kept"}`} />
        <span className="mt-auto text-[10px] font-extrabold leading-none text-white">pay<span className="text-paytm">tm</span></span>
      </div>
    </div>
  );
}

const TILES = [["QR", "M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h2v2h-2v-2Zm4 0h2v6h-6v-2h4v-4Z"], ["Payments", "M3 6h18v12H3V6Zm0 4h18"], ["Settlement", "M4 19V9l8-5 8 5v10H4Zm5 0v-6h6v6"], ["Soundbox", "M7 3h10v18H7V3Zm5 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"]] as const;

export default function MerchantPhone({ shopId, tips = [], onTip, free }: { shopId?: string; tips?: string[]; onTip?: boolean; free?: boolean }) {
  const embedded = !!shopId;
  const [id, setId] = useState(fixedId ?? shopId ?? "M001");
  const [m, setM] = useState<Merchant | null>(null);
  const [missing, setMissing] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [nudge, setNudge] = useState("");
  const [typed, setTyped] = useState("");
  const [showText, setShowText] = useState(!!free);
  const [cleared, setCleared] = useState<string | null>(null);
  const conversation = m?.conversation?.id === cleared ? null : m?.conversation;
  const [armed, setArmed] = useState(embedded);
  const end = useRef<HTMLDivElement>(null);

  const clearedRef = useRef<string | null>(null);
  const load = useCallback(() => {
    void fetch(`/api/merchant/${id}`).then(async (r) => {
      if (!r.ok) return setMissing(true);
      const next = (await r.json()) as Merchant;
      setM(next);
      // After a reload the conversation comes back from the server.
      setLines((now) => (now.length === 0 && next.conversation && next.conversation.id !== clearedRef.current ? next.conversation.transcript : now));
    });
  }, [id]);
  useEffect(load, [load]);

  const onLine = useCallback((l: Line) => setLines((x) => [...x, l]), []);
  const ptt = usePushToTalk(id, onLine, load);
  const { stop: stopAudio, sendText } = ptt;
  useEffect(() => stopAudio, [stopAudio]);
  const startNew = () => {
    clearedRef.current = m?.conversation?.id ?? null;
    setCleared(clearedRef.current);
    setLines([]);
    setNudge("");
    stopAudio();
  };
  useEffect(() => {
    if (!free) return;
    const say = (e: Event) => sendText((e as CustomEvent<string>).detail);
    addEventListener("rishta-say", say);
    return () => removeEventListener("rishta-say", say);
  }, [free, sendText]);

  useEvents((e) => {
    if (e.type === "reset") {
      setLines([]);
      setNudge("");
      ptt.stop();
    }
    if (e.type === "changed") load();
    if (e.type === "nudge" && e.merchantId && e.merchantId === (fixedId ?? shopId ?? e.merchantId)) {
      setId(e.merchantId);
      setLines([]);
      setNudge(e.card ?? "");
      e.lines?.forEach((l) => ptt.push(l.audio));
    }
  });

  useEffect(() => {
    if (ptt.error.startsWith("Microphone")) setShowText(true);
  }, [ptt.error]);
  useEffect(() => {
    const box = end.current;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  }, [lines, ptt.thinking, m?.inbox.length]);

  if (missing) {
    return <div className="flex h-full items-center justify-center p-8 text-center"><div><div className="text-xl font-bold text-navy">यह दुकान नहीं मिली</div><div className="text-muted">Shop {id} does not exist.</div></div></div>;
  }

  // Device faults come through the app because the Soundbox itself may be failing.
  const inApp = m?.channel === "app";
  const ended = !!conversation?.ended;
  const busy = ptt.thinking || ended;
  const status = ended && !ptt.speaking ? "बातचीत पूरी हुई" : ptt.recording ? "सुन रही हूँ…" : ptt.thinking ? "देख रही हूँ…" : ptt.speaking ? "बोल रही हूँ…" : nudge || lines.length ? "बटन दबाकर रखें और बोलें" : "सब ठीक चल रहा है";
  const talking = nudge !== "" || lines.length > 0;
  const heard = lines.filter((l) => l.role === "merchant").map((l) => l.text);
  // Suggestions stop as soon as the merchant goes off script.
  const tip = talking && !ended && heard.every((t, i) => t === tips[i]) ? tips[heard.length] : undefined;

  return (
    <div className="flex h-full items-center justify-center">
      <div className={fixedId ? "relative flex h-dvh w-full flex-col overflow-hidden bg-paper" : "relative flex h-[min(760px,calc(100dvh-178px))] w-[370px] max-w-full flex-col overflow-hidden rounded-[36px] border-[7px] border-ink bg-paper shadow-xl"}>
        {!armed && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-white p-8 text-center">
            <div className="text-sm text-muted">Paytm for Business</div>
            <div className="text-2xl font-bold text-navy">{m?.name ?? " "}</div>
            <button onClick={() => setArmed(true)} className="rounded-full bg-navy px-6 py-3 font-semibold text-white">ऐप खोलें</button>
            <div className="text-xs text-muted">इससे आवाज़ और माइक चालू होंगे।</div>
          </div>
        )}

        <header className="bg-white px-4 pb-2 pt-3">
          <div className="flex items-center justify-between">
            <div className="text-[15px] font-extrabold text-[#012a72]">pay<span className="text-paytm">tm</span> <span className="font-medium text-muted">for Business</span></div>
            <div className="grid h-8 w-8 place-items-center rounded-full bg-paytm/15 text-sm font-bold text-paytm-deep">{m?.name[0]}</div>
          </div>
          <div className="truncate text-sm text-muted">{m?.name}</div>
          <div className="mt-2 rounded-2xl bg-gradient-to-br from-[#012a72] to-[#0369a1] px-4 py-3 text-white shadow-sm">
            <div className="text-xs opacity-80">आज का कलेक्शन</div>
            <div className="num text-[1.9rem] font-bold leading-tight">{m ? inr(m.today) : " "}</div>
            <div className="mt-1 flex items-center justify-between border-t border-white/15 pt-1.5 text-xs">
              <span className="opacity-80">पिछला settlement</span>
              <span className="num font-semibold">{m ? inr(m.latestSettlementNetInr) : ""}{m && m.fee.feeInr > 0 && <span className="ml-1 font-normal opacity-75">Fee + GST {inr(m.fee.feePlusGstInr)}</span>}</span>
            </div>
          </div>
        </header>

        <div ref={end} className="flex-1 overflow-y-auto">
          {!talking && (
            <div className="grid grid-cols-4 gap-1 bg-white px-3 pb-3 pt-1 text-center text-[11px] text-muted" aria-hidden>
              {TILES.map(([label, path]) => (
                <div key={label}>
                  <svg viewBox="0 0 24 24" className="mx-auto h-6 w-6 text-paytm-deep" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d={path} /></svg>
                  {label}
                </div>
              ))}
            </div>
          )}

          {!talking && (free || !(m?.tickets.length || m?.inbox.length)) && (
            <div className="px-8 py-8 text-center text-muted">
              <div className="text-lg font-semibold text-navy">कोई सवाल है?</div>
              <p className="mt-1">नीचे का बटन दबाकर रखें और बोलें। जैसे, "मेरा settlement कम क्यों आया?"</p>
            </div>
          )}

          {talking && (
            <div className="space-y-2 px-4 py-3" aria-live="polite">
              <div className="text-center text-xs text-muted">Paytm Assistant · AI · OTP या PIN कभी नहीं माँगता</div>
              {nudge && lines.length === 0 && <div className="rise max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-[15px] shadow-sm">{nudge}</div>}
              {lines.map((l, i) => (
                <div key={i} className={`rise max-w-[85%] rounded-2xl px-3 py-2 text-[15px] ${l.role === "merchant" ? "ml-auto rounded-tr-sm bg-navy text-white" : "rounded-tl-sm bg-white shadow-sm"}`}>{l.text}</div>
              ))}
              {ptt.thinking && <div className="w-fit rounded-2xl bg-white px-3 py-2 text-muted shadow-sm">…</div>}
            </div>
          )}

          {!free && (m?.tickets.length || m?.inbox.length) ? (
            <div className="space-y-2 px-4 py-3">
              <div className="text-xs font-semibold text-muted">आपके लिए</div>
              {m.savedYearInr > 0 && <div className="rise rounded-xl border-l-4 border-kept bg-white px-3 py-2 text-sm"><b>{inr(m.savedYearInr)} की बचत</b><div className="text-muted">नए plan से हर साल</div></div>}
              {m.tickets.map((t) => <div key={t.id} className="rise rounded-xl border-l-4 border-paytm bg-white px-3 py-2 text-sm"><b>Ticket {t.id}</b><div className="text-muted">{t.promise === "kept" ? "आपने बताया कि ठीक हो गया ✓" : t.promise === "failed" ? "एक व्यक्ति आपको call करेगा" : "3 दिन में हम खुद पूछेंगे कि ठीक हुआ या नहीं"}</div></div>)}
              {m.inbox.map((x, i) => <div key={i} className="rise rounded-xl bg-white px-3 py-2 text-sm">{x.text}</div>)}
            </div>
          ) : null}
        </div>

        <div className="border-t border-line bg-white px-4 pb-4 pt-3">
          {ptt.error && <div className="mb-2 text-sm text-callback">{ptt.error}</div>}
          {onTip && tip && !busy && !ptt.recording && <button onClick={() => { ptt.sendText(tip); }} className="rise mb-2 w-full rounded-xl border-2 border-paytm px-3 py-2 text-left text-sm"><span className="block text-xs text-muted">Tap to say this, or hold the mic and speak</span>{tip}</button>}
          {free && ended && !ptt.speaking && <button onClick={startNew} className="mb-2 w-full rounded-xl bg-navy px-3 py-2.5 font-semibold text-white">नई बात शुरू करें</button>}
          {showText && !ended ? (
            <form className="mb-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (typed.trim() && !busy) { ptt.sendText(typed); setTyped(""); } }}>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="यहाँ लिखें" aria-label="Type your message" className="min-w-0 flex-1 rounded-full border border-line px-4 py-2" />
              <button disabled={busy} className="rounded-full bg-navy px-4 font-semibold text-white disabled:opacity-50">Send</button>
            </form>
          ) : null}
          <div className="flex items-center gap-3">
            <Soundbox active={ptt.speaking} />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted">{inApp ? "Paytm Assistant (AI)" : "Paytm Soundbox (AI)"}</div>
              <div className="truncate font-medium">{status}</div>
              {!ended && <button className="text-xs text-muted underline" onClick={() => setShowText((v) => !v)}>{showText ? "कीबोर्ड बंद करें" : "लिखकर बताएँ"}</button>}
              {!ended && heard.length > 0 && <button className="ml-3 text-xs text-muted underline" disabled={busy} onClick={() => void fetch(`/api/end/${id}`, { method: "POST" }).then(load)}>बात खत्म करें</button>}
            </div>
            <button
              onPointerDown={() => { if (!busy) void ptt.start(); }}
              onPointerUp={ptt.release}
              onPointerLeave={ptt.release}
              onKeyDown={(e) => { if (e.key === " " && !e.repeat && !busy) { e.preventDefault(); void ptt.start(); } }}
              onKeyUp={(e) => { if (e.key === " ") ptt.release(); }}
              disabled={busy}
              aria-label="Hold to talk"
              className={`h-20 w-20 shrink-0 touch-none select-none rounded-full text-sm font-bold transition-transform ${ptt.recording ? "scale-110 animate-pulse bg-callback text-white" : busy ? "bg-idle text-muted" : "bg-paytm text-navy"}`}
            >
              <svg viewBox="0 0 24 24" className="mx-auto h-7 w-7" fill="currentColor" aria-hidden="true"><path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-6a3.5 3.5 0 0 0-7 0v6A3.5 3.5 0 0 0 12 15Zm-1 3.9V21h2v-2.1a7 7 0 0 0 6-6.9h-2a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9Z" /></svg>
              <span className="block text-[11px] leading-tight">{ptt.recording ? "बोलिए" : "दबाकर बोलें"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
