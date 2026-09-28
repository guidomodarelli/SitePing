import {
  type FeedbackCreateInput,
  type FeedbackRecord,
  flattenAnnotation,
  isStoreDuplicate,
  type SitepingStore,
} from "@siteping/core";
import { SITEPING_ERROR_MESSAGES } from "../constants/error-messages.js";
import { MAX_ANNOTATIONS_PER_FEEDBACK } from "../constants/limits.js";
import type { SitepingHandlerBaseOptions } from "../options.js";
import type { AuthenticatedRequest, RequestPipeline } from "../request-pipeline.js";
import { feedbackCreateSchema } from "../validation.js";
import { dispatchWebhooks, type WebhookConfig } from "../webhooks.js";

type FeedbackCreatePayload = ReturnType<typeof feedbackCreateSchema.parse>;

export interface CreateFeedbackDependencies<Principal> {
  store: SitepingStore;
  pipeline: RequestPipeline<Principal>;
  beforeCreate: SitepingHandlerBaseOptions<Principal>["beforeCreate"];
  onCreated: NonNullable<SitepingHandlerBaseOptions<Principal>["hooks"]>["onCreated"];
  webhooks: ReadonlyArray<WebhookConfig>;
}

/** Store input from the validated payload — the store never sees wire-only shapes. */
function toCreateInput(payload: FeedbackCreatePayload): FeedbackCreateInput {
  return {
    projectName: payload.projectName,
    type: payload.type,
    message: payload.message,
    status: "open",
    url: payload.url,
    urlPattern: payload.urlPattern ?? null,
    viewport: payload.viewport,
    userAgent: payload.userAgent,
    authorName: payload.authorName,
    authorEmail: payload.authorEmail,
    clientId: payload.clientId,
    annotations: payload.annotations.map(flattenAnnotation),
    screenshotDataUrl: payload.screenshotDataUrl ?? null,
    screenshotRegion: payload.screenshotRegion ?? null,
    diagnostics: payload.diagnostics ?? null,
  };
}

/** `POST` — create a feedback, idempotent on `clientId`. */
export function createFeedbackOperation<Principal>({
  store,
  pipeline,
  beforeCreate,
  onCreated,
  webhooks,
}: CreateFeedbackDependencies<Principal>) {
  /**
   * A clientId is unique across the store, so a replay resolving to another
   * project's record is a boundary violation, not a dedup. Email stays intact
   * otherwise: the requester supplied it (fresh insert) or proved ownership by
   * presenting the clientId (replay).
   */
  const respondCreated = (scope: AuthenticatedRequest<Principal>, feedback: FeedbackRecord, projectName: string) =>
    feedback.projectName === projectName
      ? pipeline.json(scope, pipeline.present(scope, feedback, true), { status: 201 })
      : pipeline.error(scope, 409, SITEPING_ERROR_MESSAGES.clientIdUsedByAnotherProject);

  /**
   * Insert, resolving a race on clientId to the winning record. `isNew` gates
   * the creation side effects, so it must only be `true` when this call
   * inserted: stores returning the existing record on a duplicate say so
   * through `createFeedbackIfAbsent`; the others throw `StoreDuplicateError`.
   * A store that returns the existing record from plain `createFeedback`
   * cannot be told apart from an insert — see the `SitepingStore` contract.
   */
  const insert = async (input: FeedbackCreateInput): Promise<{ feedback: FeedbackRecord; isNew: boolean }> => {
    try {
      if (store.createFeedbackIfAbsent) {
        const { feedback, created } = await store.createFeedbackIfAbsent(input);
        return { feedback, isNew: created };
      }
      return { feedback: await store.createFeedback(input), isNew: true };
    } catch (error) {
      if (isStoreDuplicate(error)) {
        const existing = await store.findByClientId(input.clientId);
        if (existing) return { feedback: existing, isNew: false };
      }
      throw error;
    }
  };

  return async (request: Request): Promise<Response> => {
    const authentication = await pipeline.authenticate(request, "POST");
    if (!authentication.ok) return authentication.response;
    const scope = authentication.value;

    const payload = await pipeline.readBody(scope, feedbackCreateSchema);
    if (!payload.ok) return payload.response;
    // Defense-in-depth on top of the schema limit.
    if (payload.value.annotations.length > MAX_ANNOTATIONS_PER_FEEDBACK) {
      return pipeline.error(scope, 400, SITEPING_ERROR_MESSAGES.tooManyAnnotations);
    }

    try {
      const validatedInput = toCreateInput(payload.value);
      const input = beforeCreate ? await beforeCreate(validatedInput, scope.context) : validatedInput;

      const refusal = await pipeline.authorize(scope, { action: "create", projectName: input.projectName });
      if (refusal) return refusal;

      // Replay detection up front: a replayed submission must not notify
      // hooks or webhooks a second time.
      const replayed = await store.findByClientId(input.clientId);
      if (replayed) return respondCreated(scope, replayed, input.projectName);

      const { feedback, isNew } = await insert(input);
      if (isNew && feedback.projectName === input.projectName) {
        if (webhooks.length > 0) void dispatchWebhooks(webhooks, feedback);
        if (onCreated) await pipeline.runHook("onCreated", () => onCreated(feedback, scope.context));
      }
      return respondCreated(scope, feedback, input.projectName);
    } catch (error) {
      return pipeline.internalError(scope, "create feedback", error);
    }
  };
}
