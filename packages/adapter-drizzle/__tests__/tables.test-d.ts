import type { AnnotationRecord, FeedbackRecord } from "@siteping/core";
import { expectTypeOf, test } from "vitest";
import type { SitepingSqliteTables } from "../src/libsql/index.js";
import type { SitepingPgTables } from "../src/pg/index.js";

// Rows read back from either dialect must be exactly the core records, so a
// field added to the store contract cannot ship without its column. The
// annotation tables add only the internal `position` ordinal (submission order).
type FeedbackRow = Omit<FeedbackRecord, "annotations">;

test("PostgreSQL tables match the core records", () => {
  type AnnotationSelect = SitepingPgTables["sitepingAnnotations"]["$inferSelect"];
  expectTypeOf<SitepingPgTables["sitepingFeedbacks"]["$inferSelect"]>().toEqualTypeOf<FeedbackRow>();
  expectTypeOf<Omit<AnnotationSelect, "position">>().toEqualTypeOf<AnnotationRecord>();
  expectTypeOf<AnnotationSelect["position"]>().toEqualTypeOf<number>();
});

test("SQLite / libSQL tables match the core records", () => {
  type AnnotationSelect = SitepingSqliteTables["sitepingAnnotations"]["$inferSelect"];
  expectTypeOf<SitepingSqliteTables["sitepingFeedbacks"]["$inferSelect"]>().toEqualTypeOf<FeedbackRow>();
  expectTypeOf<Omit<AnnotationSelect, "position">>().toEqualTypeOf<AnnotationRecord>();
  expectTypeOf<AnnotationSelect["position"]>().toEqualTypeOf<number>();
});
