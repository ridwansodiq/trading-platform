import type { FastifyError, FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError
} from "fastify-type-provider-zod";
import { isApplicationError } from "./application-error";
import type { ApiErrorBody } from "./error.schema";

/**
 * The one place an error becomes an HTTP response.
 *
 * Routes therefore contain no `try`/`catch` at all: they call a service and
 * return its result. Three previously separate copies of this mapping — in the
 * trade routes, the auth routes and the auth guard — each risked drifting into
 * a different envelope for the same class of failure.
 */

const VALIDATION_FAILED = "VALIDATION_FAILED";
const INTERNAL_ERROR = "INTERNAL_ERROR";
const NOT_FOUND = "ROUTE_NOT_FOUND";
const RATE_LIMITED = "RATE_LIMITED";

/** `instancePath` arrives as a JSON pointer (`/quantity`); report it as a field. */
function fieldPath(instancePath: string): string {
  return instancePath.replace(/^\//, "").replace(/\//g, ".") || "(root)";
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler(async (request, reply) => {
    const body: ApiErrorBody = {
      code: NOT_FOUND,
      message: `Route ${request.method} ${request.url} does not exist.`
    };
    return reply.code(404).send(body);
  });

  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    // Request validation. Zod has already collected every failing field, so
    // report all of them rather than only the first.
    if (hasZodFastifySchemaValidationErrors(error)) {
      const body: ApiErrorBody = {
        code: VALIDATION_FAILED,
        message: "The request payload is invalid.",
        details: error.validation.map((issue) => ({
          path: fieldPath(issue.instancePath),
          message: issue.message ?? "Invalid value."
        }))
      };
      return reply.code(400).send(body);
    }

    /*
     * A response that does not match its own schema is our bug, not the
     * caller's. It must be loud in the log and opaque on the wire, because the
     * offending payload can contain anything.
     */
    if (isResponseSerializationError(error)) {
      request.log.error(
        { err: error, url: error.url, method: error.method },
        "Response failed contract validation"
      );
      return reply.code(500).send({
        code: INTERNAL_ERROR,
        message: "The server produced a malformed response."
      } satisfies ApiErrorBody);
    }

    if (isApplicationError(error)) {
      // Expected outcomes — a stale version, a terminal trade, a bad password.
      // Logged at debug so they do not read as faults in production logs.
      request.log.debug({ code: error.code, status: error.status }, error.message);
      return reply
        .code(error.status)
        .send({ code: error.code, message: error.message, ...error.body() });
    }

    if (error.statusCode === 429) {
      return reply.code(429).send({
        code: RATE_LIMITED,
        message: "Too many requests. Slow down and try again shortly."
      } satisfies ApiErrorBody);
    }

    // Anything Fastify itself rejected with a 4xx (malformed JSON, unsupported
    // media type) is the caller's problem and safe to describe.
    if (typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({
        code: error.code ?? "BAD_REQUEST",
        message: error.message
      } satisfies ApiErrorBody);
    }

    /*
     * Genuinely unexpected. The message can contain connection strings, SQL or
     * stack detail, so it is logged and replaced with a fixed sentence.
     */
    request.log.error({ err: error }, "Unhandled error");
    return reply.code(500).send({
      code: INTERNAL_ERROR,
      message: "Something went wrong handling this request."
    } satisfies ApiErrorBody);
  });
}
