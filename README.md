# Rishta

The manager between Paytm's predictions and its voice agents: it decides who to contact, about what, how, and who to leave alone, then learns what worked.

Design and integration: [ARCHITECTURE.md](ARCHITECTURE.md). Full plan: `CLAUDE.md`.

## Run the demo

```bash
pnpm install
cp .env.example .env    # add your Sarvam and OpenAI keys
pnpm seed
pnpm build && pnpm start
```

Open http://localhost:3000/demo. Run `pnpm reset` between rehearsals.

## Checks

`pnpm test` runs the automated tests and `pnpm eval` runs the conversation scenarios.
