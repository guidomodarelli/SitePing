import { MemoryStore } from "@beezping/adapter-memory";
import { describe, expect, it } from "vitest";
import { createSitepingHandler, createSitepingIdentityHandler, type SitepingAccessControl } from "../src/index.js";

const ENDPOINT = "http://localhost/api/siteping";
const IDENTITY_ENDPOINT = `${ENDPOINT}/identity`;
const ALLOWED_ORIGIN = "https://client-site.example";
const FOREIGN_ORIGIN = "https://attacker.example";
const SESSION_HEADER = "X-Session";
const REVIEWER_EMAIL = "reviewer@example.com";

interface Reviewer {
  email: string;
}

/** Custom session policy: the caller identifies through a non-simple `X-Session` header. */
const headerSessionAccess: SitepingAccessControl<Reviewer> = {
  authenticate: (request) => {
    const email = request.headers.get(SESSION_HEADER);
    return email ? { email } : null;
  },
};

/** What a browser sends before a cross-origin request carrying `requestedHeaders`. */
function preflightRequest(url: string, method: string, requestedHeaders: string, origin = ALLOWED_ORIGIN): Request {
  return new Request(url, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": method,
      "Access-Control-Request-Headers": requestedHeaders,
    },
  });
}

/** Header names announced by `Access-Control-Allow-Headers`, lowercased (browsers compare case-insensitively). */
function allowedHeaderNames(response: Response): string[] {
  const value = response.headers.get("Access-Control-Allow-Headers") ?? "";
  return value
    .split(",")
    .map((headerName) => headerName.trim().toLowerCase())
    .filter(Boolean);
}

