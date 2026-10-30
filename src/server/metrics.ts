import { Counter, Histogram, Registry, collectDefaultMetrics } from "@prometheus-io/client";

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const metrics = {
  firstReply: new Histogram({ name: "rishta_first_reply_ms", help: "Merchant stops talking to first agent line", buckets: [500, 1000, 1500, 2500, 4000, 6000, 10000], registers: [registry] }),
  turns: new Counter({ name: "rishta_turns_total", help: "Conversation turns", labelNames: ["result"], registers: [registry] }),
  outcomes: new Counter({ name: "rishta_outcomes_total", help: "Conversations finished", labelNames: ["outcome"], registers: [registry] }),
  outreach: new Counter({ name: "rishta_outreach_total", help: "Outreach requests", labelNames: ["result"], registers: [registry] }),
};
