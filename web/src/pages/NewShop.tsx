import { useState } from "react";

const CATEGORIES = [["kirana", "Kirana"], ["chemist", "Chemist"], ["tea stall", "Tea stall"], ["snacks", "Snacks"], ["restaurant", "Restaurant"], ["sweets", "Sweets"], ["electronics", "Electronics"], ["clothing", "Clothing"], ["footwear", "Footwear"], ["fruits", "Fruits"], ["vegetables", "Vegetables"]] as const;
const SALES = [[6000, "₹6,000"], [30000, "₹30,000"], [60000, "₹60,000"], [140000, "₹1.4 lakh"], [500000, "₹5 lakh"]] as const;
const TRENDS = [["growing", "Growing"], ["steady", "Steady"], ["falling", "Falling"]] as const;
const RENTS = [99, 129, 149] as const;
const PROBLEMS = [
  ["none", "Nothing, things are fine", "See what Rishta does with a healthy shop"],
  ["fee", "Money is cut from my settlement", "Fee and GST show up. This needs ₹1.4 lakh a month or more, so we set that"],
  ["device", "My Soundbox keeps failing", "Battery alerts, failed payments, falling sales"],
  ["settlement", "My money arrives late", "Settlements delayed, and a complaint already open"],
  ["rent", "The rent feels too high", "Works best with small monthly sales"],
] as const;

function Choice<T extends string | number>({ label, options, value, set }: { label: string; options: readonly (readonly [T, string])[]; value: T; set: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, text]) => <button key={v} type="button" aria-pressed={v === value} onClick={() => set(v)} className={`rounded-full border px-3.5 py-2 ${v === value ? "border-navy bg-navy text-white" : "border-line bg-white"}`}>{text}</button>)}
      </div>
    </fieldset>
  );
}

function Field({ label, value, set, hint }: { label: string; value: string; set: (v: string) => void; hint: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-semibold">{label}</span>
      <input value={value} onChange={(e) => set(e.target.value)} placeholder={hint} maxLength={40} className="w-full rounded-xl border border-line bg-white px-3.5 py-3 text-base outline-none focus:border-paytm-deep" />
    </label>
  );
}

export default function NewShop() {
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number][0]>("kirana");
  const [monthlySales, setSales] = useState<number>(60000);
  const [trend, setTrend] = useState<(typeof TRENDS)[number][0]>("steady");
  const [rent, setRent] = useState<number>(149);
  const [problem, setProblem] = useState<(typeof PROBLEMS)[number][0]>("none");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = name.trim().length >= 2 && owner.trim().length >= 2 && city.trim().length >= 2;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/shops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, owner, city, category, monthlySales, trend, rent, problem }) });
      const body = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !body.id) throw new Error(body.error ?? "Couldn't make the shop. Please try again.");
      window.location.href = `/?shop=${body.id}&fresh=1`;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="h-dvh overflow-y-auto bg-paper text-ink">
      <div className="mx-auto max-w-xl px-4 pb-10 pt-3">
        <a href="/" className="text-sm font-semibold text-paytm-deep">← Back</a>
        <h1 className="mt-3 text-3xl font-extrabold leading-tight">Make your own shop</h1>
        <p className="mt-1 text-muted">We'll build 6 months of pretend sales for it. Then Rishta decides what to do, just as it does for every other shop.</p>
        <form onSubmit={(e) => void create(e)} className="mt-6 space-y-6">
          <Field label="Shop name" value={name} set={setName} hint="Asha Kirana Store" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your first name" value={owner} set={setOwner} hint="Asha" />
            <Field label="City" value={city} set={setCity} hint="Lucknow" />
          </div>
          <Choice label="What do you sell?" options={CATEGORIES} value={category} set={setCategory} />
          <Choice label="Sales in a month" options={SALES} value={monthlySales} set={setSales} />
          <Choice label="Lately, sales are" options={TRENDS} value={trend} set={setTrend} />
          <Choice label="Soundbox rent a month" options={RENTS.map((r) => [r, `₹${r}`] as const)} value={rent} set={setRent} />
          <fieldset>
            <legend className="mb-1.5 font-semibold">What's going wrong?</legend>
            <div className="space-y-2">
              {PROBLEMS.map(([v, title, sub]) => (
                <button key={v} type="button" aria-pressed={v === problem} onClick={() => setProblem(v)} className={`block w-full rounded-xl border-2 bg-white px-3.5 py-2.5 text-left ${v === problem ? "border-paytm-deep" : "border-line"}`}>
                  <span className="block font-semibold">{title}</span><span className="block text-sm leading-snug text-muted">{sub}</span>
                </button>
              ))}
            </div>
          </fieldset>
          {error && <p role="alert" className="text-callback">{error}</p>}
          <button disabled={!ready || busy} className="btn-primary w-full justify-center py-3 text-base disabled:opacity-50">{busy ? "Rishta is looking at your shop…" : "Open my shop"}</button>
          {!ready && <p className="text-center text-sm text-muted">Add a shop name, your name and city to continue.</p>}
        </form>
      </div>
    </div>
  );
}
