import { useCallback, useEffect, useState } from "react";
import { useEvents } from "../hooks/useEvents";
import { Empty, Icon, Pill, Skeleton } from "../ui";
import MerchantPhone from "./MerchantPhone";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface ShopRow { id: string; name: string; city: string; category: string; demo: boolean; status: string }

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

// Anything a shopkeeper might say. Nothing here is matched to a shop: each one goes to the real agent.
const TRY = ["मेरे settlement में पैसे कम क्यों आए?", "मशीन बार बार बंद हो जाती है", "Rent बहुत ज़्यादा है", "मुझे loan मिल सकता है?", "OTP बताऊँ क्या?", "किसी इंसान से बात कराओ", "मुझे फ़ोन मत करना"];

const ACTION: Record<string, string> = {
  getMerchantSummary: "Read this shop's numbers", explainFee: "Worked out the fee", checkDeviceHealth: "Checked the device", raiseTicket: "Raised a ticket", proposePlan: "Looked up plans", changePlan: "Changed the plan",
  scheduleHumanCallback: "Called in a person", recordOptOut: "Stopped all contact", sendAppMessage: "Sent an app message", requestDeviceReturn: "Booked a device return", checkLoan: "Checked the loan and sales", setReducedEmi: "Set a smaller EMI", proposeLoan: "Worked out loan options", acceptLoan: "Sent a loan for approval", confirmFix: "Recorded if the fix worked",
};

function Picker({ selected, pick }: { selected: string; pick: (id: string) => void }) {
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
    <aside className="flex min-h-0 w-full flex-col border-r border-line bg-white lg:w-80 lg:shrink-0">
      <div className="space-y-2 border-b border-line p-3">
        <div className="text-sm font-semibold text-ink">Be any of {data ? data.total.toLocaleString("en-IN") : "the"} shops</div>
        <div className="relative">
          <Icon name="search" size={16} className="absolute left-2.5 top-2.5 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, city or ID" aria-label="Search shops" className="w-full rounded-lg border border-line bg-paper py-1.5 pl-8 pr-3 text-sm outline-none focus:border-paytm" />
        </div>
        <button onClick={() => void random()} className="btn-ghost w-full justify-center">Pick a random shop</button>
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

function Inside({ shop, merchant, nudge, nudgeError }: { shop: any; merchant: any; nudge: () => void; nudgeError: string }) {
  if (!shop || !merchant) return <div className="w-full p-4"><Skeleton h={320} /></div>;
  const live = shop.live;
  const actions: string[] = (live?.actions ?? []).filter((a: string) => a !== "recordOutcome");
  const canNudge = shop.brief && ["soundbox", "app"].includes(shop.brief.channel) && !shop.left && !shop.blocked && !shop.outcome;
  return (
    <aside className="min-h-0 w-full space-y-4 overflow-y-auto border-l border-line bg-white p-4 lg:w-[22rem] lg:shrink-0">
      <section>
        <div className="text-lg font-bold leading-tight text-ink">{shop.name}</div>
        <div className="text-sm text-muted">{shop.city} · {shop.id}</div>
        <dl className="mt-2 text-sm">
          {[["Collections, 30 days", inr(merchant.collections30DaysInr)], ["Last settlement received", inr(merchant.latestSettlementNetInr)], ["Fee plus GST", inr(merchant.fee.feePlusGstInr)], ["Monthly rent", inr(merchant.plan.rent)]].map(([k, val]) => (
            <div key={k} className="flex justify-between border-b border-line py-1 last:border-0"><dt className="text-muted">{k}</dt><dd className="num font-semibold">{val}</dd></div>
          ))}
        </dl>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ink">Rishta's plan for this shop</h2>
        {shop.left ? <p className="text-sm text-muted">Left alone: {shop.left.reasons.join(". ")}. It still answers if the shop presses the button.</p>
          : shop.meta ? <p className="text-sm text-muted">{shop.meta.reasonLabel}: {shop.meta.approachLabel}. It won't bring this up unless it reaches out first.</p>
          : <p className="text-sm text-muted">Nothing planned. It will answer whatever the shop asks.</p>}
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

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-white px-4 py-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-paytm to-paytm-deep text-sm font-extrabold text-white">र</span>
        <span className="font-bold text-ink">Rishta</span>
        <Pill tone="warn">Simulated shop data, real agent</Pill>
        <span className="flex-1" />
        <button onClick={() => void fetch("/api/reset", { method: "POST" }).then(load)} className="btn-quiet flex items-center gap-1.5 text-sm"><Icon name="reset" size={15} />Reset</button>
        <a href="/sales" className="btn-ghost text-sm">Sales app</a>
        <a href="/demo" className="btn-ghost text-sm">Guided demo</a>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="h-72 shrink-0 lg:h-auto lg:contents"><Picker selected={id} pick={pick} /></div>
        <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-paper p-3">
          <div className="min-h-0 w-full flex-1"><MerchantPhone key={id} shopId={id} free /></div>
          <div className="flex max-w-xl flex-wrap justify-center gap-1.5">{TRY.map((t) => <button key={t} onClick={() => say(t)} className="seg seg-sm">{t}</button>)}</div>
        </main>
        <Inside shop={shop} merchant={merchant} nudge={() => void nudge()} nudgeError={nudgeError} />
      </div>
    </div>
  );
}
