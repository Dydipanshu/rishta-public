import { useCallback, useEffect, useRef, useState } from "react";

export interface Line {
  role: "merchant" | "agent";
  text: string;
}

const TAP_MS = 400;
const MAX_CLIP_MS = 25_000;
const RELEASE_TAIL_MS = 250;
const SILENCE = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTRUoAWgBgkOAGbZHBgG1OF6zM82DWbZaUmMBptgQhGjsyYqc9ae9XFz280948NMBWInljyzsNRFLPWdnZGWrddDsjK1unuSrVN9jJsK8KuQtQCtMBjCEtImISdNKJOopIpBFpNSMbIHCSRpRR5iakjTiyzLhchUUBwCgyKiweBv/7UsQbg8isVNoMPMjAAAA0gAAABEVFGmgqK////9bP/6XCykxBTUUzLjEwMKqqqqqqqqqqqqo=";
// Apple devices record mp4 reliably; their webm support is recent.
const apple = /iPhone|iPad|Macintosh/.test(navigator.userAgent) && !/Chrome|CriOS|Android/.test(navigator.userAgent);
const clipType = () => (apple ? ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"] : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]).find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));

// Plays URLs one after another; press interrupts.
function useAudioQueue() {
  const queue = useRef<string[]>([]);
  const current = useRef<HTMLAudioElement | null>(null);
  // Phones only allow sound on an element first played from a tap, so one element plays everything.
  const player = useRef<HTMLAudioElement | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const unlocked = useRef(false);
  const unlock = useCallback(() => {
    if (unlocked.current || current.current) return;
    player.current ??= new Audio();
    player.current.src = SILENCE;
    void player.current.play().then(() => { unlocked.current = true; }, () => undefined);
  }, []);
  // iPhones don't count a finger going down as a tap, only one coming up, so every touch retries until sound is allowed.
  useEffect(() => {
    for (const type of ["touchend", "click", "keydown"]) document.addEventListener(type, unlock, true);
    return () => { for (const type of ["touchend", "click", "keydown"]) document.removeEventListener(type, unlock, true); };
  }, [unlock]);

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

function micProblem(err: unknown) {
  const name = (err as Error).name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return apple
      ? "Mic की इजाज़त नहीं मिली। Safari में address bar के aA, फिर Website Settings, फिर Microphone: Allow करें। तब तक नीचे लिखें।"
      : "Mic की इजाज़त नहीं मिली। Browser settings में Microphone: Allow करें। तब तक नीचे लिखें।";
  }
  if (name === "NotFoundError") return "इस device में mic नहीं मिला। नीचे लिखकर पूछें।";
  if (name === "NotReadableError" || name === "AbortError") return "Mic अभी कोई और app चला रहा है। उसे बंद करें या नीचे लिखें।";
  return "इस browser में mic नहीं चलता। Safari या Chrome में खोलें, या नीचे लिखें।";
}

export function usePushToTalk(merchantId: string, onLine: (l: Line) => void, onDone: () => void) {
  const { push, stop, speaking, unlock } = useAudioQueue();
  const [recording, setRecording] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const pressing = useRef(false);
  const opening = useRef(false);
  const closing = useRef(false);
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

  // Let go of the mic after every clip: an open mic keeps the red bar up and makes an iPhone play replies quietly.
  const closeMic = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const finish = useCallback(() => {
    const rec = recorder.current;
    clearTimeout(limit.current);
    locked.current = false;
    // A short tail, so the last word isn't cut off when the button comes up.
    if (rec?.state === "recording") {
      closing.current = true;
      setTimeout(() => { if (rec.state === "recording") rec.stop(); }, RELEASE_TAIL_MS);
    }
    recorder.current = null;
    setRecording(false);
  }, []);

  const start = useCallback(async () => {
    // A tap started this recording, so the next tap sends it.
    if (recorder.current) return finish();
    if (opening.current || closing.current) return;
    opening.current = true;
    pressing.current = true;
    pressedAt.current = performance.now();
    stop();
    unlock();
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia || !clipType()) throw new Error("no mic");
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      stream.current = mic;
      const type = clipType()!;
      const rec = new MediaRecorder(mic, { mimeType: type });
      const parts: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) parts.push(e.data); };
      rec.onstop = () => {
        closing.current = false;
        // iOS ends the recording itself when the app goes to the background.
        if (recorder.current === rec) {
          clearTimeout(limit.current);
          locked.current = false;
          recorder.current = null;
          setRecording(false);
        }
        closeMic();
        if (parts.length === 0) return setError("आवाज़ रिकॉर्ड नहीं हुई। फिर से बोलें या नीचे लिखें।");
        const actual = (rec.mimeType || type).split(";")[0]!;
        const form = new FormData();
        form.append("audio", new Blob(parts, { type: actual }), actual.includes("mp4") ? "clip.m4a" : "clip.webm");
        void send(form);
      };
      rec.start();
      recorder.current = rec;
      // The finger came up while the mic was opening, or during the permission prompt: carry on as a tap.
      if (!pressing.current) locked.current = true;
      limit.current = setTimeout(finish, MAX_CLIP_MS);
      setRecording(true);
    } catch (err) {
      closeMic();
      setError(micProblem(err));
    }
    opening.current = false;
  }, [closeMic, finish, send, stop, unlock]);

  // Switching app mid-sentence sends what was said; leaving the screen drops it.
  useEffect(() => {
    const hidden = () => { if (document.hidden && recorder.current) finish(); };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      clearTimeout(limit.current);
      const rec = recorder.current;
      recorder.current = null;
      if (rec) rec.onstop = null;
      if (rec?.state === "recording") rec.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };
  }, [finish]);

  const release = useCallback(() => {
    // Hold to talk, or tap once to start and again to send.
    pressing.current = false;
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
