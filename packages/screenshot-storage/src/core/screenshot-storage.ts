import type { ScreenshotStorage } from "@siteping/core";
import {
  CONTENT_TYPE_EXTENSIONS,
  DEFAULT_ALLOWED_CONTENT_TYPES,
  DEFAULT_KEY_PREFIX,
  DEFAULT_MAX_SCREENSHOT_BYTES,
  KEY_PREFIX_PATTERN,
  KEY_RANDOM_BYTES,
} from "../constants/screenshots.js";
import { decodeImageDataUrl } from "./data-url.js";
import { type ScreenshotObjectStore, ScreenshotUploadRejectedError } from "./object-store.js";

/** Reports degraded-but-handled situations (failed reclaim of an uncertain upload). */
export interface ScreenshotStorageLogger {
  warn(message: string, context: Record<string, unknown>): void;
}

export interface ScreenshotStorageOptions {
  /** Image types accepted. Defaults to JPEG, PNG and WebP. */
  allowedContentTypes?: readonly string[];
  /** Largest decoded image accepted, in bytes. Defaults to 1.5 MB. */
  maxBytes?: number;
  /** Prefix of generated keys (lowercase letters, digits, `-`, `_`). Defaults to `siteping-`. */
  keyPrefix?: string;
  logger?: ScreenshotStorageLogger;
}

const defaultLogger: ScreenshotStorageLogger = {
  warn(message, context) {
    console.warn(message, context);
  },
};

function randomHex(byteCount: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteCount));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Build a `ScreenshotStorage` (what `DrizzleStore`, `PrismaStore` and other
 * stores accept) on top of any `ScreenshotObjectStore`.
 *
 * - Validates the widget's data URL (type allowlist, size cap) before any I/O.
 * - Keys are random — never derived from the client-supplied `clientId`, so a
 *   replayed id cannot overwrite someone else's screenshot.
 * - The URL is reserved before the upload; when the upload outcome is unknown
 *   (timeout, 5xx) the key is reclaimed so no unreferenced object survives.
 * - `delete` ignores URLs the backend does not own (inline data URLs, other hosts).
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

  return {
    async upload(dataUrl) {
      const image = decodeImageDataUrl(dataUrl, { allowedContentTypes, maxBytes });
      const extension =
        CONTENT_TYPE_EXTENSIONS[image.contentType] ?? image.contentType.split("/")[1]?.replace(/[^a-z0-9]/g, "");
      const key = `${keyPrefix}${randomHex(KEY_RANDOM_BYTES)}.${extension}`;
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
      if (key) await objectStore.remove(key);
    },
  };
}
