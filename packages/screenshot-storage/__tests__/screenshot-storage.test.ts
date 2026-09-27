import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCloudflareImagesObjectStore } from "../src/cloudflare-images/index.js";
import { createFilesystemObjectStore } from "../src/filesystem/index.js";
import {
  createScreenshotServeHandler,
  createScreenshotStorage,
  InvalidScreenshotError,
  ObjectStoreRequestError,
  type ScreenshotObjectStore,
  ScreenshotUploadRejectedError,
} from "../src/index.js";
import { createMemoryObjectStore } from "../src/memory/index.js";
import { createS3ObjectStore } from "../src/s3/index.js";
import { createFakeCloudflareImages, createFakeS3, type FakeBackend } from "./fake-backends.js";

/** A real 1×1 JPEG. */
const JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const JPEG_DATA_URL = `data:image/jpeg;base64,${JPEG_BASE64}`;
const JPEG_BYTES = Uint8Array.from(atob(JPEG_BASE64), (character) => character.charCodeAt(0));
const PUBLIC_BASE_URL = "https://app.example.com/api/siteping/screenshots";
const UPLOAD_CONTEXT = { feedbackId: "client-supplied-id", mimeType: "image/jpeg" };
const silentLogger = () => ({ warn: vi.fn() });

interface BackendUnderTest {
  name: string;
  open(): {
    objectStore: ScreenshotObjectStore;
    /** Bytes currently stored under `key`, read without going through the store. */
    storedBytes(key: string): Promise<Uint8Array | null>;
    /** Make the next upload fail after the object was (possibly) stored — an unknown outcome. */
    failUploadsUncertainly?(): void;
    /** Make uploads fail with a definitive rejection. */
    rejectUploads?(): void;
    cleanup?(): void;
  };
}

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const backends: BackendUnderTest[] = [
  {
    name: "memory",
    open() {
      const objectStore = createMemoryObjectStore({ publicBaseUrl: PUBLIC_BASE_URL });
      return { objectStore, storedBytes: async (key) => (await objectStore.get?.(key))?.bytes ?? null };
    },
  },
  {
    name: "filesystem",
    open() {
      const directory = mkdtempSync(join(tmpdir(), "siteping-screenshots-"));
      temporaryDirectories.push(directory);
      const objectStore = createFilesystemObjectStore({ directory, publicBaseUrl: PUBLIC_BASE_URL });
      return {
        objectStore,
        storedBytes: async (key) =>
          readdirSync(directory).includes(key) ? ((await objectStore.get?.(key))?.bytes ?? null) : null,
      };
    },
  },
  {
    name: "Cloudflare Images",
    open() {
      const fake: FakeBackend = createFakeCloudflareImages({ accountId: "account-1", apiToken: "cf-token" });
      const objectStore = createCloudflareImagesObjectStore({
        accountId: "account-1",
        apiToken: "cf-token",
        accountHash: "hash-1",
        fetch: fake.fetch,
      });
      return {
        objectStore,
        storedBytes: async (key) => fake.objects.get(key)?.bytes ?? null,
        failUploadsUncertainly: () => fake.failWhen(/^POST /, 502, { afterStoring: true }),
        rejectUploads: () => fake.failWhen(/^POST /, 400),
      };
    },
  },
  {
    name: "S3-compatible",
    open() {
      const credentials = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "s3-secret" };
      const fake = createFakeS3({ bucket: "screens", region: "auto", ...credentials });
      const objectStore = createS3ObjectStore({
        endpoint: "https://account.r2.cloudflarestorage.com",
        bucket: "screens",
        publicBaseUrl: "https://screens.example.com",
        ...credentials,
        fetch: fake.fetch,
      });
      return {
        objectStore,
        storedBytes: async (key) => fake.objects.get(key)?.bytes ?? null,
        failUploadsUncertainly: () => fake.failWhen(/^PUT /, 503, { afterStoring: true }),
        rejectUploads: () => fake.failWhen(/^PUT /, 403),
      };
    },
  },
];

