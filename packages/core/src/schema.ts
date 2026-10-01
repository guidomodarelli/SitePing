/**
 * Beezping database models — single source of truth.
 *
 * Used by:
 * - CLI to generate Prisma schema (via prisma-ast)
 * - Adapter for Zod validation
 * - Type exports
 *
 * This is a TS representation, NOT a .prisma file.
 * The CLI generates the actual Prisma schema from this definition.
 */

import type { BEEZPING_MODELS } from "./constants/schema.js";
import type { AssertEqual } from "./type-utils.js";
import type { AnnotationRecord, CommentRecord, FeedbackRecord } from "./types.js";

/** Prisma scalar types supported by Beezping field definitions. */
export type PrismaScalarType =
  | "String"
  | "Boolean"
  | "Int"
  | "BigInt"
  | "Float"
  | "Decimal"
  | "DateTime"
  | "Json"
  | "Bytes";

/** Prisma native column hints applied via `@db.<NativeType>`. */
export type PrismaNativeType = "Text" | "VarChar" | "Char" | "MediumText" | "LongText" | (string & {});

/** Relation cardinality between two Beezping models. */
export type RelationKind = "1-to-many" | "many-to-1";

/** Prisma `onDelete` referential action. */
export type RelationOnDelete = "Cascade" | "Restrict" | "NoAction" | "SetNull" | "SetDefault";

/**
 * Relation metadata attached to a {@link FieldDef}.
 *
 * - `1-to-many` fields point at the related model and require no inverse
 *   column on this side (`fields`/`references` are inferred by Prisma).
 * - `many-to-1` fields own the foreign key — Prisma needs `fields` and
 *   `references` to wire it up.
 */
export interface RelationDef {
  kind: RelationKind;
  model: string;
  fields?: readonly string[];
  references?: readonly string[];
  onDelete?: RelationOnDelete;
}

/**
 * Definition of a single field in a Beezping database model.
 *
 * The interface intentionally keeps a wide structural shape so it stays
 * easy to extend, but consumers can narrow via {@link isRelationField} /
 * {@link isScalarField} when relation vs. scalar logic diverges.
 */
export interface FieldDef {
  /** Prisma type (e.g. "String", "Int") for scalars, model name for relations. */
  type: PrismaScalarType | (string & {});
  /** Default literal (`"open"`) or function call (`now()`, `cuid()`). */
  default?: string;
  /** Whether the column is nullable. */
  optional?: boolean;
  /** Set on relation fields — absent on scalars. */
  relation?: RelationDef;
  isId?: boolean;
  isUnique?: boolean;
  /** Prisma native type attribute (e.g. "Text" for @db.Text) — used for MySQL compatibility on long strings */
  nativeType?: PrismaNativeType;
  /** Prisma @updatedAt attribute */
  isUpdatedAt?: boolean;
}

/** Narrowing predicate: returns `true` when `field` declares a Prisma relation. */
export function isRelationField(field: FieldDef): field is FieldDef & { relation: RelationDef } {
  return field.relation !== undefined;
}

/** Narrowing predicate: returns `true` when `field` is a Prisma scalar (no relation metadata). */
export function isScalarField(field: FieldDef): field is FieldDef & { relation?: undefined } {
  return field.relation === undefined;
}

/** Definition of a composite index on a Beezping database model. */
export interface IndexDef {
  fields: readonly string[];
}

/** Definition of a single Beezping database model (fields + indexes). */
export interface ModelDef {
  fields: Record<string, FieldDef>;
  indexes?: readonly IndexDef[];
}

export { BEEZPING_MODELS } from "./constants/schema.js";

/** Union of every Beezping model name as a string literal. */
export type BeezpingModelName = "BeezpingFeedback" | "BeezpingAnnotation" | "BeezpingComment";

/** Field names declared on a specific Beezping model. */
export type BeezpingModelFieldName<M extends BeezpingModelName> = keyof (typeof BEEZPING_MODELS)[M]["fields"];

// ---------------------------------------------------------------------------
// Compile-time locks — the Prisma model definitions and the store record
// interfaces describe the same columns. Adding a field to one side without
// the other is a compile error here (the CLI generates the actual Prisma
// schema from BEEZPING_MODELS, so a missed column would otherwise only
// surface as a runtime Prisma error).
// ---------------------------------------------------------------------------

const _feedbackModelMatchesRecord: AssertEqual<BeezpingModelFieldName<"BeezpingFeedback">, keyof FeedbackRecord> = true;
void _feedbackModelMatchesRecord;

// `feedback` is the relation back-reference — the only field with no record
// counterpart.
const _annotationModelMatchesRecord: AssertEqual<
  Exclude<BeezpingModelFieldName<"BeezpingAnnotation">, "feedback">,
  keyof AnnotationRecord
> = true;
void _annotationModelMatchesRecord;

const _commentModelMatchesRecord: AssertEqual<
  Exclude<BeezpingModelFieldName<"BeezpingComment">, "feedback">,
  keyof CommentRecord
> = true;
void _commentModelMatchesRecord;
