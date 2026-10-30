import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";

export type LLMItem = OpenAI.Responses.ResponseInputItem;

export interface LLMTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMCall {
  callId: string;
  name: string;
  args: string;
}

export type LLMEvent =
  | { type: "text"; delta: string }
  | { type: "done"; items: LLMItem[]; calls: LLMCall[] };

// The only place that knows about OpenAI, so Paytm can swap in its own models.
export interface LLMAdapter {
  turn(req: { instructions: string; input: LLMItem[]; tools: LLMTool[] }): AsyncIterable<LLMEvent>;
  extract<T extends z.ZodType>(req: { instructions: string; text: string; schema: T; name: string }): Promise<z.infer<T>>;
}

export function openAIAdapter(apiKey: string, model: string, effort: "none" | "low" | "medium"): LLMAdapter {
  const client = new OpenAI({ apiKey });
  return {
    async *turn({ instructions, input, tools }) {
      const stream = await client.responses.create({
        model,
        instructions,
        input,
        tools: tools.map((t) => ({ type: "function" as const, strict: true, ...t })),
        reasoning: { effort },
        stream: true,
        store: false,
      });
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") yield { type: "text", delta: event.delta };
        if (event.type === "response.completed") {
          const output = event.response.output.filter((o) => o.type === "message" || o.type === "function_call");
          const calls = output.flatMap((o) => (o.type === "function_call" ? [{ callId: o.call_id, name: o.name, args: o.arguments }] : []));
          yield { type: "done", items: output as LLMItem[], calls };
        }
      }
    },
    async extract<T extends z.ZodType>({ instructions, text, schema, name }: { instructions: string; text: string; schema: T; name: string }) {
      const res = await client.responses.parse({
        model,
        instructions,
        input: text,
        reasoning: { effort },
        store: false,
        text: { format: zodTextFormat(schema as never, name) },
      });
      if (res.output_parsed === null) throw new Error("Extraction returned nothing");
      return res.output_parsed as z.infer<T>;
    },
  };
}
