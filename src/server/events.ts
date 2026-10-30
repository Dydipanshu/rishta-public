import type { FastifyReply } from "fastify";

const clients = new Set<FastifyReply>();

export function subscribe(reply: FastifyReply) {
  reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  reply.raw.write(": connected\n\n");
  clients.add(reply);
  reply.raw.on("close", () => clients.delete(reply));
}

export function publish(event: Record<string, unknown>) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) c.raw.write(data);
}
