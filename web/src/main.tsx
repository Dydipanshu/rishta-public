import "@fontsource/mukta/400.css";
import "@fontsource/mukta/500.css";
import "@fontsource/mukta/600.css";
import "@fontsource/mukta/700.css";
import "@fontsource/mukta/800.css";
import "@fontsource/ibm-plex-mono/500.css";
import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import Flow from "./pages/Flow";
import Home from "./pages/Home";
import Live from "./pages/Live";
import MerchantPhone from "./pages/MerchantPhone";
import NewShop from "./pages/NewShop";
import Sales from "./pages/Sales";
import Voices from "./pages/Voices";

// A crash shows a way back, never a white page.
class Guard extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError = () => ({ failed: true });
  override render() {
    if (!this.state.failed) return this.props.children;
    return <div className="flex h-dvh items-center justify-center p-8 text-center"><div><p className="text-xl font-bold">Something went wrong.</p><a href="/" className="mt-3 inline-block font-semibold text-paytm-deep">Start again</a></div></div>;
  }
}

const path = window.location.pathname;
const shopChosen = new URLSearchParams(window.location.search).has("shop");
const Page = path.startsWith("/phone/") ? MerchantPhone : path.startsWith("/sales") ? Sales : path.startsWith("/voices") ? Voices : path.startsWith("/demo") ? Flow : path.startsWith("/new") ? NewShop : shopChosen ? Live : Home;

// The first call gives this browser its private copy, before screens ask for data side by side.
const show = () => createRoot(document.getElementById("root")!).render(<Guard><Page /></Guard>);
void fetch("/api/site").then(show, show);
