import { useEffect, useRef } from "react";

export interface ServerEvent {
  type: "changed" | "nudge" | "reset";
  merchantId?: string;
  channel?: string;
  card?: string;
  lines?: { text: string; audio: string }[];
}

export function useEvents(onEvent: (e: ServerEvent) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (m) => handler.current(JSON.parse(m.data) as ServerEvent);
    return () => source.close();
  }, []);
}