for (const backend of backends) {
  describe(`createScreenshotStorage — ${backend.name}`, () => {
    it("stores the decoded image under a random key and returns a URL it can delete", async () => {
      const { objectStore, storedBytes } = backend.open();
      const storage = createScreenshotStorage(objectStore, { logger: silentLogger() });

      const { url } = await storage.upload(JPEG_DATA_URL, UPLOAD_CONTEXT);
      const key = objectStore.keyFromUrl(url);

      expect(key).toMatch(/^siteping-[a-f0-9]{32}\.jpg$/);
      expect(url).not.toContain(UPLOAD_CONTEXT.feedbackId);
      expect(await storedBytes(key as string)).toEqual(JPEG_BYTES);

      await storage.delete?.(url);
      expect(await storedBytes(key as string)).toBeNull();
    });

    it("never reuses a key, even for the same client id", async () => {
      const { objectStore } = backend.open();
      const storage = createScreenshotStorage(objectStore, { logger: silentLogger() });

      const first = await storage.upload(JPEG_DATA_URL, UPLOAD_CONTEXT);
      const second = await storage.upload(JPEG_DATA_URL, UPLOAD_CONTEXT);

      expect(first.url).not.toBe(second.url);
    });

    it("ignores URLs it does not own and already-deleted objects on delete", async () => {
      const { objectStore } = backend.open();
      const storage = createScreenshotStorage(objectStore, { logger: silentLogger() });
      const { url } = await storage.upload(JPEG_DATA_URL, UPLOAD_CONTEXT);
      await storage.delete?.(url);

      await expect(storage.delete?.(url)).resolves.toBeUndefined();
      await expect(storage.delete?.(JPEG_DATA_URL)).resolves.toBeUndefined();
      await expect(storage.delete?.("https://elsewhere.example.com/siteping-x.jpg")).resolves.toBeUndefined();
    });

    if (backend.name !== "memory" && backend.name !== "filesystem") {
      it("reclaims an upload whose outcome is unknown, then reports the failure", async () => {
        const { objectStore, storedBytes, failUploadsUncertainly } = backend.open();
        failUploadsUncertainly?.();
        const putKeys: string[] = [];
        const storage = createScreenshotStorage(
          {
            ...objectStore,
            put: (object) => {
              putKeys.push(object.key);
              return objectStore.put(object);
            },
          },
          { logger: silentLogger() },
        );

        await expect(storage.upload(JPEG_DATA_URL, UPLOAD_CONTEXT)).rejects.toBeInstanceOf(ObjectStoreRequestError);

        expect(await storedBytes(putKeys[0] as string)).toBeNull();
      });

      it("reports a definitive rejection without trying to reclaim", async () => {
        const { objectStore, rejectUploads } = backend.open();
        rejectUploads?.();
        const remove = vi.spyOn(objectStore, "remove");
        const storage = createScreenshotStorage(objectStore, { logger: silentLogger() });

        await expect(storage.upload(JPEG_DATA_URL, UPLOAD_CONTEXT)).rejects.toBeInstanceOf(
          ScreenshotUploadRejectedError,
        );
        expect(remove).not.toHaveBeenCalled();
      });
    }
  });
}

describe("createScreenshotStorage — validation", () => {
  const storage = () =>
    createScreenshotStorage(createMemoryObjectStore({ publicBaseUrl: PUBLIC_BASE_URL }), { maxBytes: 200 });

  it.each([
    ["a non-image data URL", "data:text/html;base64,PGgxPmhpPC9oMT4="],
    ["a disallowed image type", `data:image/svg+xml;base64,${btoa("<svg/>")}`],
    ["an invalid base64 payload", "data:image/jpeg;base64,***"],
    ["an image over the size limit", `data:image/jpeg;base64,${btoa("x".repeat(201))}`],
    ["a remote URL", "https://example.com/shot.jpg"],
  ])("rejects %s before any I/O", async (_label, dataUrl) => {
    await expect(storage().upload(dataUrl, UPLOAD_CONTEXT)).rejects.toBeInstanceOf(InvalidScreenshotError);
  });

  it("refuses a key prefix that is unsafe in paths or URLs", () => {
    expect(() =>
      createScreenshotStorage(createMemoryObjectStore({ publicBaseUrl: PUBLIC_BASE_URL }), { keyPrefix: "../" }),
    ).toThrow(/keyPrefix/);
  });
});

describe("createScreenshotServeHandler", () => {
  it("serves stored screenshots with their type and immutable caching", async () => {
    const objectStore = createMemoryObjectStore({ publicBaseUrl: PUBLIC_BASE_URL });
    const { url } = await createScreenshotStorage(objectStore).upload(JPEG_DATA_URL, UPLOAD_CONTEXT);

    const response = await createScreenshotServeHandler(objectStore).GET(new Request(url));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG_BYTES);
  });

  it("answers 404 for unknown keys and anything that is not a generated key", async () => {
    const directory = mkdtempSync(join(tmpdir(), "siteping-serve-"));
    temporaryDirectories.push(directory);
    const handler = createScreenshotServeHandler(
      createFilesystemObjectStore({ directory, publicBaseUrl: PUBLIC_BASE_URL }),
    );

    for (const key of [`siteping-${"a".repeat(32)}.jpg`, "..%2F..%2Fetc%2Fpasswd", "package.json"]) {
      expect((await handler.GET(new Request(`${PUBLIC_BASE_URL}/${key}`))).status).toBe(404);
    }
  });

  it("applies the authorize callback", async () => {
    const objectStore = createMemoryObjectStore({ publicBaseUrl: PUBLIC_BASE_URL });
    const { url } = await createScreenshotStorage(objectStore).upload(JPEG_DATA_URL, UPLOAD_CONTEXT);
    const handler = createScreenshotServeHandler(objectStore, {
      authorize: (request) => request.headers.get("cookie") === "session=ok",
    });

    expect((await handler.GET(new Request(url))).status).toBe(403);
    expect((await handler.GET(new Request(url, { headers: { cookie: "session=ok" } }))).status).toBe(200);
  });

  it("refuses backends that serve their own URLs", () => {
    const objectStore = createCloudflareImagesObjectStore({ accountId: "a", apiToken: "t", accountHash: "h" });
    expect(() => createScreenshotServeHandler(objectStore)).toThrow(/serves screenshots from its own URLs/);
  });
});
