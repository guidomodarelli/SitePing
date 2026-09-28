import type { ScreenshotStorage } from "@siteping/core";
import {
  DEFAULT_ALLOWED_CONTENT_TYPES,
  DEFAULT_KEY_PREFIX,
  DEFAULT_MAX_SCREENSHOT_BYTES,
  KEY_PREFIX_PATTERN,
} from "../constants/screenshots.js";
import { decodeImageDataUrl } from "./data-url.js";
import { assertKeyableContentTypes, generateKey, isGeneratedKey } from "./generated-key.js";
import { type ScreenshotObjectStore, ScreenshotUploadRejectedError } from "./object-store.js";

/** Reports degraded-but-handled situations (failed reclaim of an uncertain upload, refused delete). */
export interface ScreenshotStorageLogger {
  warn(message: string, context: Record<string, unknown>): void;
}

export interface ScreenshotStorageOptions {
  /**
   * Image types accepted. Defaults to JPEG, PNG and WebP. Each type must map to
   * a key extension of 1–10 lowercase letters or digits (`image/gif` → `gif`,
   * `image/svg+xml` → `svg`); `createScreenshotStorage` throws otherwise.
   */
  allowedContentTypes?: readonly string[];
  /** Largest decoded image accepted, in bytes. Defaults to 1.5 MB. */
  maxBytes?: number;
  /**
   * Prefix of generated keys (lowercase letters, digits, `-`, `_`). Defaults to
   * `siteping-`. `delete` only removes keys with this prefix, so keep it
   * distinctive when the bucket or CDN is shared with other objects.
   */
  keyPrefix?: string;
  logger?: ScreenshotStorageLogger;
}

const defaultLogger: ScreenshotStorageLogger = {
  warn(message, context) {
    console.warn(message, context);
  },
};

/**
 * Build a `ScreenshotStorage` (what `DrizzleStore`, `PrismaStore` and other
 * stores accept) on top of any `ScreenshotObjectStore`.
 *
 * - Validates the widget's data URL (type allowlist, size cap) before any I/O.
 * - Every upload gets a fresh random key, so each returned URL belongs to one
 *   upload — and therefore to one `ctx.feedbackId` — never shared between
 *   records nor content-addressed, as the core `ScreenshotStorage` URL
 *   ownership rule requires. `ctx.feedbackId` is attacker-controlled (Prisma
 *   passes the client's `clientId`) and never enters a key, so a replayed id
 *   cannot overwrite someone else's screenshot.
 * - The URL is reserved before the upload; when the upload outcome is unknown
 *   (timeout, 5xx) the key is reclaimed so no unreferenced object survives.
 * - `delete` ignores URLs the backend does not own (inline data URLs, other
 *   hosts) and, under the backend's own base URL, any key outside this
 *   storage's generated namespace (`<keyPrefix><hex>.<ext>`) — so a legacy or
 *   imported URL pointing at another object of a shared bucket or CDN is never
 *   deleted. Such refusals are logged as warnings.
 *
 * @example
 * ```ts
 * import { createScreenshotStorage } from "@siteping/screenshot-storage";
 * import { createS3ObjectStore } from "@siteping/screenshot-storage/s3";
 *
 * const screenshotStorage = createScreenshotStorage(createS3ObjectStore({ … }));
 * const store = createPgSitepingStore(db, { screenshotStorage });
 * ```
 */
export function createScreenshotStorage(
  objectStore: ScreenshotObjectStore,
  {
    allowedContentTypes = DEFAULT_ALLOWED_CONTENT_TYPES,
    maxBytes = DEFAULT_MAX_SCREENSHOT_BYTES,
    keyPrefix = DEFAULT_KEY_PREFIX,
    logger = defaultLogger,
  }: ScreenshotStorageOptions = {},
): ScreenshotStorage {
  if (!KEY_PREFIX_PATTERN.test(keyPrefix)) {
    throw new Error(`[siteping] createScreenshotStorage: keyPrefix "${keyPrefix}" must match [a-z0-9_-]{0,64}`);
  }
  assertKeyableContentTypes(allowedContentTypes);

  return {
    async upload(dataUrl) {
      const image = decodeImageDataUrl(dataUrl, { allowedContentTypes, maxBytes });
      const key = generateKey(keyPrefix, image.contentType);
      const url = objectStore.urlFor(key);
      try {
        await objectStore.put({ key, bytes: image.bytes, contentType: image.contentType });
      } catch (error) {
        if (!(error instanceof ScreenshotUploadRejectedError)) {
          // The upload may still land after we gave up — remove it so no
          // object outlives the feedback that never referenced it.
          await objectStore.remove(key).catch((reclaimError: unknown) => {
            logger.warn(`[siteping] ${objectStore.name}: could not reclaim an uncertain upload`, {
              key,
              error: reclaimError,
            });
          });
        }
        throw error;
      }
      return { url };
    },

    async delete(url) {
      const key = objectStore.keyFromUrl(url);
      if (!key) return;
      if (!isGeneratedKey(key, keyPrefix)) {
        logger.warn(`[siteping] ${objectStore.name}: refusing to delete an object this storage did not generate`, {
          key,
          keyPrefix,
        });
        return;
      }
      await objectStore.remove(key);
    },
  };
}
