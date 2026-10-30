import { z } from "zod";
import { OutcomeEvent, OutreachEvent, PlanEvent } from "../contracts/events.js";
import { Brief, Outcome } from "../engine/brief.js";

export const contractSchemas = () => ({
  Brief: z.toJSONSchema(Brief, { target: "draft-7", io: "input" }),
  Outcome: z.toJSONSchema(Outcome, { target: "draft-7", io: "input" }),
  OutcomeEvent: z.toJSONSchema(OutcomeEvent, { target: "draft-7", io: "input" }),
  OutreachEvent: z.toJSONSchema(OutreachEvent, { target: "draft-7", io: "input" }),
  PlanEvent: z.toJSONSchema(PlanEvent, { target: "draft-7", io: "input" }),
});

const ref = (name: string) => ({ content: { "application/json": { schema: { $ref: `#/components/schemas/${name}` } } } });

export const openapi = () => ({
  openapi: "3.1.0",
  info: { title: "Rishta", version: "1.0.0", description: "The contract any agent or channel uses to plug into Rishta." },
  security: [{ apiKey: [] }],
  components: { securitySchemes: { apiKey: { type: "http", scheme: "bearer" } }, schemas: contractSchemas() },
  paths: {
    "/v1/briefs": {
      get: {
        summary: "Today's briefs, one page at a time",
        parameters: [
          { name: "channel", in: "query", schema: { type: "string" } },
          { name: "after", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", maximum: 500 } },
        ],
        responses: { 200: { description: "A page of briefs and the next cursor" } },
      },
    },
    "/v1/briefs/{merchantId}": {
      get: { summary: "One merchant's brief", parameters: [{ name: "merchantId", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "Brief", ...ref("Brief") }, 404: { description: "Nothing planned today" } } },
    },
    "/v1/settle": {
      post: { summary: "Count live contacts that reached 30 days and update the playbook", responses: { "200": { description: "What was counted" } } },
    },
    "/v1/outcomes": {
      post: { summary: "Report how a conversation ended. Safe to retry.", requestBody: { required: true, ...ref("Outcome") }, responses: { 200: { description: "Recorded" }, 404: { description: "Unknown brief" } } },
    },
    "/v1/outreach/{merchantId}": {
      post: { summary: "Send today's nudge, after consent and contact-hour checks", parameters: [{ name: "merchantId", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "Queued" }, 409: { description: "Blocked by a guardrail" } } },
    },
    "/v1/sessions": {
      post: { summary: "Mint a short-lived merchant token after Paytm login", responses: { 200: { description: "Token" } } },
    },
  },
});
