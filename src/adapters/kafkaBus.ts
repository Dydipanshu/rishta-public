import { randomUUID } from "node:crypto";
import { Kafka, Partitioners, logLevel, type Consumer } from "kafkajs";
import type { EventBus } from "../ports.js";

export async function kafkaBus(brokers: string[], topics: string[], partitions: number): Promise<EventBus> {
  const kafka = new Kafka({ clientId: "rishta", brokers, logLevel: logLevel.WARN });
  const admin = kafka.admin();
  await admin.connect();
  await admin.createTopics({ topics: topics.map((topic) => ({ topic, numPartitions: partitions })), waitForLeaders: true });
  await admin.disconnect();
  const producer = kafka.producer({ idempotent: true, createPartitioner: Partitioners.DefaultPartitioner });
  await producer.connect();
  const consumers: Consumer[] = [];
  return {
    // Keyed by merchant, so one merchant's events stay in order.
    publish: async (topic, key, value) => {
      await producer.send({ topic, messages: [{ key, value }] });
    },
    subscribe: async ({ topics: wanted, group, handler }) => {
      const consumer = kafka.consumer({ groupId: group ?? `rishta-pod-${randomUUID()}` });
      await consumer.connect();
      await consumer.subscribe({ topics: wanted, fromBeginning: false });
      await consumer.run({ eachMessage: async ({ topic, message }) => handler(topic, message.value?.toString() ?? "") });
      consumers.push(consumer);
    },
    close: async () => {
      await Promise.all(consumers.map((c) => c.disconnect()));
      await producer.disconnect();
    },
  };
}
