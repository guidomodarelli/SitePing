import { isStoreNotFound, type SitepingStore } from "@siteping/core";
import { SITEPING_ERROR_MESSAGES } from "../constants/error-messages.js";
import type { SitepingDeletionTarget, SitepingHandlerBaseOptions } from "../options.js";
import type { RequestPipeline } from "../request-pipeline.js";
import { type FeedbackDeleteInput, feedbackDeleteSchema } from "../validation.js";

type LifecycleHooks<Principal> = NonNullable<SitepingHandlerBaseOptions<Principal>["hooks"]>;

export interface DeleteFeedbackDependencies<Principal> {
  store: SitepingStore;
  pipeline: RequestPipeline<Principal>;
  onDeleting: LifecycleHooks<Principal>["onDeleting"];
  onDeleted: LifecycleHooks<Principal>["onDeleted"];
}

function toDeletionTarget(deletion: FeedbackDeleteInput): SitepingDeletionTarget {
  return "deleteAll" in deletion
    ? { kind: "project", projectName: deletion.projectName }
    : { kind: "single", id: deletion.id, projectName: deletion.projectName };
}

/** `DELETE` — remove one feedback, or every feedback of a project (`deleteAll`). */
export function deleteFeedbackOperation<Principal>({
  store,
  pipeline,
  onDeleting,
  onDeleted,
}: DeleteFeedbackDependencies<Principal>) {
  const removeTarget = (target: SitepingDeletionTarget): Promise<void> =>
    target.kind === "project" ? store.deleteAllFeedbacks(target.projectName) : store.deleteFeedback(target.id);

  return async (request: Request): Promise<Response> => {
    const authentication = await pipeline.authenticate(request, "DELETE");
    if (!authentication.ok) return authentication.response;
    const scope = authentication.value;

    const payload = await pipeline.readBody(scope, feedbackDeleteSchema);
    if (!payload.ok) return payload.response;
    const target = toDeletionTarget(payload.value as FeedbackDeleteInput);

    try {
      const refusal = await pipeline.authorize(
        scope,
        target.kind === "project"
          ? { action: "deleteAll", projectName: target.projectName }
          : { action: "delete", projectName: target.projectName, feedbackId: target.id },
      );
      if (refusal) return refusal;

      if (
        target.kind === "single" &&
        store.verifyProjectOwnership &&
        !(await store.verifyProjectOwnership(target.id, target.projectName))
      ) {
        return pipeline.error(scope, 404, SITEPING_ERROR_MESSAGES.feedbackNotFound);
      }

      if (onDeleting) {
        try {
          await onDeleting(target, scope.context);
        } catch (error) {
          pipeline.logger.error("[siteping] createSitepingHandler: hook onDeleting aborted the deletion", {
            error,
            target,
          });
          return pipeline.error(scope, 502, SITEPING_ERROR_MESSAGES.deletionAborted);
        }
      }

      await removeTarget(target);
      if (onDeleted) await pipeline.runHook("onDeleted", () => onDeleted(target, scope.context));
      return pipeline.json(scope, { deleted: true });
    } catch (error) {
      if (isStoreNotFound(error)) return pipeline.error(scope, 404, SITEPING_ERROR_MESSAGES.feedbackNotFound);
      return pipeline.internalError(scope, "delete feedback", error);
    }
  };
}
