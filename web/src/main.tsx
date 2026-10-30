import "@fontsource/mukta/400.css";
import "@fontsource/mukta/500.css";
import "@fontsource/mukta/600.css";
import "@fontsource/mukta/700.css";
import "@fontsource/mukta/800.css";
import "@fontsource/ibm-plex-mono/500.css";
import { createRoot } from "react-dom/client";
import "./index.css";
import Console from "./pages/Console";
import MerchantPhone from "./pages/MerchantPhone";
import Sales from "./pages/Sales";
import Voices from "./pages/Voices";

function Demo() {
  return (
    <div className="flex h-screen bg-[#e6eef6]">
      <iframe title="Shopkeeper's phone" src="/merchant" allow="autoplay; microphone" className="h-full w-[410px] shrink-0 border-0" />
      <iframe title="Rishta console" src="/console" className="h-full min-w-0 flex-1 border-0 border-l border-line" />
    </div>
  );
}

const path = window.location.pathname;
const Page = path.startsWith("/merchant") || path.startsWith("/phone") ? MerchantPhone : path.startsWith("/console") ? Console : path.startsWith("/sales") ? Sales : path.startsWith("/voices") ? Voices : Demo;
createRoot(document.getElementById("root")!).render(<Page />);
