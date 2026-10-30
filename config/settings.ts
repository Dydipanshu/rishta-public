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
  APP_ENV: z.enum(["demo", "production"]).default("demo"),
  DATABASE_URL: z.string().optional(),
  DB_POOL_SIZE: z.coerce.number().int().default(20),
  KAFKA_BROKERS: z.string().optional(),
  KAFKA_PARTITIONS: z.coerce.number().int().default(12),
  OPENAI_BASE_URL: z.string().optional(),
  OUTREACH_ENABLED: z.stringbool().default(true),
  RISHTA_API_KEY: z.string().default("demo-key"),
  SESSION_SECRET: z.string().default("demo-secret"),
  LOG_LEVEL: z.string().default("info"),
}).refine(
  (s) => s.APP_ENV !== "production" || (s.RISHTA_API_KEY !== "demo-key" && s.SESSION_SECRET.length >= 32 && !!s.DATABASE_URL?.startsWith("postgres") && !!s.KAFKA_BROKERS),
  { message: "production needs RISHTA_API_KEY, a 32+ character SESSION_SECRET, Postgres and Kafka" },
);

export type Settings = z.infer<typeof schema>;

export function loadSettings(): Settings {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Bad .env settings:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
