import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { benchCore } from "../src/adapters/benchCore.js";
import { memoryBus } from "../src/adapters/memoryBus.js";
import { detectProblem } from "../src/models/problems.js";
import { buildFeatures } from "../src/features/buildFeatures.js";
import { openSql } from "../src/data/sql.js";
import { saveShop } from "../src/data/store.js";
import { routedSql, visitorPool, visitorScope, type VisitorPool } from "../src/data/visitors.js";
import { planShop } from "../src/engine/dailyRun.js";
import { CustomShop, buildCustomShop } from "../src/sim/customShop.js";
import { TODAY } from "../src/sim/types.js";

const dir = "data/test-visitors";
let pool: VisitorPool;
const base = await openSql("data/rishta.db");
const sql = routedSql(base);
const core = benchCore(sql);
const as = async <T>(id: string, fn: () => Promise<T>) => visitorScope.run(await pool.enter(id), fn);
const A = "a".repeat(32), B = "b".repeat(32);
const shop = (problem: string, extra = {}) => CustomShop.parse({ name: "Test Kirana 99", owner: "Asha Rao", city: "Lucknow", category: "kirana", monthlySales: 60000, trend: "steady", rent: 149, problem, ...extra });

beforeAll(async () => {
  pool = await visitorPool({ dir, template: "data/visitor-template.db", days: "data/bench-days.db", bus: memoryBus(), onError: (e) => { throw e; } });
});
afterAll(async () => {
  await pool.close();
  await base.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("private copies", () => {
  it("reads the shared history for any bench shop", async () => {
    const m = await as(A, () => core.merchant("M001"));
    expect(m.days[TODAY]!.value).toBe(14250);
    expect(m.days.length).toBe(180);
  });
  it("keeps one visitor's writes away from another and from the bench", async () => {
    await as(A, () => core.raiseTicket("M001", "device", "only for A"));
    const count = () => sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM tickets WHERE note = 'only for A'");
    expect((await as(A, count))?.n).toBe(1);
    expect((await as(B, count))?.n).toBe(0);
    expect((await count())?.n).toBe(0);
  });
  it("delivers relay jobs only for visitors who are here", async () => {
    const seen: string[] = [];
    await as(A, async () => {});
    await pool.each(async () => { seen.push(visitorScope.getStore()!.id); });
    expect(seen.sort()).toEqual([A, B]);
  });
  it("forgets idle visitors", async () => {
    const C = "c".repeat(32);
    await as(C, async () => {});
    await pool.expire(Date.now() + 7 * 3_600_000);
    expect(pool.knows(C)).toBe(false);
  });
});

describe("a shop the visitor makes", () => {
  it("strips digits and odd characters from names", () => {
    expect(shop("none").name).toBe("Test Kirana");
    expect(() => CustomShop.parse({ ...shop("none"), name: "<>" })).toThrow();
  });
  it("gets the fee only above ₹1 lakh a month", () => {
    expect(buildCustomShop("MY1", shop("none"), 7).days[TODAY]!.fee).toBe(0);
    const paying = buildCustomShop("MY1", shop("fee"), 7);
    expect(paying.feeCategory).toBe("P2M");
    expect(paying.days[TODAY]!.fee).toBeGreaterThan(0);
  });
  it.each([["device", "device_fault"], ["settlement", "settlement_delay"], ["fee", "fee_confusion"], ["rent", "rent_too_high"]])("%s shows up as %s", (problem, code) => {
    const m = buildCustomShop("MY1", shop(problem, problem === "rent" ? { monthlySales: 6000 } : {}), 7);
    expect(detectProblem(buildFeatures(m, TODAY))?.problem).toBe(code);
  });
  it("gets a decision from the same engine", async () => {
    const m = buildCustomShop("MY001", shop("device"), 7);
    await as(B, async () => {
      await saveShop(sql, m);
      await planShop(sql, core, 7, m.id);
      const loaded = await core.merchant(m.id);
      expect(loaded.days.length).toBe(180);
      const row = await sql.get<{ n: number }>("SELECT (SELECT COUNT(*) FROM briefs WHERE merchant_id = ?) + (SELECT COUNT(*) FROM left_alone WHERE merchant_id = ?) AS n", [m.id, m.id]);
      expect(row?.n).toBe(1);
    });
  });
});
