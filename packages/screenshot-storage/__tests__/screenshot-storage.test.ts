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
  isObjectStoreRequestError,
  isScreenshotUploadRejected,
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
/** A real 1×1 GIF — a type outside the defaults. */
const GIF_DATA_URL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
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

    it("returns a distinct URL per upload, even for the same feedbackId and identical bytes", async () => {
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

    it("treats a stored URL with malformed percent-encoding as not its own on delete", async () => {
      const { objectStore, storedBytes } = backend.open();
      const storage = createScreenshotStorage(objectStore, { logger: silentLogger() });
      const { url } = await storage.upload(JPEG_DATA_URL, UPLOAD_CONTEXT);
      const key = objectStore.keyFromUrl(url) ?? "";

      for (const malformedKey of ["%", "%ZZ", "%E0%A4%A"]) {
        const malformedUrl = objectStore.urlFor("PLACEHOLDER").replace("PLACEHOLDER", malformedKey);
        expect(objectStore.keyFromUrl(malformedUrl)).toBeNull();
        await expect(storage.delete?.(malformedUrl)).resolves.toBeUndefined();
      }
      expect(await storedBytes(key)).toEqual(JPEG_BYTES);
    });

    it("never deletes another object behind the same public base URL", async () => {
      const { objectStore, storedBytes } = backend.open();
      const logger = silentLogger();
      const storage = createScreenshotStorage(objectStore, { logger });
      const foreignKey = `other-app-${"b".repeat(32)}.jpg`;
      await objectStore.put({ key: foreignKey, bytes: JPEG_BYTES.slice(), contentType: "image/jpeg" });

      await storage.delete?.(objectStore.urlFor(foreignKey));

      expect(await storedBytes(foreignKey)).toEqual(JPEG_BYTES);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("refusing to delete"), {
        key: foreignKey,
        keyPrefix: "siteping-",
      });
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

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5])(
    "refuses maxBytes %s, which cannot enforce a limit",
    (maxBytes) => {
      expect(() =>
        createScreenshotStorage(createMemoryObjectStore({ publicBaseUrl: PUBLIC_BASE_URL }), { maxBytes }),
      ).toThrow(`maxBytes must be a positive integer number of bytes, got ${String(maxBytes)}`);
    },
  );

  it("rejects an oversized payload by its base64 length, before decoding it", async () => {
    const oversizedUndecodable = `data:image/jpeg;base64,${"AA==".repeat(80)}`;
    await expect(storage().upload(oversizedUndecodable, UPLOAD_CONTEXT)).rejects.toThrow(/exceeds the 200-byte limit/);
  });

  it("accepts an image of exactly maxBytes", async () => {
    const exactSize = `data:image/jpeg;base64,${btoa("x".repeat(200))}`;
    await expect(storage().upload(exactSize, UPLOAD_CONTEXT)).resolves.toHaveProperty("url");
  });

  it("only deletes keys with the configured prefix and the generated shape", async () => {
    const objectStore = createMemoryObjectStore({ publicBaseUrl: PUBLIC_BASE_URL });
    const storage = createScreenshotStorage(objectStore, { keyPrefix: "team-a-", logger: silentLogger() });
    const { url } = await storage.upload(JPEG_DATA_URL, UPLOAD_CONTEXT);
    const foreignKeys = ["team-a-logo.png", `siteping-${"c".repeat(32)}.jpg`, `team-a-${"c".repeat(32)}.jpg.bak`];
    for (const key of foreignKeys) await objectStore.put({ key, bytes: JPEG_BYTES.slice(), contentType: "image/jpeg" });

    for (const key of foreignKeys) await storage.delete?.(objectStore.urlFor(key));
    await storage.delete?.(url);

    expect(objectStore.keys().sort()).toEqual([...foreignKeys].sort());
  });

  it("refuses a key prefix that is unsafe in paths or URLs", () => {
    expect(() =>
      createScreenshotStorage(createMemoryObjectStore({ publicBaseUrl: PUBLIC_BASE_URL }), { keyPrefix: "../" }),
    ).toThrow(/keyPrefix/);
  });

  it("refuses an allowed content type whose key extension the serve handler would reject", () => {
    expect(() =>
      createScreenshotStorage(createMemoryObjectStore({ publicBaseUrl: PUBLIC_BASE_URL }), {
        allowedContentTypes: ["image/jpeg", "image/vnd.adobe.photoshop"],
      }),
    ).toThrow(/image\/vnd\.adobe\.photoshop.*vndadobephotoshop/);
  });

  it.each(["image/svg+xml", "IMAGE/SVG+XML"])("refuses the active format %s in allowedContentTypes", (contentType) => {
    expect(() =>
      createScreenshotStorage(createMemoryObjectStore({ publicBaseUrl: PUBLIC_BASE_URL }), {
        allowedContentTypes: ["image/png", contentType],
      }),
    ).toThrow(/active format/);
  });

  it("gives custom content types keys the serve handler accepts", async () => {
    const objectStore = createMemoryObjectStore({ publicBaseUrl: PUBLIC_BASE_URL });
    const storage = createScreenshotStorage(objectStore, {
      allowedContentTypes: ["image/vnd.microsoft.icon"],
      logger: silentLogger(),
    });

    const { url } = await storage.upload(`data:image/vnd.microsoft.icon;base64,${JPEG_BASE64}`, UPLOAD_CONTEXT);
    const response = await createScreenshotServeHandler(objectStore).GET(new Request(url));

    expect(objectStore.keyFromUrl(url)).toMatch(/\.ico$/);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/vnd.microsoft.icon");
  });
});

