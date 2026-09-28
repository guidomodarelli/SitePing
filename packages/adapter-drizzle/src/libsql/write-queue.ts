/**
 * Pending-write tail per Drizzle libSQL database. Every store built on the
 * same `db` object — e.g. several `createLibSQLSitepingStore(db)` calls in one
 * process — shares one queue.
 */
const pendingWriteTails = new WeakMap<object, Promise<unknown>>();

/**
 * Run `write` after every write previously queued on `db` has settled.
 *
 * Why: the local libSQL driver executes statements synchronously on pooled
 * connections, while an interactive transaction keeps its connection's write
 * lock across `await`s. A second in-process write that reaches SQLite while
 * that lock is held either fails immediately with `SQLITE_BUSY` or, with a
 * busy `timeout`, blocks the event loop so the lock holder can never commit.
 * Serializing this process's writes removes that self-deadlock; atomicity of
 * `clientId` deduplication still comes from the unique index, so writes from
 * other processes (or a remote Turso database) remain safe.
 *
 * @param db - The Drizzle database the write targets (queue key).
 * @param write - The write to run once the queue is free.
 * @returns The write's own result or rejection; a failed write never blocks the next one.
 */
export function enqueueWrite<Result>(db: object, write: () => Promise<Result>): Promise<Result> {
  const previousTail = pendingWriteTails.get(db) ?? Promise.resolve();
  const result = previousTail.then(write);
  pendingWriteTails.set(
    db,
    result.catch(() => undefined),
  );
  return result;
}
