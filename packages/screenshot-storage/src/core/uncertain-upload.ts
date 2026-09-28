import type { ScreenshotObjectStore } from "./object-store.js";

/** Reports degraded-but-handled situations (failed reclaim of an uncertain upload, refused delete). */
export interface ScreenshotStorageLogger {
  warn(message: string, context: Record<string, unknown>): void;
}

/** Runs `task` once, `delayMs` from now, without the caller awaiting it. */
export type ReclaimScheduler = (task: () => void, delayMs: number) => void;

/** Called with the key of every upload whose outcome is unknown. */
export type UncertainUploadHook = (key: string) => void | Promise<void>;

interface UncertainUploadReclaimerOptions {
  objectStore: Pick<ScreenshotObjectStore, "name" | "remove">;
  logger: ScreenshotStorageLogger;
  delaysMs: readonly number[];
  schedule: ReclaimScheduler;
  onUncertainUpload: UncertainUploadHook | undefined;
}

/**
 * Default {@link ReclaimScheduler}: a `setTimeout` that does not keep a
 * Node.js process alive just for a pending reclaim.
 */
export const scheduleWithTimer: ReclaimScheduler = (task, delayMs) => {
  const timer: unknown = setTimeout(task, delayMs);
  if (typeof timer === "object" && timer !== null && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }
};

/**
 * Refuse reclaim delays that are not finite, non-negative numbers of milliseconds.
 *
 * @param delaysMs - The `uncertainUploadReclaimDelaysMs` option.
 * @throws Error naming the invalid delay.
 */
export function assertReclaimDelays(delaysMs: readonly number[]): void {
  const invalidDelay = delaysMs.find((delayMs) => !Number.isFinite(delayMs) || delayMs < 0);
  if (invalidDelay !== undefined) {
    throw new Error(
      `[siteping] createScreenshotStorage: uncertainUploadReclaimDelaysMs entry ${invalidDelay} must be a finite, non-negative number of milliseconds`,
    );
  }
}

/**
 * Build the reclaim routine for uploads whose outcome is unknown (timeout,
 * 5xx, network error): the backend may still commit the object after the
 * client gave up, leaving an object no feedback references.
 *
 * `reclaim(key)` removes the key right away, schedules one more `remove` per
 * configured delay (so an upload committed after the first removal is still
 * deleted, as long as the process lives), and hands the key to the host's
 * `onUncertainUpload` hook for durable handling. It never throws: a failed
 * removal, a scheduler that throws and a failing hook are each logged without
 * skipping the remaining steps, and the caller rethrows the original upload error.
 *
 * Only a backend-side lifecycle rule (e.g. S3/R2 expiration under the key
 * prefix) or a durable job fed by the hook fully guarantees no orphan
 * survives a process that exits before the last delayed attempt.
 *
 * @returns `reclaim(key)`, resolved once the immediate removal and the hook settled.
 */
export function createUncertainUploadReclaimer({
  objectStore,
  logger,
  delaysMs,
  schedule,
  onUncertainUpload,
}: UncertainUploadReclaimerOptions): (key: string) => Promise<void> {
  const removeLogged = (key: string, attempt: string): Promise<void> =>
    objectStore.remove(key).catch((reclaimError: unknown) => {
      logger.warn(`[siteping] ${objectStore.name}: could not reclaim an uncertain upload`, {
        key,
        attempt,
        error: reclaimError,
      });
    });

  return async (key) => {
    await removeLogged(key, "immediate");
    for (const delayMs of delaysMs) {
      // A failing injected scheduler loses this attempt only: the other
      // attempts, the hook and the caller's original upload error still follow.
      try {
        schedule(() => void removeLogged(key, `after ${delayMs} ms`), delayMs);
      } catch (scheduleError) {
        logger.warn(`[siteping] ${objectStore.name}: could not schedule a delayed reclaim of an uncertain upload`, {
          key,
          delayMs,
          error: scheduleError,
        });
      }
    }
    if (!onUncertainUpload) return;
    try {
      await onUncertainUpload(key);
    } catch (hookError) {
      logger.warn(`[siteping] ${objectStore.name}: onUncertainUpload failed`, { key, error: hookError });
    }
  };
}
