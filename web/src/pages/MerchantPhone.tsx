import qrcode from "qrcode-generator";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEvents } from "../hooks/useEvents";
import { useAppHeight } from "../hooks/useAppHeight";
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
  recent: { label: string; value: number; count: number }[];
  device: { offlineHours7Days: number; batteryAlerts7Days: number; failedPaymentsPct7Days: number };
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

// /phone/M001 is the real-device view: full screen, one shop. It is a plain web page, the form a Paytm Mini App takes.
const fixedId = window.location.pathname.match(/^\/phone\/([^/]+)/)?.[1];

const Mic = ({ className }: { className: string }) => <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true"><path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-6a3.5 3.5 0 0 0-7 0v6A3.5 3.5 0 0 0 12 15Zm-1 3.9V21h2v-2.1a7 7 0 0 0 6-6.9h-2a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9Z" /></svg>;

const qrSvg = (text: string) => {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 0 });
};

type View = "home" | "qr" | "payments" | "settlement" | "soundbox" | "chat";
const TITLES = { qr: "मेरा QR", payments: "Payments", settlement: "Settlement", soundbox: "मेरा Soundbox" };
const TILES = [["qr", "QR", "M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h2v2h-2v-2Zm4 0h2v6h-6v-2h4v-4Z"], ["payments", "Payments", "M3 6h18v12H3V6Zm0 4h18"], ["settlement", "Settlement", "M4 19V9l8-5 8 5v10H4Zm5 0v-6h6v6"], ["soundbox", "Soundbox", "M7 3h10v18H7V3Zm5 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"]] as const;

