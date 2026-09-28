import { SITEPING_ERROR_MESSAGES } from "./constants/error-messages.js";
/** HTTP methods served by `createSitepingHandler`. */
export type SitepingHttpMethod = "GET" | "POST" | "PATCH" | "DELETE" | "OPTIONS";

/** Operation a request performs, passed to `SitepingAccessControl.authorize`. */
export type SitepingAction = "create" | "list" | "update" | "delete" | "deleteAll";

/** Context shared by authorization, transforms and lifecycle hooks. */
export interface SitepingRequestContext<Principal> {
  request: Request;
  /** Whoever `authenticate` resolved — `null` for requests the access policy leaves anonymous. */
  principal: Principal | null;
}

/** What `authorize` decides about. */
export interface SitepingAuthorizationContext<Principal> extends SitepingRequestContext<Principal> {
  action: SitepingAction;
  /** Project the request targets (from the body for writes, the query for reads). */
  projectName: string;
  /** Target record id for `update` / `delete`. */
  feedbackId?: string;
}

/**
 * Pluggable access policy — how the handler knows who is calling and what
 * they may do. Framework- and provider-agnostic: resolve the principal from
 * the standard `Request` (session cookie, JWT, API key, proxy header…).
 *
 * - `authenticate` returning `null` → 401.
 * - `authorize` returning `false` → 403. Defaults to allowing every
 *   authenticated principal. When set, the store must implement
 *   `verifyProjectOwnership`: PATCH/DELETE address records by id, and the
 *   check is what keeps the authorized `projectName` bound to the record.
 * - `canReadAuthorEmail` decides whether responses include `authorEmail`
 *   (reviewer PII). Defaults to `true` for authenticated principals.
 */
export interface SitepingAccessControl<Principal> {
  authenticate(request: Request): Principal | null | Promise<Principal | null>;
  authorize?(context: SitepingAuthorizationContext<Principal>): boolean | Promise<boolean>;
  canReadAuthorEmail?(principal: Principal): boolean;
}

/** Outcome of authenticating one request. @internal */
export type AuthenticationOutcome<Principal> =
  | { ok: true; principal: Principal | null; canReadAuthorEmail: boolean }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Normalized policy the handler runs: authenticate once per request, then
 * authorize once the target project is known (after body/query parsing).
 * @internal
 */
export interface AccessGate<Principal> {
  authenticate(request: Request, method: SitepingHttpMethod): Promise<AuthenticationOutcome<Principal>>;
  authorize(context: SitepingAuthorizationContext<Principal>): Promise<boolean>;
}

/** Wrap a public `SitepingAccessControl` into the handler's gate. @internal */
export function accessGateFromControl<Principal>(access: SitepingAccessControl<Principal>): AccessGate<Principal> {
  return {
    async authenticate(request) {
      const principal = await access.authenticate(request);
      if (principal === null) return { ok: false, status: 401, error: SITEPING_ERROR_MESSAGES.unauthorized };
      return { ok: true, principal, canReadAuthorEmail: access.canReadAuthorEmail?.(principal) ?? true };
    },
    async authorize(context) {
      return access.authorize ? access.authorize(context) : true;
    },
  };
}
