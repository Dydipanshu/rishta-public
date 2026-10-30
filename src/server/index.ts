import { startRelay } from "../data/outbox.js";
import { compose } from "../compose.js";
import { buildApp } from "./app.js";

const deps = await compose();
const { s, sql, bus } = deps;
const relay = startRelay(sql, bus, (err) => app.log.error(err, "event relay failed"));
const { app, prewarm, sweep, closeScreens } = await buildApp({ ...deps, kickRelay: relay.kick });

await app.listen({ port: s.PORT, host: "0.0.0.0" });
app.log.info(`Rishta on http://localhost:${s.PORT}  (/demo, /merchant, /console)`);

prewarm().then(() => app.log.info("Fixed lines cached")).catch((err) => app.log.error(err, "Could not cache fixed lines"));
const sweeper = setInterval(() => void sweep().catch((err) => app.log.error(err, "sweep failed")), 60_000);

// On a rolling update: finish current turns, then leave. Conversations continue on another server.
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  clearInterval(sweeper);
  relay.stop();
  closeScreens();
  await app.close();
  await bus.close();
  await sql.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
