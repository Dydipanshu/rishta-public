# Rishta

**The relationship manager Paytm can't hire 1.64 crore times.**

Every night Rishta looks at every shop and decides who needs a conversation, about what, how to open it, and who to leave alone. It talks to the shopkeeper in Hindi or English by voice, fixes what it can, comes back to check the fix worked, and passes the rest to a salesperson with a brief. Every outcome is measured against a control group, so it learns what actually works.

Built solo for the Paytm Build for India AI Hackathon, Track 3: Autonomous AI Teammates. A student prototype, not a Paytm product. All shops and results are simulated.

## Who it helps

| Who | What they get |
| --- | --- |
| Shopkeeper | An answer from their own numbers, a ticket raised, a plan changed, and someone who comes back to ask if it worked |
| Salesperson | One ranked list of who to see today, with why, what to say and what's already been tried |
| Paytm's merchant team | Why shops really leave, in their own words, and proof of which approach works |

## Try it

The site gives each visitor a private copy of 5,000 simulated shops.

- `/` Be any shopkeeper and talk to Rishta, or make your own shop
- `/sales` The salesperson's list
- `/demo` A guided tour of the nightly run, the proof and the guardrails

## How it works

```
Nightly run   shop data → risk → likely problem → leave alone? → best approach → channel → brief
Conversation  mic → speech to text → safety router → LLM + tools → number guard → speech
Afterwards    outcome + quoted reasons → shop memory and promises → playbook vs control group
```

- **The brief is the contract.** The same typed brief can drive Rishta's agent, Paytm's voice agent, or a salesperson.
- **Safety runs in code, before the model.** Fraud mentions, requests for a person, opt-outs and OTP questions are routed without an LLM call.
- **Numbers can't be invented.** Every number is checked against tool results before it is spoken.
- **Learning is explainable.** Thompson sampling per problem and segment, scored in net rupees, with a fixed holdout.

Full design and integration points: [ARCHITECTURE.md](ARCHITECTURE.md).

## Stack

TypeScript throughout. Fastify, SQLite (Postgres and Kafka by configuration), React, Vite, Tailwind, zod. Sarvam for speech, OpenAI for the language model behind a swappable adapter.

## Run it

Needs Node 20.12+, pnpm, and Sarvam and OpenAI keys.

```bash
pnpm install
cp .env.example .env    # add your keys
pnpm seed
pnpm build && pnpm start
```

Open http://localhost:3000. Set `PUBLIC_SITE=true` for the multi-visitor site. Deployment: [DEPLOY.md](DEPLOY.md).

## Checks

`pnpm test` runs the unit tests, `pnpm eval` the conversation scenarios (spends API credit), and `pnpm e2e` the whole app in a real browser with a virtual mic.
