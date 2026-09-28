import { MemoryStore } from "@siteping/adapter-memory";
import type { FeedbackRecord } from "@siteping/core";
import { describe, expect, it, vi } from "vitest";
import {
  createSitepingHandler,
  type SitepingAccessControl,
  type SitepingHandler,
  type SitepingLogger,
} from "../src/index.js";
import { validPayloadNoAnnotations } from "./fixtures.js";

const ENDPOINT = "http://localhost/api/siteping";
const SAME_ORIGIN = "http://localhost";
const ALLOWED_ORIGIN = "https://client-site.example";
const FOREIGN_ORIGIN = "https://attacker.example";
const SESSION_COOKIE = "session=reviewer";
const JSON_CONTENT_TYPE = "application/json";
const PLAIN_TEXT_CONTENT_TYPE = "text/plain;charset=UTF-8";

interface Reviewer {
  email: string;
}

/** Cookie session policy: the browser attaches the cookie to any request, cross-site forgeries included. */
function cookieSessionAccess(): SitepingAccessControl<Reviewer> {
  return {
    authenticate: vi.fn((request: Request) =>
      request.headers.get("Cookie") === SESSION_COOKIE ? { email: "reviewer@example.com" } : null,
    ),
  };
}

interface MutationRequestOptions {
  method: "POST" | "PATCH" | "DELETE";
  body: unknown;
  origin?: string;
  contentType?: string;
}

/** A credentialed browser request, as the page at `origin` (if any) would send it. */
function mutationRequest({ method, body, origin, contentType = JSON_CONTENT_TYPE }: MutationRequestOptions): Request {
  const headers: Record<string, string> = { Cookie: SESSION_COOKIE, "Content-Type": contentType };
  if (origin !== undefined) headers.Origin = origin;
  return new Request(ENDPOINT, { method, headers, body: JSON.stringify(body) });
}

interface HandlerSetup {
  handler: SitepingHandler;
  store: MemoryStore;
  access: SitepingAccessControl<Reviewer>;
  onCreated: ReturnType<typeof vi.fn>;
  onUpdated: ReturnType<typeof vi.fn>;
  onDeleted: ReturnType<typeof vi.fn>;
  logger: { error: ReturnType<typeof vi.fn<SitepingLogger["error"]>> };
}

/** `null` builds a handler without `allowedOrigins` (CORS disabled). */
function setupHandler(allowedOrigins: ReadonlyArray<string> | null = [ALLOWED_ORIGIN]): HandlerSetup {
  const store = new MemoryStore();
  const access = cookieSessionAccess();
  const onCreated = vi.fn();
  const onUpdated = vi.fn();
  const onDeleted = vi.fn();
  const logger = { error: vi.fn<SitepingLogger["error"]>() };
  const handler = createSitepingHandler<Reviewer>({
    store,
    access,
    allowedOrigins: allowedOrigins ?? undefined,
    logger,
    hooks: { onCreated, onUpdated, onDeleted },
  });
  return { handler, store, access, onCreated, onUpdated, onDeleted, logger };
}

async function storedFeedbacks(store: MemoryStore): Promise<FeedbackRecord[]> {
  return (await store.getFeedbacks({ projectName: validPayloadNoAnnotations.projectName })).feedbacks;
}

