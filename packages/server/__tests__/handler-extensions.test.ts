import { MemoryStore } from "@siteping/adapter-memory";
import type { FeedbackCreateInput, FeedbackRecord, SitepingStore } from "@siteping/core";
import { describe, expect, it, vi } from "vitest";
import {
  createSitepingHandler,
  createSitepingIdentityHandler,
  type SitepingAccessControl,
  type SitepingAuthorizationContext,
  type SitepingLogger,
} from "../src/index.js";
import { validPayloadNoAnnotations } from "./fixtures.js";

const ENDPOINT = "http://localhost/api/siteping";

interface Reviewer {
  email: string;
  isAdmin: boolean;
}

const ADMIN: Reviewer = { email: "admin@example.com", isAdmin: true };
const GUEST: Reviewer = { email: "guest@example.com", isAdmin: false };

/** Session stand-in: the caller identifies through a header, as a cookie session would. */
function sessionAccess(overrides: Partial<SitepingAccessControl<Reviewer>> = {}): SitepingAccessControl<Reviewer> {
  return {
    authenticate: (request) => {
      const email = request.headers.get("x-session");
      if (email === ADMIN.email) return ADMIN;
      if (email === GUEST.email) return GUEST;
      return null;
    },
    ...overrides,
  };
}

function jsonRequest(method: string, body: unknown, session?: Reviewer): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session) headers["x-session"] = session.email;
  return new Request(ENDPOINT, { method, headers, body: JSON.stringify(body) });
}

function listRequest(projectName: string, session?: Reviewer): Request {
  const headers: Record<string, string> = session ? { "x-session": session.email } : {};
  return new Request(`${ENDPOINT}?projectName=${projectName}`, { headers });
}

/** Store input the handler derives from a widget payload without annotations. */
function storedInputOf(payload: typeof validPayloadNoAnnotations): FeedbackCreateInput {
  return {
    ...payload,
    status: "open",
    urlPattern: null,
    annotations: [],
    screenshotDataUrl: null,
    screenshotRegion: null,
    diagnostics: null,
  };
}

const silentLogger = () => ({ error: vi.fn<SitepingLogger["error"]>() });

async function createFeedback(handler: ReturnType<typeof createSitepingHandler>, session: Reviewer = ADMIN) {
  const response = await handler.POST(jsonRequest("POST", validPayloadNoAnnotations, session));
  expect(response.status).toBe(201);
  return (await response.json()) as FeedbackRecord;
}

