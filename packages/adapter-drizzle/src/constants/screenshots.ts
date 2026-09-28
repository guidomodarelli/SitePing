/**
 * MIME type reported to `ScreenshotStorage.upload` when the data URL declares
 * none — the format the widget encodes screenshots with.
 */
export const FALLBACK_SCREENSHOT_MIME_TYPE = "image/jpeg";

/**
 * Media type of a data URL (`data:<type>/<subtype>[;params][,…]`), captured
 * without its parameters. The server accepts JPEG, PNG and WebP screenshots.
 */
export const DATA_URL_MEDIA_TYPE_PATTERN = /^data:([a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+)[;,]/i;

/** Prefix of inline screenshots — stored as-is, never uploaded, nothing to clean up. */
export const INLINE_SCREENSHOT_URL_PREFIX = "data:";
