import { type BeezpingStore, buildFeedbackRecord } from "@beezping/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBeezpingHandler } from "../src/index.js";
import { validAnnotation, validPayloadNoAnnotations } from "./fixtures.js";

// NOTE: the type-level regression guard for #99 (delegate bivariance) lives in
// src/index.ts next to PrismaModelDelegate, where it documents the constraint
// at the definition site.

function mockPrisma() {
  return {
    beezpingFeedback: {
      create: vi.fn().mockResolvedValue({
        id: "fb-1",
        ...validPayloadNoAnnotations,
        status: "open",
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        annotations: [],
      }),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi
        .fn()
        .mockResolvedValue({ id: "fb-1", status: "resolved", resolvedAt: new Date().toISOString(), annotations: [] }),
      delete: vi.fn().mockResolvedValue({ id: "fb-1" }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

describe("createBeezpingHandler", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let handler: ReturnType<typeof createBeezpingHandler>;

  beforeEach(() => {
    prisma = mockPrisma();
    // These tests focus on validation/persistence/error paths; the destructive-op
    // auth gate is exercised in auth-cors.test.ts.
    handler = createBeezpingHandler({ prisma, requireAuthForDestructive: false });
  });

  describe("POST", () => {
    it("creates a feedback with valid payload", async () => {
      const req = new Request("http://localhost/api/beezping", {
        method: "POST",
        body: JSON.stringify(validPayloadNoAnnotations),
      });
      const res = await handler.POST(req);
      expect(res.status).toBe(201);
      expect(prisma.beezpingFeedback.create).toHaveBeenCalledOnce();
    });

    it("returns 400 for invalid JSON", async () => {
      const req = new Request("http://localhost/api/beezping", {
        method: "POST",
        body: "not json",
      });
      const res = await handler.POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 for missing required fields", async () => {
      const req = new Request("http://localhost/api/beezping", {
        method: "POST",
        body: JSON.stringify({ type: "bug" }),
      });
      const res = await handler.POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.errors).toBeDefined();
      expect(body.errors.length).toBeGreaterThan(0);
    });

    it("returns 400 for invalid email", async () => {
      const req = new Request("http://localhost/api/beezping", {
        method: "POST",
        body: JSON.stringify({ ...validPayloadNoAnnotations, authorEmail: "not-email" }),
      });
      const res = await handler.POST(req);
      expect(res.status).toBe(400);
    });

    it("answers 422, which the widget never retries, to a value longer than its MySQL column", async () => {
      // P2000: a 268-character in-app browser user agent in a VARCHAR(191).
      prisma.beezpingFeedback.create.mockRejectedValue({ code: "P2000" });
      const logger = { error: vi.fn() };
      const req = new Request("http://localhost/api/beezping", {
        method: "POST",
        body: JSON.stringify({ ...validPayloadNoAnnotations, userAgent: "u".repeat(268) }),
      });

      const res = await createBeezpingHandler({ prisma, logger }).POST(req);

      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: "A value is too long for this server's database" });
      expect(logger.error).toHaveBeenCalledWith("[beezping] A value is too long for the store", expect.anything());
    });

    it("handles duplicate clientId gracefully", async () => {
      prisma.beezpingFeedback.create.mockRejectedValue({ code: "P2002" });
      prisma.beezpingFeedback.findUnique.mockResolvedValue({ id: "fb-1", ...validPayloadNoAnnotations });
      const req = new Request("http://localhost/api/beezping", {
        method: "POST",
        body: JSON.stringify(validPayloadNoAnnotations),
      });
      const res = await handler.POST(req);
      expect(res.status).toBe(201);
    });

    it("handles a unique-constraint race (P2002 after the replay check) gracefully", async () => {
      // findUnique sees nothing, the insert collides, findUnique then finds the winner.
      prisma.beezpingFeedback.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "fb-1", ...validPayloadNoAnnotations });
      prisma.beezpingFeedback.create.mockRejectedValue({ code: "P2002" });
      const req = new Request("http://localhost/api/beezping", {
        method: "POST",
        body: JSON.stringify(validPayloadNoAnnotations),
      });
      const res = await handler.POST(req);
      expect(res.status).toBe(201);
    });

    it("answers a CORS-enabled JSON 500 when the duplicate-race lookup itself fails", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const origin = "https://app.example.com";
      const corsHandler = createBeezpingHandler({ prisma, allowedOrigins: [origin] });
      // Replay check sees nothing, the insert collides, then the re-lookup fails.
      prisma.beezpingFeedback.findUnique
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error("connection reset"));
      prisma.beezpingFeedback.create.mockRejectedValue({ code: "P2002" });

      const res = await corsHandler.POST(
        new Request("http://localhost/api/beezping", {
          method: "POST",
          headers: { Origin: origin },
          body: JSON.stringify(validPayloadNoAnnotations),
        }),
      );

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Internal server error" });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      consoleSpy.mockRestore();
    });

    it("processes a retry afresh after the create for its clientId failed", async () => {
      // A failed create must leave the in-flight registry: a retry that joined
      // the settled rejection would answer 500 forever for that clientId.
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      prisma.beezpingFeedback.create.mockRejectedValueOnce({ code: "P1001" });
      const post = () =>
        handler.POST(
          new Request("http://localhost/api/beezping", {
            method: "POST",
            body: JSON.stringify(validPayloadNoAnnotations),
          }),
        );

      expect((await post()).status).toBe(500);
      expect((await post()).status).toBe(201);
      expect(prisma.beezpingFeedback.create).toHaveBeenCalledTimes(2);
      consoleSpy.mockRestore();
    });

    it("runs its own replay lookup once an earlier create of the same clientId has settled", async () => {
      const post = () =>
        handler.POST(
          new Request("http://localhost/api/beezping", {
            method: "POST",
            body: JSON.stringify(validPayloadNoAnnotations),
          }),
        );

      expect((await post()).status).toBe(201);
      expect((await post()).status).toBe(201);
      // One replay lookup per request: the second never joined the first's settled outcome.
      expect(prisma.beezpingFeedback.findUnique).toHaveBeenCalledTimes(2);
    });

    it("does not insert again when the clientId was already stored (replay)", async () => {
      prisma.beezpingFeedback.findUnique.mockResolvedValue({ id: "fb-1", ...validPayloadNoAnnotations });
      const req = new Request("http://localhost/api/beezping", {
        method: "POST",
        body: JSON.stringify(validPayloadNoAnnotations),
      });
      const res = await handler.POST(req);
      expect(res.status).toBe(201);
      expect(prisma.beezpingFeedback.create).not.toHaveBeenCalled();
    });

    it("answers 409 when the clientId already belongs to another project's record", async () => {
      // A clientId is unique across the whole store — a replay that resolves
      // to a foreign project's record must not hand that record over.
      prisma.beezpingFeedback.findUnique.mockResolvedValue({
        id: "fb-1",
        ...validPayloadNoAnnotations,
        projectName: "another-project",
      });
      const req = new Request("http://localhost/api/beezping", {
        method: "POST",
        body: JSON.stringify(validPayloadNoAnnotations),
      });
      const res = await handler.POST(req);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "clientId already used by another project" });
      expect(prisma.beezpingFeedback.create).not.toHaveBeenCalled();
    });

    it("returns 500 on unexpected DB error", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      prisma.beezpingFeedback.create.mockRejectedValue(new Error("DB down"));
      const req = new Request("http://localhost/api/beezping", {
        method: "POST",
        body: JSON.stringify(validPayloadNoAnnotations),
      });
      const res = await handler.POST(req);
      expect(res.status).toBe(500);
      consoleSpy.mockRestore();
    });

    it("maps annotation anchor fields to Prisma create", async () => {
      const payloadWithAnnotation = {
        ...validPayloadNoAnnotations,
        annotations: [validAnnotation],
      };

      const req = new Request("http://localhost/api/beezping", {
        method: "POST",
        body: JSON.stringify(payloadWithAnnotation),
      });

      await handler.POST(req);

      expect(prisma.beezpingFeedback.create).toHaveBeenCalledOnce();
      const createArg = prisma.beezpingFeedback.create.mock.calls[0]?.[0] as {
        data: { annotations: { create: Array<Record<string, unknown>> } };
      };
      const [flatAnnotation] = createArg.data.annotations.create;
      if (!flatAnnotation) throw new Error("expected one annotation in the Prisma create payload");

      expect(flatAnnotation.cssSelector).toBe("div.main > section:nth-child(2)");
      expect(flatAnnotation.xpath).toBe("/html/body/div[1]/section[2]");
      expect(flatAnnotation.textSnippet).toBe("Welcome to our platform");
      expect(flatAnnotation.elementTag).toBe("SECTION");
      expect(flatAnnotation.elementId).toBe("hero");
      expect(flatAnnotation.textPrefix).toBe("Navigation links here");
      expect(flatAnnotation.textSuffix).toBe("Learn more about us");
      expect(flatAnnotation.fingerprint).toBe("3:1:a1b2c3");
      expect(flatAnnotation.neighborText).toBe("Previous section | Next section");
      expect(flatAnnotation.xPct).toBe(0.1);
      expect(flatAnnotation.yPct).toBe(0.2);
      expect(flatAnnotation.wPct).toBe(0.5);
      expect(flatAnnotation.hPct).toBe(0.3);
      expect(flatAnnotation.scrollX).toBe(0);
      expect(flatAnnotation.scrollY).toBe(150);
      expect(flatAnnotation.viewportW).toBe(1920);
      expect(flatAnnotation.viewportH).toBe(1080);
      expect(flatAnnotation.devicePixelRatio).toBe(2);
    });

    it("passes screenshotRegion into Prisma create", async () => {
      const region = { xPct: 0.25, yPct: 0.4, wPct: 0.3, hPct: 0.1 };
      const req = new Request("http://localhost/api/beezping", {
        method: "POST",
        body: JSON.stringify({ ...validPayloadNoAnnotations, screenshotRegion: region }),
      });
      const res = await handler.POST(req);
      expect(res.status).toBe(201);
      const createArg = prisma.beezpingFeedback.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(createArg.data.screenshotRegion).toEqual(region);
    });

    it("omits the screenshotRegion column when the payload has none (unsynced schemas)", async () => {
      const req = new Request("http://localhost/api/beezping", {
        method: "POST",
        body: JSON.stringify(validPayloadNoAnnotations),
      });
      const res = await handler.POST(req);
      expect(res.status).toBe(201);
      const createArg = prisma.beezpingFeedback.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(createArg.data).not.toHaveProperty("screenshotRegion");
    });

    it("returns 400 for an invalid screenshotRegion", async () => {
      const req = new Request("http://localhost/api/beezping", {
        method: "POST",
        body: JSON.stringify({
          ...validPayloadNoAnnotations,
          screenshotRegion: { xPct: 1.5, yPct: 0, wPct: 0.5, hPct: 0.5 },
        }),
      });
      const res = await handler.POST(req);
      expect(res.status).toBe(400);
      expect(prisma.beezpingFeedback.create).not.toHaveBeenCalled();
    });
  });

  describe("GET", () => {
    it("returns feedbacks for a project", async () => {
      prisma.beezpingFeedback.findMany.mockResolvedValue([]);
      prisma.beezpingFeedback.count.mockResolvedValue(0);
      const req = new Request("http://localhost/api/beezping?projectName=test");
      const res = await handler.GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("feedbacks");
      expect(body).toHaveProperty("total");
    });

    it("returns 400 without projectName", async () => {
      const req = new Request("http://localhost/api/beezping");
      const res = await handler.GET(req);
      expect(res.status).toBe(400);
    });

    it("rejects limit > 100 via Zod validation", async () => {
      const req = new Request("http://localhost/api/beezping?projectName=test&limit=999");
      const res = await handler.GET(req);
      expect(res.status).toBe(400);
    });

    it("applies type and status filters", async () => {
      prisma.beezpingFeedback.findMany.mockResolvedValue([]);
      prisma.beezpingFeedback.count.mockResolvedValue(0);
      const req = new Request("http://localhost/api/beezping?projectName=test&type=bug&status=open");
      await handler.GET(req);
      const callArgs = prisma.beezpingFeedback.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
      expect(callArgs.where.type).toBe("bug");
      expect(callArgs.where.status).toBe("open");
    });

    it.each(["in_progress", "wont_fix"] as const)("applies the %s status filter", async (status) => {
      prisma.beezpingFeedback.findMany.mockResolvedValue([]);
      prisma.beezpingFeedback.count.mockResolvedValue(0);
      const req = new Request(`http://localhost/api/beezping?projectName=test&status=${status}`);
      const res = await handler.GET(req);
      expect(res.status).toBe(200);
      const callArgs = prisma.beezpingFeedback.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
      expect(callArgs.where.status).toBe(status);
    });

    it("applies a statuses bucket as where.status.in", async () => {
      prisma.beezpingFeedback.findMany.mockResolvedValue([]);
      prisma.beezpingFeedback.count.mockResolvedValue(0);
      const req = new Request("http://localhost/api/beezping?projectName=test&statuses=open,in_progress");
      const res = await handler.GET(req);
      expect(res.status).toBe(200);
      const callArgs = prisma.beezpingFeedback.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
      expect(callArgs.where.status).toEqual({ in: ["open", "in_progress"] });
    });

    it("prefers the statuses bucket over an exact status when both are present", async () => {
      prisma.beezpingFeedback.findMany.mockResolvedValue([]);
      prisma.beezpingFeedback.count.mockResolvedValue(0);
      const req = new Request("http://localhost/api/beezping?projectName=test&status=open&statuses=resolved,wont_fix");
      const res = await handler.GET(req);
      expect(res.status).toBe(200);
      const callArgs = prisma.beezpingFeedback.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
      expect(callArgs.where.status).toEqual({ in: ["resolved", "wont_fix"] });
    });

    it("rejects a statuses bucket with an unknown value", async () => {
      const req = new Request("http://localhost/api/beezping?projectName=test&statuses=open,bogus");
      const res = await handler.GET(req);
      expect(res.status).toBe(400);
    });

    describe("?search filter — case-insensitive mode", () => {
      it("falls back to omitting mode when the active provider can't be detected", async () => {
        // The default mockPrisma() exposes none of the internal probe paths,
        // so detectActiveProvider returns null. The safe default is to omit
        // `mode` — `contains` works on every provider; `mode: "insensitive"`
        // would throw on MySQL/SQLite/SQL Server.
        prisma.beezpingFeedback.findMany.mockResolvedValue([]);
        prisma.beezpingFeedback.count.mockResolvedValue(0);
        const req = new Request("http://localhost/api/beezping?projectName=test&search=hello");
        await handler.GET(req);
        const callArgs = prisma.beezpingFeedback.findMany.mock.calls[0]?.[0] as {
          where: { message?: { contains: string; mode?: string } };
        };
        expect(callArgs.where.message).toEqual({ contains: "hello" });
        expect(callArgs.where.message).not.toHaveProperty("mode");
      });

      it("omits mode when caseInsensitiveSearch:false is passed explicitly", async () => {
        const sqliteHandler = createBeezpingHandler({ prisma, caseInsensitiveSearch: false });
        prisma.beezpingFeedback.findMany.mockResolvedValue([]);
        prisma.beezpingFeedback.count.mockResolvedValue(0);
        const req = new Request("http://localhost/api/beezping?projectName=test&search=hello");
        await sqliteHandler.GET(req);
        const callArgs = prisma.beezpingFeedback.findMany.mock.calls[0]?.[0] as {
          where: { message?: { contains: string; mode?: string } };
        };
        expect(callArgs.where.message).toEqual({ contains: "hello" });
        expect(callArgs.where.message).not.toHaveProperty("mode");
      });

      it("auto-detects sqlite via _activeProvider and omits mode", async () => {
        const sqlitePrisma = Object.assign(mockPrisma(), { _activeProvider: "sqlite" });
        const sqliteHandler = createBeezpingHandler({ prisma: sqlitePrisma });
        sqlitePrisma.beezpingFeedback.findMany.mockResolvedValue([]);
        sqlitePrisma.beezpingFeedback.count.mockResolvedValue(0);
        const req = new Request("http://localhost/api/beezping?projectName=test&search=hello");
        await sqliteHandler.GET(req);
        const callArgs = sqlitePrisma.beezpingFeedback.findMany.mock.calls[0]?.[0] as {
          where: { message?: { contains: string; mode?: string } };
        };
        expect(callArgs.where.message).toEqual({ contains: "hello" });
      });

      it("auto-detects postgresql via _activeProvider and keeps mode", async () => {
        const pgPrisma = Object.assign(mockPrisma(), { _activeProvider: "postgresql" });
        const pgHandler = createBeezpingHandler({ prisma: pgPrisma });
        pgPrisma.beezpingFeedback.findMany.mockResolvedValue([]);
        pgPrisma.beezpingFeedback.count.mockResolvedValue(0);
        const req = new Request("http://localhost/api/beezping?projectName=test&search=hello");
        await pgHandler.GET(req);
        const callArgs = pgPrisma.beezpingFeedback.findMany.mock.calls[0]?.[0] as {
          where: { message?: { contains: string; mode?: string } };
        };
        expect(callArgs.where.message).toEqual({ contains: "hello", mode: "insensitive" });
      });

      it("explicit caseInsensitiveSearch:true overrides sqlite auto-detect", async () => {
        const sqlitePrisma = Object.assign(mockPrisma(), { _activeProvider: "sqlite" });
        const overriddenHandler = createBeezpingHandler({
          prisma: sqlitePrisma,
          caseInsensitiveSearch: true,
        });
        sqlitePrisma.beezpingFeedback.findMany.mockResolvedValue([]);
        sqlitePrisma.beezpingFeedback.count.mockResolvedValue(0);
        const req = new Request("http://localhost/api/beezping?projectName=test&search=hello");
        await overriddenHandler.GET(req);
        const callArgs = sqlitePrisma.beezpingFeedback.findMany.mock.calls[0]?.[0] as {
          where: { message?: { contains: string; mode?: string } };
        };
        expect(callArgs.where.message).toEqual({ contains: "hello", mode: "insensitive" });
      });

      it("does not touch where.message when search is absent", async () => {
        const sqliteHandler = createBeezpingHandler({ prisma, caseInsensitiveSearch: false });
        prisma.beezpingFeedback.findMany.mockResolvedValue([]);
        prisma.beezpingFeedback.count.mockResolvedValue(0);
        const req = new Request("http://localhost/api/beezping?projectName=test");
        await sqliteHandler.GET(req);
        const callArgs = prisma.beezpingFeedback.findMany.mock.calls[0]?.[0] as {
          where: Record<string, unknown>;
        };
        expect(callArgs.where).not.toHaveProperty("message");
      });

      it("auto-detects mysql via _activeProvider and omits mode", async () => {
        // MySQL's generated Prisma client does not expose `mode?:` on string
        // filters — passing it raises `Unknown argument 'mode'` at runtime.
        const mysqlPrisma = Object.assign(mockPrisma(), { _activeProvider: "mysql" });
        const mysqlHandler = createBeezpingHandler({ prisma: mysqlPrisma });
        mysqlPrisma.beezpingFeedback.findMany.mockResolvedValue([]);
        mysqlPrisma.beezpingFeedback.count.mockResolvedValue(0);
        const req = new Request("http://localhost/api/beezping?projectName=test&search=hello");
        await mysqlHandler.GET(req);
        const callArgs = mysqlPrisma.beezpingFeedback.findMany.mock.calls[0]?.[0] as {
          where: { message?: { contains: string; mode?: string } };
        };
        expect(callArgs.where.message).not.toHaveProperty("mode");
      });

      it("auto-detects mongodb via _activeProvider and keeps mode", async () => {
        // MongoDB's generated Prisma client exposes `mode?: QueryMode` (Prisma
        // compiles it to a case-insensitive $regex under the hood).
        const mongoPrisma = Object.assign(mockPrisma(), { _activeProvider: "mongodb" });
        const mongoHandler = createBeezpingHandler({ prisma: mongoPrisma });
        mongoPrisma.beezpingFeedback.findMany.mockResolvedValue([]);
        mongoPrisma.beezpingFeedback.count.mockResolvedValue(0);
        const req = new Request("http://localhost/api/beezping?projectName=test&search=hello");
        await mongoHandler.GET(req);
        const callArgs = mongoPrisma.beezpingFeedback.findMany.mock.calls[0]?.[0] as {
          where: { message?: { contains: string; mode?: string } };
        };
        expect(callArgs.where.message).toEqual({ contains: "hello", mode: "insensitive" });
      });

      it("auto-detects cockroachdb via _activeProvider and keeps mode", async () => {
        const cockroachPrisma = Object.assign(mockPrisma(), { _activeProvider: "cockroachdb" });
        const cockroachHandler = createBeezpingHandler({ prisma: cockroachPrisma });
        cockroachPrisma.beezpingFeedback.findMany.mockResolvedValue([]);
        cockroachPrisma.beezpingFeedback.count.mockResolvedValue(0);
        const req = new Request("http://localhost/api/beezping?projectName=test&search=hello");
        await cockroachHandler.GET(req);
        const callArgs = cockroachPrisma.beezpingFeedback.findMany.mock.calls[0]?.[0] as {
          where: { message?: { contains: string; mode?: string } };
        };
        expect(callArgs.where.message).toEqual({ contains: "hello", mode: "insensitive" });
      });

      it("auto-detects sqlserver via _activeProvider and omits mode", async () => {
        const mssqlPrisma = Object.assign(mockPrisma(), { _activeProvider: "sqlserver" });
        const mssqlHandler = createBeezpingHandler({ prisma: mssqlPrisma });
        mssqlPrisma.beezpingFeedback.findMany.mockResolvedValue([]);
        mssqlPrisma.beezpingFeedback.count.mockResolvedValue(0);
        const req = new Request("http://localhost/api/beezping?projectName=test&search=hello");
        await mssqlHandler.GET(req);
        const callArgs = mssqlPrisma.beezpingFeedback.findMany.mock.calls[0]?.[0] as {
          where: { message?: { contains: string; mode?: string } };
        };
        expect(callArgs.where.message).not.toHaveProperty("mode");
      });

      it("reads provider from _engineConfig.activeProvider when _activeProvider is missing", async () => {
        const altPrisma = Object.assign(mockPrisma(), { _engineConfig: { activeProvider: "postgresql" } });
        const altHandler = createBeezpingHandler({ prisma: altPrisma });
        altPrisma.beezpingFeedback.findMany.mockResolvedValue([]);
        altPrisma.beezpingFeedback.count.mockResolvedValue(0);
        const req = new Request("http://localhost/api/beezping?projectName=test&search=hello");
        await altHandler.GET(req);
        const callArgs = altPrisma.beezpingFeedback.findMany.mock.calls[0]?.[0] as {
          where: { message?: { contains: string; mode?: string } };
        };
        expect(callArgs.where.message).toEqual({ contains: "hello", mode: "insensitive" });
      });

      it("survives a prisma client whose provider probe throws", async () => {
        // Some test doubles use Proxies whose get-traps throw — the constructor
        // must still build a working store rather than crash.
        const throwingPrisma = new Proxy(mockPrisma(), {
          get(target, prop, receiver) {
            if (prop === "_activeProvider" || prop === "_engineConfig" || prop === "_engine") {
              throw new Error("probe denied");
            }
            return Reflect.get(target, prop, receiver);
          },
        }) as unknown as ReturnType<typeof mockPrisma>;
        const throwingHandler = createBeezpingHandler({ prisma: throwingPrisma });
        throwingPrisma.beezpingFeedback.findMany.mockResolvedValue([]);
        throwingPrisma.beezpingFeedback.count.mockResolvedValue(0);
        const req = new Request("http://localhost/api/beezping?projectName=test&search=hello");
        await throwingHandler.GET(req);
        const callArgs = throwingPrisma.beezpingFeedback.findMany.mock.calls[0]?.[0] as {
          where: { message?: { contains: string; mode?: string } };
        };
        // Probe threw → fallback → no mode (safe default).
        expect(callArgs.where.message).not.toHaveProperty("mode");
      });
    });
  });

  describe("PATCH", () => {
    it("resolves a feedback", async () => {
      prisma.beezpingFeedback.findUnique.mockResolvedValue({ id: "fb-1", projectName: "test-project" });
      prisma.beezpingFeedback.update.mockResolvedValue({
        id: "fb-1",
        projectName: "test-project",
        status: "resolved",
        resolvedAt: new Date().toISOString(),
        annotations: [],
      });
      const req = new Request("http://localhost/api/beezping", {
        method: "PATCH",
        body: JSON.stringify({ id: "fb-1", projectName: "test-project", status: "resolved" }),
      });
      const res = await handler.PATCH(req);
      expect(res.status).toBe(200);
      const updateArgs = prisma.beezpingFeedback.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(updateArgs.data.status).toBe("resolved");
      expect(updateArgs.data.resolvedAt).toBeInstanceOf(Date);
    });

    it("unresolves a feedback (clears resolvedAt)", async () => {
      prisma.beezpingFeedback.findUnique.mockResolvedValue({ id: "fb-1", projectName: "test-project" });
      prisma.beezpingFeedback.update.mockResolvedValue({
        id: "fb-1",
        projectName: "test-project",
        status: "open",
        resolvedAt: null,
        annotations: [],
      });
      const req = new Request("http://localhost/api/beezping", {
        method: "PATCH",
        body: JSON.stringify({ id: "fb-1", projectName: "test-project", status: "open" }),
      });
      await handler.PATCH(req);
      const updateArgs = prisma.beezpingFeedback.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(updateArgs.data.resolvedAt).toBeNull();
    });

    // resolvedAt is the CLOSURE timestamp — derived at the handler edge from
    // the status: set for terminal statuses (resolved, wont_fix), null for
    // active ones (open, in_progress).
    it.each([
      ["open", null],
      ["in_progress", null],
      ["resolved", "date"],
      ["wont_fix", "date"],
    ] as const)("PATCH to %s derives resolvedAt = %s", async (status, expected) => {
      prisma.beezpingFeedback.findUnique.mockResolvedValue({ id: "fb-1", projectName: "test-project" });
      prisma.beezpingFeedback.update.mockResolvedValue({
        id: "fb-1",
        projectName: "test-project",
        status,
        resolvedAt: expected === "date" ? new Date().toISOString() : null,
        annotations: [],
      });
      const req = new Request("http://localhost/api/beezping", {
        method: "PATCH",
        body: JSON.stringify({ id: "fb-1", projectName: "test-project", status }),
      });
      const res = await handler.PATCH(req);
      expect(res.status).toBe(200);
      const updateArgs = prisma.beezpingFeedback.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(updateArgs.data.status).toBe(status);
      if (expected === "date") {
        expect(updateArgs.data.resolvedAt).toBeInstanceOf(Date);
      } else {
        expect(updateArgs.data.resolvedAt).toBeNull();
      }
    });

    it("returns 404 when feedback belongs to a different project", async () => {
      prisma.beezpingFeedback.findUnique.mockResolvedValue({ id: "fb-1", projectName: "other-project" });
      const req = new Request("http://localhost/api/beezping", {
        method: "PATCH",
        body: JSON.stringify({ id: "fb-1", projectName: "test-project", status: "resolved" }),
      });
      const res = await handler.PATCH(req);
      expect(res.status).toBe(404);
      expect(prisma.beezpingFeedback.update).not.toHaveBeenCalled();
    });

    it("returns 404 when feedback does not exist", async () => {
      prisma.beezpingFeedback.findUnique.mockResolvedValue(null);
      const req = new Request("http://localhost/api/beezping", {
        method: "PATCH",
        body: JSON.stringify({ id: "nonexistent", projectName: "test-project", status: "resolved" }),
      });
      const res = await handler.PATCH(req);
      expect(res.status).toBe(404);
      expect(prisma.beezpingFeedback.update).not.toHaveBeenCalled();
    });

    it("returns 400 for invalid status", async () => {
      const req = new Request("http://localhost/api/beezping", {
        method: "PATCH",
        body: JSON.stringify({ id: "fb-1", projectName: "test-project", status: "pending" }),
      });
      const res = await handler.PATCH(req);
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE", () => {
    it("deletes a single feedback by id", async () => {
      prisma.beezpingFeedback.findUnique.mockResolvedValue({ id: "fb-1", projectName: "test-project" });
      const req = new Request("http://localhost/api/beezping", {
        method: "DELETE",
        body: JSON.stringify({ id: "fb-1", projectName: "test-project" }),
      });
      const res = await handler.DELETE(req);
      expect(res.status).toBe(200);
      expect(prisma.beezpingFeedback.delete).toHaveBeenCalledWith({ where: { id: "fb-1" } });
    });

    it("deletes all feedbacks for a project", async () => {
      const req = new Request("http://localhost/api/beezping", {
        method: "DELETE",
        body: JSON.stringify({ projectName: "test", deleteAll: true }),
      });
      const res = await handler.DELETE(req);
      expect(res.status).toBe(200);
      expect(prisma.beezpingFeedback.deleteMany).toHaveBeenCalledWith({ where: { projectName: "test" } });
    });

    it("returns 400 for invalid JSON", async () => {
      const req = new Request("http://localhost/api/beezping", {
        method: "DELETE",
        body: "not json",
      });
      const res = await handler.DELETE(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 for empty body", async () => {
      const req = new Request("http://localhost/api/beezping", {
        method: "DELETE",
        body: JSON.stringify({}),
      });
      const res = await handler.DELETE(req);
      expect(res.status).toBe(400);
    });

    it("returns 404 when feedback not found (P2025)", async () => {
      prisma.beezpingFeedback.findUnique.mockResolvedValue({ id: "nonexistent", projectName: "test-project" });
      prisma.beezpingFeedback.delete.mockRejectedValue({ code: "P2025" });
      const req = new Request("http://localhost/api/beezping", {
        method: "DELETE",
        body: JSON.stringify({ id: "nonexistent", projectName: "test-project" }),
      });
      const res = await handler.DELETE(req);
      expect(res.status).toBe(404);
    });

    it("returns 500 on unexpected DB error", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      prisma.beezpingFeedback.findUnique.mockResolvedValue({ id: "fb-1", projectName: "test-project" });
      prisma.beezpingFeedback.delete.mockRejectedValue(new Error("DB down"));
      const req = new Request("http://localhost/api/beezping", {
        method: "DELETE",
        body: JSON.stringify({ id: "fb-1", projectName: "test-project" }),
      });
      const res = await handler.DELETE(req);
      expect(res.status).toBe(500);
      consoleSpy.mockRestore();
    });
  });

  // clientId is a browser-local dedup secret and authorEmail is PII — the
  // handler strips/redacts them at the HTTP edge (#105); stores stay raw.
  describe("response redaction", () => {
    function feedbackRow(overrides: Record<string, unknown> = {}) {
      return {
        id: "fb-1",
        ...validPayloadNoAnnotations,
        status: "open",
        resolvedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        annotations: [],
        ...overrides,
      };
    }

    it("GET without apiKey blanks authorEmail and strips clientId on every feedback", async () => {
      prisma.beezpingFeedback.findMany.mockResolvedValue([
        feedbackRow(),
        feedbackRow({ id: "fb-2", clientId: "uuid-456", authorEmail: "bob@example.com" }),
      ]);
      prisma.beezpingFeedback.count.mockResolvedValue(2);
      const res = await handler.GET(new Request("http://localhost/api/beezping?projectName=test-project"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.feedbacks).toHaveLength(2);
      for (const row of body.feedbacks) {
        expect(row.authorEmail).toBe("");
        expect("clientId" in row).toBe(false);
      }
    });

    it("POST 201 strips clientId but keeps the submitter's own authorEmail", async () => {
      const req = new Request("http://localhost/api/beezping", {
        method: "POST",
        body: JSON.stringify(validPayloadNoAnnotations),
      });
      const res = await handler.POST(req);
      expect(res.status).toBe(201);
      const body = await res.json();
      expect("clientId" in body).toBe(false);
      expect(body.authorEmail).toBe("alice@example.com");
    });

    it("POST dedup response strips clientId (no record-theft oracle) and keeps authorEmail", async () => {
      prisma.beezpingFeedback.create.mockRejectedValue({ code: "P2002" });
      prisma.beezpingFeedback.findUnique.mockResolvedValue(feedbackRow());
      const req = new Request("http://localhost/api/beezping", {
        method: "POST",
        body: JSON.stringify(validPayloadNoAnnotations),
      });
      const res = await handler.POST(req);
      expect(res.status).toBe(201);
      const body = await res.json();
      expect("clientId" in body).toBe(false);
      expect(body.authorEmail).toBe("alice@example.com");
    });

    it("unauthenticated PATCH blanks authorEmail and strips clientId", async () => {
      // handler has requireAuthForDestructive: false and no apiKey → PATCH is reachable unauthenticated
      prisma.beezpingFeedback.findUnique.mockResolvedValue({ id: "fb-1", projectName: "test-project" });
      prisma.beezpingFeedback.update.mockResolvedValue(feedbackRow({ status: "resolved" }));
      const req = new Request("http://localhost/api/beezping", {
        method: "PATCH",
        body: JSON.stringify({ id: "fb-1", projectName: "test-project", status: "resolved" }),
      });
      const res = await handler.PATCH(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.authorEmail).toBe("");
      expect("clientId" in body).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Store errors from another bundle's copy of core — every published package
// bundles its own core, so e.g. an adapter-kit-built store throws error
// classes this handler's `instanceof` checks don't know.
// ---------------------------------------------------------------------------

type StoreErrorCode = "STORE_NOT_FOUND" | "STORE_DUPLICATE";

/** Same `code` as core's store errors, different class identity. */
class ForeignStoreError extends Error {
  constructor(readonly code: StoreErrorCode) {
    super(code);
  }
}

describe.each<[string, (code: StoreErrorCode) => unknown]>([
  ["an Error class from another copy of core", (code) => new ForeignStoreError(code)],
  ["a plain { code } object", (code) => ({ code })],
])("createBeezpingHandler — store errors thrown as %s", (_label, storeError) => {
  /** A third-party store without the optional `verifyProjectOwnership`. */
  function foreignStore(overrides: Partial<BeezpingStore>): BeezpingStore {
    return {
      createFeedback: vi.fn(),
      getFeedbacks: vi.fn(),
      findByClientId: vi.fn().mockResolvedValue(null),
      updateFeedback: vi.fn(),
      deleteFeedback: vi.fn(),
      deleteAllFeedbacks: vi.fn(),
      ...overrides,
    };
  }

  it("PATCH of an unknown id returns 404", async () => {
    const store = foreignStore({ updateFeedback: vi.fn().mockRejectedValue(storeError("STORE_NOT_FOUND")) });
    const handler = createBeezpingHandler({ store, requireAuthForDestructive: false });

    const res = await handler.PATCH(
      new Request("http://localhost/api/beezping", {
        method: "PATCH",
        body: JSON.stringify({ id: "missing", projectName: "test-project", status: "resolved" }),
      }),
    );

    expect(res.status).toBe(404);
  });

  it("DELETE of an unknown id returns 404", async () => {
    const store = foreignStore({ deleteFeedback: vi.fn().mockRejectedValue(storeError("STORE_NOT_FOUND")) });
    const handler = createBeezpingHandler({ store, requireAuthForDestructive: false });

    const res = await handler.DELETE(
      new Request("http://localhost/api/beezping", {
        method: "DELETE",
        body: JSON.stringify({ id: "missing", projectName: "test-project" }),
      }),
    );

    expect(res.status).toBe(404);
  });

  it("POST that loses the clientId race returns the existing record", async () => {
    const existing = buildFeedbackRecord(
      { ...validPayloadNoAnnotations, status: "open", annotations: [] },
      { id: "fb-existing", annotationId: () => "ann" },
    );
    const store = foreignStore({
      // Not there at the replay check, inserted by the racing request right after.
      findByClientId: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(existing),
      createFeedback: vi.fn().mockRejectedValue(storeError("STORE_DUPLICATE")),
    });
    const handler = createBeezpingHandler({ store });

    const res = await handler.POST(
      new Request("http://localhost/api/beezping", { method: "POST", body: JSON.stringify(validPayloadNoAnnotations) }),
    );

    expect(res.status).toBe(201);
    expect((await res.json()).id).toBe("fb-existing");
  });
});
