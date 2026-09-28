import {
  applyFeedbackFilters,
  buildFeedbackRecord,
  type FeedbackCreateInput,
  isStorePersistence,
  type ScreenshotStorage,
} from "@siteping/core";
import { getTableName, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SitepingTableNames } from "../src/constants/table-names.js";
import { createLibSQLSitepingStore, createSitepingSqliteTables } from "../src/libsql/index.js";
import { createPgSitepingStore, createSitepingPgTables } from "../src/pg/index.js";
import type { DrizzleStore, DrizzleStoreOptions } from "../src/shared/store.js";
import { createLibSQLTestDatabase, createPgTestDatabase } from "./databases.js";

const SCREENSHOT_DATA_URL = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
/** Response cap of the size-limited driver — smaller than one inline screenshot in the tests using it. */
const RESPONSE_SIZE_LIMIT_BYTES = 16 * 1024;
/** Time the injected test clocks start at, far from the real wall clock. */
const FROZEN_TIME_MS = Date.parse("2026-01-01T00:00:00.000Z");
const CUSTOM_TABLE_NAMES: SitepingTableNames = { feedbacks: "review_feedbacks", annotations: "review_annotations" };

function feedbackInput(overrides: Partial<FeedbackCreateInput> = {}): FeedbackCreateInput {
  return {
    projectName: "site",
    type: "bug",
    message: "Checkout button is broken",
    status: "open",
    url: "https://example.com/checkout",
    viewport: "1280x720",
    userAgent: "Mozilla/5.0",
    authorName: "Alice",
    authorEmail: "alice@example.com",
    clientId: crypto.randomUUID(),
    annotations: [
      {
        cssSelector: "button.pay",
        xpath: "/html/body/button",
        textSnippet: "Pay",
        elementTag: "BUTTON",
        textPrefix: "",
        textSuffix: "",
        fingerprint: "1:0:pay",
        neighborText: "",
        xPct: 0,
        yPct: 0,
        wPct: 1,
        hPct: 1,
        scrollX: 0,
        scrollY: 0,
        viewportW: 1280,
        viewportH: 720,
        devicePixelRatio: 1,
      },
    ],
    ...overrides,
  };
}

/** A feedback row written by the host application itself, bypassing the store. */
function applicationFeedbackRow() {
  const { annotations: _annotations, ...row } = buildFeedbackRecord(feedbackInput(), {
    id: crypto.randomUUID(),
    annotationId: () => crypto.randomUUID(),
  });
  return row;
}

/** Annotation inputs told apart by their selector, to check the stored order. */
function orderedAnnotations(count: number): FeedbackCreateInput["annotations"] {
  const [template] = feedbackInput().annotations;
  if (!template) throw new Error("feedbackInput() must provide an annotation template");
  return Array.from({ length: count }, (_, index) => ({ ...template, cssSelector: `li:nth-child(${index + 1})` }));
}

const REJECTED_WRITE_OPERATIONS = ["INSERT", "UPDATE", "DELETE"] as const;

interface DialectUnderTest {
  name: string;
  open(names?: SitepingTableNames): Promise<{
    createStore(options?: DrizzleStoreOptions): DrizzleStore;
    /** A store on the same database, reached through a driver that caps response size. */
    createStoreBehindResponseSizeLimit(maxResponseBytes: number, options?: DrizzleStoreOptions): DrizzleStore;
    countAnnotations(): Promise<number>;
    /** Write through the same `db` as the host application would — an insert and a bulk update, outside the store. */
    writeAsApplication(): Promise<void>;
    /** Re-insert every annotation row in reverse physical order, as a dump/restore or a table rewrite may. */
    reverseAnnotationStorageOrder(): Promise<void>;
    /** Make the database reject writes to the feedback table; resolves to the undo. */
    rejectFeedbackWrites(): Promise<() => Promise<void>>;
    reset(): Promise<void>;
    close(): Promise<void>;
  }>;
}

