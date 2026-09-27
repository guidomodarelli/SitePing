import type { AccessGate, SitepingHttpMethod } from "./access.js";

/** Options of the built-in shared-secret policy (the historical `adapter-prisma` behavior). */
export interface ApiKeyAccessOptions {
  /**
   * Shared secret expected as `Authorization: Bearer {apiKey}`.
   *
   * - **When set:** every request not listed in `publicEndpoints` must carry it (401 otherwise).
   * - **When not set:** the API is public, except DELETE/PATCH while
   *   `requireAuthForDestructive` is on.
   */
  apiKey?: string | undefined;
  /** Methods that skip the key. Defaults to `['POST', 'OPTIONS']` when `apiKey` is set. */
  publicEndpoints?: ReadonlyArray<SitepingHttpMethod>;
  /**
   * Whether DELETE/PATCH require `apiKey`. Defaults to `true`: without `apiKey`
   * the handler refuses to start in production and answers 401 elsewhere.
   * Set `false` only behind your own auth layer — or pass `access` instead.
   */
  requireAuthForDestructive?: boolean;
  /**
   * Blank `authorEmail` in responses to requests without a valid key.
   * Defaults to `true` — reviewer emails are PII and GET must stay reachable
   * by the widget.
   */
  redactUnauthenticatedEmails?: boolean;
}

const textEncoder = new TextEncoder();

/**
 * Constant-time comparison without `node:crypto`, so the handler runs on any
 * runtime with Web APIs (Node, Bun, Deno, edge workers). A length difference
 * returns early (unavoidable leak); comparing bytes keeps multi-byte input
 * from turning into an exception.
 */
function constantTimeEqual(received: string, expected: string): boolean {
  const receivedBytes = textEncoder.encode(received);
  const expectedBytes = textEncoder.encode(expected);
  if (receivedBytes.length !== expectedBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < receivedBytes.length; index++) {
    difference |= (receivedBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }
  return difference === 0;
}

/** `NODE_ENV === "production"`, tolerating runtimes without `process` (edge workers, Deno). */
function isProductionEnvironment(): boolean {
  return typeof process !== "undefined" && process.env?.NODE_ENV === "production";
}

/**
 * Build the shared-secret gate. Throws at startup when it would expose an
 * unauthenticated destructive surface in production.
 * @internal
 */
export function createApiKeyGate({
  apiKey,
  publicEndpoints = apiKey ? ["POST", "OPTIONS"] : undefined,
  requireAuthForDestructive = true,
  redactUnauthenticatedEmails = true,
}: ApiKeyAccessOptions): AccessGate<never> {
  // Without this guard anyone could `DELETE { deleteAll: true }` against the API.
  if (!apiKey && requireAuthForDestructive && isProductionEnvironment()) {
    throw new Error(
      "[siteping] createSitepingHandler: apiKey is required in production. " +
        "Set `apiKey` to enable destructive endpoints, pass `access` to plug your own auth, or pass " +
        "`requireAuthForDestructive: false` if SitePing sits behind your own auth middleware.",
    );
  }

  const publicMethods: ReadonlySet<SitepingHttpMethod> | null = publicEndpoints ? new Set(publicEndpoints) : null;

  const isBearerAuthenticated = (request: Request): boolean => {
    if (!apiKey) return false;
    const header = request.headers.get("Authorization");
    return header !== null && constantTimeEqual(header, `Bearer ${apiKey}`);
  };

  return {
    async authenticate(request, method) {
      const canReadAuthorEmail = !redactUnauthenticatedEmails || isBearerAuthenticated(request);
      if (!apiKey) {
        // GET/POST/OPTIONS stay open by default so the widget works in dev without config.
        if (requireAuthForDestructive && (method === "DELETE" || method === "PATCH")) {
          return { ok: false, status: 401, error: "apiKey required for destructive operations" };
        }
        return { ok: true, principal: null, canReadAuthorEmail };
      }
      if (publicMethods?.has(method) || isBearerAuthenticated(request)) {
        return { ok: true, principal: null, canReadAuthorEmail };
      }
      return { ok: false, status: 401, error: "Unauthorized" };
    },
    async authorize() {
      return true;
    },
  };
}
