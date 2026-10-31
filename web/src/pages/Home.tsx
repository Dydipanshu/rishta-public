import { Icon } from "../ui";

const SHOPS = [
  { id: "M001", name: "Ramesh General Store", place: "Lucknow · Kirana", story: "Money looks short in his settlement. He's thinking of returning the machine.", say: "मेरे settlement में पैसे कम क्यों आए?", tag: "Explains a fee" },
  { id: "M002", name: "Sharma Medicos", place: "Pune · Chemist", story: "Payments are failing and sales are down 40%. They haven't complained yet.", say: "मशीन बार बार बंद हो जाती है", tag: "Raises a ticket" },
  { id: "M004", name: "Gupta Snacks", place: "Indore · Snacks", story: "A tiny shop paying too much rent. A rival is offering a cheaper box.", say: "Rent बहुत ज़्यादा है", tag: "Changes a plan" },
  { id: "M008", name: "Anand Sweets", place: "Kanpur · Sweets", story: "Sales are growing and the record is clean. Is this the right moment for a loan?", say: "मुझे loan मिल सकता है?", tag: "Offers a loan" },
  { id: "M007", name: "Verma Footwear", place: "Nagpur · Footwear", story: "Sales fell and EMIs were missed. Pressure won't help. A smaller EMI might.", say: "EMI भरना मुश्किल हो रहा है", tag: "Eases a loan" },
  { id: "M003", name: "Raju Tea Point", place: "Delhi · Tea stall", story: "Three open complaints, and he's angry. Rishta should step aside for a person.", say: "किसी इंसान से बात कराओ", tag: "Calls a person" },
];

const STEPS = [
  ["overview", "Every night", "Rishta checks every shop, then decides who needs help, about what, and who to leave alone."],
  ["talk", "Every day", "It talks to the shop in Hindi or English and fixes the problem, using the shop's own numbers."],
  ["proof", "Every week", "It compares results against shops it didn't contact, and moves to what really works."],
] as const;

// A real exchange from the Ramesh case, figures as the agent gives them. It plays once and stops.
const CHAT: { from: "shop" | "ai" | "done"; text: string }[] = [
  { from: "shop", text: "मेरे settlement में पैसे कम क्यों आए? मशीन वापस कर दूँ क्या?" },
  { from: "ai", text: "Ramesh जी, ₹2,000 से ऊपर के 4 payments पर fee ₹38 और GST ₹6.84 लगा। कुल ₹44.84." },
  { from: "ai", text: "₹2,000 तक के payments पर कोई fee नहीं है।" },
  { from: "shop", text: "अच्छा, समझ गया। मशीन रखता हूँ।" },
  { from: "done", text: "Every number checked against this shop's data before it was spoken" },
];

