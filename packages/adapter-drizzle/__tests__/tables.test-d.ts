import type { AnnotationRecord, FeedbackRecord } from "@siteping/core";
import { expectTypeOf, test } from "vitest";
import type { SitepingSqliteTables } from "../src/libsql/index.js";
import type { SitepingPgTables } from "../src/pg/index.js";

// Rows read back from either dialect must be exactly the core records, so a
// field added to the store contract cannot ship without its column. The tables
// add only internal ordinals: `creationSequence` on feedbacks (tie-break of
// "newest first") and `position` on annotations (submission order).
type FeedbackRow = Omit<FeedbackRecord, "annotations">;

test("PostgreSQL tables match the core records", () => {
  type FeedbackSelect = SitepingPgTables["sitepingFeedbacks"]["$inferSelect"];
  type AnnotationSelect = SitepingPgTables["sitepingAnnotations"]["$inferSelect"];
  expectTypeOf<Omit<FeedbackSelect, "creationSequence">>().toEqualTypeOf<FeedbackRow>();
  expectTypeOf<FeedbackSelect["creationSequence"]>().toEqualTypeOf<number>();
  expectTypeOf<Omit<AnnotationSelect, "position">>().toEqualTypeOf<AnnotationRecord>();
  expectTypeOf<AnnotationSelect["position"]>().toEqualTypeOf<number>();
});

test("SQLite / libSQL tables match the core records", () => {
  type FeedbackSelect = SitepingSqliteTables["sitepingFeedbacks"]["$inferSelect"];
  type AnnotationSelect = SitepingSqliteTables["sitepingAnnotations"]["$inferSelect"];
  expectTypeOf<Omit<FeedbackSelect, "creationSequence">>().toEqualTypeOf<FeedbackRow>();
  expectTypeOf<FeedbackSelect["creationSequence"]>().toEqualTypeOf<number>();
  expectTypeOf<Omit<AnnotationSelect, "position">>().toEqualTypeOf<AnnotationRecord>();
  expectTypeOf<AnnotationSelect["position"]>().toEqualTypeOf<number>();
});
