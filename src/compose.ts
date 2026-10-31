import { loadSettings } from "../config/settings.js";
import { benchCore } from "./adapters/benchCore.js";
import { benchGateway } from "./adapters/benchGateway.js";
import { kafkaBus } from "./adapters/kafkaBus.js";
import { memoryBus } from "./adapters/memoryBus.js";
import { openAIAdapter } from "./agent/llmAdapter.js";
import { TOPICS } from "./contracts/events.js";
import { openSql } from "./data/sql.js";
import { routedSql, visitorPool } from "./data/visitors.js";
import { makeStt } from "./voice/stt.js";
import { makeTranslate } from "./voice/translate.js";
import { makeTts } from "./voice/tts.js";

// The only file that picks implementations. Plugging Rishta in elsewhere means changing this list.
export async function compose() {
  const s = loadSettings();
  const base = await openSql(s.DATABASE_URL, s.DB_POOL_SIZE);
  const sql = s.PUBLIC_SITE ? routedSql(base) : base;
  const bus = s.KAFKA_BROKERS ? await kafkaBus(s.KAFKA_BROKERS.split(","), Object.values(TOPICS), s.KAFKA_PARTITIONS) : memoryBus();
  return {
    s,
    sql,
    bus,
    visitors: s.PUBLIC_SITE
      ? await visitorPool({ dir: s.VISITOR_DIR, template: "data/visitor-template.db", days: "data/bench-days.db", bus, onError: (err) => console.error("visitor relay failed", err) })
      : undefined,
    core: benchCore(sql),
    gateway: benchGateway(bus),
    llm: openAIAdapter(s.OPENAI_API_KEY, s.OPENAI_MODEL, s.OPENAI_REASONING_EFFORT, s.OPENAI_BASE_URL),
    stt: makeStt(s),
    translate: makeTranslate(s),
    tts: makeTts(s),
  };
}
