# @siteping/screenshot-storage

Where [SitePing](https://siteping.dev) screenshots live — pick a backend, or bring your own.

```ts
import { createScreenshotStorage } from "@siteping/screenshot-storage";
import { createCloudflareImagesObjectStore } from "@siteping/screenshot-storage/cloudflare-images";

const screenshotStorage = createScreenshotStorage(
  createCloudflareImagesObjectStore({ accountId, apiToken, accountHash }),
);

// Hand it to your store: createPgSitepingStore(db, { screenshotStorage }), new PrismaStore(prisma, { screenshotStorage })…
```

| Backend | Entry | Notes |
|---|---|---|
| Cloudflare Images | `./cloudflare-images` | Served from `imagedelivery.net` (or your custom domain) |
| AWS S3, Cloudflare R2, Backblaze B2, MinIO, DigitalOcean Spaces… | `./s3` | SigV4 over WebCrypto — no AWS SDK, runs on edge runtimes |
| Local disk | `./filesystem` | Node.js; served by `createScreenshotServeHandler` |
| Memory | `./memory` | Development and tests |
| Your own (database table, Vercel Blob, Supabase Storage…) | — | Implement `ScreenshotObjectStore`: `put`, `remove`, `urlFor`, `keyFromUrl` (+ `get` to be served by the handler) |

Without any storage, stores keep screenshots inline in the database as base64 — fine for development.

`createScreenshotStorage` handles the backend-agnostic parts: image type and size validation, random keys (never derived from client input), reclaiming uploads whose outcome is unknown, and ignoring URLs it does not own on delete.

Backends without a public URL are served from your app:

```ts
// app/api/siteping/screenshots/[key]/route.ts
export const { GET } = createScreenshotServeHandler(objectStore, { authorize: (request) => hasSession(request) });
```

MIT
