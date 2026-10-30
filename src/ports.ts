import type { Brief } from "./engine/brief.js";
import type { Merchant } from "./sim/types.js";

// Everything Rishta needs from Paytm. The test bench implements this today;
// a production adapter calls Paytm's services instead, and nothing else changes.
export interface PaytmCore {
  merchant(id: string): Promise<Merchant>;
  merchantPage(lo: number, hi: number, afterId: string, limit: number): Promise<Merchant[]>;
  openTickets(id: string): Promise<{ note: string; openedDay: number }[]>;
  raiseTicket(merchantId: string, type: string, note: string): Promise<{ ticketId: string }>;
  changePlan(merchantId: string, from: string, to: { id: string; monthlyRent: number }): Promise<void>;
  scheduleCallback(merchantId: string, reason: string, summary: string): Promise<void>;
  optOut(merchantId: string): Promise<void>;
  notify(merchantId: string, text: string): Promise<void>;
}

export interface OutreachRequest {
  brief: Brief;
  lines: { text: string; audio: string }[];
  card: string;
}

// How a nudge reaches the shop: Soundbox command, Mini App notification, or the bench phone.
export interface ChannelGateway {
  deliver(request: OutreachRequest): Promise<void>;
}

export interface Subscription {
  topics: string[];
  // Pods sharing a group split the work. No group means every pod gets every event.
  group?: string;
  handler: (topic: string, value: string) => Promise<void>;
}

export interface EventBus {
  publish(topic: string, key: string, value: string): Promise<void>;
  subscribe(subscription: Subscription): Promise<void>;
  close(): Promise<void>;
}
