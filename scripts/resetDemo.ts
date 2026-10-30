// Resets demo state between rehearsals. Asks a running server first so screens refresh.
import { existsSync } from "node:fs";
import { resetLive } from "../src/data/reset.js";
import { openSql } from "../src/data/sql.js";

if (existsSync(".env")) process.loadEnvFile(".env");
try {
  await fetch(`http://localhost:${process.env.PORT ?? 3000}/api/reset`, { method: "POST", signal: AbortSignal.timeout(2000) });
  console.log("Reset through the running server");
} catch {
  const sql = await openSql();
  await resetLive(sql);
  await sql.close();
  console.log("Reset the database");
}