describe("createSitepingHandler — access control", () => {
  it("answers 401 on every method when authenticate resolves no principal", async () => {
    const handler = createSitepingHandler({ store: new MemoryStore(), access: sessionAccess() });

    expect((await handler.POST(jsonRequest("POST", validPayloadNoAnnotations))).status).toBe(401);
    expect((await handler.GET(listRequest("test-project"))).status).toBe(401);
    expect((await handler.PATCH(jsonRequest("PATCH", { id: "x", projectName: "p", status: "resolved" }))).status).toBe(
      401,
    );
    expect((await handler.DELETE(jsonRequest("DELETE", { id: "x", projectName: "p" }))).status).toBe(401);
  });

  it("passes action, project and target id to authorize and answers 403 when it refuses", async () => {
    const decisions: Array<SitepingAuthorizationContext<Reviewer>> = [];
    const handler = createSitepingHandler({
      store: new MemoryStore(),
      access: sessionAccess({
        authorize: (context) => {
          decisions.push(context);
          return context.action === "create" || context.principal?.isAdmin === true;
        },
      }),
    });

    const feedback = await createFeedback(handler, GUEST);
    const guestUpdate = await handler.PATCH(
      jsonRequest("PATCH", { id: feedback.id, projectName: "test-project", status: "resolved" }, GUEST),
    );
    const adminUpdate = await handler.PATCH(
      jsonRequest("PATCH", { id: feedback.id, projectName: "test-project", status: "resolved" }, ADMIN),
    );

    expect(guestUpdate.status).toBe(403);
    expect(adminUpdate.status).toBe(200);
    expect(
      decisions.map(({ action, projectName, feedbackId, principal }) => ({
        action,
        projectName,
        feedbackId,
        principal,
      })),
    ).toEqual([
      { action: "create", projectName: "test-project", feedbackId: undefined, principal: GUEST },
      { action: "update", projectName: "test-project", feedbackId: feedback.id, principal: GUEST },
      { action: "update", projectName: "test-project", feedbackId: feedback.id, principal: ADMIN },
    ]);
  });

  it("blanks authorEmail for principals that may not read it", async () => {
    const handler = createSitepingHandler({
      store: new MemoryStore(),
      access: sessionAccess({ canReadAuthorEmail: (principal) => principal.isAdmin }),
    });
    await createFeedback(handler);

    const asGuest = (await (await handler.GET(listRequest("test-project", GUEST))).json()) as {
      feedbacks: FeedbackRecord[];
    };
    const asAdmin = (await (await handler.GET(listRequest("test-project", ADMIN))).json()) as {
      feedbacks: FeedbackRecord[];
    };

    expect(asGuest.feedbacks[0]?.authorEmail).toBe("");
    expect(asAdmin.feedbacks[0]?.authorEmail).toBe(validPayloadNoAnnotations.authorEmail);
    expect(asAdmin.feedbacks[0]).not.toHaveProperty("clientId");
  });

  it("never lets the browser cache a list response that depends on the session", async () => {
    const handler = createSitepingHandler({
      store: new MemoryStore(),
      access: sessionAccess({ canReadAuthorEmail: (principal) => principal.isAdmin }),
    });
    await createFeedback(handler);

    const response = await handler.GET(listRequest("test-project", ADMIN));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("never lets the browser cache a list response that depends on the API key", async () => {
    const handler = createSitepingHandler({ store: new MemoryStore(), apiKey: "secret-key" });

    const response = await handler.GET(
      new Request(`${ENDPOINT}?projectName=test-project`, { headers: { Authorization: "Bearer secret-key" } }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("never lets the browser cache an open list response of the shared-secret policy", async () => {
    const handler = createSitepingHandler({ store: new MemoryStore(), requireAuthForDestructive: false });

    const response = await handler.GET(listRequest("test-project"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not require an apiKey in production when a custom access policy is passed", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => createSitepingHandler({ store: new MemoryStore(), access: sessionAccess() })).not.toThrow();
      expect(() => createSitepingHandler({ store: new MemoryStore() })).toThrow(/apiKey is required in production/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

/**
 * A conformant store that leaves out the optional `verifyProjectOwnership`,
 * as a minimal third-party adapter may — every required method delegates to
 * a real `MemoryStore`.
 */
function storeWithoutOwnershipCheck(backing = new MemoryStore()): SitepingStore {
  return {
    createFeedback: (data) => backing.createFeedback(data),
    getFeedbacks: (query) => backing.getFeedbacks(query),
    findByClientId: (clientId) => backing.findByClientId(clientId),
    updateFeedback: (id, data) => backing.updateFeedback(id, data),
    deleteFeedback: (id) => backing.deleteFeedback(id),
    deleteAllFeedbacks: (projectName) => backing.deleteAllFeedbacks(projectName),
  };
}

/** Policy scoping each principal to one project: the admin to `test-project`, the guest to `guest-project`. */
const projectScopedAccess = () =>
  sessionAccess({
    authorize: ({ principal, projectName }) => projectName === (principal?.isAdmin ? "test-project" : "guest-project"),
  });

describe("createSitepingHandler — project ownership of per-record mutations", () => {
  it("refuses to start with a custom authorize over a store without verifyProjectOwnership", () => {
    expect(() => createSitepingHandler({ store: storeWithoutOwnershipCheck(), access: projectScopedAccess() })).toThrow(
      /needs a store implementing `verifyProjectOwnership`/,
    );
  });

  it("still starts over such a store when no policy scopes callers to projects", () => {
    expect(() => createSitepingHandler({ store: storeWithoutOwnershipCheck(), access: sessionAccess() })).not.toThrow();
    expect(() => createSitepingHandler({ store: storeWithoutOwnershipCheck(), apiKey: "secret-key" })).not.toThrow();
  });

  it("answers 404 and leaves the record untouched when the claimed project is not the record's", async () => {
    const store = new MemoryStore();
    const handler = createSitepingHandler({ store, access: projectScopedAccess() });
    const created = await handler.POST(
      jsonRequest("POST", { ...validPayloadNoAnnotations, projectName: "guest-project" }, GUEST),
    );
    expect(created.status).toBe(201);
    const guestFeedback = (await created.json()) as FeedbackRecord;

    const crossUpdate = await handler.PATCH(
      jsonRequest("PATCH", { id: guestFeedback.id, projectName: "test-project", status: "resolved" }, ADMIN),
    );
    const crossDelete = await handler.DELETE(
      jsonRequest("DELETE", { id: guestFeedback.id, projectName: "test-project" }, ADMIN),
    );

    expect(crossUpdate.status).toBe(404);
    expect(crossDelete.status).toBe(404);
    const [stored] = (await store.getFeedbacks({ projectName: "guest-project" })).feedbacks;
    expect(stored).toMatchObject({ id: guestFeedback.id, status: "open" });
  });
});

describe("createSitepingHandler — beforeCreate and presentFeedback", () => {
  it("stores the input rewritten by beforeCreate and authorizes its effective project", async () => {
    const authorizedProjects: string[] = [];
    const store = new MemoryStore();
    const handler = createSitepingHandler({
      store,
      access: sessionAccess({
        authorize: ({ projectName }) => {
          authorizedProjects.push(projectName);
          return true;
        },
      }),
      beforeCreate: (input, { principal }) => ({
        ...input,
        projectName: "server-project",
        authorEmail: principal?.email ?? input.authorEmail,
        message: input.message.replace(/token=\S+/g, "token=[redacted]"),
      }),
    });

    const response = await handler.POST(
      jsonRequest("POST", { ...validPayloadNoAnnotations, message: "Broken, token=abc123" }, GUEST),
    );

    expect(response.status).toBe(201);
    const [stored] = (await store.getFeedbacks({ projectName: "server-project" })).feedbacks;
    expect(stored).toMatchObject({ authorEmail: GUEST.email, message: "Broken, token=[redacted]" });
    expect(authorizedProjects).toEqual(["server-project"]);
  });

  it("applies presentFeedback to every serialized record", async () => {
    const handler = createSitepingHandler({
      store: new MemoryStore(),
      access: sessionAccess(),
      presentFeedback: (feedback) => ({ ...feedback, message: feedback.message.toUpperCase() }),
    });
    const created = await createFeedback(handler);

    const page = (await (await handler.GET(listRequest("test-project", ADMIN))).json()) as {
      feedbacks: FeedbackRecord[];
    };

    expect(created.message).toBe(validPayloadNoAnnotations.message.toUpperCase());
    expect(page.feedbacks[0]?.message).toBe(validPayloadNoAnnotations.message.toUpperCase());
  });
});

describe("createSitepingHandler — lifecycle hooks", () => {
  it("runs onCreated once per new feedback, never on a replayed clientId", async () => {
    const onCreated = vi.fn();
    const handler = createSitepingHandler({ store: new MemoryStore(), access: sessionAccess(), hooks: { onCreated } });

    const feedback = await createFeedback(handler);
    await createFeedback(handler);

    expect(onCreated).toHaveBeenCalledOnce();
    expect(onCreated.mock.calls[0]?.[0]).toMatchObject({ id: feedback.id, projectName: "test-project" });
    expect(onCreated.mock.calls[0]?.[1]).toMatchObject({ principal: ADMIN });
  });

  it("runs no creation side effect when the store returns the record a concurrent request inserted", async () => {
    class RacingStore extends MemoryStore {
      /** The concurrent request inserts right after this request's replay lookup missed. */
      private lookupsBeforeRace = 1;
      override findByClientId(clientId: string): Promise<FeedbackRecord | null> {
        if (this.lookupsBeforeRace-- > 0) return Promise.resolve(null);
        return super.findByClientId(clientId);
      }
    }
    const onCreated = vi.fn();
    const store = new RacingStore();
    const winner = await store.createFeedback(storedInputOf(validPayloadNoAnnotations));
    const handler = createSitepingHandler({ store, access: sessionAccess(), hooks: { onCreated } });

    const response = await handler.POST(jsonRequest("POST", validPayloadNoAnnotations, ADMIN));

    expect(response.status).toBe(201);
    expect(((await response.json()) as FeedbackRecord).id).toBe(winner.id);
    expect(onCreated).not.toHaveBeenCalled();
    expect((await store.getFeedbacks({ projectName: "test-project" })).total).toBe(1);
  });

  it("keeps `this` for hooks implemented as class methods", async () => {
    class IssueTrackerHooks {
      readonly createdIds: string[] = [];
      onCreated(feedback: FeedbackRecord): void {
        this.createdIds.push(feedback.id);
      }
    }
    const tracker = new IssueTrackerHooks();
    const handler = createSitepingHandler({ store: new MemoryStore(), access: sessionAccess(), hooks: tracker });

    const feedback = await createFeedback(handler);

    expect(tracker.createdIds).toEqual([feedback.id]);
  });

  it("logs a failing onCreated hook without failing the request", async () => {
    const logger = silentLogger();
    const hookError = new Error("issue tracker down");
    const handler = createSitepingHandler({
      store: new MemoryStore(),
      access: sessionAccess(),
      logger,
      hooks: { onCreated: () => Promise.reject(hookError) },
    });

    await createFeedback(handler);

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("hook onCreated failed"), { error: hookError });
  });

  it("runs onUpdated with the stored record", async () => {
    const onUpdated = vi.fn();
    const handler = createSitepingHandler({ store: new MemoryStore(), access: sessionAccess(), hooks: { onUpdated } });
    const feedback = await createFeedback(handler);

    await handler.PATCH(
      jsonRequest("PATCH", { id: feedback.id, projectName: "test-project", status: "wont_fix" }, ADMIN),
    );

    expect(onUpdated).toHaveBeenCalledOnce();
    expect(onUpdated.mock.calls[0]?.[0]).toMatchObject({ id: feedback.id, status: "wont_fix" });
  });

  it("keeps the record and answers 502 when onDeleting throws", async () => {
    const store = new MemoryStore();
    const onDeleted = vi.fn();
    const handler = createSitepingHandler({
      store,
      access: sessionAccess(),
      logger: silentLogger(),
      hooks: {
        onDeleting: () => {
          throw new Error("could not close linked issue");
        },
        onDeleted,
      },
    });
    const feedback = await createFeedback(handler);

    const response = await handler.DELETE(
      jsonRequest("DELETE", { id: feedback.id, projectName: "test-project" }, ADMIN),
    );

    expect(response.status).toBe(502);
    expect(onDeleted).not.toHaveBeenCalled();
    expect((await store.getFeedbacks({ projectName: "test-project" })).total).toBe(1);
  });

  it("passes single and whole-project deletion targets to onDeleting and onDeleted", async () => {
    const onDeleting = vi.fn();
    const onDeleted = vi.fn();
    const handler = createSitepingHandler({
      store: new MemoryStore(),
      access: sessionAccess(),
      hooks: { onDeleting, onDeleted },
    });
    const feedback = await createFeedback(handler);

    await handler.DELETE(jsonRequest("DELETE", { id: feedback.id, projectName: "test-project" }, ADMIN));
    await handler.DELETE(jsonRequest("DELETE", { projectName: "test-project", deleteAll: true }, ADMIN));

    const targets = [
      { kind: "single", id: feedback.id, projectName: "test-project" },
      { kind: "project", projectName: "test-project" },
    ];
    expect(onDeleting.mock.calls.map(([target]) => target)).toEqual(targets);
    expect(onDeleted.mock.calls.map(([target]) => target)).toEqual(targets);
  });
});

describe("createSitepingHandler — store failures", () => {
  it("reports the failure through the logger and describeError", async () => {
    const storeError = new Error("relation does not exist");
    class UnreachableStore extends MemoryStore {
      override findByClientId(): Promise<FeedbackRecord | null> {
        return Promise.reject(storeError);
      }
    }
    const failingStore: SitepingStore = new UnreachableStore();
    const logger = silentLogger();
    const handler = createSitepingHandler({
      store: failingStore,
      access: sessionAccess(),
      logger,
      describeError: (error) => (error === storeError ? "Run the SitePing migrations" : undefined),
    });

    const response = await handler.POST(jsonRequest("POST", validPayloadNoAnnotations, ADMIN));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Run the SitePing migrations" });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("create feedback failed"), {
      error: storeError,
      method: "POST",
      path: "/api/siteping",
    });
  });
});

describe("createSitepingHandler — access gate failures", () => {
  const ALLOWED_ORIGIN = "https://client-site.example";
  const sessionStoreError = new Error("session database unreachable: connection refused at 10.0.0.5:5432");
  const failingAccess = sessionAccess({ authenticate: () => Promise.reject(sessionStoreError) });

  const withOrigin = (request: Request) => {
    const headers = new Headers(request.headers);
    headers.set("Origin", ALLOWED_ORIGIN);
    return new Request(request, { headers });
  };

  it("answers a logged, CORS-readable 500 on every method when authenticate throws", async () => {
    const logger = silentLogger();
    const handler = createSitepingHandler({
      store: new MemoryStore(),
      access: failingAccess,
      allowedOrigins: [ALLOWED_ORIGIN],
      logger,
    });
    const requests = {
      GET: listRequest("test-project"),
      POST: jsonRequest("POST", validPayloadNoAnnotations),
      PATCH: jsonRequest("PATCH", { id: "x", projectName: "test-project", status: "resolved" }),
      DELETE: jsonRequest("DELETE", { id: "x", projectName: "test-project" }),
    } as const;

    for (const method of ["GET", "POST", "PATCH", "DELETE"] as const) {
      const response = await handler[method](withOrigin(requests[method]));

      expect(response.status).toBe(500);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
      expect(await response.json()).toEqual({ error: "Internal server error" });
      expect(logger.error).toHaveBeenLastCalledWith(expect.stringContaining("authenticate request failed"), {
        error: sessionStoreError,
        method,
        path: "/api/siteping",
      });
    }
  });

  it("answers the 500 when canReadAuthorEmail throws after a successful authenticate", async () => {
    const handler = createSitepingHandler({
      store: new MemoryStore(),
      access: sessionAccess({
        canReadAuthorEmail: () => {
          throw sessionStoreError;
        },
      }),
      allowedOrigins: [ALLOWED_ORIGIN],
      logger: silentLogger(),
    });

    const response = await handler.GET(withOrigin(listRequest("test-project", ADMIN)));

    expect(response.status).toBe(500);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
  });
});

/**
 * Store errors as thrown by an adapter that bundles its own copy of
 * `@siteping/core` (every published package does): same stable `code`,
 * a class identity the server's `instanceof` checks do not know.
 */
class BundledStoreNotFoundError extends Error {
  readonly code = "STORE_NOT_FOUND" as const;
}
class BundledStoreDuplicateError extends Error {
  readonly code = "STORE_DUPLICATE" as const;
}

describe("createSitepingHandler — store errors from another bundled copy of core", () => {
  it("answers 404 when the record vanishes between the ownership check and the mutation", async () => {
    class RacingStore extends MemoryStore {
      override updateFeedback(): Promise<FeedbackRecord> {
        return Promise.reject(new BundledStoreNotFoundError("Record not found"));
      }
      override deleteFeedback(): Promise<void> {
        return Promise.reject(new BundledStoreNotFoundError("Record not found"));
      }
    }
    const handler = createSitepingHandler({
      store: new RacingStore(),
      access: sessionAccess(),
      logger: silentLogger(),
    });
    const feedback = await createFeedback(handler);

    const update = await handler.PATCH(
      jsonRequest("PATCH", { id: feedback.id, projectName: "test-project", status: "resolved" }, ADMIN),
    );
    const removal = await handler.DELETE(
      jsonRequest("DELETE", { id: feedback.id, projectName: "test-project" }, ADMIN),
    );

    expect(update.status).toBe(404);
    expect(removal.status).toBe(404);
  });

  it("resolves a duplicate-clientId race to the winning record instead of a 500", async () => {
    const onCreated = vi.fn();
    class RacingStore extends MemoryStore {
      /** The concurrent request inserts right after this request's replay lookup missed. */
      private lookupsBeforeRace = 1;
      override findByClientId(clientId: string): Promise<FeedbackRecord | null> {
        if (this.lookupsBeforeRace-- > 0) return Promise.resolve(null);
        return super.findByClientId(clientId);
      }
      override async createFeedback(data: Parameters<MemoryStore["createFeedback"]>[0]): Promise<FeedbackRecord> {
        if (await super.findByClientId(data.clientId)) throw new BundledStoreDuplicateError("Duplicate record");
        return super.createFeedback(data);
      }
    }
    const store = new RacingStore();
    const winner = await store.createFeedback(storedInputOf(validPayloadNoAnnotations));
    const handler = createSitepingHandler({ store, access: sessionAccess(), hooks: { onCreated } });

    const response = await handler.POST(jsonRequest("POST", validPayloadNoAnnotations, ADMIN));

    expect(response.status).toBe(201);
    expect(((await response.json()) as FeedbackRecord).id).toBe(winner.id);
    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe("createSitepingIdentityHandler", () => {
  const identityHandler = (enabled?: boolean | ((principal: Reviewer) => boolean)) =>
    createSitepingIdentityHandler<Reviewer>({
      access: sessionAccess(),
      projectName: "my-site",
      resolveIdentity: (principal) => ({ name: principal.email.split("@")[0] ?? "", email: principal.email }),
      ...(enabled === undefined ? {} : { enabled }),
    });

  const identityRequest = (session?: Reviewer) =>
    new Request(`${ENDPOINT}/identity`, { headers: session ? { "x-session": session.email } : {} });

  it("returns the resolved identity for an enabled principal, uncached", async () => {
    const response = await identityHandler().GET(identityRequest(ADMIN));

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      enabled: true,
      identity: { name: "admin", email: ADMIN.email },
      projectName: "my-site",
    });
  });

  it("disables the widget for anonymous visitors and principals the flag excludes", async () => {
    const disabled = { enabled: false, identity: null, projectName: "my-site" };

    expect(await (await identityHandler().GET(identityRequest())).json()).toEqual(disabled);
    expect(await (await identityHandler((principal) => principal.isAdmin).GET(identityRequest(GUEST))).json()).toEqual(
      disabled,
    );
    expect(await (await identityHandler(false).GET(identityRequest(ADMIN))).json()).toEqual(disabled);
  });

  it("answers a logged, uncached, CORS-readable 500 when a callback throws", async () => {
    const allowedOrigin = "https://client-site.example";
    const sessionStoreError = new Error("session database unreachable: connection refused at 10.0.0.5:5432");
    const logger = silentLogger();
    const failingCallbacks = {
      authenticate: { access: sessionAccess({ authenticate: () => Promise.reject(sessionStoreError) }) },
      enabled: {
        access: sessionAccess(),
        enabled: () => {
          throw sessionStoreError;
        },
      },
      resolveIdentity: { access: sessionAccess(), resolveIdentity: () => Promise.reject(sessionStoreError) },
    };

    for (const callbackOptions of Object.values(failingCallbacks)) {
      const handler = createSitepingIdentityHandler<Reviewer>({
        projectName: "my-site",
        resolveIdentity: (principal) => ({ name: "Reviewer", email: principal.email }),
        allowedOrigins: [allowedOrigin],
        logger,
        ...callbackOptions,
      });

      const response = await handler.GET(
        new Request(`${ENDPOINT}/identity`, { headers: { Origin: allowedOrigin, "x-session": ADMIN.email } }),
      );

      expect(response.status).toBe(500);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(allowedOrigin);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "Internal server error" });
      expect(logger.error).toHaveBeenLastCalledWith(expect.stringContaining("resolve identity failed"), {
        error: sessionStoreError,
        method: "GET",
        path: "/api/siteping/identity",
      });
    }
    expect(logger.error).toHaveBeenCalledTimes(3);
  });
});
