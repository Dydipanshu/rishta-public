import "@fontsource/mukta/400.css";
import "@fontsource/mukta/500.css";
import "@fontsource/mukta/600.css";
import "@fontsource/mukta/700.css";
import "@fontsource/mukta/800.css";
import "@fontsource/ibm-plex-mono/500.css";
import { createRoot } from "react-dom/client";
import "./index.css";
import Flow from "./pages/Flow";
import MerchantPhone from "./pages/MerchantPhone";
import Sales from "./pages/Sales";
import Voices from "./pages/Voices";

const path = window.location.pathname;
const Page = path.startsWith("/phone/") ? MerchantPhone : path.startsWith("/sales") ? Sales : path.startsWith("/voices") ? Voices : Flow;
createRoot(document.getElementById("root")!).render(<Page />);
