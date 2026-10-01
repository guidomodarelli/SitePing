// Re-export commonly needed core types so consumers don't have to depend on @beezping/core directly.
export type {
  BeezpingCapabilities,
  BeezpingStore,
  CommentCreateInput,
  CommentRecord,
  FeedbackPermissions,
  FeedbackRecord,
  FeedbackStatus,
  FeedbackType,
} from "@beezping/core";
export { FEEDBACK_STATUSES, FEEDBACK_TYPES, isClosedStatus } from "@beezping/core";
export { BeezpingInbox } from "./components/inbox.js";
export { registerLocale } from "./i18n/index.js";
export { createEndpointSource, createStoreSource } from "./source.js";
export type { InboxTheme, ResolvedTheme } from "./theme.js";
export type {
  BeezpingInboxPresentationProps,
  BeezpingInboxProps,
  EndpointSourceOptions,
  InboxCustomSourceOptions,
  InboxEndpointOptions,
  InboxPage,
  InboxRecord,
  InboxSharedOptions,
  InboxSource,
  InboxState,
  InboxStatusFilter,
  InboxStoreOptions,
  InboxTypeFilter,
  UseBeezpingInboxOptions,
} from "./types.js";
export { useBeezpingInbox } from "./use-inbox.js";
