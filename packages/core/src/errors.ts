/**
 * Typed error hierarchy for Beezping client/server boundaries.
 *
 * Consumers can `instanceof`-check or read `code` / `retryable` instead of
 * pattern-matching error messages. Designed to be additive on top of the
 * existing store errors (`StoreNotFoundError`, `StoreDuplicateError`) which
 * remain the canonical signals for server-side store implementations.
 *
 * Usage on the widget side (api-client.ts):
 *   - fetch failures / aborts / timeouts → `BeezpingNetworkError` (retryable)
 *   - HTTP 4xx (except 401/403)         → `BeezpingValidationError` (not retryable)
 *   - HTTP 401 / 403                    → `BeezpingAuthError` (not retryable)
 *   - everything else                   → `BeezpingError` generic
 *
 * Store mode (store-client.ts): a `createFeedback` that does not settle in
 * time → `BeezpingError` with code `"TIMEOUT"` (retryable).
 *
 * `retryable` is meta information surfaced to host apps that want to wire
 * their own retry/queue/backoff strategy — the widget already retries
 * network failures via its built-in retry queue.
 */

/**
 * Discriminant string carried by every `BeezpingError`. Subclasses pin a
 * literal value; the base class accepts a wider string so userland can
 * extend the hierarchy without colliding with built-ins.
 */
export type BeezpingErrorCode = "NETWORK" | "VALIDATION" | "AUTH" | "SERVER" | "TIMEOUT" | (string & {});

export class BeezpingError<TCode extends BeezpingErrorCode = BeezpingErrorCode> extends Error {
  readonly code: TCode;
  readonly retryable: boolean;

  constructor(message: string, code: TCode, retryable: boolean) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.name = "BeezpingError";
  }
}

/** Network-level failure: connection refused, DNS, CORS, timeout, abort. Retryable. */
export class BeezpingNetworkError extends BeezpingError<"NETWORK"> {
  constructor(message: string) {
    super(message, "NETWORK", true);
    this.name = "BeezpingNetworkError";
  }
}

/**
 * Server rejected the request (4xx, not auth). Validation problem on the
 * client side. `status` is the HTTP status when a response said so: a 404
 * (the target is gone) and a 409 (a full thread) call for other answers
 * than a 400.
 */
export class BeezpingValidationError extends BeezpingError<"VALIDATION"> {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message, "VALIDATION", false);
    this.name = "BeezpingValidationError";
    this.status = status;
  }
}

/** Server rejected auth (401 or 403). Not retryable without fresh credentials. */
export class BeezpingAuthError extends BeezpingError<"AUTH"> {
  /**
   * `401`: the credentials are missing or no longer work — drop a dead token
   * on this one. `403`: they work, and the server's policy refuses this request.
   */
  readonly status: 401 | 403;

  constructor(message: string, status: 401 | 403) {
    super(message, "AUTH", false);
    this.name = "BeezpingAuthError";
    this.status = status;
  }
}
