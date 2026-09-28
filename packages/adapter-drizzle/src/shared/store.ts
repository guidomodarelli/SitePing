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
import { INLINE_SCREENSHOT_URL_PREFIX } from "../constants/screenshots.js";
import type {
  AnnotationRow,
  DeleteFeedbacksOptions,
  FeedbackFilter,
  FeedbackRow,
  SitepingSqlGateway,
} from "./gateway.js";
import { screenshotMimeType } from "./screenshots.js";

/**
 * The store returned by the dialect factories — the full contract, including
 * the ownership check and the atomic `createFeedbackIfAbsent`.
 */
export type DrizzleStore = SitepingStore &
  Required<Pick<SitepingStore, "verifyProjectOwnership" | "createFeedbackIfAbsent">>;

/**
 * Where the store reports degraded-but-non-fatal situations (failed
 * screenshot uploads or cleanups, inline screenshots). `console` satisfies it.
 */
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
  /**
   * Degraded-path reporting (failed uploads/cleanups, inline screenshots).
   * The store never picks a logging backend itself: without one these events
   * are dropped, so pass your application's logger (or `console`) to see them.
   */
  logger?: DrizzleStoreLogger | undefined;
  /**
   * Clock for record timestamps: `createdAt` of new feedbacks and `updatedAt`
   * of status updates. Defaults to the system clock.
   */
  now?: (() => Date) | undefined;
}

/** Logger of stores created without one: drops every event, leaving the logging policy to the host application. */
const silentLogger: DrizzleStoreLogger = {
  warn() {},
};

/** Clock of stores created without one. */
const systemClock = (): Date => new Date();

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
  private readonly now: () => Date;
  private inlineScreenshotWarned = false;
  /** Last issued `createdAt`, kept strictly increasing so "newest first" is stable within one millisecond. */
  private lastCreatedAtMs = 0;

  constructor(
    private readonly gateway: SitepingSqlGateway,
    options: DrizzleStoreOptions = {},
  ) {
    this.screenshotStorage = options.screenshotStorage;
    this.logger = options.logger ?? silentLogger;
    this.now = options.now ?? systemClock;
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

    // Fresh per attempt: racing creates of one clientId upload under distinct
    // ids, so the winner's object is never overwritten by a loser's upload.
    const id = crypto.randomUUID();
    const screenshotUrl = await this.persistScreenshot(data.screenshotDataUrl, {
      feedbackId: id,
      clientId: data.clientId,
    });
    const { annotations, ...feedback } = buildFeedbackRecord(data, {
      id,
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
    // screenshot, uploaded under its own id, so the one just uploaded is an
    // orphan. The URL check only guards storages that ignore the id (e.g. a
    // content-addressed key), where both uploads can share the winner's URL.
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
    // creates may have pushed a few milliseconds ahead of the clock.
    const row = await persistMutation("updateFeedback", { id }, () =>
      this.gateway.updateStatus(id, {
        status: data.status,
        resolvedAt: data.resolvedAt,
        updatedAt: this.now(),
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
    this.lastCreatedAtMs = Math.max(this.now().getTime(), this.lastCreatedAtMs + 1);
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
   *
   * @param dataUrl - Screenshot submitted with the feedback, if any.
   * @param attempt - `feedbackId` is the id this create attempt will insert
   *   the row under — unique per attempt and never client-supplied — so
   *   racing attempts on one `clientId` never write the same object;
   *   `clientId` is only reported in logs.
   */
  private async persistScreenshot(
    dataUrl: string | null | undefined,
    { feedbackId, clientId }: { feedbackId: string; clientId: string },
  ): Promise<string | null> {
    if (!dataUrl) return null;
    if (this.screenshotStorage) {
      try {
        const { url } = await this.screenshotStorage.upload(dataUrl, {
          feedbackId,
          mimeType: screenshotMimeType(dataUrl),
        });
        return url;
      } catch (error) {
        this.logger.warn(
          "[siteping] DrizzleStore: screenshotStorage.upload failed — feedback saved without screenshot",
          { clientId, feedbackId, error },
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
   * once the database confirms no stored row points at it: a failure
   * reported after the commit (e.g. a dropped connection) may have stored
   * this attempt's row. A row stored by a racing attempt holds its own
   * screenshot, so this one is still an orphan. When the check itself fails,
   * the object is kept (an orphan is acceptable, a dangling row is not).
   */
  private async discardUnreferencedScreenshot(screenshotUrl: string | null, clientId: string): Promise<void> {
    if (!isUploadedScreenshotUrl(screenshotUrl)) return;
    try {
      const stored = await this.gateway.findByClientId(clientId);
      if (stored?.screenshotUrl === screenshotUrl) return;
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
