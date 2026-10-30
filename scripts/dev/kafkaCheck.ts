// Proves the adapter against a real broker: broadcast reaches every server, a group shares work.
import { kafkaBus } from "../../src/adapters/kafkaBus.js";

const topics = [`rishta.check.${Date.now()}`];
const [topic] = topics as [string];
const brokers = ["localhost:19092"];
const a = await kafkaBus(brokers, topics, 3);
const b = await kafkaBus(brokers, topics, 3);
const broadcast = [0, 0];
const group = [0, 0];
await a.subscribe({ topics, handler: async () => void broadcast[0]!++ });
await b.subscribe({ topics, handler: async () => void broadcast[1]!++ });
await a.subscribe({ topics, group: "check", handler: async () => void group[0]!++ });
await b.subscribe({ topics, group: "check", handler: async () => void group[1]!++ });
await new Promise((r) => setTimeout(r, 8000));
for (let i = 0; i < 10; i++) await a.publish(topic, `m${i}`, `{"n":${i}}`);
await new Promise((r) => setTimeout(r, 4000));
await a.close();
await b.close();
const shared = group[0]! + group[1]!;
console.log(`Broadcast ${broadcast.join("/")} (want 10/10). Group ${group.join("+")}=${shared} (want 10).`);
console.log(broadcast[0] === 10 && broadcast[1] === 10 && shared === 10 ? "PASS" : "FAIL");
process.exit(broadcast[0] === 10 && broadcast[1] === 10 && shared === 10 ? 0 : 1);
