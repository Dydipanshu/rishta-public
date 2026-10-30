import { TOPICS } from "../contracts/events.js";
import type { ChannelGateway, EventBus } from "../ports.js";

// Sends the nudge to the simulated phone. A production gateway calls the Soundbox and Mini App services.
export const benchGateway = (bus: EventBus): ChannelGateway => ({
  deliver: ({ brief, lines, card }) =>
    bus.publish(TOPICS.ui, brief.merchantId, JSON.stringify({ type: "nudge", merchantId: brief.merchantId, channel: brief.channel, lines, card })),
});
