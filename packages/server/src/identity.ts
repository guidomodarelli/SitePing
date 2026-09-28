import type { SitepingAccessControl } from "./access.js";
import { IDENTITY_CACHE_CONTROL, IDENTITY_CORS_ALLOWED_METHODS } from "./constants/http.js";
import { buildCorsHeaders, createCorsPolicy, preflightResponse, withCors } from "./cors.js";

/** Reviewer identity the widget pre-fills (`SitepingConfig.identity`). */
export interface SitepingIdentity {
  name: string;
  email: string;
}

/**
 * Body of the identity endpoint. The host page fetches it to decide whether
 * to mount the widget and with which identity/project:
 *
 * ```ts
 * const { enabled, identity, projectName } = await (await fetch("/api/siteping/identity")).json();
 * if (enabled && identity) initSiteping({ endpoint, projectName, identity, forceShow: true });
 * ```
 */
export interface SitepingIdentityResponse {
  enabled: boolean;
  identity: SitepingIdentity | null;
  projectName: string;
}

export interface SitepingIdentityHandlerOptions<Principal> {
  /** Same `authenticate` as the feedback handler's `access`. */
  access: Pick<SitepingAccessControl<Principal>, "authenticate">;
  /** Map the principal to the identity shown in the widget; `null` hides the widget. */
  resolveIdentity(principal: Principal): SitepingIdentity | null | Promise<SitepingIdentity | null>;
  /** Project the widget reports into. */
  projectName: string;
  /**
   * Feature flag — globally (`boolean`) or per principal (e.g. an allowlist
   * of reviewers). Defaults to enabled for every resolved identity.
   */
  enabled?: boolean | ((principal: Principal) => boolean | Promise<boolean>);
  /** Allowed CORS origins, as in `createSitepingHandler`. */
  allowedOrigins?: ReadonlyArray<string> | undefined;
  /**
   * Extra request headers cross-origin callers may send, as in
   * `createSitepingHandler` — list the headers `access.authenticate` reads.
   */
  allowedHeaders?: ReadonlyArray<string> | undefined;
}

/** Handlers of the identity endpoint — mount both on any Fetch-API router. */
export interface SitepingIdentityHandler {
  /** CORS preflight — needed as soon as the identity request carries a non-simple header (e.g. `Authorization`). */
  OPTIONS: (request: Request) => Response;
  GET: (request: Request) => Promise<Response>;
}

/**
 * `GET` endpoint telling the host page whether the current visitor may give
 * feedback, and as whom. Anonymous or disabled visitors get
 * `{ enabled: false, identity: null }` with 200 — the page simply does not
 * mount the widget. Responses are `no-store`: they depend on the session.
 * `OPTIONS` answers the CORS preflight of cross-origin callers with the
 * same `allowedOrigins` / `allowedHeaders` policy.
 *
 * @throws Error when `allowedHeaders` contains an invalid header name.
 */
export function createSitepingIdentityHandler<Principal>({
  access,
  resolveIdentity,
  projectName,
  enabled = true,
  allowedOrigins,
  allowedHeaders,
}: SitepingIdentityHandlerOptions<Principal>): SitepingIdentityHandler {
  const corsPolicy = createCorsPolicy({
    allowedOrigins,
    allowedHeaders,
    allowedMethods: IDENTITY_CORS_ALLOWED_METHODS,
  });
  const respond = (request: Request, body: SitepingIdentityResponse): Response =>
    withCors(
      Response.json(body, { headers: { "Cache-Control": IDENTITY_CACHE_CONTROL } }),
      buildCorsHeaders(request, corsPolicy),
    );
  const disabled = (request: Request) => respond(request, { enabled: false, identity: null, projectName });

  return {
    OPTIONS: (request: Request): Response => preflightResponse(request, corsPolicy),
    GET: async (request: Request): Promise<Response> => {
      const principal = await access.authenticate(request);
      if (principal === null) return disabled(request);
      const isEnabled = typeof enabled === "function" ? await enabled(principal) : enabled;
      if (!isEnabled) return disabled(request);
      const identity = await resolveIdentity(principal);
      if (!identity) return disabled(request);
      return respond(request, { enabled: true, identity, projectName });
    },
  };
}