describe("createScreenshotServeHandler", () => {
  it("serves stored screenshots with their type and immutable caching", async () => {
    const objectStore = createMemoryObjectStore({ publicBaseUrl: PUBLIC_BASE_URL });
    const { url } = await createScreenshotStorage(objectStore).upload(JPEG_DATA_URL, UPLOAD_CONTEXT);

    const response = await createScreenshotServeHandler(objectStore).GET(new Request(url));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG_BYTES);
  });

  for (const backend of backends.filter(({ name }) => name === "memory" || name === "filesystem")) {
    it(`serves a custom allowed type from ${backend.name} with the type it was uploaded with`, async () => {
      const { objectStore } = backend.open();
      const storage = createScreenshotStorage(objectStore, {
        allowedContentTypes: ["image/jpeg", "image/gif"],
        logger: silentLogger(),
      });

      const { url } = await storage.upload(GIF_DATA_URL, UPLOAD_CONTEXT);
      const response = await createScreenshotServeHandler(objectStore).GET(new Request(url));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/gif");
    });
  }

  for (const backend of backends.filter(({ name }) => name === "memory" || name === "filesystem")) {
    it(`sandboxes whatever ${backend.name} serves, even an SVG that reached the backend directly`, async () => {
      const { objectStore } = backend.open();
      const legacyKey = `siteping-${"b".repeat(32)}.svg`;
      const svgBytes = new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      );
      await objectStore.put({ key: legacyKey, bytes: svgBytes, contentType: "image/svg+xml" });

      const response = await createScreenshotServeHandler(objectStore).GET(new Request(objectStore.urlFor(legacyKey)));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    });
  }

  it("removes the filesystem content-type sidecar with the screenshot", async () => {
    const directory = mkdtempSync(join(tmpdir(), "siteping-sidecar-"));
    temporaryDirectories.push(directory);
    const storage = createScreenshotStorage(createFilesystemObjectStore({ directory, publicBaseUrl: PUBLIC_BASE_URL }));

    const { url } = await storage.upload(JPEG_DATA_URL, UPLOAD_CONTEXT);
    expect(readdirSync(directory)).toHaveLength(2);
    await storage.delete?.(url);

    expect(readdirSync(directory)).toEqual([]);
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

  it("answers 404 for keys with malformed percent-encoding", async () => {
    const objectStore = createMemoryObjectStore({ publicBaseUrl: PUBLIC_BASE_URL });
    await createScreenshotStorage(objectStore).upload(JPEG_DATA_URL, UPLOAD_CONTEXT);
    const handler = createScreenshotServeHandler(objectStore);

    for (const malformedSegment of ["%", "%ZZ", "%E0%A4%A"]) {
      expect((await handler.GET(new Request(`${PUBLIC_BASE_URL}/${malformedSegment}`))).status).toBe(404);
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

  it("keeps screenshots behind an authorize callback out of shared caches and revalidated on every reuse", async () => {
    const objectStore = createMemoryObjectStore({ publicBaseUrl: PUBLIC_BASE_URL });
    const { url } = await createScreenshotStorage(objectStore).upload(JPEG_DATA_URL, UPLOAD_CONTEXT);
    const handler = createScreenshotServeHandler(objectStore, { authorize: () => true });

    const response = await handler.GET(new Request(url));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
  });

  it("revalidates an authorized screenshot with a 304, and refuses it once access is revoked", async () => {
    const objectStore = createMemoryObjectStore({ publicBaseUrl: PUBLIC_BASE_URL });
    const { url } = await createScreenshotStorage(objectStore).upload(JPEG_DATA_URL, UPLOAD_CONTEXT);
    let hasAccess = true;
    const handler = createScreenshotServeHandler(objectStore, { authorize: () => hasAccess });

    const firstResponse = await handler.GET(new Request(url));
    const etag = firstResponse.headers.get("etag");
    expect(etag).toMatch(/^".+"$/);
    const revalidation = await handler.GET(new Request(url, { headers: { "If-None-Match": `W/${etag}` } }));
    expect(revalidation.status).toBe(304);
    expect(revalidation.headers.get("cache-control")).toBe("private, no-cache");
    expect(await revalidation.text()).toBe("");

    hasAccess = false;
    const afterRevocation = await handler.GET(new Request(url, { headers: { "If-None-Match": `${etag}` } }));
    expect(afterRevocation.status).toBe(403);
  });

  it("only serves its own keyPrefix namespace from a filesystem directory shared with another app", async () => {
    const directory = mkdtempSync(join(tmpdir(), "siteping-shared-"));
    temporaryDirectories.push(directory);
    const objectStore = createFilesystemObjectStore({ directory, publicBaseUrl: PUBLIC_BASE_URL });
    const appA = createScreenshotStorage(objectStore, { keyPrefix: "app-a-" });
    const appB = createScreenshotStorage(objectStore, { keyPrefix: "app-b-" });
    const { url: urlOfA } = await appA.upload(JPEG_DATA_URL, UPLOAD_CONTEXT);
    const { url: urlOfB } = await appB.upload(JPEG_DATA_URL, UPLOAD_CONTEXT);
    const authorizedKeys: string[] = [];
    const handlerOfA = createScreenshotServeHandler(objectStore, {
      keyPrefix: "app-a-",
      authorize: (_request, { key }) => {
        authorizedKeys.push(key);
        return true;
      },
    });

    expect((await handlerOfA.GET(new Request(urlOfA))).status).toBe(200);
    expect((await handlerOfA.GET(new Request(urlOfB))).status).toBe(404);
    expect(authorizedKeys).toEqual([objectStore.keyFromUrl(urlOfA)]);
  });

  it("serves only the default siteping- namespace when no keyPrefix is given", async () => {
    const objectStore = createMemoryObjectStore({ publicBaseUrl: PUBLIC_BASE_URL });
    const { url } = await createScreenshotStorage(objectStore, { keyPrefix: "other-" }).upload(
      JPEG_DATA_URL,
      UPLOAD_CONTEXT,
    );

    expect((await createScreenshotServeHandler(objectStore).GET(new Request(url))).status).toBe(404);
  });

  it("refuses a serve keyPrefix that is unsafe in paths or URLs", () => {
    const objectStore = createMemoryObjectStore({ publicBaseUrl: PUBLIC_BASE_URL });
    expect(() => createScreenshotServeHandler(objectStore, { keyPrefix: "../" })).toThrow(
      /createScreenshotServeHandler: keyPrefix/,
    );
  });

  it("refuses backends that serve their own URLs", () => {
    const objectStore = createCloudflareImagesObjectStore({ accountId: "a", apiToken: "t", accountHash: "h" });
    expect(() => createScreenshotServeHandler(objectStore)).toThrow(/serves screenshots from its own URLs/);
  });
});

/**
 * A memory backend whose `put` times out while the upload is still in flight:
 * the caller gets an unknown outcome at once, and the object is committed
 * `commitDelayMs` later — after the immediate reclaim already ran.
 */
function createLateCommittingObjectStore(commitDelayMs: number) {
  const committed = createMemoryObjectStore({ publicBaseUrl: PUBLIC_BASE_URL });
  const objectStore: ScreenshotObjectStore = {
    ...committed,
    async put(object) {
      setTimeout(() => void committed.put(object), commitDelayMs);
      throw new ObjectStoreRequestError("memory", "PUT", `/${object.key}`, null, {
        cause: new DOMException("The operation timed out.", "TimeoutError"),
      });
    },
  };
  return { objectStore, storedKeys: () => committed.keys() };
}

describe("createScreenshotStorage — uploads committed after a timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reclaims an object the backend commits after the immediate reclaim", async () => {
    vi.useFakeTimers();
    const { objectStore, storedKeys } = createLateCommittingObjectStore(1_000);
    const storage = createScreenshotStorage(objectStore, { logger: silentLogger() });

    await expect(storage.upload(JPEG_DATA_URL, UPLOAD_CONTEXT)).rejects.toBeInstanceOf(ObjectStoreRequestError);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(storedKeys()).toHaveLength(1);

    await vi.runAllTimersAsync();
    expect(storedKeys()).toEqual([]);
  });

  it("leaves the late commit behind with only the immediate reclaim — the gap the delays close", async () => {
    vi.useFakeTimers();
    const { objectStore, storedKeys } = createLateCommittingObjectStore(1_000);
    const storage = createScreenshotStorage(objectStore, {
      uncertainUploadReclaimDelaysMs: [],
      logger: silentLogger(),
    });

    await expect(storage.upload(JPEG_DATA_URL, UPLOAD_CONTEXT)).rejects.toBeInstanceOf(ObjectStoreRequestError);
    await vi.runAllTimersAsync();

    expect(storedKeys()).toHaveLength(1);
  });

  it("runs the delayed attempts through the injected scheduler and hands the key to onUncertainUpload", async () => {
    const scheduled: { task: () => void; delayMs: number }[] = [];
    const uncertainKeys: string[] = [];
    const { objectStore, storedKeys } = createLateCommittingObjectStore(0);
    const storage = createScreenshotStorage(objectStore, {
      uncertainUploadReclaimDelaysMs: [10, 20],
      scheduleReclaim: (task, delayMs) => scheduled.push({ task, delayMs }),
      onUncertainUpload: (key) => {
        uncertainKeys.push(key);
      },
      logger: silentLogger(),
    });

    await expect(storage.upload(JPEG_DATA_URL, UPLOAD_CONTEXT)).rejects.toBeInstanceOf(ObjectStoreRequestError);
    await new Promise((resolve) => setTimeout(resolve, 5)); // let the late commit land
    expect(storedKeys()).toEqual(uncertainKeys);
    expect(scheduled.map(({ delayMs }) => delayMs)).toEqual([10, 20]);

    scheduled[0]?.task();
    await vi.waitFor(() => expect(storedKeys()).toEqual([]));
  });

  it("logs a failing onUncertainUpload hook and still reports the upload error", async () => {
    const logger = silentLogger();
    const { objectStore } = createLateCommittingObjectStore(0);
    const storage = createScreenshotStorage(objectStore, {
      uncertainUploadReclaimDelaysMs: [],
      onUncertainUpload: () => {
        throw new Error("queue unavailable");
      },
      logger,
    });

    await expect(storage.upload(JPEG_DATA_URL, UPLOAD_CONTEXT)).rejects.toBeInstanceOf(ObjectStoreRequestError);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("onUncertainUpload failed"), {
      key: expect.stringMatching(/^siteping-[a-f0-9]{32}\.jpg$/),
      error: expect.objectContaining({ message: "queue unavailable" }),
    });
  });

  it("refuses reclaim delays that are not finite, non-negative milliseconds", () => {
    const objectStore = createMemoryObjectStore({ publicBaseUrl: PUBLIC_BASE_URL });
    expect(() => createScreenshotStorage(objectStore, { uncertainUploadReclaimDelaysMs: [-1] })).toThrow(
      /uncertainUploadReclaimDelaysMs/,
    );
  });
});

