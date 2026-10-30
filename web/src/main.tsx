import { createRoot } from "react-dom/client";
import "./index.css";
import Console from "./pages/Console";
import MerchantPhone from "./pages/MerchantPhone";

function Demo() {
  return (
    <div className="flex h-screen">
      <iframe title="Merchant" src="/merchant" allow="autoplay; microphone" className="h-full w-[440px] shrink-0 border-0" />
      <iframe title="Console" src="/console" className="h-full flex-1 border-0 border-l border-slate-300" />
    </div>
  );
}

const path = window.location.pathname;
const Page = path.startsWith("/merchant") ? MerchantPhone : path.startsWith("/console") ? Console : Demo;
createRoot(document.getElementById("root")!).render(<Page />);
