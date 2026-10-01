import type { AnnotationRecord, CommentRecord, FeedbackRecord } from "@beezping/core";
import { expectTypeOf, test } from "vitest";
import type { BeezpingSqliteTables, LibSQLBeezpingStoreOptions } from "../src/libsql/index.js";
import type { BeezpingPgTables, PgBeezpingStoreOptions } from "../src/pg/index.js";

// Rows read back from either dialect must be exactly the core records, so a
// field added to the store contract cannot ship without its column. The tables
// add only internal columns: `creationSequence` on PostgreSQL feedbacks
// (tie-break of "newest first" — SQLite uses its implicit `rowid`), `position`
// on annotations (submission order) and comments (posting order), and
// `messageSearch` on feedbacks (Unicode-lowercased message searched).
type FeedbackRow = Omit<FeedbackRecord, "annotations" | "comments">;

test("PostgreSQL tables match the core records", () => {
  type FeedbackSelect = BeezpingPgTables["beezpingFeedbacks"]["$inferSelect"];
  type AnnotationSelect = BeezpingPgTables["beezpingAnnotations"]["$inferSelect"];
  type CommentSelect = BeezpingPgTables["beezpingComments"]["$inferSelect"];
  expectTypeOf<Omit<FeedbackSelect, "creationSequence" | "messageSearch">>().toEqualTypeOf<FeedbackRow>();
  expectTypeOf<FeedbackSelect["creationSequence"]>().toEqualTypeOf<number>();
  expectTypeOf<FeedbackSelect["messageSearch"]>().toEqualTypeOf<string | null>();
  expectTypeOf<Omit<AnnotationSelect, "position">>().toEqualTypeOf<AnnotationRecord>();
  expectTypeOf<AnnotationSelect["position"]>().toEqualTypeOf<number>();
  expectTypeOf<Omit<CommentSelect, "position">>().toEqualTypeOf<CommentRecord>();
  expectTypeOf<CommentSelect["position"]>().toEqualTypeOf<number>();
});

test("SQLite / libSQL tables match the core records", () => {
  type FeedbackSelect = BeezpingSqliteTables["beezpingFeedbacks"]["$inferSelect"];
  type AnnotationSelect = BeezpingSqliteTables["beezpingAnnotations"]["$inferSelect"];
  type CommentSelect = BeezpingSqliteTables["beezpingComments"]["$inferSelect"];
  expectTypeOf<Omit<FeedbackSelect, "messageSearch">>().toEqualTypeOf<FeedbackRow>();
  expectTypeOf<FeedbackSelect["messageSearch"]>().toEqualTypeOf<string | null>();
  expectTypeOf<Omit<AnnotationSelect, "position">>().toEqualTypeOf<AnnotationRecord>();
  expectTypeOf<AnnotationSelect["position"]>().toEqualTypeOf<number>();
  expectTypeOf<Omit<CommentSelect, "position">>().toEqualTypeOf<CommentRecord>();
  expectTypeOf<CommentSelect["position"]>().toEqualTypeOf<number>();
});

test("store options accept an explicit undefined, like every other optional option", () => {
  // Under exactOptionalPropertyTypes, spreading an optional `tables` from a
  // caller's own options object must type-check.
  expectTypeOf<{ tables: undefined }>().toExtend<PgBeezpingStoreOptions>();
  expectTypeOf<{ tables: undefined }>().toExtend<LibSQLBeezpingStoreOptions>();
});
