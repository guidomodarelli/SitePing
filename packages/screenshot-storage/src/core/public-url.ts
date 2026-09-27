/**
 * URL ↔ key mapping for backends that serve objects under a base URL
 * (`<base>/<key>`): the filesystem and memory stores behind the serve
 * handler, or an S3 bucket behind a CDN / public domain.
 */
export function createPublicUrlMapping(publicBaseUrl: string) {
  const base = publicBaseUrl.replace(/\/+$/, "");
  return {
    urlFor: (key: string): string => `${base}/${encodeURIComponent(key)}`,
    keyFromUrl: (url: string): string | null => {
      if (!url.startsWith(`${base}/`)) return null;
      const key = decodeURIComponent(url.slice(base.length + 1));
      return key.length > 0 && !key.includes("/") ? key : null;
    },
  };
}
