/**
 * Base class for errors a module raises deliberately.
 *
 * The single Fastify error handler maps these to documented HTTP responses;
 * anything that is not an `ApplicationError` is an unexpected fault and becomes
 * a 500 with no internal detail leaked.
 */
export abstract class ApplicationError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }

  /**
   * Extra fields merged into the response body beyond `code` and `message`.
   *
   * Overriding this is how an error carries its own context — a version
   * conflict returns the current trade, for instance — so the error handler
   * never needs to know which error types exist.
   */
  body(): Record<string, unknown> {
    return {};
  }
}

export function isApplicationError(error: unknown): error is ApplicationError {
  return error instanceof ApplicationError;
}
