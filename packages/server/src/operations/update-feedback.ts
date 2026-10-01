import { isStoreNotFound, type SitepingStore, toFeedbackUpdate } from "@beezping/core";
import { SITEPING_ERROR_MESSAGES } from "../constants/error-messages.js";
import type { SitepingHandlerBaseOptions } from "../options.js";
import type { RequestPipeline } from "../request-pipeline.js";
import { feedbackPatchSchema } from "../validation.js";

export interface UpdateFeedbackDependencies<Principal> {
  store: SitepingStore;
  pipeline: RequestPipeline<Principal>;
  onUpdated: NonNullable<SitepingHandlerBaseOptions<Principal>["hooks"]>["onUpdated"];
}

/** `PATCH` — change a feedback's status. */
export function updateFeedbackOperation<Principal>({
  store,
  pipeline,
  onUpdated,
}: UpdateFeedbackDependencies<Principal>) {
  return async (request: Request): Promise<Response> => {
    const authentication = await pipeline.authenticate(request, "PATCH");
    if (!authentication.ok) return authentication.response;
    const scope = authentication.value;

    const payload = await pipeline.readBody(scope, feedbackPatchSchema);
    if (!payload.ok) return payload.response;
    const { id, projectName, status } = payload.value;

    try {
      const refusal = await pipeline.authorize(scope, { action: "update", projectName, feedbackId: id });
      if (refusal) return refusal;
      // Cross-project guard. `createSitepingHandler` refuses to start with a
      // custom `authorize` over a store lacking the check, so it is only ever
      // skipped when no policy scopes callers to projects.
      if (store.verifyProjectOwnership && !(await store.verifyProjectOwnership(id, projectName))) {
        return pipeline.error(scope, 404, SITEPING_ERROR_MESSAGES.feedbackNotFound);
      }
      // resolvedAt (closure timestamp) is derived here at the edge.
      const feedback = await store.updateFeedback(id, toFeedbackUpdate(status));
      if (onUpdated) await pipeline.runHook("onUpdated", () => onUpdated(feedback, scope.context));
      return pipeline.json(scope, pipeline.present(scope, feedback));
    } catch (error) {
      if (isStoreNotFound(error)) return pipeline.error(scope, 404, SITEPING_ERROR_MESSAGES.feedbackNotFound);
      return pipeline.internalError(scope, "update feedback", error);
    }
  };
}
