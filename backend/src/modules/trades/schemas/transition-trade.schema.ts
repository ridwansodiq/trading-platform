import { z } from "zod";

export const transitionTradeSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .meta({ id: "TransitionTradeCommand" });

export type TransitionTradeBody = z.infer<typeof transitionTradeSchema>;
