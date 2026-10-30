#!/usr/bin/env bash
# Downloads official Apache Kafka to data/, starts it, and tests Rishta's Kafka adapter.
# Stop it afterwards with: data/kafka/bin/kafka-server-stop.sh
set -euo pipefail
V=4.4.0
K=data/kafka
if [ ! -d "$K" ]; then
  curl -fsSL "https://downloads.apache.org/kafka/$V/kafka_2.13-$V.tgz" -o data/kafka.tgz
  mkdir -p "$K" && tar xzf data/kafka.tgz -C "$K" --strip-components=1
fi
CONF=$PWD/data/kraft.properties
cat > "$CONF" <<C
process.roles=broker,controller
node.id=1
controller.quorum.bootstrap.servers=localhost:19093
listeners=PLAINTEXT://localhost:19092,CONTROLLER://localhost:19093
advertised.listeners=PLAINTEXT://localhost:19092
controller.listener.names=CONTROLLER
listener.security.protocol.map=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT
log.dirs=$PWD/data/kafka-logs
offsets.topic.replication.factor=1
transaction.state.log.replication.factor=1
transaction.state.log.min.isr=1
group.initial.rebalance.delay.ms=0
C
[ -d data/kafka-logs ] || "$K/bin/kafka-storage.sh" format -t "$("$K/bin/kafka-storage.sh" random-uuid)" -c "$CONF" --standalone >/dev/null
"$K/bin/kafka-server-start.sh" -daemon "$CONF"
sleep 8
pnpm exec tsx scripts/dev/kafkaCheck.ts