describe("createSitepingHandler — cross-site request forgery", () => {
  it("refuses a credentialed text/plain POST from a foreign origin before authenticating or running hooks", async () => {
    const { handler, store, access, onCreated, logger } = setupHandler();

    const response = await handler.POST(
      mutationRequest({
        method: "POST",
        body: validPayloadNoAnnotations,
        origin: FOREIGN_ORIGIN,
        contentType: PLAIN_TEXT_CONTENT_TYPE,
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await storedFeedbacks(store)).toHaveLength(0);
    expect(access.authenticate).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("origin outside allowedOrigins"),
      expect.objectContaining({ method: "POST", path: "/api/siteping", origin: FOREIGN_ORIGIN }),
    );
  });

  it("refuses a foreign origin even when it sends a JSON body", async () => {
    const { handler, store, onCreated } = setupHandler();

    const response = await handler.POST(
      mutationRequest({ method: "POST", body: validPayloadNoAnnotations, origin: FOREIGN_ORIGIN }),
    );

    expect(response.status).toBe(403);
    expect(await storedFeedbacks(store)).toHaveLength(0);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("refuses the opaque null origin of sandboxed frames", async () => {
    const { handler, store } = setupHandler();

    const response = await handler.POST(
      mutationRequest({ method: "POST", body: validPayloadNoAnnotations, origin: "null" }),
    );

    expect(response.status).toBe(403);
    expect(await storedFeedbacks(store)).toHaveLength(0);
  });

  it("refuses PATCH and DELETE from a foreign origin and leaves the record untouched", async () => {
    const { handler, store, onUpdated, onDeleted } = setupHandler();
    const created = await handler.POST(mutationRequest({ method: "POST", body: validPayloadNoAnnotations }));
    const { id } = (await created.json()) as FeedbackRecord;
    const projectName = validPayloadNoAnnotations.projectName;

    const patch = await handler.PATCH(
      mutationRequest({ method: "PATCH", body: { id, projectName, status: "resolved" }, origin: FOREIGN_ORIGIN }),
    );
    const remove = await handler.DELETE(
      mutationRequest({ method: "DELETE", body: { id, projectName }, origin: FOREIGN_ORIGIN }),
    );

    expect(patch.status).toBe(403);
    expect(remove.status).toBe(403);
    const [stored] = await storedFeedbacks(store);
    expect(stored?.status).toBe("open");
    expect(onUpdated).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("truncates the refused origin it logs", async () => {
    const { handler, logger } = setupHandler();
    const oversizedOrigin = `https://${"a".repeat(500)}.example`;

    await handler.POST(mutationRequest({ method: "POST", body: validPayloadNoAnnotations, origin: oversizedOrigin }));

    expect(logger.error).toHaveBeenCalledOnce();
    const [, context] = logger.error.mock.calls[0] ?? [];
    expect(context?.origin).toBe(oversizedOrigin.slice(0, 128));
  });

  it.each([
    ["an origin listed in allowedOrigins", ALLOWED_ORIGIN],
    ["the endpoint's own origin", SAME_ORIGIN],
    ["no Origin header (server-to-server, curl)", undefined],
  ])("serves a JSON POST from %s", async (_label, origin) => {
    const { handler, store, onCreated } = setupHandler();

    const response = await handler.POST(
      mutationRequest({ method: "POST", body: validPayloadNoAnnotations, ...(origin ? { origin } : {}) }),
    );

    expect(response.status).toBe(201);
    expect(await storedFeedbacks(store)).toHaveLength(1);
    expect(onCreated).toHaveBeenCalledOnce();
  });

  it("accepts a JSON content type carrying parameters", async () => {
    const { handler, store } = setupHandler();

    const response = await handler.POST(
      mutationRequest({
        method: "POST",
        body: validPayloadNoAnnotations,
        origin: ALLOWED_ORIGIN,
        contentType: "Application/JSON; charset=utf-8",
      }),
    );

    expect(response.status).toBe(201);
    expect(await storedFeedbacks(store)).toHaveLength(1);
  });

  it("answers 415 to a non-JSON body from an allowed origin, without creating anything", async () => {
    const { handler, store, access, onCreated } = setupHandler();

    const response = await handler.POST(
      mutationRequest({
        method: "POST",
        body: validPayloadNoAnnotations,
        origin: ALLOWED_ORIGIN,
        contentType: PLAIN_TEXT_CONTENT_TYPE,
      }),
    );

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: "Content-Type must be application/json" });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    expect(await storedFeedbacks(store)).toHaveLength(0);
    expect(access.authenticate).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("answers 415 to a CORS-simple forgery when no allowedOrigins is configured", async () => {
    const { handler, store, onCreated } = setupHandler(null);

    const response = await handler.POST(
      mutationRequest({
        method: "POST",
        body: validPayloadNoAnnotations,
        origin: FOREIGN_ORIGIN,
        contentType: PLAIN_TEXT_CONTENT_TYPE,
      }),
    );

    expect(response.status).toBe(415);
    expect(await storedFeedbacks(store)).toHaveLength(0);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("answers 415 to a PATCH without Content-Type", async () => {
    const { handler, store } = setupHandler();
    const created = await handler.POST(mutationRequest({ method: "POST", body: validPayloadNoAnnotations }));
    const { id } = (await created.json()) as FeedbackRecord;

    const response = await handler.PATCH(
      new Request(ENDPOINT, {
        method: "PATCH",
        headers: { Cookie: SESSION_COOKIE },
        body: new Blob([
          JSON.stringify({ id, projectName: validPayloadNoAnnotations.projectName, status: "resolved" }),
        ]),
      }),
    );

    expect(response.status).toBe(415);
    const [stored] = await storedFeedbacks(store);
    expect(stored?.status).toBe("open");
  });
});
