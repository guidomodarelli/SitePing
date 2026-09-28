import { MAX_ANNOTATIONS_PER_FEEDBACK } from "./limits.js";

/**
 * `error` strings of the HTTP API. Part of the wire contract: widgets and
 * existing `adapter-prisma` consumers match on some of them.
 */
export const SITEPING_ERROR_MESSAGES = {
  invalidJson: "Invalid JSON",
  unauthorized: "Unauthorized",
  apiKeyRequiredForDestructive: "apiKey required for destructive operations",
  forbidden: "Forbidden",
  feedbackNotFound: "Feedback not found",
  clientIdUsedByAnotherProject: "clientId already used by another project",
  tooManyAnnotations: `Too many annotations (max ${MAX_ANNOTATIONS_PER_FEEDBACK})`,
  deletionAborted: "Deletion aborted: a linked resource could not be cleaned up",
  internalServerError: "Internal server error",
} as const satisfies Record<string, string>;

/**
 * Startup errors thrown by `createSitepingHandler` when its options would
 * leave a security guard inoperative. Not part of the wire contract.
 */
export const SITEPING_CONFIGURATION_ERROR_MESSAGES = {
  ownershipVerificationRequired:
    "[siteping] createSitepingHandler: `access.authorize` needs a store implementing `verifyProjectOwnership`. " +
    "Without it, a caller authorized for one project could PATCH or DELETE another project's feedback by id. " +
    "Implement `verifyProjectOwnership` on the store (createCollectionStore and PrismaStore already do).",
} as const satisfies Record<string, string>;
