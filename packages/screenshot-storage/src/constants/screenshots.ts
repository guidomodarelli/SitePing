/** Image types accepted by default — what the widget captures, plus common lossless/modern formats. */
export const DEFAULT_ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Largest decoded screenshot accepted by default, in bytes (matches the server's payload cap). */
export const DEFAULT_MAX_SCREENSHOT_BYTES = 1_500_000;

/** Prefix of generated object keys; keeps SitePing objects recognizable in a shared bucket. */
export const DEFAULT_KEY_PREFIX = "siteping-";

/** Random bytes in a generated key (hex-encoded: twice as many characters). */
export const KEY_RANDOM_BYTES = 16;

/** Base64 image data URL: `data:<type>;base64,<payload>`. */
export const IMAGE_DATA_URL_PATTERN = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i;

/**
 * Conventional file extension per content type, where it differs from (or is
 * shorter than) the subtype's alphanumerics. Other allowed types derive their
 * extension from the subtype (`image/gif` → `gif`).
 */
export const CONTENT_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

/**
 * `Cache-Control` of screenshots served without an `authorize` callback —
 * objects are immutable (a new key per upload), so any cache may keep them.
 */
export const SERVED_SCREENSHOT_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * `Cache-Control` of screenshots served behind an `authorize` callback: only the
 * requesting browser may keep them. A shared cache (CDN, proxy) storing an
 * authorized response would hand it to later requests without running the check.
 */
export const AUTHORIZED_SERVED_SCREENSHOT_CACHE_CONTROL = "private, max-age=31536000, immutable";

// Building blocks of a generated key `<prefix><hex>.<extension>` — the single
// source every key check below is derived from, so keys `createScreenshotStorage`
// produces are always keys the serve handler and backends accept.
const KEY_PREFIX_SOURCE = "[a-z0-9_-]{0,64}";
const KEY_RANDOM_SOURCE = `[a-f0-9]{${KEY_RANDOM_BYTES * 2}}`;
const KEY_EXTENSION_SOURCE = "[a-z0-9]{1,10}";

/** Allowed `keyPrefix`: safe in file names, URLs and object keys. */
export const KEY_PREFIX_PATTERN = new RegExp(`^${KEY_PREFIX_SOURCE}$`);

/** Allowed extension of a generated key — every allowed content type must map to one. */
export const KEY_EXTENSION_PATTERN = new RegExp(`^${KEY_EXTENSION_SOURCE}$`);

/** Part of a generated key after its prefix: `<hex>.<extension>`. */
export const GENERATED_KEY_SUFFIX_PATTERN = new RegExp(`^${KEY_RANDOM_SOURCE}\\.${KEY_EXTENSION_SOURCE}$`);

/** Shape of a generated key (`<prefix><hex>.<ext>`) — the serve handler refuses anything else. */
export const GENERATED_KEY_PATTERN = new RegExp(`^${KEY_PREFIX_SOURCE}${KEY_RANDOM_SOURCE}\\.${KEY_EXTENSION_SOURCE}$`);

/**
 * Extra reclaim attempts after an upload with an unknown outcome, in ms from
 * the failure. The immediate reclaim can run before a timed-out upload is
 * committed by the backend; these later attempts catch such late commits.
 */
export const UNCERTAIN_UPLOAD_RECLAIM_DELAYS_MS: readonly number[] = [5_000, 30_000, 120_000];
