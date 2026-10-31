import { useCallback, useRef, useState } from "react";

export interface Line {
  role: "merchant" | "agent";
  text: string;
}

const TAP_MS = 400;
const MAX_CLIP_MS = 25_000;
const RELEASE_TAIL_MS = 250;
const SILENCE = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTRUoAWgBgkOAGbZHBgG1OF6zM82DWbZaUmMBptgQhGjsyYqc9ae9XFz280948NMBWInljyzsNRFLPWdnZGWrddDsjK1unuSrVN9jJsK8KuQtQCtMBjCEtImISdNKJOopIpBFpNSMbIHCSRpRR5iakjTiyzLhchUUBwCgyKiweBv/7UsQbg8isVNoMPMjAAAA0gAAABEVFGmgqK////9bP/6XCykxBTUUzLjEwMKqqqqqqqqqqqqo=";
const clipType = () => ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));

// Plays URLs one after another; press interrupts.
function useAudioQueue() {
  const queue = useRef<string[]>([]);
  const current = useRef<HTMLAudioElement | null>(null);
  // Phones only allow sound on an element first played from a tap, so one element plays everything.
  const player = useRef<HTMLAudioElement | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const unlock = useCallback(() => {
    if (player.current) return;
    player.current = new Audio(SILENCE);
    void player.current.play().catch(() => undefined);
  }, []);

  const next = useCallback(() => {
    const url = queue.current.shift();
    if (!url) {
      current.current = null;
      setSpeaking(false);
      return;
    }
    const audio = player.current ?? new Audio();
    audio.src = url;
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

  return { push, stop, speaking, unlock };
}

export function usePushToTalk(merchantId: string, onLine: (l: Line) => void, onDone: () => void) {
  const { push, stop, speaking, unlock } = useAudioQueue();
  const [recording, setRecording] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const pressedAt = useRef(0);
  const locked = useRef(false);
  const limit = useRef<ReturnType<typeof setTimeout>>(undefined);
  const busy = useRef(false);

  const readReply = useCallback(async (res: Response) => {
    if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "कुछ गड़बड़ हुई। फिर से कोशिश करें।");
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
    // One turn at a time: a second send would answer out of order.
    if (busy.current) return;
    busy.current = true;
    setThinking(true);
    setError("");
    try {
      await readReply(await fetch(`/api/talk/${merchantId}`, { method: "POST", body, headers }));
    } catch (err) {
      setError((err as Error).message);
    }
    busy.current = false;
    setThinking(false);
  }, [merchantId, readReply]);

  const finish = useCallback(() => {
    const rec = recorder.current;
    clearTimeout(limit.current);
    locked.current = false;
    // A short tail, so the last word isn't cut off when the button comes up.
    if (rec?.state === "recording") setTimeout(() => rec.stop(), RELEASE_TAIL_MS);
    recorder.current = null;
    setRecording(false);
  }, []);

  const start = useCallback(async () => {
    // A tap started this recording, so the next tap sends it.
    if (locked.current) return finish();
    stop();
    unlock();
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia || !clipType()) throw new Error("no mic");
      stream.current ??= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      const type = clipType()!;
      const rec = new MediaRecorder(stream.current, { mimeType: type });
      chunks.current = [];
      rec.ondataavailable = (e) => chunks.current.push(e.data);
      rec.onstop = () => {
        const form = new FormData();
        form.append("audio", new Blob(chunks.current, { type: type.split(";")[0]! }), type.includes("mp4") ? "clip.m4a" : "clip.webm");
        void send(form);
      };
      rec.start();
      pressedAt.current = performance.now();
      recorder.current = rec;
      limit.current = setTimeout(finish, MAX_CLIP_MS);
      setRecording(true);
    } catch {
      setError("माइक नहीं चल रहा। नीचे लिखकर पूछें। Mic isn't available here, please type instead.");
    }
  }, [finish, send, stop, unlock]);

  const release = useCallback(() => {
    // Hold to talk, or tap once to start and again to send.
    if (!recorder.current) return;
    if (performance.now() - pressedAt.current < TAP_MS) {
      locked.current = true;
      return;
    }
    if (!locked.current) finish();
  }, [finish]);

  const sendText = useCallback((text: string) => {
    stop();
    unlock();
    void send(JSON.stringify({ text }), { "Content-Type": "application/json" });
  }, [send, stop]);

  return { start, release, sendText, push, stop, recording, thinking, speaking, error };
}