const dialects: DialectUnderTest[] = [
  {
    name: "PostgreSQL (PGlite)",
    async open(names) {
      const database = await createPgTestDatabase(names);
      const tables = createSitepingPgTables(names);
      return {
        createStore: (options) => createPgSitepingStore(database.db, { ...options, tables }),
        createStoreBehindResponseSizeLimit: (maxResponseBytes, options) =>
          createPgSitepingStore(database.withResponseSizeLimit(maxResponseBytes), { ...options, tables }),
        countAnnotations: async () => (await database.db.select().from(tables.sitepingAnnotations)).length,
        async writeAsApplication() {
          await database.db.insert(tables.sitepingFeedbacks).values(applicationFeedbackRow());
          await database.db.update(tables.sitepingFeedbacks).set({ authorName: "Edited by the application" });
        },
        async reverseAnnotationStorageOrder() {
          const rows = await database.db.select().from(tables.sitepingAnnotations);
          await database.db.delete(tables.sitepingAnnotations);
          for (const row of rows.reverse()) await database.db.insert(tables.sitepingAnnotations).values(row);
        },
        async rejectFeedbackWrites() {
          // PGlite is a single session: every later statement runs read-only.
          await database.db.execute(sql`SET default_transaction_read_only = on`);
          return async () => {
            await database.db.execute(sql`SET default_transaction_read_only = off`);
          };
        },
        reset: database.reset,
        close: database.close,
      };
    },
  },
  {
    name: "libSQL (Turso)",
    async open(names) {
      const database = await createLibSQLTestDatabase(names);
      const tables = createSitepingSqliteTables(names);
      return {
        createStore: (options) => createLibSQLSitepingStore(database.db, { ...options, tables }),
        createStoreBehindResponseSizeLimit: (maxResponseBytes, options) =>
          createLibSQLSitepingStore(database.withResponseSizeLimit(maxResponseBytes), { ...options, tables }),
        countAnnotations: async () => (await database.db.select().from(tables.sitepingAnnotations)).length,
        async writeAsApplication() {
          await database.db.insert(tables.sitepingFeedbacks).values(applicationFeedbackRow());
          await database.db.update(tables.sitepingFeedbacks).set({ authorName: "Edited by the application" });
        },
        async reverseAnnotationStorageOrder() {
          const rows = await database.db.select().from(tables.sitepingAnnotations);
          await database.db.delete(tables.sitepingAnnotations);
          for (const row of rows.reverse()) await database.db.insert(tables.sitepingAnnotations).values(row);
        },
        async rejectFeedbackWrites() {
          const feedbackTable = sql.identifier(getTableName(tables.sitepingFeedbacks));
          const triggerName = (operation: string) => sql.identifier(`reject_feedback_${operation.toLowerCase()}`);
          for (const operation of REJECTED_WRITE_OPERATIONS) {
            await database.db.run(
              sql`CREATE TRIGGER ${triggerName(operation)} BEFORE ${sql.raw(operation)} ON ${feedbackTable} BEGIN SELECT RAISE(ABORT, 'database is read-only'); END`,
            );
          }
          return async () => {
            for (const operation of REJECTED_WRITE_OPERATIONS) {
              await database.db.run(sql`DROP TRIGGER ${triggerName(operation)}`);
            }
          };
        },
        reset: database.reset,
        close: database.close,
      };
    },
  },
];

function recordingStorage(overrides: Partial<ScreenshotStorage> = {}) {
  const uploads: Array<{ feedbackId: string; mimeType: string }> = [];
  const deletions: string[] = [];
  const storage: ScreenshotStorage = {
    async upload(_dataUrl, context) {
      uploads.push(context);
      return { url: `https://cdn.example.com/${context.feedbackId}.jpg` };
    },
    async delete(url) {
      deletions.push(url);
    },
    ...overrides,
  };
  return { storage, uploads, deletions };
}