function Hero() {
  return (
    <section className="bg-gradient-to-br from-[#012a72] via-[#0a2f7a] to-[#0369a1] text-white">
      <header className="mx-auto flex max-w-5xl items-center gap-2.5 px-4 py-3 sm:px-6">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-white font-extrabold text-paytm-deep">र</span>
        <span className="text-lg font-bold">Rishta</span>
        <span className="flex-1" />
        <a href="/sales" className="text-sm font-semibold text-white/90 underline-offset-4 hover:underline">Salesperson</a>
        <a href="/demo" className="ml-3 text-sm font-semibold text-white/90 underline-offset-4 hover:underline">The 3-minute tour</a>
      </header>
      <div className="mx-auto grid max-w-5xl items-center gap-7 px-4 pb-9 pt-5 sm:px-6 sm:pt-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-10 lg:pb-14">
        <div>
          <p className="text-sm font-semibold text-paytm">An AI relationship manager for every Paytm shop</p>
          <h1 className="mt-2 text-[2.15rem] font-extrabold leading-[1.1] sm:text-5xl">Paytm can't hire 1.64 crore relationship managers. Rishta is one.</h1>
          <p className="mt-3 text-lg leading-snug text-white/80">It fixes problems before shops give up, comes back to check, and knows when to stay quiet. Don't take our word for it. Be the shopkeeper and talk to it.</p>
          <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
            <a href="/?shop=M001" className="inline-flex items-center justify-center gap-2 rounded-xl bg-paytm px-6 py-3.5 text-base font-bold text-navy transition-transform active:translate-y-px"><Icon name="talk" />Talk to Rishta now</a>
            <a href="/new" className="inline-flex items-center justify-center rounded-xl border border-white/35 px-6 py-3.5 text-base font-semibold text-white hover:bg-white/10">Make your own shop</a>
          </div>
          <p className="mt-2.5 text-sm text-white/65">Speak or type, Hindi or English. No sign-up.</p>
        </div>
        <div className="rounded-3xl bg-white/10 p-3 ring-1 ring-white/15" aria-label="Example conversation with Ramesh General Store">
          <div className="flex items-center gap-2 px-1 pb-2 text-sm"><span className="live-dot" /><span className="font-semibold">Ramesh General Store</span><span className="text-white/60">Lucknow</span></div>
          <div className="space-y-2 rounded-2xl bg-[#f3f6fb] p-3 text-[15px] leading-snug text-ink">
            {CHAT.map((c, i) => c.from === "done"
              ? <div key={i} className="say flex items-start gap-1.5 pt-1 text-sm font-semibold text-kept" style={{ "--at": `${300 + i * 450}ms` } as React.CSSProperties}><Icon name="check" size={16} className="mt-0.5" />{c.text}</div>
              : <div key={i} className={`say max-w-[88%] rounded-2xl px-3 py-2 ${c.from === "shop" ? "ml-auto w-fit rounded-tr-sm bg-navy text-white" : "w-fit rounded-tl-sm bg-white shadow-sm"}`} style={{ "--at": `${100 + i * 450}ms` } as React.CSSProperties}>{c.text}</div>)}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <div className="h-dvh overflow-y-auto bg-paper text-ink">
      <Hero />

      <section id="shops" className="mx-auto max-w-5xl scroll-mt-4 px-4 py-8 sm:px-6">
        <h2 className="text-xl font-bold">Step into a shop</h2>
        <p className="text-muted">Each one has a different problem. Speak or type, in Hindi or English.</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SHOPS.map((s) => (
            <li key={s.id}>
              <a href={`/?shop=${s.id}`} className="group flex h-full flex-col rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition-[border-color,transform] hover:-translate-y-0.5 hover:border-paytm-deep active:translate-y-0">
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0"><span className="block truncate font-bold">{s.name}</span><span className="block text-sm text-muted">{s.place}</span></span>
                  <span className="shrink-0 rounded-full bg-paytm/12 px-2 py-0.5 text-xs font-semibold text-paytm-deep">{s.tag}</span>
                </span>
                <span className="mt-2 flex-1 leading-snug text-ink/80">{s.story}</span>
                <span className="mt-3 flex items-center gap-2 rounded-xl bg-paper px-3 py-2 text-sm"><span className="min-w-0 flex-1"><span className="block text-xs text-muted">Try saying</span>{s.say}</span><span className="text-paytm-deep transition-transform group-hover:translate-x-0.5"><Icon name="arrow" /></span></span>
              </a>
            </li>
          ))}
          <li>
            <a href="/new" className="flex h-full min-h-44 flex-col justify-center rounded-2xl border-2 border-dashed border-paytm-deep/40 bg-white p-4 text-center hover:border-paytm-deep">
              <span className="font-bold text-paytm-deep">Make your own shop</span>
              <span className="mt-1 text-muted">Your name, your city, your problem. Rishta decides what to do about it.</span>
            </a>
          </li>
        </ul>
      </section>

      <section className="border-y border-line bg-white">
        <div className="mx-auto grid max-w-5xl gap-5 px-4 py-8 sm:grid-cols-3 sm:px-6">
          {STEPS.map(([icon, title, text]) => (
            <div key={title}><Icon name={icon} className="text-paytm-deep" /><h3 className="mt-1.5 font-bold">{title}</h3><p className="leading-snug text-muted">{text}</p></div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-3 rounded-2xl bg-navy p-5 text-white sm:flex-row sm:items-center">
          <div><h2 className="text-lg font-bold">See it from the other chairs</h2><p className="text-white/75">5,000 simulated shops, tonight's decisions, and the proof behind them. Or the salesperson's list for today.</p></div>
          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row"><a href="/demo" className="rounded-xl bg-white px-5 py-2.5 text-center font-semibold text-navy">Take the tour</a><a href="/sales" className="rounded-xl border border-white/35 px-5 py-2.5 text-center font-semibold text-white">Salesperson view</a></div>
        </div>
      </section>

      <footer className="mx-auto max-w-5xl px-4 pb-8 text-sm text-muted sm:px-6">
        Student hackathon prototype, not a Paytm product. All shops and results are simulated. Never enter real OTPs, PINs or bank details. What you do here is private to you and clears itself.
      </footer>
    </div>
  );
}