describe("createSitepingHandler — allowedHeaders", () => {
  it("lets a browser preflight the custom header read by authenticate, then serves the cross-origin request", async () => {
    const handler = createSitepingHandler<Reviewer>({
      store: new MemoryStore(),
      access: headerSessionAccess,
      allowedOrigins: [ALLOWED_ORIGIN],
      allowedHeaders: [SESSION_HEADER],
    });

    const preflight = handler.OPTIONS(preflightRequest(ENDPOINT, "GET", "x-session"));

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    expect(allowedHeaderNames(preflight)).toEqual(["content-type", "authorization", "x-session"]);

    const response = await handler.GET(
      new Request(`${ENDPOINT}?projectName=my-site`, {
        headers: { Origin: ALLOWED_ORIGIN, [SESSION_HEADER]: REVIEWER_EMAIL },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
  });

  it("keeps only the widget's default headers when allowedHeaders is not set", () => {
    const handler = createSitepingHandler<Reviewer>({
      store: new MemoryStore(),
      access: headerSessionAccess,
      allowedOrigins: [ALLOWED_ORIGIN],
    });

    const preflight = handler.OPTIONS(preflightRequest(ENDPOINT, "GET", "x-session"));

    expect(allowedHeaderNames(preflight)).toEqual(["content-type", "authorization"]);
  });

  it("never reflects headers the browser requests but the integrator did not declare", () => {
    const handler = createSitepingHandler<Reviewer>({
      store: new MemoryStore(),
      access: headerSessionAccess,
      allowedOrigins: [ALLOWED_ORIGIN],
      allowedHeaders: [SESSION_HEADER],
    });

    const preflight = handler.OPTIONS(preflightRequest(ENDPOINT, "POST", "x-session, x-evil-header"));

    expect(allowedHeaderNames(preflight)).not.toContain("x-evil-header");
  });

  it("merges extra headers with the defaults case-insensitively, without duplicates", () => {
    const handler = createSitepingHandler<Reviewer>({
      store: new MemoryStore(),
      access: headerSessionAccess,
      allowedOrigins: [ALLOWED_ORIGIN],
      allowedHeaders: ["authorization", "X-Session", "x-session", "CONTENT-TYPE"],
    });

    const preflight = handler.OPTIONS(preflightRequest(ENDPOINT, "GET", "x-session"));

    expect(preflight.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type, Authorization, X-Session");
  });

  it("emits no CORS headers for an origin outside the allowlist, whatever headers are configured", () => {
    const handler = createSitepingHandler<Reviewer>({
      store: new MemoryStore(),
      access: headerSessionAccess,
      allowedOrigins: [ALLOWED_ORIGIN],
      allowedHeaders: [SESSION_HEADER],
    });

    const preflight = handler.OPTIONS(preflightRequest(ENDPOINT, "GET", "x-session", FOREIGN_ORIGIN));

    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toBeNull();
  });

  it.each([
    ["an empty name", ""],
    ["a comma-separated list", "X-Session, X-Other"],
    ["a name with spaces", "X Session"],
    ["a name with a line break", "X-Session\r\nSet-Cookie"],
  ])("refuses to start when allowedHeaders contains %s", (_label, invalidHeader) => {
    expect(() =>
      createSitepingHandler<Reviewer>({
        store: new MemoryStore(),
        access: headerSessionAccess,
        allowedOrigins: [ALLOWED_ORIGIN],
        allowedHeaders: [invalidHeader],
      }),
    ).toThrow(/allowedHeaders: every entry must be a valid HTTP header name/);
  });
});

describe("createSitepingIdentityHandler — allowedHeaders", () => {
  const identityHandler = (allowedHeaders?: ReadonlyArray<string>) =>
    createSitepingIdentityHandler<Reviewer>({
      access: headerSessionAccess,
      projectName: "my-site",
      resolveIdentity: (principal) => ({ name: "Reviewer", email: principal.email }),
      allowedOrigins: [ALLOWED_ORIGIN],
      ...(allowedHeaders ? { allowedHeaders } : {}),
    });

  it("announces the configured session header on cross-origin identity responses", async () => {
    const response = await identityHandler([SESSION_HEADER]).GET(
      new Request(IDENTITY_ENDPOINT, { headers: { Origin: ALLOWED_ORIGIN, [SESSION_HEADER]: REVIEWER_EMAIL } }),
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    expect(allowedHeaderNames(response)).toContain("x-session");
    expect(((await response.json()) as { enabled: boolean }).enabled).toBe(true);
  });

  it("refuses to start with an invalid header name", () => {
    expect(() => identityHandler(["X Session"])).toThrow(/allowedHeaders/);
  });
});

describe("createSitepingIdentityHandler — CORS preflight", () => {
  const identityHandler = (allowedOrigins?: ReadonlyArray<string>) =>
    createSitepingIdentityHandler<Reviewer>({
      access: {
        authenticate: (request) => {
          const token = request.headers.get("Authorization");
          return token ? { email: REVIEWER_EMAIL } : null;
        },
      },
      projectName: "my-site",
      resolveIdentity: (principal) => ({ name: "Reviewer", email: principal.email }),
      allowedHeaders: [SESSION_HEADER],
      ...(allowedOrigins ? { allowedOrigins } : {}),
    });

  it("answers the preflight of an Authorization-bearing identity request, then serves the GET", async () => {
    const handler = identityHandler([ALLOWED_ORIGIN]);

    const preflight = handler.OPTIONS(preflightRequest(IDENTITY_ENDPOINT, "GET", "authorization"));

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
    expect(allowedHeaderNames(preflight)).toEqual(["content-type", "authorization", "x-session"]);

    const response = await handler.GET(
      new Request(IDENTITY_ENDPOINT, { headers: { Origin: ALLOWED_ORIGIN, Authorization: "Bearer token" } }),
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    expect(await response.json()).toEqual({
      enabled: true,
      identity: { name: "Reviewer", email: REVIEWER_EMAIL },
      projectName: "my-site",
    });
  });

  it("answers 204 without CORS headers for an origin outside the allowlist", () => {
    const preflight = identityHandler([ALLOWED_ORIGIN]).OPTIONS(
      preflightRequest(IDENTITY_ENDPOINT, "GET", "authorization", FOREIGN_ORIGIN),
    );

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(null);
  });

  it("answers 204 without CORS headers when allowedOrigins is not set", () => {
    const preflight = identityHandler().OPTIONS(preflightRequest(IDENTITY_ENDPOINT, "GET", "authorization"));

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(null);
  });
});
