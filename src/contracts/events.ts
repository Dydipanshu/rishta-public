import { z } from "zod";
import { Outcome } from "../engine/brief.js";

export const TOPICS = { outcomes: "rishta.outcomes.v1", outreach: "rishta.outreach.v1", plans: "rishta.plans.v1", ui: "rishta.ui.v1" } as const;

export const OutcomeEvent = z.object({
  id: z.string(),
  type: z.literal("conversation.outcome"),
  version: z.literal(1),
  at: z.string(),
  merchantId: z.string(),
  conversationId: z.string(),
  outcome: Outcome,
});

export const OutreachEvent = z.object({
  id: z.string(),
  type: z.literal("outreach.requested"),
  version: z.literal(1),
  at: z.string(),
  merchantId: z.string(),
  briefId: z.string(),
  channel: z.string(),
});

export const PlanEvent = z.object({
  id: z.string(),
  type: z.literal("plan.ready"),
  version: z.literal(1),
  at: z.string(),
  plan: z.record(z.string(), z.unknown()),
});
