import { Icon, RoleTabs } from "../ui";

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

export default function Home() {
  return (
    <div className="h-dvh overflow-y-auto bg-paper text-ink">
      <header className="mx-auto flex max-w-5xl items-center gap-2.5 px-4 py-3 sm:px-6">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-paytm to-paytm-deep font-extrabold text-white">र</span>
        <span className="text-lg font-bold">Rishta</span>
        <span className="flex-1" />
        <a href="/demo" className="text-sm font-semibold text-paytm-deep">The 3-minute tour</a>
      </header>

      <div className="mx-auto max-w-5xl px-4 sm:px-6"><div className="sm:max-w-sm"><RoleTabs /></div></div>
      <section className="mx-auto max-w-5xl px-4 pb-8 pt-6 sm:px-6 sm:pt-12">
        <p className="text-sm font-semibold text-paytm-deep">An AI relationship manager for every Paytm shop</p>
        <h1 className="mt-2 max-w-3xl text-[2.1rem] font-extrabold leading-[1.12] sm:text-5xl">Paytm can't hire 1.64 crore relationship managers. Rishta is one.</h1>
        <p className="mt-4 max-w-2xl text-lg leading-snug text-muted">It fixes problems before shops give up, comes back to check the fix worked, and knows when to stay quiet. Don't take our word for it. Be the shopkeeper and talk to it.</p>
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          <a href="#shops" className="btn-primary justify-center px-6 py-3 text-base">Talk to Rishta</a>
          <a href="/new" className="btn-ghost justify-center px-6 py-3 text-base">Make your own shop</a>
        </div>
      </section>

      <section id="shops" className="mx-auto max-w-5xl scroll-mt-4 px-4 pb-10 sm:px-6">
        <h2 className="text-xl font-bold">Step into a shop</h2>
        <p className="text-muted">Each one has a different problem. Speak or type, in Hindi or English.</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SHOPS.map((s) => (
            <li key={s.id}>
              <a href={`/?shop=${s.id}`} className="group flex h-full flex-col rounded-2xl border border-line bg-white p-4 transition-colors hover:border-paytm-deep">
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0"><span className="block truncate font-bold">{s.name}</span><span className="block text-sm text-muted">{s.place}</span></span>
                  <span className="shrink-0 rounded-full bg-paytm/12 px-2 py-0.5 text-xs font-semibold text-paytm-deep">{s.tag}</span>
                </span>
                <span className="mt-2 flex-1 leading-snug text-ink/80">{s.story}</span>
                <span className="mt-3 block rounded-xl bg-paper px-3 py-2 text-sm"><span className="block text-xs text-muted">Try saying</span>{s.say}</span>
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
          <div><h2 className="text-lg font-bold">See the manager's side</h2><p className="text-white/75">5,000 shops, tonight's decisions, and the proof behind them.</p></div>
          <a href="/demo" className="shrink-0 rounded-xl bg-white px-5 py-2.5 font-semibold text-navy">Take the tour</a>
        </div>
      </section>

      <footer className="mx-auto max-w-5xl px-4 pb-8 text-sm text-muted sm:px-6">
        Student hackathon prototype, not a Paytm product. All shops and results are simulated. Never enter real OTPs, PINs or bank details. What you do here is private to you and clears itself.
      </footer>
    </div>
  );
}
