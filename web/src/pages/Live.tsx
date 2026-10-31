import { useCallback, useEffect, useState } from "react";
import { useEvents } from "../hooks/useEvents";
import { Empty, Icon, RoleTabs, Skeleton, useNarrow } from "../ui";
import MerchantPhone from "./MerchantPhone";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface ShopRow { id: string; name: string; city: string; category: string; demo: boolean; status: string }

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

// Anything a shopkeeper might say. Nothing here is matched to a shop: each one goes to the real agent.
// What each story shop would say first.
const OPENING: Record<string, string> = { M002: "मशीन बार बार बंद हो जाती है", M003: "किसी इंसान से बात कराओ", M004: "Rent बहुत ज़्यादा है", M005: "धंधा कैसे बढ़ाऊँ?", M007: "EMI भरना मुश्किल हो रहा है", M008: "मुझे loan मिल सकता है?" };
const TRY = ["मेरे settlement में पैसे कम क्यों आए?", "मशीन बार बार बंद हो जाती है", "Rent बहुत ज़्यादा है", "मुझे loan मिल सकता है?", "OTP बताऊँ क्या?", "किसी इंसान से बात कराओ", "मुझे फ़ोन मत करना"];

const ACTION: Record<string, string> = {
  getMerchantSummary: "Read this shop's numbers", explainFee: "Worked out the fee", checkDeviceHealth: "Checked the device", raiseTicket: "Raised a ticket", proposePlan: "Looked up plans", changePlan: "Changed the plan",
  scheduleHumanCallback: "Called in a person", recordOptOut: "Stopped all contact", sendAppMessage: "Sent an app message", requestDeviceReturn: "Booked a device return", checkLoan: "Checked the loan and sales", setReducedEmi: "Set a smaller EMI", proposeLoan: "Worked out loan options", acceptLoan: "Sent a loan for approval", confirmFix: "Recorded if the fix worked",
};

function Picker({ selected, pick, wide }: { selected: string; pick: (id: string) => void; wide?: boolean }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState<{ total: number; matching: number; shops: ShopRow[] } | null>(null);
  const more = async () => {
    const res = await (await fetch(`/api/shops?q=${encodeURIComponent(q)}&offset=${data?.shops.length ?? 0}`)).json();
    setData((d) => d && { ...d, shops: [...d.shops, ...res.shops] });
  };
  useEffect(() => {
    const t = setTimeout(() => void fetch(`/api/shops?q=${encodeURIComponent(q)}`).then((r) => r.json()).then(setData), 150);
    return () => clearTimeout(t);
  }, [q]);
  const random = async () => {
    const number = 1 + Math.floor(Math.random() * Math.max(1, (data?.total ?? 1) - 1));
    const res = await (await fetch(`/api/shops?q=${encodeURIComponent(String(number).padStart(4, "0"))}`)).json();
    const shops = res.shops.filter((s: ShopRow) => !s.demo);
    if (shops[0]) pick(shops[0].id);
  };
  return (
    <aside className={`flex min-h-0 w-full flex-col bg-white ${wide ? "flex-1" : "border-r border-line lg:w-80 lg:shrink-0"}`}>
      <div className="space-y-2 border-b border-line p-3">
        <div className="relative">
          <Icon name="search" size={16} className="absolute left-2.5 top-2.5 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, city or ID" aria-label="Search shops" className="w-full rounded-lg border border-line bg-paper py-1.5 pl-8 pr-3 text-sm outline-none focus:border-paytm" />
        </div>
        <div className="flex gap-2"><a href="/new" className="btn-ghost flex-1 justify-center">Make your own</a><button onClick={() => void random()} className="btn-ghost flex-1 justify-center">Random shop</button></div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {data?.shops.map((s) => (
          <li key={s.id}>
            <button onClick={() => pick(s.id)} aria-current={s.id === selected ? "true" : undefined} className={`w-full border-b border-line px-3 py-2 text-left ${s.id === selected ? "bg-paytm/12" : "hover:bg-paper"}`}>
              <span className="block truncate font-semibold text-ink">{s.name}</span>
              <span className="block truncate text-sm text-muted">{s.city} · {s.status}</span>
            </button>
          </li>
        ))}
        {data?.shops.length === 0 && <li><Empty title="No shop found" /></li>}
        {data && data.shops.length < data.matching && <li className="p-3"><button onClick={() => void more()} className="btn-ghost w-full justify-center">Load more ({data.shops.length.toLocaleString("en-IN")} of {data.matching.toLocaleString("en-IN")})</button></li>}
      </ul>
    </aside>
  );
}

