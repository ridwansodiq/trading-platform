import { z } from "zod";

/**
 * The pagination envelope, defined once for the type layer and once for the
 * wire.
 *
 * It lives in infrastructure rather than in a module because it describes the
 * shape of the HTTP contract, not anyone's domain. The point is less reuse than
 * consistency: the next paginated resource inherits these field names and their
 * meanings instead of arriving with `limit`/`offset` beside the existing
 * `page`/`pageSize`, which is how an API ends up with two pagination dialects.
 */

/**
 * One page of `T`, as a repository or service returns it.
 *
 * `total` counts every row matching the filter rather than the rows in `data`,
 * so it is the one field here not bounded by `pageSize`. The blotter's footer
 * depends on that distinction.
 */
export type Page<T> = {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
};

/**
 * The wire schema for a `Page<T>`.
 *
 * `id` is an argument rather than something derived, because OpenAPI components
 * are keyed by name and a generic cannot name itself. Passing it keeps each
 * instantiation a named component; without one, every paginated response would
 * be inlined per operation and status code, which is exactly what the
 * `.meta({ id })` convention elsewhere exists to prevent.
 *
 * The returned type is inferred rather than annotated, so `z.infer` on the
 * result still yields `{ data: T[]; ... }` and not a widened `ZodType`.
 */
export function pageSchema<T extends z.ZodType>(item: T, id: string) {
  return z
    .object({
      data: z.array(item),
      page: z.number().int().positive(),
      pageSize: z.number().int().positive(),
      total: z.number().int().nonnegative()
    })
    .meta({ id });
}
