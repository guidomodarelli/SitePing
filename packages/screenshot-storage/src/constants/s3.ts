/** Signature algorithm identifier of AWS Signature Version 4. */
export const SIGV4_ALGORITHM = "AWS4-HMAC-SHA256";

/** Service name in the SigV4 credential scope. */
export const S3_SERVICE = "s3";

/** Terminator of the SigV4 credential scope. */
export const SIGV4_SCOPE_TERMINATOR = "aws4_request";

/** Region S3-compatible services without regions accept (Cloudflare R2). */
export const S3_DEFAULT_REGION = "auto";
