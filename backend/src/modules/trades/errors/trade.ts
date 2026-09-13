import { ApplicationError } from "../../../infrastructure/errors/application-error";
import type { TradeState, TradeStatus } from "../types";

export class TradeNotFoundError extends ApplicationError {
  readonly code = "TRADE_NOT_FOUND";
  readonly status = 404;

  constructor() {
    super("Trade not found.");
  }
}

export class TradeAlreadyExistsError extends ApplicationError {
  readonly code = "TRADE_ALREADY_EXISTS";
  readonly status = 422;

  constructor() {
    super("Trade already exists.");
  }
}

export class InvalidTradeError extends ApplicationError {
  readonly code = "INVALID_TRADE";
  readonly status = 422;
}

export class InvalidTradeTransitionError extends ApplicationError {
  readonly code = "INVALID_TRADE_TRANSITION";
  readonly status = 422;

  constructor(status: TradeStatus) {
    super(`${status} trades cannot be changed.`);
  }
}

/**
 * Raised when the trade moved on between the client reading it and submitting a
 * operation.
 *
 * The error carries the current trade itself, so the UI can render its diff
 * without a follow-up request and without the route layer performing a second
 * data lookup to enrich the response.
 */
export class VersionConflictError extends ApplicationError {
  readonly code = "VERSION_CONFLICT";
  readonly status = 409;

  constructor(
    readonly expectedVersion: number,
    readonly currentTrade: TradeState | null = null
  ) {
    super("Trade has changed since it was opened.");
  }

  override body(): Record<string, unknown> {
    return {
      expectedVersion: this.expectedVersion,
      ...(this.currentTrade
        ? { currentVersion: this.currentTrade.version, currentTrade: this.currentTrade }
        : {})
    };
  }
}
