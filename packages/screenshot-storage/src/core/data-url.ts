import { IMAGE_DATA_URL_PATTERN } from "../constants/screenshots.js";

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

/** Decode base64 with Web APIs only (runs on Node, Bun, Deno and edge runtimes). */
function decodeBase64(payload: string): Uint8Array<ArrayBuffer> {
  const binary = atob(payload.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Parse and validate a base64 image data URL against the allowed types and size. */
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
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = decodeBase64(match[2]);
  } catch {
    throw new InvalidScreenshotError("invalid base64 payload");
  }
  if (bytes.length === 0) throw new InvalidScreenshotError("empty image");
  if (bytes.length > limits.maxBytes) {
    throw new InvalidScreenshotError(`${bytes.length} bytes exceeds the ${limits.maxBytes}-byte limit`);
  }
  return { contentType, bytes };
}
