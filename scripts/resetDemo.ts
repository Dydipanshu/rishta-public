// Resets demo state between rehearsals. Asks a running server first so screens refresh.
import { loadSettings } from "../config/settings.js";
import { openDb } from "../src/server/db.js";
import { resetLive } from "../src/server/reset.js";

const s = loadSettings();
try {
  await fetch(`http://localhost:${s.PORT}/api/reset`, { method: "POST", signal: AbortSignal.timeout(2000) });
  console.log("Reset through the running server");
} catch {
  resetLive(openDb());
  console.log("Reset the database");
}
