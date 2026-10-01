import {
  clampPagination,
  type FeedbackCreateInput,
  type FeedbackPage,
  type FeedbackPayload,
  type FeedbackQuery,
  type FeedbackRecord,
  type FeedbackStatus,
  type FeedbackType,
  type FeedbackUpdateInput,
  hasOwn,
  isStoreDuplicate,
  isStoreNotFound,
  isUnreachableOffset,
  type ScreenshotStorage,
  type SitepingStore,
  StoreDuplicateError,
  StoreNotFoundError,
} from "@beezping/core";
import {
  type ApiKeyAccessOptions,
  createSitepingHandler as createServerHandler,
  type SitepingHandler,
  type WebhookConfig,
} from "@beezping/server";

export type { ScreenshotStorage, SitepingStore } from "@beezping/core";
export {
  flattenAnnotation,
  isStorePersistence,
  StoreDuplicateError,
  StoreNotFoundError,
  StorePersistenceError,
} from "@beezping/core";
export type {
  FeedbackDeleteInput,
  FeedbackPatchInput,
  GetQueryInput,
  SitepingHandler,
  SitepingHttpMethod,
} from "@beezping/server";

/**
 * @deprecated The create wire shape is core's `FeedbackPayload` — import
 * that instead. This alias is kept for one release cycle.
 */
export type FeedbackCreateSchemaInput = FeedbackPayload;
export type {
  DiscordWebhookPayload,
  GenericWebhookPayload,
  SlackWebhookPayload,
  WebhookConfig,
  WebhookPayloadMap,
  WebhookType,
} from "@beezping/server";
export { dispatchWebhook, dispatchWebhooks } from "@beezping/server";

// ---------------------------------------------------------------------------
// Minimal PrismaClient shape expected by this adapter
// ---------------------------------------------------------------------------

/**
 * Structural type for a Prisma model delegate (`prisma.sitepingFeedback`).
 *
 * Arguments are kept `unknown` so any Prisma version's generated client
 * satisfies the constraint; the adapter assembles type-safe payloads
 * internally before forwarding them.
 *
 * Members use **method syntax** (`create(args)`) rather than function-property
 * syntax (`create: (args) => ...`) on purpose: under `strictFunctionTypes`,
 * function-property parameters are checked *contravariantly*, so a real
 * generated delegate — whose `create(args: SpecificArgs)` takes a type narrower
 * than `unknown` — would fail to assign to `PrismaModelDelegate`. Method
 * signatures are checked *bivariantly* on parameters, which is exactly what we
 * want for structurally matching a third-party generated client (#99).
 */