function Sheet({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  return (
    <div role="dialog" aria-label={title} className="rise safe-top fixed inset-0 z-40 flex flex-col bg-white">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5"><span className="font-bold text-ink">{title}</span><button onClick={close} className="font-semibold text-paytm-deep">Close</button></div>
      {children}
    </div>
  );
}

function Inside({ shop, merchant, nudge, nudgeError }: { shop: any; merchant: any; nudge: () => void; nudgeError: string }) {
  // Same box as the loaded panel, otherwise the phone jumps while this loads.
  if (!shop || !merchant) return <aside className="min-h-0 w-full flex-1 overflow-y-auto border-l border-line bg-white p-4 lg:w-[22rem] lg:flex-none lg:shrink-0"><Skeleton h={320} /></aside>;
  const live = shop.live;
  const actions: string[] = (live?.actions ?? []).filter((a: string) => a !== "recordOutcome");
  const canNudge = shop.brief && ["soundbox", "app"].includes(shop.brief.channel) && !shop.left && !shop.blocked && !shop.outcome;
  return (
    <aside className="min-h-0 w-full flex-1 space-y-4 overflow-y-auto border-l border-line bg-white p-4 lg:w-[22rem] lg:flex-none lg:shrink-0">
      <section>
        <div className="text-lg font-bold leading-tight text-ink">{shop.name}</div>
        <div className="text-sm text-muted">{shop.city} · {shop.id}</div>
        <dl className="mt-2 text-sm">
          {[["Collections, 30 days", inr(merchant.collections30DaysInr)], ["Last settlement received", inr(merchant.latestSettlementNetInr)], ["Fee plus GST", `₹${merchant.fee.feePlusGstInr}`], ["Monthly rent", inr(merchant.plan.rent)]].map(([k, val]) => (
            <div key={k} className="flex justify-between border-b border-line py-1 last:border-0"><dt className="text-muted">{k}</dt><dd className="num font-semibold">{val}</dd></div>
          ))}
        </dl>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ink">Rishta's plan for this shop</h2>
        {shop.left ? <p className="text-sm text-muted">Left alone: {shop.left.reasons.join(". ")}. It still answers if the shop presses the button.</p>
          : shop.meta ? <p className="text-sm text-muted">{shop.meta.reasonLabel}: {shop.meta.approachLabel}. It won't bring this up unless it reaches out first.</p>
          : <p className="text-sm text-muted">This shop looks healthy, so Rishta won't disturb it. It will answer whatever the shop asks.</p>}
        {canNudge && <button onClick={nudge} className="btn-ghost mt-2 w-full justify-center">Let Rishta reach out first</button>}
        {nudgeError && <p className="mt-1 text-sm text-callback">{nudgeError}</p>}
      </section>

      <section>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><span className="live-dot" />This conversation</h2>
        {!live?.transcript.length ? <p className="text-sm text-muted">The shopkeeper speaks first. Real tool calls show up here as they happen.</p> : (
          <ol className="mt-1 space-y-1 text-sm">
            {live.numbersChecked > 0 && <li className="rise flex gap-2"><Icon name="check" className="text-kept" />{live.numbersChecked} numbers checked before speaking</li>}
            {live.guardEvents.length > 0 && <li className="rise flex gap-2 text-sim"><Icon name="shield" />{live.guardEvents.length} blocked, never spoken</li>}
            {actions.map((a, i) => <li key={i} className="rise flex gap-2"><Icon name="check" className="text-kept" />{ACTION[a] ?? a}</li>)}
            {actions.length === 0 && live.numbersChecked === 0 && <li className="text-muted">No tools needed yet.</li>}
          </ol>
        )}
      </section>

      {shop.history?.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-ink">What Rishta remembers</h2>
          <ol className="mt-1 space-y-1 text-sm">{shop.history.slice(0, 6).map((e: any, i: number) => <li key={i}><span className="font-semibold">{e.when}</span> <span className="text-muted">{e.text}</span></li>)}</ol>
        </section>
      )}
    </aside>
  );
}

export default function Live() {
  const [id, setId] = useState(() => new URLSearchParams(window.location.search).get("shop") ?? "M001");
  const [shop, setShop] = useState<any>(null);
  const [merchant, setMerchant] = useState<any>(null);
  const [nudgeError, setNudgeError] = useState("");
  const narrow = useNarrow();
  // A shop the visitor just made opens on what Rishta decided about it.
  const [sheet, setSheet] = useState<"shops" | "rishta" | null>(() => (new URLSearchParams(window.location.search).has("fresh") ? "rishta" : null));

  const load = useCallback(() => {
    void fetch(`/api/shop/${id}`).then((r) => (r.ok ? r.json() : null)).then(setShop);
    void fetch(`/api/merchant/${id}`).then((r) => (r.ok ? r.json() : null)).then(setMerchant);
  }, [id]);
  useEffect(() => { setShop(null); setMerchant(null); setNudgeError(""); load(); }, [load]);
  useEvents((e) => { if (e.type === "reset" || e.merchantId === id) load(); });

  const pick = (next: string) => {
    history.replaceState(null, "", `/?shop=${next}`);
    setId(next);
  };
  const nudge = async () => {
    setNudgeError("");
    const res = await fetch(`/api/outreach/${id}`, { method: "POST" });
    if (!res.ok) setNudgeError(((await res.json()) as { error?: string }).error ?? "Couldn't reach the shop.");
  };
  const say = (text: string) => dispatchEvent(new CustomEvent("rishta-say", { detail: text }));
  useEffect(() => {
    try { localStorage.setItem("rishta-shop", id); } catch { /* Only a convenience. */ }
  }, [id]);
  const panel = <Inside shop={shop} merchant={merchant} nudge={() => { setSheet(null); void nudge(); }} nudgeError={nudgeError} />;
  const done = (shop?.live?.actions ?? []).filter((a: string) => a !== "recordOutcome").length;

  // On a phone the shop is the whole screen. Tap its name to change shop.
  if (narrow) {
    return (
      <div className="app-h safe-top flex flex-col bg-white">
        <header className="flex items-center gap-1 border-b border-line py-1.5 pl-2 pr-2">
          <a href="/" aria-label="Home" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-paytm to-paytm-deep font-extrabold text-white">र</a>
          <button onClick={() => setSheet("shops")} aria-label="Change shop" className="min-w-0 flex-1 rounded-lg px-2 py-0.5 text-left leading-tight active:bg-paper">
            <span className="flex items-center gap-1"><span className="truncate font-bold text-ink">{shop?.name ?? " "}</span><svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg></span>
            <span className="block truncate text-xs text-muted">{shop?.city ?? " "} · दुकान बदलें</span>
          </button>
          <button onClick={() => setSheet("rishta")} className="flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 py-1.5 text-sm font-semibold text-paytm-deep"><span className="live-dot" />Rishta{done > 0 ? ` · ${done}` : ""}</button>
        </header>
        <div className="border-b border-line px-2 py-1.5"><RoleTabs on="shop" /></div>
        <div className="min-h-0 flex-1"><MerchantPhone key={id} shopId={id} free bare suggest={[...new Set([OPENING[id] ?? TRY[0]!, ...TRY])].slice(0, 3)} /></div>
        {sheet === "shops" && <Sheet title="Change shop" close={() => setSheet(null)}><Picker wide selected={id} pick={(next) => { pick(next); setSheet(null); }} /></Sheet>}
        {sheet === "rishta" && <Sheet title="What Rishta sees" close={() => setSheet(null)}>{panel}</Sheet>}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-white px-4 py-2">
        <a href="/" className="flex items-center gap-3"><span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-paytm to-paytm-deep text-sm font-extrabold text-white">र</span>
        <span className="font-bold text-ink">Rishta</span></a>
        <span className="flex-1" />
        <button onClick={() => void fetch("/api/reset", { method: "POST" }).then(load)} className="btn-quiet flex items-center gap-1.5 text-sm"><Icon name="reset" size={15} />Start over</button>
        <div className="w-80"><RoleTabs on="shop" /></div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="h-72 shrink-0 lg:h-auto lg:contents"><Picker selected={id} pick={pick} /></div>
        <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-paper p-3">
          <div className="min-h-0 w-full flex-1"><MerchantPhone key={id} shopId={id} free /></div>
          <div className="flex max-w-xl flex-wrap justify-center gap-1.5">{TRY.map((t) => <button key={t} onClick={() => say(t)} className="seg seg-sm">{t}</button>)}</div>
        </main>
        {panel}
      </div>
    </div>
  );
}
