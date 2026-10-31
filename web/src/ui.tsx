import { useEffect, useState, type ReactNode } from "react";

const PATHS: Record<string, string> = {
  overview: "M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  shop: "M4 10v10h16V10M3 10l2-6h14l2 6H3Zm6 10v-6h6v6",
  talk: "M4 5h16v11H9l-5 4V5Z",
  proof: "M4 20V10m6 10V4m6 16v-7m5 7H3",
  why: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5v.01M12 13c0-2 3-2 3-4.5A3 3 0 0 0 9.2 8",
  team: "M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1m6.5-9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 20v-1a4 4 0 0 0-3-3.9M15 4.2a3.5 3.5 0 0 1 0 6.6",
  phone: "M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm4 15h2",
  search: "m20 20-4-4m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
  check: "m5 12 5 5 9-10",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  back: "M19 12H5m6-6-6 6 6 6",
  reset: "M4 4v6h6M5 16a8 8 0 1 0-.5-7L4 10",
  shield: "M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z",
};

export const Icon = ({ name, size = 18, className = "" }: { name: keyof typeof PATHS | string; size?: number; className?: string }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden><path d={PATHS[name]} /></svg>
);

export const Card = ({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={`card ${className}`}>
    {title && <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3"><h2 className="text-[0.95rem] font-semibold text-ink">{title}</h2>{action}</header>}
    <div className={title ? "p-4" : "p-4"}>{children}</div>
  </section>
);

export const Stat = ({ value, label, hint, tone }: { value: ReactNode; label: string; hint?: string; tone?: "good" | "brand" }) => (
  <div className="card px-4 py-3.5">
    <div className="text-sm text-muted">{label}</div>
    <div className={`num mt-0.5 text-[1.7rem] font-bold leading-tight ${tone === "good" ? "text-kept" : tone === "brand" ? "text-paytm-deep" : "text-ink"}`}>{value}</div>
    {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
  </div>
);

const TONES = { good: "bg-kept/10 text-kept", bad: "bg-callback/10 text-callback", warn: "bg-leftalone/15 text-sim", brand: "bg-paytm/15 text-paytm-deep", plain: "bg-idle text-muted" } as const;
export type Tone = keyof typeof TONES;
export const Pill = ({ tone = "plain", children }: { tone?: Tone; children: ReactNode }) => <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${TONES[tone]}`}>{children}</span>;

export const PageHead = ({ eyebrow, title, sub, action }: { eyebrow?: ReactNode; title: ReactNode; sub?: ReactNode; action?: ReactNode }) => (
  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
    <div className="max-w-3xl">
      {eyebrow && <div className="text-sm font-medium text-paytm-deep">{eyebrow}</div>}
      <h1 className="text-[1.5rem] font-bold leading-[1.2] text-ink">{title}</h1>
      {sub && <p className="mt-1 text-muted">{sub}</p>}
    </div>
    {action}
  </div>
);

export const SimTag = () => <Pill tone="warn">Simulated</Pill>;
export const Skeleton = ({ h = 96 }: { h?: number }) => <div className="skeleton rounded-xl" style={{ height: h }} />;
export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="py-6 text-center"><div className="font-semibold text-ink">{title}</div>{children && <div className="mt-0.5 text-sm text-muted">{children}</div>}</div>
);

// True below the laptop layout. The phone gets its own screens, not a squeezed desktop.
export const useNarrow = (width = 1023) => {
  const media = `(max-width: ${width}px)`;
  const [narrow, setNarrow] = useState(() => matchMedia(media).matches);
  useEffect(() => {
    const q = matchMedia(media);
    const on = () => setNarrow(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, [media]);
  return narrow;
};

const ROLES = [["shop", "Shopkeeper"], ["sales", "Salesperson"], ["manager", "Manager"]] as const;
const lastShop = () => {
  try {
    const id = localStorage.getItem("rishta-shop");
    return id ? `/?shop=${id}` : "/#shops";
  } catch {
    return "/#shops";
  }
};
// The same shops seen from three chairs. Switching keeps everything this visitor has done.
export const RoleTabs = ({ on }: { on?: (typeof ROLES)[number][0] }) => (
  <nav aria-label="Switch view" className="grid grid-cols-3 gap-1 rounded-xl bg-idle p-1 text-center text-sm font-semibold">
    {ROLES.map(([key, label]) => <a key={key} aria-current={on === key ? "page" : undefined} href={key === "shop" ? lastShop() : key === "sales" ? "/sales" : "/demo/today"} className={`rounded-lg px-3 py-1.5 ${on === key ? "bg-white text-ink shadow-sm" : "text-muted"}`}>{label}</a>)}
  </nav>
);
