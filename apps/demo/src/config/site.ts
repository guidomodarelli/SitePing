/**
 * Local origin used when `BEEZPING_SITE_URL` is unset (dev and local builds).
 * Deployments must set `BEEZPING_SITE_URL` at build time: the Docker build
 * refuses to run without it (see `apps/demo/Dockerfile` and `.env.example`).
 */
const DEFAULT_SITE_ORIGIN = "http://localhost:3000";

/** Canonical origin for metadata, localized URLs and the sitemap. */
export const SITE_URL = new URL(
  (typeof process !== "undefined" ? process.env.BEEZPING_SITE_URL : undefined) || DEFAULT_SITE_ORIGIN,
).origin;
