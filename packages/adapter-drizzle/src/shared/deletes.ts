import type { Column } from "drizzle-orm";
import type { DeletedFeedbacks, DeleteFeedbacksOptions } from "./gateway.js";

/**
 * `RETURNING` columns of a feedback delete: the id alone (enough to tell a hit
 * from a miss), plus `screenshotUrl` only when the caller will clean up
 * screenshots. Without a cleanup hook, screenshots are often inline base64
 * data URLs — reading them back would materialize megabytes per row for
 * nothing, and can exceed an HTTP driver's response-size limit.
 *
 * @param columns - Feedback table columns (`id`, `screenshotUrl`) of the dialect.
 * @param options - Whether the screenshot URLs are needed.
 */
export function deletedFeedbackColumns<IdColumn extends Column, ScreenshotUrlColumn extends Column>(
  columns: { id: IdColumn; screenshotUrl: ScreenshotUrlColumn },
  { collectScreenshotUrls }: DeleteFeedbacksOptions,
): Record<string, IdColumn | ScreenshotUrlColumn> {
  return collectScreenshotUrls ? { id: columns.id, screenshotUrl: columns.screenshotUrl } : { id: columns.id };
}

/**
 * The screenshot URLs read back by a delete built with {@link deletedFeedbackColumns}.
 *
 * @param rows - Rows returned by that delete.
 */
export function toDeletedFeedbacks(rows: ReadonlyArray<Record<string, unknown>>): DeletedFeedbacks {
  return {
    screenshotUrls: rows.flatMap((row) =>
      "screenshotUrl" in row ? [typeof row.screenshotUrl === "string" ? row.screenshotUrl : null] : [],
    ),
  };
}
