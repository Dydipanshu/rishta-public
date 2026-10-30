import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { SarvamAIClient } from "sarvamai";
import type { Settings } from "../../config/settings.js";
import { speakable } from "./speakNumbers.js";

const CACHE_DIR = "data/tts-cache";

export function makeTts(s: Settings) {
  const sarvam = new SarvamAIClient({ apiSubscriptionKey: s.SARVAM_API_KEY });
  mkdirSync(CACHE_DIR, { recursive: true });
  const fileFor = (hash: string) => `${CACHE_DIR}/${hash}.mp3`;
  const hashOf = (spoken: string) => createHash("sha1").update(`${s.SARVAM_TTS_MODEL}|${s.SARVAM_TTS_VOICE}|${spoken}`).digest("hex").slice(0, 20);
  const sign = (text: string) => createHmac("sha256", s.SESSION_SECRET).update(text).digest();

  const open = (text: string) =>
    sarvam.textToSpeech.convertStream({
      text,
      language_code: "hi-IN",
      model: s.SARVAM_TTS_MODEL as "bulbul:v4-flash",
      speaker: s.SARVAM_TTS_VOICE as "aparna_hi_customer",
      enable_preprocessing: true,
      speech_sample_rate: 24000,
      output_audio_codec: "mp3",
    });

  const store = (hash: string, chunks: Buffer[]) => {
    // Written then renamed, so a reader never sees half a file.
    const temp = `${fileFor(hash)}.${process.pid}`;
    writeFileSync(temp, Buffer.concat(chunks));
    renameSync(temp, fileFor(hash));
  };

  return {
    // The signed URL carries the line itself, so any server can play it.
    prepare(text: string) {
      const spoken = speakable(text);
      const t = Buffer.from(spoken).toString("base64url");
      return `/api/tts/${hashOf(spoken)}?t=${t}&s=${sign(spoken).toString("base64url")}`;
    },

    verify(t: string, sig: string) {
      const spoken = Buffer.from(t, "base64url").toString();
      const given = Buffer.from(sig, "base64url");
      const wanted = sign(spoken);
      return given.length === wanted.length && timingSafeEqual(given, wanted) ? spoken : null;
    },

    async prewarm(lines: string[]) {
      for (const line of lines) {
        const spoken = speakable(line);
        const hash = hashOf(spoken);
        if (existsSync(fileFor(hash))) continue;
        const res = await open(spoken);
        const chunks: Buffer[] = [];
        for await (const chunk of res.stream()!) chunks.push(Buffer.from(chunk));
        store(hash, chunks);
      }
    },

    // Streams to the browser while filling the cache.
    async *stream(spoken: string): AsyncGenerator<Buffer> {
      const hash = hashOf(spoken);
      if (existsSync(fileFor(hash))) {
        yield readFileSync(fileFor(hash));
        return;
      }
      const res = await open(spoken);
      const chunks: Buffer[] = [];
      for await (const chunk of res.stream()!) {
        const b = Buffer.from(chunk);
        chunks.push(b);
        yield b;
      }
      store(hash, chunks);
    },
  };
}
