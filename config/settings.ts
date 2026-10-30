import { existsSync } from "node:fs";
import { z } from "zod";

if (existsSync(".env")) process.loadEnvFile(".env");

const schema = z.object({
  SARVAM_API_KEY: z.string("missing: add it to .env").min(1, "missing: add it to .env"),
  OPENAI_API_KEY: z.string("missing: add it to .env").min(1, "missing: add it to .env"),
  OPENAI_MODEL: z.string("missing: add it to .env").min(1, "missing: add it to .env"),
  SARVAM_STT_MODEL: z.string().default("saaras:v3"),
  SARVAM_TTS_MODEL: z.string().default("bulbul:v3"),
  SARVAM_TTS_VOICE: z.string().default("priya"),
  FEE_START_DATE: z.iso.date().default("2026-11-15"),
  DEMO_SEED: z.coerce.number().int().default(7),
  HOLDOUT_SHARE: z.coerce.number().min(0).max(0.5).default(0.15),
  OPENAI_REASONING_EFFORT: z.enum(["none", "low", "medium"]).default("none"),
  PORT: z.coerce.number().int().default(3000),
});

export type Settings = z.infer<typeof schema>;

export function loadSettings(): Settings {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Bad .env settings:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
