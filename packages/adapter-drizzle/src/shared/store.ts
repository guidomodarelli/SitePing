import {
  buildFeedbackRecord,
  clampPagination,
  type FeedbackCreateInput,
  type FeedbackCreateOutcome,
  type FeedbackPage,
  type FeedbackQuery,
  type FeedbackRecord,
  type FeedbackUpdateInput,
  isStoreDuplicate,
  isStoreNotFound,
  isStorePersistence,
  type ScreenshotStorage,
  type SitepingStore,
  StoreNotFoundError,
  StorePersistenceError,
} from "@siteping/core";
import { DRIZZLE_STORE_MESSAGE_PREFIX, type DrizzleStoreMutation } from "../constants/errors.js";
import { INLINE_SCREENSHOT_URL_PREFIX, SCREENSHOT_MIME_TYPE } from "../constants/screenshots.js";
import type {
  AnnotationRow,
  DeleteFeedbacksOptions,
  FeedbackFilter,
  FeedbackRow,
  SitepingSqlGateway,
} from "./gateway.js";

/**
 * The store returned by the dialect factories — the full contract, including
 * the ownership check and the atomic `createFeedbackIfAbsent`.
 */
export type DrizzleStore = SitepingStore &
  Required<Pick<SitepingStore, "verifyProjectOwnership" | "createFeedbackIfAbsent">>;

/** Where the store reports degraded-but-non-fatal situations. Defaults to `console.warn`. */
export interface DrizzleStoreLogger {
  warn(message: string, context: Record<string, unknown>): void;
}

export interface DrizzleStoreOptions {
  /**
   * Upload screenshots to external storage (S3, R2, Cloudflare Images…) and
   * persist only the returned URL. Without it, the base64 data URL is stored
   * inline (warned once) — fine for development, heavy for production.
   */
  screenshotStorage?: ScreenshotStorage | undefined;
  /** Degraded-path reporting (failed uploads/cleanups, inline screenshots). */
  logger?: DrizzleStoreLogger | undefined;
}

const defaultLogger: DrizzleStoreLogger = {
  warn(message, context) {
    console.warn(message, context);
  },
};

/** Whether a store error already carries its contract meaning and must propagate untouched. */
function isStoreContractError(error: unknown): boolean {
  return isStoreNotFound(error) || isStoreDuplicate(error) || isStorePersistence(error);
}

/**
 * Run a gateway write, reporting any database failure (read-only or full
 * database, lost connection, rejected statement…) as `StorePersistenceError`
 * — the `SitepingStore` mutation contract — with the driver error as `cause`.
 *
 * @param mutation - Store method being served, for the message.
 * @param identifiers - Minimal ids to debug the failure (never payload data).
 * @param write - The gateway write.
 */
async function persistMutation<Result>(
  mutation: DrizzleStoreMutation,
  identifiers: Record<string, string>,
  write: () => Promise<Result>,
): Promise<Result> {
  try {
    return await write();
  } catch (error) {
    if (isStoreContractError(error)) throw error;
    const context = Object.entries(identifiers)
      .map(([name, value]) => `${name}=${value}`)
      .join(" ");
    throw new StorePersistenceError(`${DRIZZLE_STORE_MESSAGE_PREFIX}.${mutation} failed to write (${context})`, {
      cause: error,
    });
  }
}

/** Whether a stored `screenshotUrl` points at an object the storage owns (inline data URLs were never uploaded). */
function isUploadedScreenshotUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && url.length > 0 && !url.startsWith(INLINE_SCREENSHOT_URL_PREFIX);
}

/**
 * `SitepingStore` over a dialect gateway: ids, timestamps, clientId
 * idempotency, screenshot upload/cleanup and the error contract live here,
 * SQL lives in the gateway.
 * @internal
 */
export class DrizzleSitepingStore implements DrizzleStore {
  private readonly screenshotStorage: ScreenshotStorage | undefined;
  private readonly logger: DrizzleStoreLogger;
  private inlineScreenshotWarned = false;
  /** Last issued `createdAt`, kept strictly increasing so "newest first" is stable within one millisecond. */
  private lastCreatedAtMs = 0;

  constructor(
    private readonly gateway: SitepingSqlGateway,
    options: DrizzleStoreOptions = {},
  ) {
    this.screenshotStorage = options.screenshotStorage;
    this.logger = options.logger ?? defaultLogger;
  }

