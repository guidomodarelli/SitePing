/**
 * Type-level locks for the handler options (vitest typecheck mode — never
 * executed): every @beezping/server option, the `apiKey` policy XOR `access`.
 */

import type { BeezpingStore } from "@beezping/core";
import { describe, expectTypeOf, it } from "vitest";
import {
  type BeezpingAccessControl,
  type BeezpingAuthorizationContext,
  type BeezpingDeletionTarget,
  type BeezpingHandlerBaseOptions,
  type BeezpingLifecycleHooks,
  type BeezpingLogger,
  type BeezpingPrismaClient,
  type BeezpingRequestContext,
  type CommentPayload,
  createBeezpingHandler,
  type FeedbackCreateInput,
  type FeedbackRecord,
  type HandlerOptions,
  type PrismaAccessHandlerOptions,
} from "../src/index.js";

declare const prisma: BeezpingPrismaClient;
declare const store: BeezpingStore;
declare function sessionUser(request: Request): Promise<{ id: string } | null>;

describe("createBeezpingHandler options", () => {
  it("keeps the historical options", () => {
    expectTypeOf({
      prisma,
      apiKey: "k",
      publicEndpoints: ["POST", "OPTIONS"],
      allowedOrigins: ["https://example.com"],
      requireAuthForDestructive: true,
      redactUnauthenticatedEmails: true,
      caseInsensitiveSearch: true,
      screenshotStorage: { upload: async () => ({ url: "https://cdn.example.com/s.jpg" }) },
      webhooks: { url: "https://hooks.example.com" },
    } as const).toExtend<HandlerOptions>();
    expectTypeOf({ store }).toExtend<HandlerOptions>();
  });

  it("takes a custom access policy, never alongside apiKey", () => {
    createBeezpingHandler({
      prisma,
      access: {
        authenticate: sessionUser,
        authorize: ({ principal }) => {
          expectTypeOf(principal).toEqualTypeOf<{ id: string }>();
          return true;
        },
      },
    });

    // @ts-expect-error — apiKey and access are mutually exclusive
    createBeezpingHandler({ prisma, apiKey: "k", access: { authenticate: sessionUser } });

    // @ts-expect-error — a boolean check is no principal: its false would read as a signed-in caller
    createBeezpingHandler({ prisma, access: { authenticate: (request) => request.headers.has("x-token") } });
  });

  it("takes options assembled at runtime, either policy, like @beezping/server does", () => {
    const options: HandlerOptions | PrismaAccessHandlerOptions<{ id: string }> = process.env.SSO
      ? { prisma, access: { authenticate: sessionUser } }
      : { prisma, apiKey: "k" };

    createBeezpingHandler(options);
  });
});

describe("server option types", () => {
  interface Reviewer {
    id: string;
  }

  it("are re-exported, so standalone policies and hooks need no direct @beezping/server dependency", () => {
    const access: BeezpingAccessControl<Reviewer> = {
      authenticate: sessionUser,
      authorize: ({ action }: BeezpingAuthorizationContext<Reviewer>) => action !== "deleteAll",
    };
    const hooks: BeezpingLifecycleHooks<Reviewer> = {
      onDeleted: (target: BeezpingDeletionTarget, { principal }: BeezpingRequestContext<Reviewer>) => {
        expectTypeOf(target.projectName).toEqualTypeOf<string>();
        expectTypeOf(principal).toEqualTypeOf<Reviewer>();
      },
    };
    const logger: BeezpingLogger = { error: () => {} };
    const beforeCreate = (input: FeedbackCreateInput): FeedbackCreateInput => input;
    const beforeComment: BeezpingHandlerBaseOptions<Reviewer>["beforeComment"] = (input: CommentPayload) => input;
    const presentFeedback = (feedback: FeedbackRecord): FeedbackRecord => feedback;

    createBeezpingHandler({ prisma, access, hooks, logger, beforeCreate, beforeComment, presentFeedback });
  });
});
