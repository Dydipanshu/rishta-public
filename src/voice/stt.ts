import { SarvamAIClient } from "sarvamai";
import type { Settings } from "../../config/settings.js";

export function makeStt(s: Settings) {
  const sarvam = new SarvamAIClient({ apiSubscriptionKey: s.SARVAM_API_KEY });
  return async (audio: Buffer, contentType: string) => {
    const res = await sarvam.speechToText.transcribe({
      file: { data: audio, filename: "clip.webm", contentType },
      model: s.SARVAM_STT_MODEL as "saaras:v3",
      ...(s.SARVAM_STT_MODEL === "saaras:v3" ? { mode: "codemix" as const } : {}),
    });
    return res.transcript;
  };
}
