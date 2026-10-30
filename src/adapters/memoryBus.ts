import type { EventBus, Subscription } from "../ports.js";

// Single-process bus for the laptop demo and tests.
export function memoryBus(): EventBus {
  const subs: Subscription[] = [];
  return {
    publish: async (topic, _key, value) => {
      for (const s of subs) if (s.topics.includes(topic)) await s.handler(topic, value);
    },
    subscribe: async (s) => void subs.push(s),
    close: async () => {},
  };
}
