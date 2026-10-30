# Rishta architecture

Rishta is a service that sits beside Paytm's systems. It reads merchant signals, decides what to do, hands a brief to whichever agent or channel does the talking, and records what happened. It owns the decisions and the learning, and leaves payments, tickets, plans and devices to the systems that already own them.

## What Paytm actually runs

Paytm publishes little about its internals, so each line says how far it can be trusted.

| Area | What we know | Confidence |
|---|---|---|
| Merchant app | Mini Apps are web apps opened inside the Consumer and Business apps, with a JS bridge, Paytm sign-in (`paytmFetchAuthCode`) and `sendPartnerNotification`. Server SDKs exist for Java and Node. | Official docs |
| Payment events | Server-to-server webhook on final payment status, signed with `CHECKSUMHASH`. No public settlement webhook found. | Official docs |
| Services | Java, Spring Boot, microservices, Kafka or RabbitMQ, Redis or Aerospike, relational databases, AWS, Kubernetes. | Job posts only |
| Data | Spark, Hive, HBase, Flink, Hudi and Presto on Amazon EMR. | AWS case study, 2021 |
| Soundbox | MQTT is the industry pattern. Paytm's protocol is not public. | Inferred |
| AI | Paytm Intelligence sells agents to enterprises; Paytm says AI is in Soundbox and merchant sales. No public agent API found. | Press |

## Design

```
 Paytm data lake        Paytm services            Paytm voice agent, Soundbox,
 (signals)              (tickets, plans)          Mini App, sales app
      |                       ^                            ^        |
      | PaytmCore             | PaytmCore          brief   |        | outcome
      v                       |                            |        v
 +----------------------------+----------------------------+-----------+
 | Decision workers           Conversation servers         /v1 API     |
 | sharded, nightly           stateless, autoscaled        contract    |
 +---------+----------------------+-----------------------------+------+
           |                      |                             |
           v                      v                             v
      Postgres  <-- outbox -->  Kafka  --> outcomes, outreach, plan events
```

**Decision workers** split merchants into 1,024 shards. Each worker takes a range and pages through it, so memory stays flat. A final step applies shared limits such as salesperson capacity, and refuses to publish if any shard is missing.

**Conversation servers** hold no conversation in memory. State is saved after every turn, so any server can take the next one. Audio links carry the signed line itself, so they also work on any server.

**The outbox** writes each event in the same transaction as the change it announces, so a crash can't lose one. After a crash an event can repeat; consumers dedupe on its id.

## Why TypeScript, not Java

The boundary is a contract, so the language behind it doesn't matter to Paytm's services: JSON over HTTP, and events on Kafka. A rewrite would add risk and no capability. The infrastructure matches the Paytm stack as far as it is known: Postgres as the relational database, Kafka for events, containers on Kubernetes, and a Node SDK for Mini Apps. Redis isn't needed yet, because a conversation writes once per turn and Postgres handles that comfortably. If that changes, session storage is one small class.

## Plugging in

`src/compose.ts` is the only file that picks implementations.

| Connection | Today | In production |
|---|---|---|
| `PaytmCore` | Test bench | Adapter calling Paytm's merchant, ticket and plan services, and reading the lake |
| `ChannelGateway` | Simulated phone | Soundbox command service; Mini App `sendPartnerNotification` |
| `EventBus` | In-process, Kafka adapter ready | Paytm's Kafka |
| `Sql` | SQLite, Postgres adapter ready | Managed Postgres |
| `LLMAdapter` | OpenAI | Any compatible endpoint through `OPENAI_BASE_URL`, or a new adapter for Paytm's model |
| Voice agent | Rishta's reference agent | Paytm's agent: `GET /v1/briefs`, then `POST /v1/outcomes` |
| Merchant screen | `/merchant` | Same web app as a Mini App; Paytm's backend mints a token through `POST /v1/sessions` |

The published contract is in `contracts/`: OpenAPI plus JSON Schema for briefs, outcomes and events.

## Production controls

- **Access:** service routes need an API key, and merchants need a short-lived signed token that only reaches their own data. Secrets are checked at boot, and the reset route doesn't exist in production.
- **Merchant safety:** consent, opt-out and contact hours (9am to 7pm IST) are re-checked at send time. Each brief is sent once. `OUTREACH_ENABLED=false` stops all outreach.
- **Failure:** model and speech calls have time limits. If a turn fails, the merchant is told a person will call and a handoff is created.
- **Abandoned calls:** any server can close them after 5 idle minutes, and each conversation finishes exactly once.
- **Operations:** `/healthz`, `/readyz`, `/metrics` (Prometheus), JSON logs with credentials redacted, graceful shutdown, append-only audit log.

## Capacity

Sizing the whole subscription base of 1.51 crore at the bench's 3.2% contact rate gives about 4.8 lakh conversations a day. Over a 10-hour contact window that's about 13 new conversations a second, or about 1,600 at once if each lasts 2 minutes. Those are estimates from simulated rates, not measured demand.

Measured on this laptop with one server, real Postgres and a faked 1-second model:

| Measure | Result |
|---|---|
| Live conversations | 170 at once |
| Throughput | 120 turns/s |
| Time Rishta adds to a turn, all 170 at once | 237ms median, 642ms p95 |
| Daily run, 4 workers | 5,000 merchants in about 6s, including process start |

Nothing scales forever. Servers and workers add capacity by adding pods. The limits, in the order they would arrive:

1. **Model and speech quotas.** Peak concurrency needs contracted capacity, whichever provider is used.
2. **Postgres writes.** Partition high-volume tables by shard, then split into separate databases; the shard key already exists.
3. **The source of `merchantPage`.** At full base the decision job should read the lake. The job's logic is plain functions, so it can run wherever the data is.

## Proven, and not yet

Proven by tests here:

- 50 automated tests pass on SQLite; the 14 storage and conversation tests also pass on Postgres 17.
- 4 parallel workers produce briefs identical to a single run.
- `kill -9` on a server mid-conversation: a second server finished it with exactly one outcome.
- 15 of 15 conversation evals, and 3 of 3 full browser demo runs.

Not proven or not built:

- **Kafka adapter:** written, not yet run against a broker. Use `scripts/dev/kafka.sh`.
- **Docker and Kubernetes files:** written, not run. This machine has no Docker.
- **Paytm adapters:** can't be built until Paytm shares internal APIs. `PaytmCore` lists exactly what is needed.
- **30-day kept update:** live conversations record `kept` as empty. The job that fills it needs a real activity signal.
- **Data rules:** transcripts reach OpenAI and Sarvam today. Paytm's compliance team must approve the model hosting; an India-hosted or Paytm-hosted endpoint needs only a settings change.
