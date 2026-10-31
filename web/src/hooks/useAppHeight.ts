import { useEffect, useRef } from "react";

// iPhones slide the keyboard over the page instead of shrinking it, which hides the input.
// This keeps the app sized to what is actually visible.
export function useAppHeight(active: boolean, onChange?: () => void) {
  const changed = useRef(onChange);
  changed.current = onChange;
  useEffect(() => {
    const view = window.visualViewport;
    if (!active || !view) return;
    const root = document.documentElement;
    const sync = () => {
      if (view.scale > 1.01) return;
      root.style.setProperty("--app-h", `${Math.round(view.height)}px`);
      root.style.setProperty("--app-top", `${Math.round(view.offsetTop)}px`);
      root.toggleAttribute("data-keyboard", window.innerHeight - view.height > 120);
      changed.current?.();
    };
    sync();
    view.addEventListener("resize", sync);
    view.addEventListener("scroll", sync);
    return () => {
      view.removeEventListener("resize", sync);
      view.removeEventListener("scroll", sync);
      root.style.removeProperty("--app-h");
      root.style.removeProperty("--app-top");
      root.removeAttribute("data-keyboard");
    };
  }, [active]);
}
