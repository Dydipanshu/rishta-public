# Rishta

AI teammate for Paytm's merchant team. Read `CLAUDE.md` for the full plan.

## Step 1: voice test

```bash
pnpm install
cp .env.example .env        # then add your Sarvam and OpenAI keys
pnpm spike:check            # both keys work
pnpm spike:openai           # tools + streaming work, with timings
pnpm spike:tts              # writes voice samples to out/tts
```

Then record the lines in `eval/stt-clips/clips.yaml` into that folder and run:

```bash
pnpm spike:stt                   # word accuracy on saaras:v3 codemix
pnpm spike:stt saaras:v4         # same clips on v4
pnpm spike:latency eval/stt-clips/01.wav
```
