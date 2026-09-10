import { z } from "zod";

/**
 * The error shape every route can return. Module-specific errors extend this
 * with extra context rather than inventing a new envelope.
 *
 * `details` carries per-field validation failures so a client can point at the
 * offending input instead of showing one opaque sentence.
 */
export const apiErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    details: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
  })
  .meta({ id: "ApiError" });

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

/**
 * Every route can fail these three ways: malformed input, no session, and an
 * unexpected fault. Documenting them everywhere keeps the generated client's
 * error union honest — an undocumented status becomes an untyped surprise, and
 * Fastify would serialise it with its own envelope instead of ours.
 */
export function commonErrorResponses<T extends z.ZodType>(schema: T) {
  return { 400: schema, 401: schema, 500: schema };
}
