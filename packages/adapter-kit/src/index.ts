/**
 * Everything needed to build a custom Beezping store adapter, published —
 * `@beezping/core` is an internal (unpublished) package, so this kit is the
 * supported dependency for third-party adapters.
 *
 * Two ways to implement a store:
 *
 * 1. **Snapshot backends** (KV, flat file, IndexedDB, …): hand
 *    {@link createCollectionStore} a `load`/`persist`/`generateId` trio and
 *    every store semantic (clientId dedup, serialized mutations, filtering,
 *    pagination, error contract) comes built-in — an adapter is ~20 lines
 *    plus its storage specifics.
 * 2. **Query backends** (SQL, ORMs): implement {@link BeezpingStore}
 *    directly; {@link buildFeedbackRecord} / {@link buildAnnotationRecord} /
 *    {@link buildCommentRecord} handle input→record construction, and the
 *    JSDoc on `BeezpingStore` documents the exact error contract.
 *
 * Either way, verify with the conformance suite from
 * `@beezping/adapter-kit/testing`:
 *
 * @example
 * ```ts
 * import { testBeezpingStore } from "@beezping/adapter-kit/testing";
 * import { MyStore } from "../src/index.js";
 *
 * testBeezpingStore(() => new MyStore());
 * ```
 */

// The store contract and its data model
// Building blocks — record construction, the shared filter pipeline, and
// the full collection-store engine
export type {
  AnchorData,
  AnnotationCreateInput,
  AnnotationPayload,
  AnnotationRecord,
  AnnotationResponse,
  BeezpingStore,
  ClosedFeedbackStatus,
  CollectionStore,
  CollectionStoreBackend,
  CommentAuthorRole,
  CommentCreateInput,
  CommentRecord,
  CommentResponse,
  ConsoleDiagnosticEntry,
  ConsoleDiagnosticLevel,
  DiagnosticsSnapshot,
  FeedbackCreateInput,
  FeedbackCreateOutcome,
  FeedbackPage,
  FeedbackPayload,
  FeedbackQuery,
  FeedbackRecord,
  FeedbackResponse,
  FeedbackResponseList,
  FeedbackStatus,
  FeedbackType,
  FeedbackUpdateInput,
  FilterResult,
  NetworkDiagnosticEntry,
  OpenFeedbackStatus,
  Pagination,
  RectData,
  ScreenshotRegion,
  ScreenshotStorage,
  Serialized,
} from "@beezping/core";
// Status/type constants + helpers
// Store errors — throw these from adapter implementations
export {
  applyFeedbackFilters,
  buildAnnotationRecord,
  buildCommentRecord,
  buildFeedbackRecord,
  CLOSED_FEEDBACK_STATUSES,
  COMMENT_AUTHOR_ROLES,
  CONSOLE_DIAGNOSTIC_LEVELS,
  clampPagination,
  createCollectionStore,
  DEFAULT_PAGE_LIMIT,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  flattenAnnotation,
  isClosedStatus,
  isStoreDuplicate,
  isStoreLimit,
  isStoreNotFound,
  isStorePersistence,
  isStoreValueTooLong,
  isUnreachableOffset,
  MAX_COMMENTS_PER_FEEDBACK,
  MAX_PAGE_LIMIT,
  OPEN_FEEDBACK_STATUSES,
  StoreDuplicateError,
  StoreLimitError,
  StoreNotFoundError,
  StorePersistenceError,
  StoreValueTooLongError,
  toFeedbackUpdate,
} from "@beezping/core";
