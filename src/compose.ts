import { loadSettings } from "../config/settings.js";
import { benchCore } from "./adapters/benchCore.js";
import { benchGateway } from "./adapters/benchGateway.js";
import { kafkaBus } from "./adapters/kafkaBus.js";
import { memoryBus } from "./adapters/memoryBus.js";
import { openAIAdapter } from "./agent/llmAdapter.js";
import { TOPICS } from "./contracts/events.js";
import { openSql } from "./data/sql.js";
import { makeStt } from "./voice/stt.js";
import { makeTts } from "./voice/tts.js";

// The only file that picks implementations. Plugging Rishta in elsewhere means changing this list.
export async function compose() {
  const s = loadSettings();
  const sql = await openSql(s.DATABASE_URL, s.DB_POOL_SIZE);
  const bus = s.KAFKA_BROKERS ? await kafkaBus(s.KAFKA_BROKERS.split(","), Object.values(TOPICS), s.KAFKA_PARTITIONS) : memoryBus();
  return {
    s,
    sql,
    bus,
    core: benchCore(sql),
    gateway: benchGateway(bus),
    llm: openAIAdapter(s.OPENAI_API_KEY, s.OPENAI_MODEL, s.OPENAI_REASONING_EFFORT, s.OPENAI_BASE_URL),
    stt: makeStt(s),
    tts: makeTts(s),
  };
}