  async createFeedback(data: FeedbackCreateInput): Promise<FeedbackRecord> {
    return (await this.createFeedbackIfAbsent(data)).feedback;
  }

  /**
   * Insert the feedback unless a row with the same `clientId` exists. The
   * unique `client_id` index plus `ON CONFLICT DO NOTHING` make the check
   * atomic across store instances and processes: of N concurrent calls, only
   * the one whose insert lands reports `created: true`.
   */
  async createFeedbackIfAbsent(data: FeedbackCreateInput): Promise<FeedbackCreateOutcome> {
    const existing = await this.findByClientId(data.clientId);
    if (existing) return { feedback: existing, created: false };

    const screenshotUrl = await this.persistScreenshot(data.screenshotDataUrl, data.clientId);
    const { annotations, ...feedback } = buildFeedbackRecord(data, {
      id: crypto.randomUUID(),
      annotationId: () => crypto.randomUUID(),
      now: this.nextCreatedAt(),
    });
    const row: FeedbackRow = { ...feedback, screenshotUrl };

    let inserted: boolean;
    try {
      inserted = await persistMutation("createFeedback", { clientId: data.clientId }, () =>
        this.gateway.insertFeedback(row, annotations),
      );
    } catch (error) {
      await this.discardUnreferencedScreenshot(screenshotUrl, data.clientId);
      throw error;
    }
    if (inserted) {
      return { feedback: { ...row, annotations }, created: true };
    }

    // Lost a race against the same clientId: the stored row keeps its own
    // screenshot, so the one just uploaded is an orphan — unless the storage
    // derives the object key from the clientId and both uploads landed on the
    // winner's URL, which must survive.
    const winner = await this.findByClientId(data.clientId);
    if (!winner) {
      throw new Error(
        `[siteping] DrizzleStore.createFeedbackIfAbsent: clientId ${data.clientId} conflicted but no row was found`,
      );
    }
    if (screenshotUrl !== winner.screenshotUrl) await this.discardScreenshots([screenshotUrl]);
    return { feedback: winner, created: false };
  }

  async getFeedbacks(query: FeedbackQuery): Promise<FeedbackPage> {
    const { limit, skip } = clampPagination(query);
    const filter: FeedbackFilter = { projectName: query.projectName };
    if (query.type) filter.type = query.type;
    // A non-empty `statuses` bucket wins over the exact `status` filter.
    if (query.statuses && query.statuses.length > 0) filter.statuses = query.statuses;
    else if (query.status) filter.statuses = [query.status];
    if (query.url) filter.url = query.url;
    if (query.urlPattern) filter.urlPattern = query.urlPattern;
    if (query.search) filter.search = query.search;

    const { rows, total } = await this.gateway.findFeedbacks(filter, { limit, offset: skip });
    return { feedbacks: await this.withAnnotations(rows), total };
  }

  async findByClientId(clientId: string): Promise<FeedbackRecord | null> {
    const row = await this.gateway.findByClientId(clientId);
    return row ? ((await this.withAnnotations([row]))[0] ?? null) : null;
  }

  async updateFeedback(id: string, data: FeedbackUpdateInput): Promise<FeedbackRecord> {
    // The gateway clamps updatedAt to the row's createdAt, which a burst of
    // creates may have pushed a few milliseconds ahead of the wall clock.
    const row = await persistMutation("updateFeedback", { id }, () =>
      this.gateway.updateStatus(id, {
        status: data.status,
        resolvedAt: data.resolvedAt,
        updatedAt: new Date(),
      }),
    );
    if (!row) throw new StoreNotFoundError();
    const [record] = await this.withAnnotations([row]);
    return record as FeedbackRecord;
  }

  async deleteFeedback(id: string): Promise<void> {
    const deleted = await persistMutation("deleteFeedback", { id }, () =>
      this.gateway.deleteById(id, this.deleteOptions()),
    );
    if (!deleted) throw new StoreNotFoundError();
    await this.discardScreenshots(deleted.screenshotUrls);
  }

  async deleteAllFeedbacks(projectName: string): Promise<void> {
    // Rows first, storage second: orphaned objects are acceptable, rows
    // pointing at deleted screenshots are not.
    const deleted = await persistMutation("deleteAllFeedbacks", { projectName }, () =>
      this.gateway.deleteByProject(projectName, this.deleteOptions()),
    );
    await this.discardScreenshots(deleted.screenshotUrls);
  }

