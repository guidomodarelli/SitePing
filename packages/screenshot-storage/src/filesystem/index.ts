import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { CONTENT_TYPE_EXTENSIONS, GENERATED_KEY_PATTERN } from "../constants/screenshots.js";
import type { ScreenshotObjectStore } from "../core/object-store.js";
import { createPublicUrlMapping } from "../core/public-url.js";

export interface FilesystemObjectStoreOptions {
  /** Directory the screenshots are written to (created when missing). */
  directory: string;
  /** Where `createScreenshotServeHandler` is mounted, e.g. `https://app.example.com/api/siteping/screenshots`. */
  publicBaseUrl: string;
}

const CONTENT_TYPE_BY_EXTENSION = new Map(
  Object.entries(CONTENT_TYPE_EXTENSIONS).map(([contentType, extension]) => [`.${extension}`, contentType]),
);

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/**
 * Screenshots as files on the local disk (Node.js). Serve them with
 * `createScreenshotServeHandler`, or point `publicBaseUrl` at a static file
 * server for `directory`. Not suited to serverless platforms with ephemeral disks.
 */
export function createFilesystemObjectStore({
  directory,
  publicBaseUrl,
}: FilesystemObjectStoreOptions): ScreenshotObjectStore {
  /** Keys are generated, but re-check before touching the disk so no path can escape `directory`. */
  const pathOf = (key: string): string => {
    if (!GENERATED_KEY_PATTERN.test(key)) throw new Error(`[siteping] filesystem store: refusing key "${key}"`);
    return join(directory, key);
  };

  return {
    name: "filesystem",
    ...createPublicUrlMapping(publicBaseUrl),
    async put({ key, bytes }) {
      await mkdir(directory, { recursive: true });
      await writeFile(pathOf(key), bytes, { flag: "wx" });
    },
    async remove(key) {
      await rm(pathOf(key), { force: true });
    },
    async get(key) {
      try {
        const bytes = await readFile(pathOf(key));
        const contentType = CONTENT_TYPE_BY_EXTENSION.get(extname(key)) ?? "application/octet-stream";
        return { bytes: new Uint8Array(bytes), contentType };
      } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
      }
    },
  };
}

export type { ScreenshotObjectStore } from "../core/object-store.js";
