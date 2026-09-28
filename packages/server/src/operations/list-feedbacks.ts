import type { SitepingStore } from "@siteping/core";
import { LIST_QUERY_KEYS } from "../constants/http.js";
import type { RequestPipeline } from "../request-pipeline.js";
import { getQuerySchema } from "../validation.js";

export interface ListFeedbacksDependencies<Principal> {
  store: SitepingStore;
  pipeline: RequestPipeline<Principal>;
}

/** Only the query parameters the endpoint understands, as raw strings. */
function readListQuery(request: Request): Record<string, string> {
  const searchParams = new URL(request.url).searchParams;
  const rawQuery: Record<string, string> = {};
  for (const key of LIST_QUERY_KEYS) {
    const value = searchParams.get(key);
    if (value !== null) rawQuery[key] = value;
  }
  return rawQuery;
}

/** `GET` — paginated, filtered list of a project's feedbacks. */
export function listFeedbacksOperation<Principal>({ store, pipeline }: ListFeedbacksDependencies<Principal>) {
  return async (request: Request): Promise<Response> => {
    const authentication = await pipeline.authenticate(request, "GET");
    if (!authentication.ok) return authentication.response;
    const scope = authentication.value;

    const query = pipeline.validate(scope, getQuerySchema, readListQuery(request));
    if (!query.ok) return query.response;

    try {
      const refusal = await pipeline.authorize(scope, { action: "list", projectName: query.value.projectName });
      if (refusal) return refusal;
      const page = await store.getFeedbacks(query.value);
      return pipeline.json(
        scope,
        { ...page, feedbacks: page.feedbacks.map((feedback) => pipeline.present(scope, feedback)) },
        { headers: { "Cache-Control": pipeline.listCacheControl } },
      );
    } catch (error) {
      return pipeline.internalError(scope, "list feedbacks", error);
    }
  };
}
