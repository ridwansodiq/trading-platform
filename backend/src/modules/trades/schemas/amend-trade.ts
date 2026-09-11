import { z } from "zod";
import { createTradeSchema } from "./create-trade";
import type { TradeActor } from "../types";

export const amendTradeSchema = createTradeSchema
  .partial()
  .extend({ expectedVersion: z.number().int().positive() })
  .meta({ id: "AmendTradeCommand" });

export type AmendTradeBody = z.infer<typeof amendTradeSchema>;

type AmendCommand = Omit<z.infer<typeof amendTradeSchema>, "expectedVersion">;

/**
 * Fields an amendment may change — every key of the command except the
 * concurrency token. Derived from the schema so the two can never disagree
 * about, say, whether `status` is amendable (it is not: status moves only
 * through execute and cancel).
 *
 * `undefined` is stripped from every value: the route drops absent keys before
 * calling the service, so "present but undefined" is not a state the lifecycle
 * rules can be handed. Encoding that in the type is what lets them merge the
 * changes over the current trade without re-checking each field.
 */
export type AmendableTradeFields = {
  [K in keyof AmendCommand]?: Exclude<AmendCommand[K], undefined>;
};

export type AmendTradeDto = {
  tradeId: string;
  expectedVersion: number;
  changes: AmendableTradeFields;
  actor: TradeActor;
};
