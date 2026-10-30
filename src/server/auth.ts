import { createHmac, timingSafeEqual } from "node:crypto";

const sign = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("base64url");

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const bearer = (header?: string) => (header?.startsWith("Bearer ") ? header.slice(7) : "");
export const validKey = (given: string, key: string) => same(given, key);

// Paytm's backend mints this after its own login, so a merchant can only reach their own data.
export function issueMerchantToken(secret: string, merchantId: string, ttlSec: number, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ m: merchantId, e: now + ttlSec * 1000 })).toString("base64url");
  return `${body}.${sign(secret, body)}`;
}

export function merchantFromToken(secret: string, token: string, now = Date.now()) {
  const [body, sig] = token.split(".");
  if (!body || !sig || !same(sig, sign(secret, body))) return null;
  const { m, e } = JSON.parse(Buffer.from(body, "base64url").toString()) as { m: string; e: number };
  return e > now ? m : null;
}
