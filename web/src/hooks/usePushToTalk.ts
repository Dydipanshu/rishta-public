import { useCallback, useRef, useState } from "react";

export interface Line {
  role: "merchant" | "agent";
  text: string;
}

const MIN_HOLD_MS = 500;
const RELEASE_TAIL_MS = 250;

// Plays URLs one after another; press interrupts.
function useAudioQueue() {
  const queue = useRef<string[]>([]);
  const current = useRef<HTMLAudioElement | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const next = useCallback(() => {
    const url = queue.current.shift();
    if (!url) {
      current.current = null;
      setSpeaking(false);
      return;
    }
    const audio = new Audio(url);
    current.current = audio;
    setSpeaking(true);
    audio.onended = next;
    audio.onerror = next;
    audio.play().catch(next);
  }, []);

  const push = useCallback((url: string) => {
    queue.current.push(url);
    if (!current.current) next();
  }, [next]);

  const stop = useCallback(() => {
    queue.current = [];
    current.current?.pause();
    current.current = null;
    setSpeaking(false);
  }, []);

  return { push, stop, speaking };
}

export function usePushToTalk(merchantId: string, onLine: (l: Line) => void, onDone: () => void) {
  const { push, stop, speaking } = useAudioQueue();
  const [recording, setRecording] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const pressedAt = useRef(0);

  const readReply = useCallback(async (res: Response) => {
    if (!res.ok || !res.body) throw new Error("No brief for this merchant");
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        const e = JSON.parse(line) as { type: string; text?: string; audio?: string; filler?: boolean; message?: string };
        if (e.type === "transcript") onLine({ role: "merchant", text: e.text ?? "" });
        if (e.type === "say") {
          if (!e.filler) onLine({ role: "agent", text: e.text ?? "" });
          push(e.audio!);
        }
        if (e.type === "error") setError(e.message ?? "Something went wrong");
      }
    }
    onDone();
  }, [onLine, onDone, push]);

  const send = useCallback(async (body: BodyInit, headers?: HeadersInit) => {
    setThinking(true);
    setError("");
    try {
      await readReply(await fetch(`/api/talk/${merchantId}`, { method: "POST", body, headers }));
    } catch (err) {
      setError((err as Error).message);
    }
    setThinking(false);
  }, [merchantId, readReply]);

  const start = useCallback(async () => {
    stop();
    setError("");
    try {
      stream.current ??= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      const rec = new MediaRecorder(stream.current, { mimeType: "audio/webm" });
      chunks.current = [];
      rec.ondataavailable = (e) => chunks.current.push(e.data);
      rec.onstop = () => {
        if (performance.now() - pressedAt.current < MIN_HOLD_MS) {
          setError("बटन दबाकर रखें, फिर बोलें।");
          return;
        }
        const form = new FormData();
        form.append("audio", new Blob(chunks.current, { type: "audio/webm" }), "clip.webm");
        void send(form);
      };
      rec.start();
      pressedAt.current = performance.now();
      recorder.current = rec;
      setRecording(true);
    } catch {
      setError("Microphone not available. Use the text box.");
    }
  }, [send, stop]);

  const release = useCallback(() => {
    // A short tail, so the last word isn't cut off when the button comes up.
    const rec = recorder.current;
    if (rec?.state === "recording") setTimeout(() => rec.stop(), RELEASE_TAIL_MS);
    recorder.current = null;
    setRecording(false);
  }, []);

  const sendText = useCallback((text: string) => {
    stop();
    void send(JSON.stringify({ text }), { "Content-Type": "application/json" });
  }, [send, stop]);

  return { start, release, sendText, push, stop, recording, thinking, speaking, error };
}
