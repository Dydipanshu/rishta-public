
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
    <section className="border-b border-line bg-white">
      <header className="mx-auto flex max-w-5xl items-center gap-2 border-b border-line px-4 py-3 sm:px-6">
        <span className="text-lg font-extrabold text-navy">Rishta</span>
        <span className="flex-1" />
        <a href="/sales" className="text-sm font-semibold text-ink underline-offset-4 hover:underline">Salesperson</a>
        <a href="/demo" className="ml-4 text-sm font-semibold text-ink underline-offset-4 hover:underline">Tour</a>
      </header>
      <div className="mx-auto grid max-w-5xl items-start gap-8 px-4 py-8 sm:px-6 sm:py-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
        <div>
          <h1 className="text-[2rem] font-extrabold leading-[1.12] text-navy sm:text-[2.6rem]">Paytm can't hire 1.64 crore relationship managers. Rishta is one.</h1>
          <p className="mt-4 text-lg leading-snug text-ink/80">It fixes problems before shops give up, comes back to check, and knows when to stay quiet.</p>
          <a href="/?shop=M001" className="mt-6 inline-block rounded-md bg-navy px-5 py-3 font-bold text-white hover:bg-paytm-deep">Talk to Rishta now</a>
          <p className="mt-3 text-sm text-muted">Speak or type, Hindi or English. No sign-up. Or <a href="/new" className="font-semibold text-ink underline underline-offset-2">make your own shop</a>.</p>
        </div>
        <div aria-label="Example conversation with Ramesh General Store">
          <p className="border-b border-line pb-2 text-sm"><span className="font-bold">Ramesh General Store</span><span className="text-muted">, Lucknow</span></p>
          <div className="mt-3 space-y-2 text-[15px] leading-snug">
            {CHAT.map((c, i) => c.from === "done"
              ? <p key={i} className="say pt-1 text-sm text-kept" style={{ "--at": `${300 + i * 450}ms` } as React.CSSProperties}>{c.text}</p>
              : <div key={i} className={`say w-fit max-w-[88%] rounded-lg px-3 py-2 ${c.from === "shop" ? "ml-auto bg-navy text-white" : "bg-paper"}`} style={{ "--at": `${100 + i * 450}ms` } as React.CSSProperties}>{c.text}</div>)}
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
        <h2 className="text-xl font-bold text-navy">Step into a shop</h2>
        <ul className="mt-3 border-t border-line">
          {SHOPS.map((s) => (
            <li key={s.id} className="border-b border-line">
              <a href={`/?shop=${s.id}`} className="grid gap-1 py-3 hover:bg-white sm:grid-cols-[13rem_minmax(0,1fr)_15rem] sm:gap-4">
                <span><span className="block font-bold">{s.name}</span><span className="block text-sm text-muted">{s.place}</span></span>
                <span className="leading-snug text-ink/80">{s.story}</span>
                <span className="text-sm font-semibold text-paytm-deep">{s.say}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-8 sm:px-6">
        <h2 className="text-xl font-bold text-navy">How it runs</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {STEPS.map(([, title, text]) => (
            <div key={title}><h3 className="font-bold">{title}</h3><p className="leading-snug text-muted">{text}</p></div>
          ))}
        </div>
        <p className="mt-5"><a href="/demo" className="font-semibold text-paytm-deep underline underline-offset-2">See tonight's decisions and the proof</a></p>
      </section>

      <footer className="mx-auto max-w-5xl border-t border-line px-4 py-5 text-sm text-muted sm:px-6">
        Student hackathon prototype by team Lonewolf, not a Paytm product. All shops and results are simulated. Never enter real OTPs, PINs or bank details.
      </footer>
    </div>
  );
}
