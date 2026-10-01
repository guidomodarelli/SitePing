/** Local origin used until a deployed Beezping site is configured. */
const DEFAULT_SITE_ORIGIN = "http://localhost:3000";

/** Canonical origin for metadata, localized URLs and the sitemap. */
export const SITE_URL = new URL(
  (typeof process !== "undefined" ? process.env.BEEZPING_SITE_URL : undefined) || DEFAULT_SITE_ORIGIN,
).origin;
