import type { FeedbackCreateInput, ScreenshotStorage } from "@siteping/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SitepingTableNames } from "../src/constants/table-names.js";
import { createLibSQLSitepingStore, createSitepingSqliteTables } from "../src/libsql/index.js";
import { createPgSitepingStore, createSitepingPgTables } from "../src/pg/index.js";
import type { DrizzleStore, DrizzleStoreOptions } from "../src/shared/store.js";
import { createLibSQLTestDatabase, createPgTestDatabase } from "./databases.js";

const SCREENSHOT_DATA_URL = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
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

interface DialectUnderTest {
  name: string;
  open(names?: SitepingTableNames): Promise<{
    createStore(options?: DrizzleStoreOptions): DrizzleStore;
    countAnnotations(): Promise<number>;
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
        countAnnotations: async () => (await database.db.select().from(tables.sitepingAnnotations)).length,
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
        countAnnotations: async () => (await database.db.select().from(tables.sitepingAnnotations)).length,
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

      expect(uploads).toEqual([{ feedbackId: input.clientId, mimeType: "image/jpeg" }]);
      expect(created.screenshotUrl).toBe(`https://cdn.example.com/${input.clientId}.jpg`);
      expect(deletions).toEqual([created.screenshotUrl]);
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

    it("saves the feedback without screenshot and warns when the upload fails", async () => {
      const uploadError = new Error("storage unavailable");
      const { storage } = recordingStorage({ upload: () => Promise.reject(uploadError) });
      const store = database.createStore({ screenshotStorage: storage, logger });

      const created = await store.createFeedback(feedbackInput({ screenshotDataUrl: SCREENSHOT_DATA_URL }));

      expect(created.screenshotUrl).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("upload failed"), {
        clientId: created.clientId,
        error: uploadError,
      });
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

    it("removes the annotations of deleted feedbacks", async () => {
      const store = database.createStore({ logger });
      const single = await store.createFeedback(feedbackInput());
      await store.createFeedback(feedbackInput({ projectName: "bulk" }));
      await store.createFeedback(feedbackInput({ projectName: "kept" }));

      await store.deleteFeedback(single.id);
      await store.deleteAllFeedbacks("bulk");

      expect(await database.countAnnotations()).toBe(1);
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
