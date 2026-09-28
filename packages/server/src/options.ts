import type { FeedbackCreateInput, FeedbackRecord, SitepingStore } from "@siteping/core";
import type { SitepingAccessControl, SitepingRequestContext } from "./access.js";
import type { ApiKeyAccessOptions } from "./api-key-access.js";
import type { WebhookConfig } from "./webhooks.js";

/** What a delete targets — one record, or a whole project (`deleteAll`). */
export type SitepingDeletionTarget =
  | { kind: "single"; id: string; projectName: string }
  | { kind: "project"; projectName: string };

/**
 * Side effects around persistence — issue trackers, chat notifications,
 * search indexes, audit logs. Hooks receive the raw stored record.
 *
 * `onCreated` / `onUpdated` / `onDeleted` are awaited before the response
 * (so serverless runtimes do not freeze them mid-flight); a throw is logged
 * and never fails the request — the write already happened.
 * `onDeleting` runs before the delete: throw to abort it (the record is kept
 * and the request answers 502), e.g. when an external resource tied to the
 * feedback could not be cleaned up and must be retried.
 */
export interface SitepingLifecycleHooks<Principal> {
  onCreated?(feedback: FeedbackRecord, context: SitepingRequestContext<Principal>): void | Promise<void>;
  onUpdated?(feedback: FeedbackRecord, context: SitepingRequestContext<Principal>): void | Promise<void>;
  onDeleting?(target: SitepingDeletionTarget, context: SitepingRequestContext<Principal>): void | Promise<void>;
  onDeleted?(target: SitepingDeletionTarget, context: SitepingRequestContext<Principal>): void | Promise<void>;
}

/** Structured logger; defaults to `console.error`. */
export interface SitepingLogger {
  error(message: string, context: Record<string, unknown>): void;
}

/** Options shared by both access modes. */
export interface SitepingHandlerBaseOptions<Principal> {
  /** Persistence backend — any `SitepingStore` (Prisma, Drizzle, memory, your own). */
  store: SitepingStore;
  /**
   * Allowed CORS origins — when set, only those origins are reflected, and
   * `POST`/`PATCH`/`DELETE` carrying any other `Origin` (except the
   * endpoint's own) are refused with `403` before any processing (CSRF).
   */
  allowedOrigins?: ReadonlyArray<string> | undefined;
  /**
   * Extra request headers cross-origin callers may send, on top of
   * `Content-Type` and `Authorization` — e.g. a custom session or proxy
   * identity header read by `access.authenticate`. Merged case-insensitively;
   * an invalid header name throws at startup. The preflight's
   * `Access-Control-Request-Headers` is never reflected.
   */
  allowedHeaders?: ReadonlyArray<string> | undefined;
  /**
   * Rewrite the validated create input before it is stored: impose the
   * project or author from the session, redact secrets from free text,
   * drop fields you do not keep. Runs before the authorization check, so
   * `authorize` sees the effective `projectName`.
   */
  beforeCreate?(
    input: FeedbackCreateInput,
    context: SitepingRequestContext<Principal>,
  ): FeedbackCreateInput | Promise<FeedbackCreateInput>;
  /**
   * Transform each record right before it is serialized in a response —
   * e.g. read-time redaction. `clientId` is always stripped afterwards.
   */
  presentFeedback?(feedback: FeedbackRecord, context: SitepingRequestContext<Principal>): FeedbackRecord;
  /** Lifecycle side effects. See `SitepingLifecycleHooks`. */
  hooks?: SitepingLifecycleHooks<Principal>;
  /**
   * Outgoing webhooks fired after a feedback is created (Slack, Discord or
   * generic JSON). Fire-and-forget; observe failures via each config's `onError`.
   */
  webhooks?: WebhookConfig | ReadonlyArray<WebhookConfig>;
  /** Where unexpected failures are reported. Defaults to `console.error`. */
  logger?: SitepingLogger;
  /**
   * Map a store failure to the `error` string sent to the client. Return
   * `undefined` for the default ("Internal server error"). Adapters use it
   * for actionable setup hints (e.g. "table not found, run migrations").
   */
  describeError?(error: unknown): string | undefined;
}

/** Built-in shared-secret policy (backwards compatible with `adapter-prisma`). */
export interface SitepingApiKeyHandlerOptions extends SitepingHandlerBaseOptions<never>, ApiKeyAccessOptions {
  access?: never;
}

/** Custom access policy — sessions, JWT, roles… */
export interface SitepingAccessHandlerOptions<Principal> extends SitepingHandlerBaseOptions<Principal> {
  access: SitepingAccessControl<Principal>;
  apiKey?: never;
  publicEndpoints?: never;
  requireAuthForDestructive?: never;
  redactUnauthenticatedEmails?: never;
}

/** Options of `createSitepingHandler` — `access` XOR the api-key options. */
export type SitepingHandlerOptions<Principal = never> =
  | SitepingApiKeyHandlerOptions
  | SitepingAccessHandlerOptions<Principal>;

/** One handler per HTTP method — mount them on any Fetch-API router. */
export interface SitepingHandler {
  OPTIONS: (request: Request) => Response;
  POST: (request: Request) => Promise<Response>;
  GET: (request: Request) => Promise<Response>;
  PATCH: (request: Request) => Promise<Response>;
  DELETE: (request: Request) => Promise<Response>;
}
