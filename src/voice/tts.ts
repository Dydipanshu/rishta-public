import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SarvamAIClient } from "sarvamai";
import type { Settings } from "../../config/settings.js";
import { speakable } from "./speakNumbers.js";

const CACHE_DIR = "data/tts-cache";

export function makeTts(s: Settings) {
  const sarvam = new SarvamAIClient({ apiSubscriptionKey: s.SARVAM_API_KEY });
  const pending = new Map<string, string>();
  mkdirSync(CACHE_DIR, { recursive: true });
  const fileFor = (hash: string) => `${CACHE_DIR}/${hash}.mp3`;

  const open = (text: string) =>
    sarvam.textToSpeech.convertStream({
      text,
      language_code: "hi-IN",
      model: s.SARVAM_TTS_MODEL as "bulbul:v3",
      speaker: s.SARVAM_TTS_VOICE as "priya",
      output_audio_codec: "mp3",
    });

  return {
    // Registers a line and returns the URL that will play it.
    prepare(text: string) {
      const spoken = speakable(text);
      const hash = createHash("sha1").update(`${s.SARVAM_TTS_MODEL}|${s.SARVAM_TTS_VOICE}|${spoken}`).digest("hex").slice(0, 20);
      if (!existsSync(fileFor(hash))) pending.set(hash, spoken);
      return `/api/tts/${hash}`;
    },

    async prewarm(lines: string[]) {
      for (const line of lines) {
        const url = this.prepare(line);
        const hash = url.split("/").pop()!;
        const spoken = pending.get(hash);
        if (!spoken) continue;
        const res = await open(spoken);
        const chunks: Buffer[] = [];
        for await (const chunk of res.stream()!) chunks.push(Buffer.from(chunk));
        writeFileSync(fileFor(hash), Buffer.concat(chunks));
        pending.delete(hash);
      }
    },

    // Streams to the browser while filling the cache.
    async *stream(hash: string): AsyncGenerator<Buffer> {
      if (existsSync(fileFor(hash))) {
        yield readFileSync(fileFor(hash));
        return;
      }
      const spoken = pending.get(hash);
      if (!spoken) throw new Error("Unknown audio");
      const res = await open(spoken);
      const chunks: Buffer[] = [];
      for await (const chunk of res.stream()!) {
        const b = Buffer.from(chunk);
        chunks.push(b);
        yield b;
      }
      writeFileSync(fileFor(hash), Buffer.concat(chunks));
      pending.delete(hash);
    },
  };
}
