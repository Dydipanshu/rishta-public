import { beforeAll, describe, expect, it } from "vitest";
import { feeOn } from "../config/fees.js";
import { eligiblePlans } from "../config/plans.js";
import { learnedSkips, ruleSkips } from "../src/engine/leaveAlone.js";
import { addResult, allocation, type Stats } from "../src/engine/playbook.js";
import { openSql, type Sql } from "../src/data/sql.js";
import { makeRng } from "../src/sim/rng.js";

describe("fees", () => {
  it("matches the demo figures", () => expect(feeOn(9500)).toEqual({ fee: 38, gst: 6.84, total: 44.84 }));
  it("only offers cheaper plans within budget", () => expect(eligiblePlans(149, 50).map((p) => p.monthlyRent)).toEqual([129, 99]));
});

describe("playbook", () => {
  it("shifts traffic to the winner but keeps exploring", () => {
    const stats: Stats = new Map();
    for (let i = 0; i < 100; i++) {
      addResult(stats, "device_fault", "device_ticket_first", "T1-food", i < 75);
      addResult(stats, "device_fault", "device_troubleshoot_first", "T1-food", i < 35);
    }
    const [win, lose] = allocation(stats, "device_fault", "T1-food", makeRng(1));
    expect(win!.share).toBeGreaterThan(0.8);
    expect(lose!.share).toBeGreaterThanOrEqual(0.1);
  });
});

describe("leave alone", () => {
  const rows = (arm: "contacted" | "holdout", kept: number, lost: number) => [
    ...Array.from({ length: kept }, () => ({ segment: "X", arm, kept: 1 })),
    ...Array.from({ length: lost }, () => ({ segment: "X", arm, kept: 0 })),
  ];
  it("needs enough holdout data", () => expect(learnedSkips([...rows("contacted", 10, 30), ...rows("holdout", 8, 2)])[0]!.skip).toBe(false));
  it("skips a clearly harmed segment", () => expect(learnedSkips([...rows("contacted", 10, 30), ...rows("holdout", 16, 4)])[0]!.skip).toBe(true));
  it("explains rule skips", () => {
    const m = { optedOut: false, consentMessages: true, consentProfiling: true, lastContactDay: 177, monthlyCollections: 50000 };
    expect(ruleSkips(m, 179)).toEqual(["Contacted 2 days ago"]);
  });
});

describe("demo plan (needs pnpm seed)", () => {
  let db: Sql;
  const brief = async (id: string) => JSON.parse((await db.get<{ json: string }>("SELECT json FROM briefs WHERE merchant_id = ?", [id]))!.json);
  beforeAll(async () => { db = await openSql(); });

  it.each([
    ["M001", "fee_own_numbers", "soundbox"],
    ["M002", "device_ticket_first", "app"],
    ["M003", "human_callback", "human_callback"],
    ["M004", "rent_right_size_plan", "soundbox"],
    ["M005", "fee_threshold_headsup", "app"],
  ])("%s gets %s via %s", async (id, approach, channel) => {
    const b = await brief(id);
    expect(b.approachId).toBe(approach);
    expect(b.channel).toBe(channel);
  });

  it("has Ramesh's exact figures", async () => {
    const f = (await brief("M001")).facts;
    expect([f.paymentsAbove2000Count, f.paymentsAbove2000TotalInr, f.feeInr, f.gstInr, f.feePlusGstInr]).toEqual([4, 9500, 38, 6.84, 44.84]);
  });

  it("leaves Fresh Fruits Corner alone for both reasons", async () => {
    const row = (await db.get<{ kind: string; reasons: string }>("SELECT kind, reasons FROM left_alone WHERE merchant_id = 'M006'"))!;
    expect(row.kind).toBe("rule + learned");
    expect(JSON.parse(row.reasons)).toHaveLength(2);
  });
});
