# Putting Rishta online

The site is one container with no outside database. Test data is baked in at build, each visitor gets a private SQLite copy, and that copy is wiped on restart.

## Cost first

Hugging Face's docs now say Docker Spaces need a paid plan: PRO is $9 a month. The hardware is free, but creating the Space is not. Custom domains are also PRO. So there are two routes.

| Route | Cost | Good | Bad |
|---|---|---|---|
| A. Your laptop + Cloudflare Tunnel | ₹0 | No card, works today | Laptop must stay on and online |
| B. Hugging Face Space | $9 a month, cancel after the event | Always up, 2 vCPU and 16 GB | Paid. Sleeps after 48 hours idle |

## A. Laptop + Cloudflare Tunnel (₹0)

1. In this folder: `pnpm build`, then `PUBLIC_SITE=true pnpm start`. `data/visitor-template.db` and `data/bench-days.db` must exist.
2. Install `cloudflared`.
3. Cloudflare dashboard → Zero Trust → Networks → Tunnels → Create a tunnel. Run the command it shows.
4. Add a public hostname: `rishta.tunedloop.com` → `http://localhost:3000`.

## B. Hugging Face Space

1. Make the GitHub repo public and push the branch. The Space fetches the code from there.
2. Create a Hugging Face account and buy PRO.
3. Make a token at huggingface.co/settings/tokens with write access.
4. Run: `HF_USER=yourname HF_TOKEN=yourtoken pnpm deploy:hf`
5. In the Space → Settings → Secrets, add these. The Space restarts by itself.
   - `SARVAM_API_KEY`
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL` (use `gpt-6.1-terra`)
   - `SESSION_SECRET` (any long random text)
6. Open `https://yourname-rishta.hf.space`. Use this address, not the huggingface.co page, because the page wraps the app in a frame.

To ship a change: commit, push, run step 4 again.

### Pointing rishta.tunedloop.com at it

With PRO, use the real custom domain:

1. Space → Settings → Custom Domain → enter `rishta.tunedloop.com`.
2. In Cloudflare DNS add a CNAME: `rishta` → `hf.space`, set to DNS only (grey cloud).
3. Wait for the Space to show "ready".

## Before anyone visits

Set a hard monthly spend limit on your OpenAI account. The site caps its own usage, but this is the backstop that stops the bill.
