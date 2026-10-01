import type { BeezpingConfig, BeezpingInstance } from "@beezping/core";
import { launch } from "./launcher.js";

export type {
  AnchorData,
  AnnotationPayload,
  AnnotationResponse,
  BeezpingConfig,
  BeezpingHeadersOption,
  BeezpingHttpConfig,
  BeezpingInstance,
  BeezpingLocale,
  BeezpingPanelAction,
  BeezpingPanelActionContext,
  BeezpingPanelActionFeedback,
  BeezpingPanelButtonAction,
  BeezpingPanelLinkAction,
  BeezpingPublicEvents,
  BeezpingStore,
  BeezpingStoreConfig,
  CommentResponse,
  FeedbackPayload,
  FeedbackPermissions,
  FeedbackResponse,
  FeedbackStatus,
  FeedbackType,
  RectData,
} from "@beezping/core";
export type { TFunction, TranslationKey, Translations } from "./i18n/index.js";
export { loadLocale, registerLocale } from "./i18n/index.js";
export type { Identity } from "./identity.js";

/**
 * Initialize the Beezping feedback widget.
 *
 * @example
 * ```ts
 * import { initBeezping } from '@beezping/widget'
 *
 * const { destroy } = initBeezping({
 *   endpoint: '/api/beezping',
 *   projectName: 'my-project',
 * })
 * ```
 */
export function initBeezping(config: BeezpingConfig): BeezpingInstance {
  return launch(config);
}