export default function MerchantPhone({ shopId, tips = [], onTip, free, bare, suggest = [] }: { shopId?: string; tips?: string[]; onTip?: boolean; free?: boolean; bare?: boolean; suggest?: string[] }) {
  const embedded = !!shopId;
  const [id, setId] = useState(fixedId ?? shopId ?? "M001");
  const [m, setM] = useState<Merchant | null>(null);
  const [missing, setMissing] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [nudge, setNudge] = useState("");
  const [typed, setTyped] = useState("");
  const [view, setView] = useState<View>(bare ? "chat" : "home");
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

  useAppHeight(!!bare || !!fixedId, () => end.current?.scrollTo({ top: end.current.scrollHeight }));

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
    setView("home");
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

  // Before paint, so a reload never flashes Home on its way back to the conversation.
  useLayoutEffect(() => {
    if (nudge || lines.length > 0) setView("chat");
  }, [nudge, lines.length]);
  useEffect(() => {
    const box = end.current;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  }, [lines, ptt.thinking, m?.inbox.length]);

  if (missing) {
    return <div className="flex h-full items-center justify-center p-8 text-center"><div><div className="text-xl font-bold text-navy">यह दुकान नहीं मिली</div><div className="text-muted">This shop has expired or doesn't exist.</div><a href="/" className="mt-3 inline-block font-semibold text-paytm-deep">Pick another shop</a></div></div>;
  }

  const ended = !!conversation?.ended;
  const busy = ptt.thinking || ended;
  const status = ended && !ptt.speaking ? "बातचीत पूरी हुई" : ptt.recording ? "सुन रही हूँ…" : ptt.thinking ? "देख रही हूँ…" : ptt.speaking ? "बोल रही हूँ…" : nudge || lines.length ? "Mic दबाकर बोलें" : "सब ठीक चल रहा है";
  const talking = nudge !== "" || lines.length > 0;
  const heard = lines.filter((l) => l.role === "merchant").map((l) => l.text);
  // Suggestions stop as soon as the merchant goes off script.
  const tip = talking && !ended && heard.every((t, i) => t === tips[i]) ? tips[heard.length] : undefined;

  const hold = {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (busy) return;
      // Keeps the hold alive if the finger slides off the button.
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not all browsers allow it */ }
      void ptt.start();
    },
    onPointerUp: ptt.release,
    onPointerCancel: ptt.release,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === " " && !e.repeat && !busy) { e.preventDefault(); void ptt.start(); } },
    onKeyUp: (e: React.KeyboardEvent) => { if (e.key === " ") ptt.release(); },
    disabled: busy,
  };
  const open = (next: View) => {
    setView(next);
    void fetch(`/api/phone-line/${id}/${next}`).then((r) => (r.ok ? r.json() : null)).then((l: { audio: string } | null) => {
      if (l) { ptt.stop(); ptt.push(l.audio); }
    });
  };
  const screen = TITLES[view as keyof typeof TITLES];

  const app = (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#f3f6fb]">
      {!armed && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-white p-8 text-center">
          <div className="text-sm text-muted">Paytm for Business</div>
          <div className="text-2xl font-bold text-navy">{m?.name ?? " "}</div>
          <button onClick={() => setArmed(true)} className="rounded-full bg-navy px-6 py-3 font-semibold text-white">ऐप खोलें</button>
          <div className="text-xs text-muted">इससे आवाज़ और माइक चालू होंगे।</div>
        </div>
      )}

      {view === "home" ? (
        <div className="noscroll min-h-0 flex-1 overflow-y-auto">
          <div className="bg-gradient-to-b from-[#012a72] to-[#0b4ea2] px-4 pb-12 pt-2 text-white">
            <div className="flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-white/15 font-bold">{m?.name[0]}</div>
              <div className="min-w-0 flex-1 leading-tight"><div className="truncate font-semibold">{m?.name}</div><div className="text-xs text-white/70">{m?.city} · Paytm for Business</div></div>
              <div className="text-sm font-extrabold">pay<span className="text-paytm">tm</span></div>
            </div>
            <div className="mt-4 text-xs text-white/75">आज का कलेक्शन</div>
            <div className="num text-[2.1rem] font-bold leading-tight">{m ? inr(m.today) : " "}</div>
          </div>
          <div className="-mt-9 px-3">
            <div className="grid grid-cols-4 rounded-2xl bg-white py-3 shadow-[0_6px_20px_rgba(1,42,114,0.12)]">
              {TILES.map(([key, label, path]) => (
                <button key={key} onClick={() => open(key)} className="rounded-xl py-1 text-[11px] font-medium text-ink active:bg-paper">
                  <span className="mx-auto mb-1 grid h-10 w-10 place-items-center rounded-full bg-paytm/12 text-paytm-deep"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d={path} /></svg></span>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2.5 px-3 pb-3 pt-3">
            <button onClick={() => setView("chat")} className="flex w-full items-center gap-3 rounded-2xl bg-white px-3 py-3 text-left shadow-sm active:bg-paper">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-paytm to-paytm-deep text-white"><Mic className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1"><span className="block font-semibold text-ink">Paytm Assistant से पूछें</span><span className="block truncate text-sm text-muted">Fee, settlement, machine, loan, कुछ भी</span></span>
            </button>
            <button onClick={() => open("settlement")} className="flex w-full items-center justify-between rounded-2xl bg-white px-3 py-3 text-left shadow-sm active:bg-paper">
              <span><span className="block text-xs text-muted">पिछली बार बैंक में आया</span><span className="num block font-semibold">{m ? inr(m.latestSettlementNetInr) : ""}</span></span>
              {m && m.fee.feeInr > 0 && <span className="num text-xs text-muted">Fee + GST {inr(m.fee.feePlusGstInr)}</span>}
            </button>
            {m?.savedYearInr ? <div className="rise rounded-2xl border-l-4 border-kept bg-white px-3 py-2 text-sm shadow-sm"><b>{inr(m.savedYearInr)} की बचत</b><div className="text-muted">नए plan से हर साल</div></div> : null}
            {m?.tickets.map((t) => <div key={t.id} className="rise rounded-2xl border-l-4 border-paytm bg-white px-3 py-2 text-sm shadow-sm"><b>Ticket {t.id}</b><div className="text-muted">{t.promise === "kept" ? "आपने बताया कि ठीक हो गया ✓" : t.promise === "failed" ? "एक व्यक्ति आपको call करेगा" : "3 दिन में हम खुद पूछेंगे कि ठीक हुआ या नहीं"}</div></div>)}
            {m?.inbox.map((x, i) => <div key={i} className="rise rounded-2xl bg-white px-3 py-2 text-sm shadow-sm">{x.text}</div>)}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 bg-[#012a72] px-2 py-2 text-white">
            <button onClick={() => { ptt.stop(); setView("home"); }} aria-label="वापस" className="grid h-8 w-8 place-items-center rounded-full active:bg-white/15"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5m6-6-6 6 6 6" /></svg></button>
            <div className="min-w-0 flex-1 leading-tight"><div className="truncate font-semibold">{view === "chat" ? "Paytm Assistant" : screen}</div>{view === "chat" && <div className="truncate text-xs text-white/70">AI · OTP या PIN कभी नहीं माँगता</div>}</div>
          </div>

          {view === "qr" && m && <div className="noscroll min-h-0 flex-1 overflow-y-auto p-4"><div className="rounded-2xl bg-white p-5 text-center shadow-sm"><div className="font-bold text-ink">{m.name}</div><div className="mt-3 flex justify-center [&_svg]:h-52 [&_svg]:w-52" dangerouslySetInnerHTML={{ __html: qrSvg(`rishta-demo:${m.id}`) }} /><div className="mt-2 text-sm text-muted">Scan करें और pay करें</div><div className="mt-1 text-xs text-muted">Demo QR, इससे असली भुगतान नहीं होता</div></div></div>}

          {view === "payments" && m && <div className="noscroll min-h-0 flex-1 overflow-y-auto p-3"><div className="overflow-hidden rounded-2xl bg-white shadow-sm">{m.recent.map((d) => <div key={d.label} className="flex items-center justify-between border-b border-line px-3 py-2.5 last:border-0"><span><span className="block font-medium">{d.label}</span><span className="text-xs text-muted">{d.count} payments</span></span><span className="num font-semibold">{inr(d.value)}</span></div>)}</div><div className="mt-2 px-1 text-sm text-muted">पिछले 30 दिन: <b className="num text-ink">{inr(m.collections30DaysInr)}</b></div></div>}

          {view === "settlement" && m && <div className="noscroll min-h-0 flex-1 overflow-y-auto p-3"><div className="rounded-2xl bg-white p-3 shadow-sm">{([["कुल payments", m.latestSettlementGrossInr], ["Fee", m.fee.feeInr], ["GST", m.fee.gstInr]] as const).map(([k, val]) => <div key={k} className="flex justify-between py-1.5 text-sm"><span className="text-muted">{k}</span><span className="num">{inr(val)}</span></div>)}<div className="mt-1 flex justify-between border-t border-line pt-2 font-bold"><span>आपको मिला</span><span className="num">{inr(m.latestSettlementNetInr)}</span></div></div><button onClick={() => setView("chat")} className="mt-3 w-full rounded-xl bg-paytm-deep py-2.5 font-semibold text-white">इसके बारे में पूछें</button></div>}

          {view === "soundbox" && m && <div className="noscroll min-h-0 flex-1 overflow-y-auto p-3"><div className="rounded-2xl bg-white p-3 shadow-sm">{([["Plan का किराया", `${inr(m.plan.rent)} महीना`], ["7 दिन में offline", `${m.device.offlineHours7Days} घंटे`], ["Battery alerts", String(m.device.batteryAlerts7Days)], ["Failed payments", `${m.device.failedPaymentsPct7Days}%`]] as const).map(([k, val]) => <div key={k} className="flex justify-between border-b border-line py-2 text-sm last:border-0"><span className="text-muted">{k}</span><span className="num font-semibold">{val}</span></div>)}</div><button onClick={() => setView("chat")} className="mt-3 w-full rounded-xl bg-paytm-deep py-2.5 font-semibold text-white">मशीन में दिक्कत है?</button></div>}

          {view === "chat" && <>
            <div ref={end} className="noscroll min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3" aria-live="polite">
              {lines.length === 0 && !nudge && <div className="flex min-h-full flex-col justify-end px-1 pb-1 text-center text-muted"><div className="text-lg font-semibold text-ink">नमस्ते{m ? `, ${m.name}` : ""}</div><div className="mt-1 text-sm">Mic दबाकर बोलें या नीचे लिखें। Hindi या English, जैसे चाहें।</div>{suggest.length > 0 && <div className="mt-5 space-y-2">{suggest.map((t) => <button key={t} disabled={busy} onClick={() => ptt.sendText(t)} className="block w-full rounded-xl border border-line bg-white px-3 py-2.5 text-left text-[15px] text-ink active:bg-paper">{t}</button>)}</div>}</div>}
              {nudge && lines.length === 0 && <div className="rise max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-[15px] shadow-sm">{nudge}</div>}
              {lines.map((l, i) => <div key={i} className={`rise max-w-[85%] rounded-2xl px-3 py-2 text-[15px] ${l.role === "merchant" ? "ml-auto rounded-tr-sm bg-navy text-white" : "rounded-tl-sm bg-white shadow-sm"}`}>{l.text}</div>)}
              {ptt.thinking && <div className="w-fit rounded-2xl bg-white px-3 py-2 text-muted shadow-sm">…</div>}
            </div>
            <div className="safe-bottom bg-white px-3 pt-2 shadow-[0_-1px_0_var(--color-line)]">
              {ptt.error && <div className="mb-1 text-sm text-callback">{ptt.error}</div>}
              {onTip && tip && !busy && !ptt.recording && <button onClick={() => { ptt.sendText(tip); }} className="rise mb-2 w-full rounded-xl border-2 border-paytm px-3 py-2 text-left text-sm"><span className="block text-xs text-muted">Tap to say this, or hold the mic and speak</span>{tip}</button>}
              {free && ended && !ptt.speaking && <button onClick={startNew} className="mb-2 w-full rounded-xl bg-navy px-3 py-2.5 font-semibold text-white">नई बात शुरू करें</button>}
              {!ended && (
                <div className="flex items-center gap-2">
                  <form className="flex min-w-0 flex-1" onSubmit={(e) => { e.preventDefault(); if (typed.trim() && !busy) { ptt.sendText(typed); setTyped(""); } }}>
                    <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="यहाँ लिखें" aria-label="Type your message" enterKeyHint="send" autoComplete="off" className="min-w-0 flex-1 rounded-full bg-paper px-4 py-2.5 text-base outline-none" />
                    {typed.trim() && <button disabled={busy} aria-label="Send" className="ml-2 rounded-full bg-navy px-4 font-semibold text-white disabled:opacity-50">भेजें</button>}
                  </form>
                  {!typed.trim() && <button {...hold} aria-label="Hold to talk" className={`mic-btn grid h-11 w-11 shrink-0 place-items-center rounded-full transition-transform ${ptt.recording ? "scale-125 animate-pulse bg-callback text-white" : busy ? "bg-idle text-muted" : "bg-paytm text-navy"}`}><Mic className="h-5 w-5" /></button>}
                </div>
              )}
              {!ended && heard.length > 0 && <button className="mt-1 w-full text-center text-xs text-muted underline" disabled={busy} onClick={() => void fetch(`/api/end/${id}`, { method: "POST" }).then(load)}>बात खत्म करें</button>}
              {ptt.recording && <div className="mt-1 text-center text-xs font-semibold text-callback">सुन रही हूँ… छोड़ें या दोबारा दबाएँ, भेज दूँगी</div>}
            </div>
          </>}
        </div>
      )}

      {view !== "chat" && (
        <nav className="safe-bottom grid grid-cols-4 bg-white pt-1.5 text-center text-[10px] text-muted shadow-[0_-1px_0_var(--color-line)]">
          {([["home", "Home"], ["payments", "Payments"], ["settlement", "Settlement"], ["chat", "Assistant"]] as const).map(([key, label]) => <button key={key} onClick={() => (key === "home" || key === "chat" ? setView(key) : open(key))} className={view === key ? "font-bold text-paytm-deep" : ""}><span className={`mx-auto mb-0.5 block h-1 w-5 rounded-full ${view === key ? "bg-paytm-deep" : "bg-transparent"}`} />{label}</button>)}
        </nav>
      )}
    </div>
  );

  if (fixedId) return <div className="app-h safe-top bg-[#012a72]">{app}</div>;
  if (bare) return <div className="h-full w-full">{app}</div>;

  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative shrink-0" style={{ height: "min(700px, calc(100dvh - 170px))", width: "calc(min(700px, 100dvh - 170px) * 0.47)" }}>
        <span className="absolute -left-[3px] top-[18%] h-8 w-[3px] rounded-l bg-[#2a3346]" aria-hidden />
        <span className="absolute -left-[3px] top-[26%] h-14 w-[3px] rounded-l bg-[#2a3346]" aria-hidden />
        <span className="absolute -right-[3px] top-[23%] h-16 w-[3px] rounded-r bg-[#2a3346]" aria-hidden />
        <div className="h-full rounded-[44px] bg-gradient-to-b from-[#232b3b] to-[#0d1320] p-[9px] shadow-[0_24px_60px_rgba(1,42,114,0.28)]">
          <div className="relative flex h-full flex-col overflow-hidden rounded-[36px] bg-[#012a72]">
            <div className="relative flex shrink-0 items-center justify-between px-6 pb-1 pt-2.5 text-[11px] font-semibold text-white" aria-hidden>
              <span className="num">9:41</span>
              <span className="absolute left-1/2 top-2 h-[18px] w-20 -translate-x-1/2 rounded-full bg-black" />
              <span className="flex items-center gap-1"><span className="flex items-end gap-[1.5px]">{[4, 6, 8, 10].map((h) => <i key={h} className="block w-[2.5px] rounded-sm bg-white" style={{ height: h }} />)}</span>4G<span className="ml-0.5 inline-block h-2.5 w-5 rounded-[3px] border border-white/80 p-[1px]"><i className="block h-full w-3/4 rounded-[1px] bg-white" /></span></span>
            </div>
            <div className="min-h-0 flex-1">{app}</div>
            <div className="flex shrink-0 justify-center bg-white pb-1.5 pt-1" aria-hidden><span className="h-1 w-24 rounded-full bg-ink/70" /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
