/** Provides the canonical database model definitions used by adapters and the CLI.
 * @module core/constants/schema
 */
import type { BeezpingModelName, ModelDef } from "../schema.js";

const _BEEZPING_MODELS = {
  BeezpingFeedback: {
    fields: {
      id: { type: "String", isId: true, default: "cuid()" },
      projectName: { type: "String" },
      type: { type: "String" },
      message: { type: "String", nativeType: "Text" },
      status: { type: "String", default: '"open"' },
      url: { type: "String" },
      urlPattern: { type: "String", optional: true },
      screenshotUrl: { type: "String", optional: true, nativeType: "Text" },
      screenshotRegion: { type: "Json", optional: true },
      diagnostics: { type: "Json", optional: true },
      viewport: { type: "String" },
      userAgent: { type: "String" },
      authorName: { type: "String" },
      authorEmail: { type: "String" },
      clientId: { type: "String", isUnique: true },
      resolvedAt: { type: "DateTime", optional: true },
      createdAt: { type: "DateTime", default: "now()" },
      updatedAt: { type: "DateTime", isUpdatedAt: true },
      annotations: {
        type: "BeezpingAnnotation",
        relation: { kind: "1-to-many", model: "BeezpingAnnotation" },
      },
      comments: {
        type: "BeezpingComment",
        relation: { kind: "1-to-many", model: "BeezpingComment" },
      },
    },
    indexes: [
      { fields: ["projectName"] },
      { fields: ["projectName", "status", "createdAt"] },
      { fields: ["projectName", "url"] },
    ],
  },
  BeezpingAnnotation: {
    fields: {
      id: { type: "String", isId: true, default: "cuid()" },
      feedbackId: { type: "String" },
      feedback: {
        type: "BeezpingFeedback",
        relation: {
          kind: "many-to-1",
          model: "BeezpingFeedback",
          fields: ["feedbackId"],
          references: ["id"],
          onDelete: "Cascade",
        },
      },
      cssSelector: { type: "String", nativeType: "Text" },
      xpath: { type: "String", nativeType: "Text" },
      textSnippet: { type: "String", nativeType: "Text" },
      elementTag: { type: "String" },
      elementId: { type: "String", optional: true },
      textPrefix: { type: "String", nativeType: "Text" },
      textSuffix: { type: "String", nativeType: "Text" },
      fingerprint: { type: "String" },
      neighborText: { type: "String", nativeType: "Text" },
      anchorKey: { type: "String", optional: true },
      xPct: { type: "Float" },
      yPct: { type: "Float" },
      wPct: { type: "Float" },
      hPct: { type: "Float" },
      scrollX: { type: "Float" },
      scrollY: { type: "Float" },
      viewportW: { type: "Int" },
      viewportH: { type: "Int" },
      devicePixelRatio: { type: "Float", default: "1" },
      createdAt: { type: "DateTime", default: "now()" },
    },
    indexes: [{ fields: ["feedbackId"] }],
  },
  BeezpingComment: {
    fields: {
      id: { type: "String", isId: true, default: "cuid()" },
      feedbackId: { type: "String" },
      feedback: {
        type: "BeezpingFeedback",
        relation: {
          kind: "many-to-1",
          model: "BeezpingFeedback",
          fields: ["feedbackId"],
          references: ["id"],
          onDelete: "Cascade",
        },
      },
      body: { type: "String", nativeType: "Text" },
      authorName: { type: "String" },
      authorEmail: { type: "String" },
      authorRole: { type: "String", default: '"client"' },
      clientId: { type: "String", isUnique: true },
      createdAt: { type: "DateTime", default: "now()" },
    },
    // A thread is read oldest first, one feedback at a time.
    indexes: [{ fields: ["feedbackId", "createdAt"] }],
  },
} as const satisfies Record<BeezpingModelName, ModelDef>;

/** Map of Beezping models keyed by model name — frozen at runtime. */
export const BEEZPING_MODELS: typeof _BEEZPING_MODELS = Object.freeze(_BEEZPING_MODELS);
