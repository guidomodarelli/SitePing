import {
  BASE64_BYTES_PER_GROUP,
  BASE64_CHARACTERS_PER_GROUP,
  IMAGE_DATA_URL_PATTERN,
} from "../constants/screenshots.js";

/** A decoded image data URL. */
export interface DecodedImage {
  contentType: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/** Why a data URL was refused — part of the error message, never the payload. */
export class InvalidScreenshotError extends Error {
  constructor(reason: string) {
    super(`[siteping] screenshot rejected: ${reason}`);
    this.name = "InvalidScreenshotError";
  }
}

/**
 * Refuse, at configuration time, a `maxBytes` that could not enforce a limit:
 * `NaN` or `Infinity` (e.g. computed from a missing setting) would make every
 * size comparison false and silently accept uploads of any size.
 *
 * @param maxBytes - The `maxBytes` option of `createScreenshotStorage`.
 * @throws Error naming the refused value unless it is a positive safe integer.
 */
export function assertMaxBytes(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(
      `[siteping] createScreenshotStorage: maxBytes must be a positive integer number of bytes, got ${String(maxBytes)}`,
    );
  }
}

/**
 * Longest base64 payload (whitespace removed) that can decode to at most
 * `maxBytes` bytes — checked before decoding so an oversized upload never
 * costs its decoding.
 *
 * @param maxBytes - Validated `maxBytes` limit.
 */
function maxBase64Length(maxBytes: number): number {
  return Math.ceil(maxBytes / BASE64_BYTES_PER_GROUP) * BASE64_CHARACTERS_PER_GROUP;
}

/** Decode base64 with Web APIs only (runs on Node, Bun, Deno and edge runtimes). */
function decodeBase64(payload: string): Uint8Array<ArrayBuffer> {
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Parse and validate a base64 image data URL against the allowed types and
 * size. The payload length is bounded before decoding, the decoded size after.
 *
 * @param dataUrl - The widget's screenshot data URL (untrusted input).
 * @param limits - Allowed content types and `maxBytes`, validated by `createScreenshotStorage`.
 * @throws InvalidScreenshotError naming the reason, never echoing the payload.
 */
export function decodeImageDataUrl(
  dataUrl: string,
  limits: { allowedContentTypes: readonly string[]; maxBytes: number },
): DecodedImage {
  const match = IMAGE_DATA_URL_PATTERN.exec(dataUrl);
  if (!match?.[1] || !match[2]) throw new InvalidScreenshotError("not a base64 image data URL");
  const contentType = match[1].toLowerCase();
  if (!limits.allowedContentTypes.includes(contentType)) {
    throw new InvalidScreenshotError(`content type ${contentType} is not allowed`);
  }
  const payload = match[2].replace(/\s/g, "");
  if (payload.length > maxBase64Length(limits.maxBytes)) {
    throw new InvalidScreenshotError(
      `base64 payload of ${payload.length} characters exceeds the ${limits.maxBytes}-byte limit`,
    );
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = decodeBase64(payload);
  } catch {
    throw new InvalidScreenshotError("invalid base64 payload");
  }
  if (bytes.length === 0) throw new InvalidScreenshotError("empty image");
  if (bytes.length > limits.maxBytes) {
    throw new InvalidScreenshotError(`${bytes.length} bytes exceeds the ${limits.maxBytes}-byte limit`);
  }
  return { contentType, bytes };
}