/**
 * What a backend subpath's CommonJS bundle throws: same name and code as the
 * classes the consumer imported from the package root, but another class.
 */
class ScreenshotUploadRejectedErrorFromAnotherBundle extends Error {
  readonly code = "SCREENSHOT_UPLOAD_REJECTED";
  override name = "ScreenshotUploadRejectedError";
}
class ObjectStoreRequestErrorFromAnotherBundle extends Error {
  readonly code = "OBJECT_STORE_REQUEST_FAILED";
  override name = "ObjectStoreRequestError";
}

describe("error identity across bundles", () => {
  it("recognizes upload rejections by their stable code, not their class", () => {
    expect(isScreenshotUploadRejected(new ScreenshotUploadRejectedError("refused"))).toBe(true);
    expect(isScreenshotUploadRejected(new ScreenshotUploadRejectedErrorFromAnotherBundle("refused"))).toBe(true);
    expect(isScreenshotUploadRejected(new ObjectStoreRequestError("S3", "PUT", "/k", 503))).toBe(false);
    expect(isScreenshotUploadRejected(new Error("refused"))).toBe(false);
    expect(isScreenshotUploadRejected(null)).toBe(false);
    expect(isScreenshotUploadRejected("SCREENSHOT_UPLOAD_REJECTED")).toBe(false);
  });

  it("recognizes failed backend requests by their stable code, not their class", () => {
    expect(isObjectStoreRequestError(new ObjectStoreRequestError("S3", "PUT", "/k", 503))).toBe(true);
    expect(isObjectStoreRequestError(new ObjectStoreRequestErrorFromAnotherBundle("failed"))).toBe(true);
    expect(isObjectStoreRequestError(new ScreenshotUploadRejectedError("refused"))).toBe(false);
    expect(isObjectStoreRequestError(undefined)).toBe(false);
  });

  it("does not reclaim after a rejection thrown by another bundle's copy of the class", async () => {
    const objectStore = createMemoryObjectStore({ publicBaseUrl: PUBLIC_BASE_URL });
    const rejection = new ScreenshotUploadRejectedErrorFromAnotherBundle("S3 PUT failed with status 403");
    const removedKeys: string[] = [];
    const storage = createScreenshotStorage(
      {
        ...objectStore,
        put: async () => {
          throw rejection;
        },
        remove: async (key) => {
          removedKeys.push(key);
          await objectStore.remove(key);
        },
      },
      { logger: silentLogger() },
    );

    await expect(storage.upload(JPEG_DATA_URL, UPLOAD_CONTEXT)).rejects.toBe(rejection);
    expect(removedKeys).toEqual([]);
  });
});