for (const dialect of dialects) {
  describe(`DrizzleStore — ${dialect.name}`, () => {
    let database: Awaited<ReturnType<DialectUnderTest["open"]>>;
    const logger = { warn: vi.fn() };

    beforeAll(async () => {
      database = await dialect.open();
    });
    afterAll(() => database.close());
    beforeEach(async () => {
      await database.reset();
      logger.warn.mockClear();
    });

    it("persists the storage URL instead of the data URL and deletes it with the feedback", async () => {
      const { storage, uploads, deletions } = recordingStorage();
      const store = database.createStore({ screenshotStorage: storage, logger });
      const input = feedbackInput({ screenshotDataUrl: SCREENSHOT_DATA_URL });

      const created = await store.createFeedback(input);
      await store.deleteFeedback(created.id);

      // Uploaded under the record id — server-generated, unlike the clientId.
      expect(uploads).toEqual([{ feedbackId: created.id, mimeType: "image/jpeg" }]);
      expect(created.screenshotUrl).toBe(`https://cdn.example.com/${created.id}.jpg`);
      expect(deletions).toEqual([created.screenshotUrl]);
    });

    it("uploads each screenshot with the MIME type its data URL declares", async () => {
      const { storage, uploads } = recordingStorage();
      const store = database.createStore({ screenshotStorage: storage, logger });

      for (const dataUrl of [
        "data:image/png;base64,iVBORw0KGgo=",
        "data:image/webp;base64,UklGRg==",
        SCREENSHOT_DATA_URL,
        "data:IMAGE/PNG;base64,iVBORw0KGgo=",
        "data:;base64,/9j/4AAQ",
      ]) {
        await store.createFeedback(feedbackInput({ screenshotDataUrl: dataUrl }));
      }

      expect(uploads.map((upload) => upload.mimeType)).toEqual([
        "image/png",
        "image/webp",
        "image/jpeg",
        "image/png",
        "image/jpeg",
      ]);
    });

    it("does not upload again when a clientId is replayed", async () => {
      const { storage, uploads } = recordingStorage();
      const store = database.createStore({ screenshotStorage: storage, logger });
      const input = feedbackInput({ screenshotDataUrl: SCREENSHOT_DATA_URL });

      const first = await store.createFeedback(input);
      const replay = await store.createFeedback(input);

      expect(replay.id).toBe(first.id);
      expect(uploads).toHaveLength(1);
    });

    it("reports created only for the first createFeedbackIfAbsent of a clientId", async () => {
      const store = database.createStore({ logger });
      const input = feedbackInput();

      const first = await store.createFeedbackIfAbsent(input);
      const replay = await store.createFeedbackIfAbsent(input);

      expect(first.created).toBe(true);
      expect(replay).toEqual({ feedback: expect.objectContaining({ id: first.feedback.id }), created: false });
    });

    it("inserts once and discards the losers' uploads when separate store instances race on a clientId", async () => {
      let uploadCount = 0;
      const { storage, deletions } = recordingStorage({
        async upload(_dataUrl, context) {
          uploadCount += 1;
          return { url: `https://cdn.example.com/${context.feedbackId}-${uploadCount}.jpg` };
        },
      });
      // Distinct instances share nothing in memory, so only the database's
      // unique clientId index can arbitrate — as with several server processes.
      const stores = [1, 2, 3].map(() => database.createStore({ screenshotStorage: storage, logger }));
      const input = feedbackInput({ screenshotDataUrl: SCREENSHOT_DATA_URL });

      const outcomes = await Promise.all(stores.map((store) => store.createFeedbackIfAbsent(input)));

      const inserted = outcomes.filter((outcome) => outcome.created);
      expect(inserted).toHaveLength(1);
      const winner = inserted[0]?.feedback;
      for (const outcome of outcomes) expect(outcome.feedback.id).toBe(winner?.id);
      expect((await stores[0]?.getFeedbacks({ projectName: "site" }))?.total).toBe(1);
      expect(await database.countAnnotations()).toBe(1);
      // Every caller that uploaded but lost the insert deletes its own upload, never the winner's.
      expect(deletions).toHaveLength(uploadCount - 1);
      expect(deletions).not.toContain(winner?.screenshotUrl);
    });

    it("keeps the winner's own screenshot when a racing loser finishes uploading last", async () => {
      // An object store keyed by the upload's feedbackId, as the documented key pattern builds it.
      const objects = new Map<string, string>();
      let releaseLateUpload: () => void = () => {};
      const lateUploadGate = new Promise<void>((resolve) => {
        releaseLateUpload = resolve;
      });
      const lateScreenshot = `${SCREENSHOT_DATA_URL}late`;
      const storage: ScreenshotStorage = {
        async upload(dataUrl, context) {
          if (dataUrl === lateScreenshot) await lateUploadGate;
          const url = `https://cdn.example.com/${context.feedbackId}.jpg`;
          objects.set(url, dataUrl);
          return { url };
        },
        async delete(url) {
          objects.delete(url);
        },
      };
      const clientId = crypto.randomUUID();
      const [lateStore, winningStore] = [1, 2].map(() => database.createStore({ screenshotStorage: storage, logger }));

      // Both attempts miss the clientId lookup; the late one uploads only after the other inserted.
      const lateAttempt = lateStore?.createFeedbackIfAbsent(
        feedbackInput({ clientId, screenshotDataUrl: lateScreenshot }),
      );
      const winner = await winningStore?.createFeedbackIfAbsent(
        feedbackInput({ clientId, screenshotDataUrl: SCREENSHOT_DATA_URL }),
      );
      releaseLateUpload();
      const loser = await lateAttempt;

      expect(winner?.created).toBe(true);
      expect(loser).toEqual({ feedback: expect.objectContaining({ id: winner?.feedback.id }), created: false });
      const winnerScreenshotUrl = winner?.feedback.screenshotUrl ?? "";
      expect(objects.get(winnerScreenshotUrl)).toBe(SCREENSHOT_DATA_URL);
      // The loser's own object is cleaned up; only the winner's remains.
      expect([...objects.keys()]).toEqual([winnerScreenshotUrl]);
    });

    it("keeps the winner's screenshot when racing uploads share one URL because the storage ignores the id", async () => {
      const { storage, deletions } = recordingStorage({
        async upload() {
          return { url: "https://cdn.example.com/content-addressed.jpg" };
        },
      });
      const stores = [1, 2, 3].map(() => database.createStore({ screenshotStorage: storage, logger }));
      const input = feedbackInput({ screenshotDataUrl: SCREENSHOT_DATA_URL });

      const outcomes = await Promise.all(stores.map((store) => store.createFeedbackIfAbsent(input)));

      expect(outcomes.filter((outcome) => outcome.created)).toHaveLength(1);
      expect(deletions).toEqual([]);
    });

    it("completes concurrent creates, updates and deletes issued from one process", async () => {
      const store = database.createStore({ logger });
      const [toUpdate, toDelete] = await Promise.all([
        store.createFeedback(feedbackInput()),
        store.createFeedback(feedbackInput()),
      ]);

      await Promise.all([
        store.createFeedback(feedbackInput()),
        store.updateFeedback(toUpdate.id, { status: "in_progress", resolvedAt: null }),
        store.deleteFeedback(toDelete.id),
        store.createFeedbackIfAbsent(feedbackInput()),
      ]);

      const page = await store.getFeedbacks({ projectName: "site" });
      expect(page.total).toBe(3);
      expect(page.feedbacks.find((feedback) => feedback.id === toUpdate.id)?.status).toBe("in_progress");
      expect(await store.verifyProjectOwnership(toDelete.id, "site")).toBe(false);
    });

    it("saves the feedback without screenshot and warns when the upload fails", async () => {
      const uploadError = new Error("storage unavailable");
      const { storage } = recordingStorage({ upload: () => Promise.reject(uploadError) });
      const store = database.createStore({ screenshotStorage: storage, logger });

      const created = await store.createFeedback(feedbackInput({ screenshotDataUrl: SCREENSHOT_DATA_URL }));

      expect(created.screenshotUrl).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("upload failed"), {
        clientId: created.clientId,
        feedbackId: created.id,
        error: uploadError,
      });
    });

    it("leaves degraded-path reporting to the host application when no logger is injected", async () => {
      const consoleWarn = vi.spyOn(console, "warn");
      try {
        const { storage } = recordingStorage({ upload: () => Promise.reject(new Error("storage unavailable")) });
        const withFailingStorage = database.createStore({ screenshotStorage: storage });
        const withInlineScreenshots = database.createStore();

        const created = await withFailingStorage.createFeedback(
          feedbackInput({ screenshotDataUrl: SCREENSHOT_DATA_URL }),
        );
        await withInlineScreenshots.createFeedback(feedbackInput({ screenshotDataUrl: SCREENSHOT_DATA_URL }));

        expect(created.screenshotUrl).toBeNull();
        expect(consoleWarn).not.toHaveBeenCalled();
      } finally {
        consoleWarn.mockRestore();
      }
    });

    it("cleans up every uploaded screenshot of a project on deleteAllFeedbacks", async () => {
      const { storage, deletions } = recordingStorage();
      const store = database.createStore({ screenshotStorage: storage, logger });
      const withScreenshot = await store.createFeedback(feedbackInput({ screenshotDataUrl: SCREENSHOT_DATA_URL }));
      await store.createFeedback(feedbackInput());
      await store.createFeedback(feedbackInput({ projectName: "other-site", screenshotDataUrl: SCREENSHOT_DATA_URL }));

      await store.deleteAllFeedbacks("site");

      expect(deletions).toEqual([withScreenshot.screenshotUrl]);
      expect((await store.getFeedbacks({ projectName: "other-site" })).total).toBe(1);
    });

    it("completes deletes and keeps cleaning up when the delete hook throws synchronously", async () => {
      const cleanupError = new Error("storage client not ready");
      let failingUrl = "";
      const { storage, deletions } = recordingStorage();
      const recordDeletion = storage.delete?.bind(storage);
      storage.delete = (url) => {
        if (url === failingUrl) throw cleanupError;
        return recordDeletion?.(url) ?? Promise.resolve();
      };
      const store = database.createStore({ screenshotStorage: storage, logger });
      const single = await store.createFeedback(feedbackInput({ screenshotDataUrl: SCREENSHOT_DATA_URL }));
      const failing = await store.createFeedback(feedbackInput({ screenshotDataUrl: SCREENSHOT_DATA_URL }));
      const cleaned = await store.createFeedback(feedbackInput({ screenshotDataUrl: SCREENSHOT_DATA_URL }));
      failingUrl = single.screenshotUrl ?? "";

      await expect(store.deleteFeedback(single.id)).resolves.toBeUndefined();
      failingUrl = failing.screenshotUrl ?? "";
      await expect(store.deleteAllFeedbacks("site")).resolves.toBeUndefined();

      expect((await store.getFeedbacks({ projectName: "site" })).total).toBe(0);
      expect(deletions).toEqual([cleaned.screenshotUrl]);
      for (const screenshotUrl of [single.screenshotUrl, failing.screenshotUrl]) {
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("delete failed"), {
          screenshotUrl,
          error: cleanupError,
        });
      }
    });

    it("removes the annotations of deleted feedbacks", async () => {
      const store = database.createStore({ logger });
      const single = await store.createFeedback(feedbackInput());
      await store.createFeedback(feedbackInput({ projectName: "bulk" }));
      await store.createFeedback(feedbackInput({ projectName: "kept" }));

      await store.deleteFeedback(single.id);
      await store.deleteAllFeedbacks("bulk");

      expect(await database.countAnnotations()).toBe(1);
    });

    it("deletes feedbacks with inline screenshots through a size-capped driver when no cleanup hook exists", async () => {
      // Each inline screenshot alone is larger than the driver accepts in a response.
      const inlineScreenshot = `${SCREENSHOT_DATA_URL}${"A".repeat(RESPONSE_SIZE_LIMIT_BYTES)}`;
      const writer = database.createStore({ logger });
      const single = await writer.createFeedback(feedbackInput({ screenshotDataUrl: inlineScreenshot }));
      await writer.createFeedback(feedbackInput({ screenshotDataUrl: inlineScreenshot }));
      await writer.createFeedback(feedbackInput({ screenshotDataUrl: inlineScreenshot }));
      const uploadOnlyStorage: ScreenshotStorage = { upload: recordingStorage().storage.upload };
      const stores = [
        database.createStoreBehindResponseSizeLimit(RESPONSE_SIZE_LIMIT_BYTES, { logger }),
        database.createStoreBehindResponseSizeLimit(RESPONSE_SIZE_LIMIT_BYTES, {
          screenshotStorage: uploadOnlyStorage,
          logger,
        }),
      ];

      await stores[0]?.deleteFeedback(single.id);
      await stores[1]?.deleteAllFeedbacks("site");

      expect((await stores[0]?.getFeedbacks({ projectName: "site" }))?.total).toBe(0);
      expect(await database.countAnnotations()).toBe(0);
    });

    it("verifies project ownership through a size-capped driver without reading inline screenshots", async () => {
      // The inline screenshot alone is larger than the driver accepts in a response.
      const inlineScreenshot = `${SCREENSHOT_DATA_URL}${"A".repeat(RESPONSE_SIZE_LIMIT_BYTES)}`;
      const created = await database
        .createStore({ logger })
        .createFeedback(feedbackInput({ screenshotDataUrl: inlineScreenshot }));
      const store = database.createStoreBehindResponseSizeLimit(RESPONSE_SIZE_LIMIT_BYTES, { logger });

      expect(await store.verifyProjectOwnership(created.id, "site")).toBe(true);
      expect(await store.verifyProjectOwnership(created.id, "other-site")).toBe(false);
      expect(await store.verifyProjectOwnership(crypto.randomUUID(), "site")).toBe(false);
    });

    it("matches LIKE wildcards in search literally", async () => {
      const store = database.createStore({ logger });
      await store.createFeedback(feedbackInput({ message: "Discount shows 100% off" }));
      await store.createFeedback(feedbackInput({ message: "Discount shows 1000 off" }));
      await store.createFeedback(feedbackInput({ message: "Field user_name is empty" }));
      await store.createFeedback(feedbackInput({ message: "Field username is empty" }));

      const percent = await store.getFeedbacks({ projectName: "site", search: "100%" });
      const underscore = await store.getFeedbacks({ projectName: "site", search: "user_name" });

      expect(percent.feedbacks.map((feedback) => feedback.message)).toEqual(["Discount shows 100% off"]);
      expect(underscore.feedbacks.map((feedback) => feedback.message)).toEqual(["Field user_name is empty"]);
    });

    it("matches backslashes in search literally", async () => {
      const store = database.createStore({ logger });
      await store.createFeedback(feedbackInput({ message: "Crash when saving to C:\\temp" }));
      await store.createFeedback(feedbackInput({ message: "Crash when saving to C:temp" }));
      await store.createFeedback(feedbackInput({ message: "Path ends with folder\\" }));
      await store.createFeedback(feedbackInput({ message: "Path ends with folder" }));

      const middle = await store.getFeedbacks({ projectName: "site", search: "C:\\temp" });
      const trailing = await store.getFeedbacks({ projectName: "site", search: "folder\\" });

      expect(middle.feedbacks.map((feedback) => feedback.message)).toEqual(["Crash when saving to C:\\temp"]);
      expect(trailing.feedbacks.map((feedback) => feedback.message)).toEqual(["Path ends with folder\\"]);
    });

    it("matches backslashes combined with LIKE wildcards in search literally", async () => {
      const store = database.createStore({ logger });
      await store.createFeedback(feedbackInput({ message: "Regex \\% breaks" }));
      await store.createFeedback(feedbackInput({ message: "Regex % breaks" }));
      await store.createFeedback(feedbackInput({ message: "Regex \\x breaks" }));
      await store.createFeedback(feedbackInput({ message: "Token a\\_b is wrong" }));
      await store.createFeedback(feedbackInput({ message: "Token a_b is wrong" }));
      await store.createFeedback(feedbackInput({ message: "Token a\\xb is wrong" }));

      const percent = await store.getFeedbacks({ projectName: "site", search: "\\%" });
      const underscore = await store.getFeedbacks({ projectName: "site", search: "a\\_b" });

      expect(percent.feedbacks.map((feedback) => feedback.message)).toEqual(["Regex \\% breaks"]);
      expect(underscore.feedbacks.map((feedback) => feedback.message)).toEqual(["Token a\\_b is wrong"]);
    });

    it("folds non-ASCII case in search like the standard store filter", async () => {
      const store = database.createStore({ logger });
      const messages = [
        "Échec du paiement",
        "échec de connexion",
        "Schlüssel ÄÖÜ fehlt",
        "Größe äöü falsch",
        "Façade Ç cassée",
        "Checkout button is broken",
      ];
      const created = [];
      for (const message of messages) created.push(await store.createFeedback(feedbackInput({ message })));
      const searches = ["échec", "ÉCHEC", "äöü", "ÄÖÜ", "ç", "Ç", "CHECKOUT"];

      for (const search of searches) {
        const found = await store.getFeedbacks({ projectName: "site", search });
        const expected = applyFeedbackFilters(created, { projectName: "site", search });
        expect(found.feedbacks.map((feedback) => feedback.message).sort(), search).toEqual(
          expected.feedbacks.map((feedback) => feedback.message).sort(),
        );
        expect(found.total, search).toBe(expected.total);
      }
      const accented = await store.getFeedbacks({ projectName: "site", search: "échec" });
      expect(accented.feedbacks.map((feedback) => feedback.message).sort()).toEqual([
        "Échec du paiement",
        "échec de connexion",
      ]);
    });

    it("searches feedbacks the host application wrote without the store", async () => {
      await database.writeAsApplication();
      const store = database.createStore({ logger });

      const found = await store.getFeedbacks({ projectName: "site", search: "CHECKOUT BUTTON" });

      expect(found.total).toBe(1);
    });

    it("lets the host application write through the same database while the store writes", async () => {
      const store = database.createStore({ logger });
      const existing = await store.createFeedback(feedbackInput());

      // Interleaved at every await: a store write that held the database's
      // write lock across an await would make the application's writes fail
      // with SQLITE_BUSY (or block the event loop) on local libSQL.
      await Promise.all([
        store.createFeedback(feedbackInput({ annotations: orderedAnnotations(3) })),
        database.writeAsApplication(),
        store.createFeedbackIfAbsent(feedbackInput()),
        database.writeAsApplication(),
        store.deleteFeedback(existing.id),
        database.writeAsApplication(),
        store.createFeedback(feedbackInput()),
      ]);

      expect((await store.getFeedbacks({ projectName: "site" })).total).toBe(6);
    });

    it("returns annotations in submission order even when the rows are stored in another order", async () => {
      const store = database.createStore({ logger });
      const annotations = orderedAnnotations(4);
      const created = await store.createFeedback(feedbackInput({ annotations }));

      await database.reverseAnnotationStorageOrder();
      const [reloaded] = (await store.getFeedbacks({ projectName: "site" })).feedbacks;

      const submittedSelectors = annotations.map((annotation) => annotation.cssSelector);
      expect(created.annotations.map((annotation) => annotation.cssSelector)).toEqual(submittedSelectors);
      expect(reloaded?.annotations.map((annotation) => annotation.cssSelector)).toEqual(submittedSelectors);
      expect(reloaded?.annotations[0]).not.toHaveProperty("position");
    });

    it("stamps createdAt and updatedAt with the injected clock", async () => {
      let currentTime = FROZEN_TIME_MS;
      const store = database.createStore({ logger, now: () => new Date(currentTime) });

      const created = await store.createFeedback(feedbackInput());
      currentTime += 60_000;
      const updated = await store.updateFeedback(created.id, { status: "in_progress", resolvedAt: null });

      expect(created.createdAt.getTime()).toBe(FROZEN_TIME_MS);
      expect(updated.createdAt.getTime()).toBe(FROZEN_TIME_MS);
      expect(updated.updatedAt.getTime()).toBe(FROZEN_TIME_MS + 60_000);
    });

    describe("with a frozen clock", () => {
      const frozenClock = () => new Date(FROZEN_TIME_MS);

      it("never stamps updatedAt before the createdAt issued during a same-millisecond burst", async () => {
        const store = database.createStore({ logger, now: frozenClock });
        await store.createFeedback(feedbackInput());
        await store.createFeedback(feedbackInput());
        const newest = await store.createFeedback(feedbackInput());

        const updated = await store.updateFeedback(newest.id, { status: "in_progress", resolvedAt: null });

        expect(newest.createdAt.getTime()).toBeGreaterThan(FROZEN_TIME_MS);
        expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(updated.createdAt.getTime());
        expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(newest.updatedAt.getTime());
      });

      it("lists feedbacks created in the same millisecond by separate store instances newest first, across pages", async () => {
        // Each instance issues createdAt from the same frozen clock, so all of them stamp the same value —
        // as several serverless invocations writing within one millisecond would.
        const createdIds: string[] = [];
        for (let instance = 0; instance < 6; instance += 1) {
          const store = database.createStore({ logger, now: frozenClock });
          createdIds.push((await store.createFeedback(feedbackInput())).id);
        }
        const reader = database.createStore({ logger, now: frozenClock });

        const all = await reader.getFeedbacks({ projectName: "site" });
        const pages = await Promise.all(
          [1, 2, 3].map((page) => reader.getFeedbacks({ projectName: "site", page, limit: 2 })),
        );

        const newestFirst = [...createdIds].reverse();
        expect(all.feedbacks.map((feedback) => feedback.createdAt.getTime())).toEqual(
          createdIds.map(() => FROZEN_TIME_MS),
        );
        expect(all.feedbacks.map((feedback) => feedback.id)).toEqual(newestFirst);
        expect(pages.flatMap((page) => page.feedbacks.map((feedback) => feedback.id))).toEqual(newestFirst);
        expect(all.feedbacks[0]).not.toHaveProperty("creationSequence");
      });
    });

    describe("when the database rejects writes", () => {
      let restoreWrites: (() => Promise<void>) | undefined;
      afterEach(async () => {
        await restoreWrites?.();
        restoreWrites = undefined;
      });

      it("reports every failed mutation as a StorePersistenceError carrying the driver error", async () => {
        const { storage, deletions } = recordingStorage();
        const store = database.createStore({ screenshotStorage: storage, logger });
        const stored = await store.createFeedback(feedbackInput());
        const annotationsBefore = await database.countAnnotations();
        restoreWrites = await database.rejectFeedbackWrites();

        const failures = await Promise.all(
          [
            () => store.createFeedback(feedbackInput({ screenshotDataUrl: SCREENSHOT_DATA_URL })),
            () => store.updateFeedback(stored.id, { status: "in_progress", resolvedAt: null }),
            () => store.deleteFeedback(stored.id),
            () => store.deleteAllFeedbacks("site"),
          ].map((mutation) =>
            mutation().then(
              () => null,
              (error: unknown) => error,
            ),
          ),
        );

        for (const failure of failures) {
          expect(isStorePersistence(failure)).toBe(true);
          expect((failure as Error).cause).toBeInstanceOf(Error);
        }
        expect((failures[1] as Error).message).toContain(stored.id);
        // Nothing half-applied, and the screenshot uploaded for the lost insert is dropped.
        await restoreWrites();
        restoreWrites = undefined;
        expect(await database.countAnnotations()).toBe(annotationsBefore);
        expect((await store.getFeedbacks({ projectName: "site" })).total).toBe(1);
        expect(deletions).toHaveLength(1);
      });
    });
  });

  describe(`DrizzleStore — ${dialect.name} with custom table names`, () => {
    it("reads and writes through the renamed tables", async () => {
      const database = await dialect.open(CUSTOM_TABLE_NAMES);
      try {
        const store = database.createStore({ logger: { warn: () => {} } });
        const created = await store.createFeedback(feedbackInput());

        const page = await store.getFeedbacks({ projectName: "site" });

        expect(page.feedbacks.map((feedback) => feedback.id)).toEqual([created.id]);
        expect(page.feedbacks[0]?.annotations).toHaveLength(1);
        expect(await database.countAnnotations()).toBe(1);
      } finally {
        await database.close();
      }
    });
  });
}