export interface PrismaModelDelegate {
  create(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<unknown[]>;
  findUnique(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
  delete(args: unknown): Promise<unknown>;
  deleteMany(args: unknown): Promise<unknown>;
  count(args: unknown): Promise<number>;
}

/**
 * Compile-time regression guard for #99 — intentionally in `src/` because the
 * package's `check` script (`tsc --noEmit`) only type-checks `src/`, and
 * vitest transpiles tests without type-checking.
 *
 * `GeneratedDelegateProbe` mirrors a real generated client: every method
 * declares args NARROWER than `unknown`. With method syntax the conditional
 * below resolves to `true`; if `PrismaModelDelegate` ever regresses to
 * function-property syntax (contravariant under `strictFunctionTypes`), it
 * resolves to `false` and the `AssertTrue` constraint fails the build.
 */
type AssertTrue<T extends true> = T;
interface GeneratedDelegateProbe {
  create(args: { data: unknown; include?: unknown }): Promise<{ id: string }>;
  findMany(args: { where?: unknown; include?: unknown }): Promise<{ id: string }[]>;
  findUnique(args: { where: unknown }): Promise<{ id: string } | null>;
  update(args: { where: unknown; data: unknown }): Promise<{ id: string }>;
  delete(args: { where: unknown }): Promise<{ id: string }>;
  deleteMany(args: { where?: unknown }): Promise<{ count: number }>;
  count(args: { where?: unknown }): Promise<number>;
}
type _AssertDelegateBivariance = AssertTrue<GeneratedDelegateProbe extends PrismaModelDelegate ? true : false>;

/**
 * Minimal Prisma client shape expected by this adapter.
 * Consumers pass their own `PrismaClient` instance at runtime — this interface
 * defines the subset of methods the adapter actually uses, so it can be
 * referenced in handler option types without importing `@prisma/client`.
 */
export interface SitepingPrismaClient {
  sitepingFeedback: PrismaModelDelegate;
}

// ---------------------------------------------------------------------------
// PrismaStore — SitepingStore implementation backed by Prisma
// ---------------------------------------------------------------------------

const INCLUDE_ANNOTATIONS = { annotations: true } as const;

/**
 * Prisma datasource providers whose generated client exposes `mode?: QueryMode`
 * on string filters. Verified against Prisma 6.x by inspecting the generated
 * `StringFilter` type per provider:
 *   - postgresql, mongodb, cockroachdb → emit `mode?: QueryMode`
 *   - mysql, sqlite, sqlserver → no `mode` field; passing it raises
 *     `PrismaClientValidationError: Unknown argument 'mode'` at runtime.
 * `postgres` is kept as a defensive alias in case `_activeProvider` ever
 * surfaces the legacy spelling.
 */
const PROVIDERS_SUPPORTING_INSENSITIVE_MODE: ReadonlySet<string> = new Set([
  "postgresql",
  "postgres",
  "mongodb",
  "cockroachdb",
]);

/** Internal shape used to probe `PrismaClient` for the active provider. */
interface PrismaClientProbe {
  _activeProvider?: unknown;
  _engineConfig?: { activeProvider?: unknown };
  _engine?: { config?: { activeProvider?: unknown } };
}

/**
 * Best-effort detection of the active Prisma provider for a runtime client.
 *
 * The provider is not part of any public API on `PrismaClient`. We probe a
 * few known internal locations across Prisma 5.x and 6.x and fall back to
 * `null` (treated as "unknown — assume default Postgres-style behaviour")
 * when none match.
 */
function detectActiveProvider(prisma: unknown): string | null {
  try {
    const candidate = prisma as PrismaClientProbe | null | undefined;
    const fromActive = candidate?._activeProvider;
    if (typeof fromActive === "string") return fromActive;
    const fromEngineConfig = candidate?._engineConfig?.activeProvider;
    if (typeof fromEngineConfig === "string") return fromEngineConfig;
    const fromEngine = candidate?._engine?.config?.activeProvider;
    if (typeof fromEngine === "string") return fromEngine;
    return null;
  } catch {
    return null;
  }
}

/**
 * Options accepted by `PrismaStore`.
 */
export interface PrismaStoreOptions {
  /**
   * When `true`, the `?search=` filter is built with `mode: "insensitive"`
   * (case-insensitive across all letters, including non-ASCII).
   *
   * When `false`, the filter is built without `mode` — uses each database's
   * default `LIKE` semantics (case-insensitive ASCII on SQLite by default;
   * case-sensitive on PostgreSQL with the standard `LIKE` operator;
   * collation-driven on MySQL and SQL Server).
   *
   * When omitted, the value is auto-detected from the Prisma client's active
   * provider: providers whose generated client exposes `mode?: QueryMode`
   * (`postgresql`, `mongodb`, `cockroachdb`) get `true`; others (`mysql`,
   * `sqlite`, `sqlserver`) get `false`. Unknown / undetectable providers
   * default to `false` — `contains` without `mode` works on every provider;
   * `mode: "insensitive"` throws on MySQL/SQLite/SQL Server, so the safer
   * default is to omit it.
   */
  caseInsensitiveSearch?: boolean;
  /**
   * Optional storage backend for screenshots. Without it, the data URL is
   * persisted inline on `Feedback.screenshotUrl` with a one-time warn.
   */
  screenshotStorage?: ScreenshotStorage | undefined;
}

/** `where` filter shape passed to `findMany` / `count`. Each field maps to a typed Prisma filter. */
interface FeedbackWhereInput {
  projectName: string;
  type?: FeedbackType;
  // Exact match (`status`) or bucket match (`{ in: [...] }` from `statuses`).
  status?: FeedbackStatus | { in: FeedbackStatus[] };
  url?: string;
  urlPattern?: string;
  message?: { contains: string; mode?: "insensitive" };
}

/**
 * Translate Prisma's coded errors into the store contract's classes (the
 * handler layer and the dashboard are ORM-agnostic and only know these).
 * Anything else — connection failures, validation errors — passes through.
 */
function toStoreError(error: unknown): unknown {
  if (error instanceof StoreNotFoundError || error instanceof StoreDuplicateError) return error;
  if (isStoreNotFound(error)) return new StoreNotFoundError(undefined, { cause: error });
  if (isStoreDuplicate(error)) return new StoreDuplicateError(undefined, { cause: error });
  return error;
}

/**
 * Whether a persisted `screenshotUrl` points at an object a `ScreenshotStorage`
 * owns — inline `data:` URLs were never uploaded, so there is nothing to delete.
 */
function isStoredScreenshotUrl(url: unknown): url is string {
  return typeof url === "string" && url.length > 0 && !url.startsWith("data:");
}

/**
 * Prisma-backed implementation of `SitepingStore`.
 *
 * Wraps a PrismaClient to satisfy the abstract store interface.
 *
 * Pass `screenshotStorage` to externalise screenshots (S3, R2, B2, …) — the
 * widget's data URL is uploaded and only the returned URL is persisted, so
 * the database stays small. Without `screenshotStorage`, the data URL is
 * persisted inline (logged once on first use as a heads-up).
 */
export class PrismaStore implements SitepingStore {
  /** @internal */
  private prisma: SitepingPrismaClient;
  private readonly screenshotStorage: ScreenshotStorage | undefined;
  /** Module-level flag would leak across PrismaStore instances in tests; use per-instance. */
  private inlineFallbackWarned = false;
  /** @internal */
  private caseInsensitiveSearch: boolean;

  constructor(prisma: SitepingPrismaClient, options: PrismaStoreOptions = {}) {
    this.prisma = prisma;
    this.screenshotStorage = options.screenshotStorage;
    if (typeof options.caseInsensitiveSearch === "boolean") {
      this.caseInsensitiveSearch = options.caseInsensitiveSearch;
    } else {
      const provider = detectActiveProvider(prisma);
      // When the provider can't be detected, default to `false`: `contains`
      // without `mode` works on every Prisma provider; `mode: "insensitive"`
      // throws on MySQL/SQLite/SQL Server. Trades non-ASCII case-insensitivity
      // on undetectable Postgres clients (rare — _activeProvider is set on
      // every real Prisma 5/6 client) for not crashing on the others.
      this.caseInsensitiveSearch = provider !== null && PROVIDERS_SUPPORTING_INSENSITIVE_MODE.has(provider);
    }
  }

  async createFeedback(data: FeedbackCreateInput): Promise<FeedbackRecord> {
    const screenshotUrl = await this.persistScreenshot(data.screenshotDataUrl, data.clientId);

    try {
      return await this.insertFeedback(data, screenshotUrl);
    } catch (error) {
      // A replay of an already-stored clientId (the widget's retry queue):
      // the existing row keeps its own screenshot, so the one just uploaded
      // for this attempt is an orphan — drop it before reporting the dup.
      if (isStoreDuplicate(error)) await this.discardScreenshots([screenshotUrl]);
      throw toStoreError(error);
    }
  }

  private async insertFeedback(data: FeedbackCreateInput, screenshotUrl: string | null): Promise<FeedbackRecord> {
    return (await this.prisma.sitepingFeedback.create({
      data: {
        projectName: data.projectName,
        type: data.type,
        message: data.message,
        status: data.status,
        url: data.url,
        urlPattern: data.urlPattern ?? null,
        screenshotUrl,
        // Persisted as JSON when the model has a `screenshotRegion Json?`
        // column — same omit-when-null contract as `diagnostics` below, so
        // hosts that haven't run `npx siteping sync` keep working.
        ...(data.screenshotRegion ? { screenshotRegion: data.screenshotRegion } : {}),
        // Persisted as JSON when the model has a `diagnostics Json?` column.
        // Hosts that haven't run `npx siteping sync` keep their schema as-is
        // and Prisma will throw if we pass an unknown column, so omit the
        // key entirely when diagnostics is null.
        ...(data.diagnostics ? { diagnostics: data.diagnostics } : {}),
        viewport: data.viewport,
        userAgent: data.userAgent,
        authorName: data.authorName,
        authorEmail: data.authorEmail,
        clientId: data.clientId,
        annotations: {
          create: data.annotations.map((ann) => ({
            cssSelector: ann.cssSelector,
            xpath: ann.xpath,
            textSnippet: ann.textSnippet,
            elementTag: ann.elementTag,
            elementId: ann.elementId,
            textPrefix: ann.textPrefix,
            textSuffix: ann.textSuffix,
            fingerprint: ann.fingerprint,
            neighborText: ann.neighborText,
            anchorKey: ann.anchorKey ?? null,
            xPct: ann.xPct,
            yPct: ann.yPct,
            wPct: ann.wPct,
            hPct: ann.hPct,
            scrollX: ann.scrollX,
            scrollY: ann.scrollY,
            viewportW: ann.viewportW,
            viewportH: ann.viewportH,
            devicePixelRatio: ann.devicePixelRatio,
          })),
        },
      },
      include: INCLUDE_ANNOTATIONS,
    })) as FeedbackRecord;
  }

  /**
   * Resolve the value to persist on `Feedback.screenshotUrl`.
   *
   * - No data URL → null
   * - Storage configured → upload, return remote URL. Upload failures
   *   persist `null` (drop the screenshot) rather than silently inlining
   *   the data URL — an inline fallback would bloat Postgres unnoticed
   *   during a multi-minute storage outage. The feedback message itself is
   *   preserved; only the screenshot is missing, and the warn surfaces it.
   * - No storage → inline base64, with a one-time warn so prod operators
   *   notice the footgun.
   *
   * Operators who prefer the legacy inline-on-failure behaviour can wrap
   * their `ScreenshotStorage.upload` with their own catch + return the
   * data URL — the adapter treats whatever the storage returns as final.
   */
  private async persistScreenshot(dataUrl: string | null | undefined, clientId: string): Promise<string | null> {
    if (!dataUrl) return null;

    if (this.screenshotStorage) {
      try {
        // Use clientId as the upload-time identifier — the feedback row's
        // own id isn't created yet and clientId is unique + stable.
        // NOTE: clientId is client-supplied; storage implementations that
        // map it to a filesystem path MUST sanitize against path traversal.
        const { url } = await this.screenshotStorage.upload(dataUrl, {
          feedbackId: clientId,
          mimeType: "image/jpeg",
        });
        return url;
      } catch (err) {
        console.warn(
          "[siteping] screenshotStorage.upload failed — feedback will be saved without a screenshot. Wrap your storage's upload to handle this differently:",
          err,
        );
        return null;
      }
    }

    if (!this.inlineFallbackWarned) {
      this.inlineFallbackWarned = true;
      console.warn(
        "[siteping] enableScreenshot is on but no `screenshotStorage` is configured — base64 data URLs will be persisted inline on Feedback.screenshotUrl. Configure a ScreenshotStorage (S3/R2/…) for production.",
      );
    }
    return dataUrl;
  }

  /**
   * Best-effort cleanup of stored screenshots through `ScreenshotStorage.delete`
   * — the hook the interface documents for feedback deletion. Failures are
   * logged and swallowed: an orphaned object is preferable to a delete that
   * reports failure after the row is already gone. Inline `data:` URLs and
   * stores without a `delete` hook are skipped.
   */
  private async discardScreenshots(urls: ReadonlyArray<unknown>): Promise<void> {
    const remove = this.screenshotStorage?.delete?.bind(this.screenshotStorage);
    if (!remove) return;
    const stored = urls.filter(isStoredScreenshotUrl);
    if (stored.length === 0) return;

    const results = await Promise.allSettled(stored.map((url) => remove(url)));
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.warn(
          `[siteping] screenshotStorage.delete failed for ${stored[index]} — object left in place:`,
          result.reason,
        );
      }
    });
  }

  /** URLs of the stored screenshots in `projectName` — only fetched when a `delete` hook can use them. */
  private async storedScreenshotUrls(projectName: string): Promise<string[]> {
    if (!this.screenshotStorage?.delete) return [];
    const rows = (await this.prisma.sitepingFeedback.findMany({
      where: { projectName, screenshotUrl: { not: null } },
      select: { screenshotUrl: true },
    })) as ReadonlyArray<{ screenshotUrl: string | null }>;
    return rows.map((row) => row.screenshotUrl).filter(isStoredScreenshotUrl);
  }

  async findByClientId(clientId: string): Promise<FeedbackRecord | null> {
    return (await this.prisma.sitepingFeedback.findUnique({
      where: { clientId },
      include: INCLUDE_ANNOTATIONS,
    })) as FeedbackRecord | null;
  }

  async getFeedbacks(query: FeedbackQuery): Promise<FeedbackPage> {
    const { projectName, type, status, statuses, search, url, urlPattern } = query;
    // Same clamp as the in-memory pipeline: the HTTP schema already bounds
    // page/limit, but direct callers reach the store without it.
    const { limit, skip } = clampPagination(query);

    const where: FeedbackWhereInput = { projectName };
    if (type) where.type = type;
    // Bucket filter (`statuses`) wins over the exact `status` filter; an empty
    // array is treated as absent so no status constraint is applied.
    if (statuses && statuses.length > 0) {
      where.status = { in: [...statuses] };
    } else if (status) {
      where.status = status;
    }
    if (url) where.url = url;
    if (urlPattern) where.urlPattern = urlPattern;
    if (search) {
      where.message = this.caseInsensitiveSearch ? { contains: search, mode: "insensitive" } : { contains: search };
    }

    // A huge `page` from a direct caller yields a `skip` Prisma rejects
    // (non-integer or past 64 bits): answer the empty page the in-memory
    // stores return, with the real total, without issuing `findMany`.
    if (isUnreachableOffset(skip)) {
      return { feedbacks: [], total: await this.prisma.sitepingFeedback.count({ where }) };
    }

    const [feedbacks, total] = await Promise.all([
      this.prisma.sitepingFeedback.findMany({
        where,
        include: INCLUDE_ANNOTATIONS,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.sitepingFeedback.count({ where }),
    ]);

    return { feedbacks: feedbacks as FeedbackRecord[], total };
  }

  async updateFeedback(id: string, data: FeedbackUpdateInput): Promise<FeedbackRecord> {
    try {
      return (await this.prisma.sitepingFeedback.update({
        where: { id },
        data: {
          status: data.status,
          resolvedAt: data.resolvedAt,
        },
        include: INCLUDE_ANNOTATIONS,
      })) as FeedbackRecord;
    } catch (error) {
      throw toStoreError(error);
    }
  }

  async deleteFeedback(id: string): Promise<void> {
    let deleted: { screenshotUrl?: string | null } | null;
    try {
      // Prisma returns the deleted row — the only chance to learn which
      // screenshot object the feedback owned.
      deleted = (await this.prisma.sitepingFeedback.delete({ where: { id } })) as {
        screenshotUrl?: string | null;
      } | null;
    } catch (error) {
      throw toStoreError(error);
    }
    await this.discardScreenshots([deleted?.screenshotUrl]);
  }

  async deleteAllFeedbacks(projectName: string): Promise<void> {
    // Rows first, storage second: a failed storage cleanup leaves orphaned
    // objects (acceptable), the reverse would leave rows pointing at deleted
    // screenshots.
    const screenshotUrls = await this.storedScreenshotUrls(projectName);
    await this.prisma.sitepingFeedback.deleteMany({ where: { projectName } });
    await this.discardScreenshots(screenshotUrls);
  }

  /**
   * Verify that a feedback record with `id` belongs to `projectName`.
   * Returns `true` when the record exists and matches, `false` otherwise.
   */
  async verifyProjectOwnership(id: string, projectName: string): Promise<boolean> {
    const record = (await this.prisma.sitepingFeedback.findUnique({
      where: { id },
      // Only need projectName for the check — skip annotations
    })) as { projectName: string } | null;
    return record !== null && record.projectName === projectName;
  }
}

// ---------------------------------------------------------------------------
// Handler — thin Prisma wrapper over the store-agnostic @beezping/server
// ---------------------------------------------------------------------------

export interface HandlerOptions extends ApiKeyAccessOptions {
  /** Prisma client — used when `store` is not provided. Wrapped in a `PrismaStore` internally. */
  prisma?: SitepingPrismaClient;
  /** Abstract store — when provided, takes precedence over `prisma`. */
  store?: SitepingStore;
  /**
   * Optional storage backend for screenshots. Used only with `prisma`
   * (ignored when a custom `store` is passed — that store is responsible
   * for its own screenshot strategy). Without a storage, the data URL is
   * persisted inline on `Feedback.screenshotUrl` with a one-time warn.
   */
  screenshotStorage?: ScreenshotStorage;
  /** Allowed CORS origins — when set, validates the Origin header */
  allowedOrigins?: ReadonlyArray<string> | undefined;
  /**
   * Override case-insensitive search behaviour for the built-in `PrismaStore`.
   *
   * Only applied when `prisma` is provided (not when a custom `store` is
   * passed). See `PrismaStoreOptions.caseInsensitiveSearch` for details on
   * auto-detection and per-provider semantics.
   */
  caseInsensitiveSearch?: boolean;
  /**
   * Outgoing webhooks fired after a feedback is successfully persisted.
   * Fire-and-forget; provide `onError` on each config to observe failures.
   */
  webhooks?: WebhookConfig | ReadonlyArray<WebhookConfig>;
}

/**
 * Create request handlers for the Siteping API endpoint.
 *
 * Accepts either a `store` (abstract) or a `prisma` client (backwards compatible).
 * When `prisma` is provided without `store`, it is wrapped in a `PrismaStore`.
 * For custom auth (sessions, roles), lifecycle hooks or input transforms use
 * `createSitepingHandler` from `@beezping/server` with a `PrismaStore`.
 *
 * **Rate limiting** is not handled by this library. Apply rate limiting at the
 * framework or reverse-proxy level (e.g. Next.js middleware, Nginx, Cloudflare).
 *
 * @example Next.js App Router — `app/api/siteping/route.ts`
 * ```ts
 * import { createSitepingHandler } from '@beezping/adapter-prisma'
 * import { prisma } from '@/lib/prisma'
 *
 * export const { GET, POST, PATCH, DELETE, OPTIONS } = createSitepingHandler({ prisma })
 * ```
 */
export function createSitepingHandler({
  prisma,
  store: providedStore,
  screenshotStorage,
  caseInsensitiveSearch,
  ...handlerOptions
}: HandlerOptions): SitepingHandler {
  if (!providedStore && !prisma) {
    throw new Error("[siteping] createSitepingHandler requires either `store` or `prisma`.");
  }
  const store: SitepingStore =
    providedStore ??
    new PrismaStore(prisma as NonNullable<typeof prisma>, {
      screenshotStorage,
      ...(typeof caseInsensitiveSearch === "boolean" ? { caseInsensitiveSearch } : {}),
    });
  return createServerHandler({ ...handlerOptions, store, describeError: actionableErrorMessage });
}

function isTableNotFoundError(error: unknown): error is { code: "P2021" } {
  return hasOwn(error, "code") && (error as { code: unknown }).code === "P2021";
}

/** Actionable message for known Prisma setup errors; `undefined` falls back to the generic one. */
function actionableErrorMessage(error: unknown): string | undefined {
  if (isTableNotFoundError(error)) {
    return "Table 'SitepingFeedback' not found. Run 'npx prisma db push' to create it.";
  }
  return undefined;
}