  async verifyProjectOwnership(id: string, projectName: string): Promise<boolean> {
    const row = await this.gateway.findById(id);
    return row !== null && row.projectName === projectName;
  }

  /**
   * Deletes read the removed screenshot URLs back only when a
   * `ScreenshotStorage.delete` hook can clean them up: without one there is
   * nothing to do with them, and inline data URLs would be materialized for
   * every deleted row.
   */
  private deleteOptions(): DeleteFeedbacksOptions {
    return { collectScreenshotUrls: typeof this.screenshotStorage?.delete === "function" };
  }

  private nextCreatedAt(): Date {
    this.lastCreatedAtMs = Math.max(Date.now(), this.lastCreatedAtMs + 1);
    return new Date(this.lastCreatedAtMs);
  }

  private async withAnnotations(rows: readonly FeedbackRow[]): Promise<FeedbackRecord[]> {
    if (rows.length === 0) return [];
    const annotations = await this.gateway.findAnnotations(rows.map((row) => row.id));
    const byFeedback = new Map<string, AnnotationRow[]>();
    for (const annotation of annotations) {
      const siblings = byFeedback.get(annotation.feedbackId);
      if (siblings) siblings.push(annotation);
      else byFeedback.set(annotation.feedbackId, [annotation]);
    }
    return rows.map((row) => ({ ...row, annotations: byFeedback.get(row.id) ?? [] }));
  }

  /**
   * Value to persist on `screenshotUrl`: the storage URL, `null` when the
   * upload fails (an inline fallback would bloat the database unnoticed
   * during a storage outage), or the inline data URL without storage.
   */
  private async persistScreenshot(dataUrl: string | null | undefined, clientId: string): Promise<string | null> {
    if (!dataUrl) return null;
    if (this.screenshotStorage) {
      try {
        // The row id does not exist yet; clientId is unique and stable, but
        // client-supplied — storages must sanitize it before building paths.
        const { url } = await this.screenshotStorage.upload(dataUrl, {
          feedbackId: clientId,
          mimeType: SCREENSHOT_MIME_TYPE,
        });
        return url;
      } catch (error) {
        this.logger.warn(
          "[siteping] DrizzleStore: screenshotStorage.upload failed — feedback saved without screenshot",
          {
            clientId,
            error,
          },
        );
        return null;
      }
    }
    if (!this.inlineScreenshotWarned) {
      this.inlineScreenshotWarned = true;
      this.logger.warn(
        "[siteping] DrizzleStore: no screenshotStorage configured — screenshots are stored inline as base64. Configure a ScreenshotStorage for production.",
        {},
      );
    }
    return dataUrl;
  }

  /**
   * After a failed insert, drop the screenshot uploaded for it — but only
   * once the database confirms no row holds that `clientId`: a failure
   * reported after the commit (e.g. a dropped connection) may have stored a
   * row that points at it. When the check itself fails, the object is kept
   * (an orphan is acceptable, a dangling row is not).
   */
  private async discardUnreferencedScreenshot(screenshotUrl: string | null, clientId: string): Promise<void> {
    if (!isUploadedScreenshotUrl(screenshotUrl)) return;
    try {
      if (await this.gateway.findByClientId(clientId)) return;
    } catch (lookupError) {
      this.logger.warn(
        `${DRIZZLE_STORE_MESSAGE_PREFIX}: insert failed and its row could not be checked — screenshot kept`,
        {
          clientId,
          screenshotUrl,
          error: lookupError,
        },
      );
      return;
    }
    await this.discardScreenshots([screenshotUrl]);
  }

  /** Best-effort cleanup through `ScreenshotStorage.delete`; failures are logged, never thrown. */
  private async discardScreenshots(urls: ReadonlyArray<string | null | undefined>): Promise<void> {
    const remove = this.screenshotStorage?.delete?.bind(this.screenshotStorage);
    if (!remove) return;
    const uploaded = urls.filter(isUploadedScreenshotUrl);
    const results = await Promise.allSettled(uploaded.map((url) => remove(url)));
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        this.logger.warn("[siteping] DrizzleStore: screenshotStorage.delete failed — object left in place", {
          screenshotUrl: uploaded[index],
          error: result.reason,
        });
      }
    });
  }
}
