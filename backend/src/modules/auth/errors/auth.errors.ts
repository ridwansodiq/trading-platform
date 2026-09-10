import { ApplicationError } from "../../../infrastructure/errors/application-error.js";

/**
 * Deliberately generic: the same error for an unknown email and a wrong
 * password, so the response cannot be used to enumerate accounts.
 */
export class InvalidCredentialsError extends ApplicationError {
  readonly code = "INVALID_CREDENTIALS";
  readonly status = 401;

  constructor() {
    super("Email or password is incorrect.");
  }
}

export class UnauthenticatedError extends ApplicationError {
  readonly code = "UNAUTHENTICATED";
  readonly status = 401;

  constructor() {
    super("Authentication required.");
  }
}
