import { z } from "zod";

export const TalkText = z.object({ text: z.string().min(1).max(500) });
