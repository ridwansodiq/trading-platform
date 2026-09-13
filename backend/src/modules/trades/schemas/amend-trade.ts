import { z } from "zod";
import { createTradeSchema } from "./create-trade";
import type { TradeActor } from "../types";

export const amendTradeSchema = createTradeSchema
  .partial()
  .extend({ expectedVersion: z.number().int().positive() })
  .meta({ id: "AmendTradeRequest" });

export type AmendTradeBody = z.infer<typeof amendTradeSchema>;

type AmendRequest = Omit<z.infer<typeof amendTradeSchema>, "expectedVersion">;

/**
 * Fields an amendment may change — every key of the request except the
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
  [K in keyof AmendRequest]?: Exclude<AmendRequest[K], undefined>;
};

export type AmendTradeInput = {
  tradeId: string;
  expectedVersion: number;
  changes: AmendableTradeFields;
  actor: TradeActor;
};
