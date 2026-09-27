import type { AnnotationRecord, FeedbackRecord } from "@siteping/core";
import { expectTypeOf, test } from "vitest";
import type { SitepingSqliteTables } from "../src/libsql/index.js";
import type { SitepingPgTables } from "../src/pg/index.js";

// Rows read back from either dialect must be exactly the core records, so a
// field added to the store contract cannot ship without its column.
type FeedbackRow = Omit<FeedbackRecord, "annotations">;

test("PostgreSQL tables match the core records", () => {
  expectTypeOf<SitepingPgTables["sitepingFeedbacks"]["$inferSelect"]>().toEqualTypeOf<FeedbackRow>();
  expectTypeOf<SitepingPgTables["sitepingAnnotations"]["$inferSelect"]>().toEqualTypeOf<AnnotationRecord>();
});

test("SQLite / libSQL tables match the core records", () => {
  expectTypeOf<SitepingSqliteTables["sitepingFeedbacks"]["$inferSelect"]>().toEqualTypeOf<FeedbackRow>();
  expectTypeOf<SitepingSqliteTables["sitepingAnnotations"]["$inferSelect"]>().toEqualTypeOf<AnnotationRecord>();
});
