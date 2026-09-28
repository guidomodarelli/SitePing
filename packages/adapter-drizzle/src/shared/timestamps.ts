import { type Column, type SQL, sql } from "drizzle-orm";
import type { GreatestValueFunction } from "../constants/sql.js";

/**
 * SQL for the `updatedAt` to store on an update: the wall-clock `updatedAt`,
 * raised to the row's own `createdAt` / `updatedAt` when those are later.
 *
 * Why: `createdAt` is issued strictly increasing, so a burst of creates in one
 * millisecond stamps rows slightly in the future — an immediate update must
 * not record `updatedAt < createdAt`. Clamping in SQL holds across store
 * instances and processes, unlike an in-memory clock.
 *
 * @param table - Feedback table columns the clamp reads.
 * @param updatedAt - Wall-clock time of the update.
 * @param greatestFunction - The dialect's "largest argument" function.
 */
export function monotonicUpdatedAt(
  table: { createdAt: Column; updatedAt: Column },
  updatedAt: Date,
  greatestFunction: GreatestValueFunction,
): SQL<Date> {
  return sql<Date>`${sql.raw(greatestFunction)}(${sql.param(updatedAt, table.updatedAt)}, ${table.createdAt}, ${table.updatedAt})`;
}
