/**
 * Type-level locks for the handler options (vitest typecheck mode — never
 * executed): the `apiKey` policy XOR a custom `access` policy, and the
 * principal inferred from `access.authenticate`.
 */

import type { BeezpingStore, CommentPayload } from "@beezping/core";
import { describe, expectTypeOf, it } from "vitest";
import {
  type BeezpingAccessControl,
  type BeezpingAction,
  type BeezpingHandler,
  type BeezpingHandlerOptions,
  createBeezpingHandler,
} from "../src/index.js";

declare const store: BeezpingStore;

interface Reviewer {
  id: string;
  isAdmin: boolean;
}
declare function sessionUser(request: Request): Promise<Reviewer | null>;

describe("createBeezpingHandler options XOR union", () => {
  it("accepts each policy on its own", () => {
    expectTypeOf(createBeezpingHandler({ store })).toEqualTypeOf<BeezpingHandler>();
    expectTypeOf(
      createBeezpingHandler({ store, apiKey: "k", publicEndpoints: ["POST"] }),
    ).toEqualTypeOf<BeezpingHandler>();
    expectTypeOf(
      createBeezpingHandler({ store, access: { authenticate: sessionUser } }),
    ).toEqualTypeOf<BeezpingHandler>();
  });

  it("accepts options assembled at runtime", () => {
    const options: BeezpingHandlerOptions<Reviewer> =
      Math.random() > 0.5 ? { store, apiKey: "k" } : { store, access: { authenticate: sessionUser } };
    expectTypeOf(createBeezpingHandler(options)).toEqualTypeOf<BeezpingHandler>();
  });

  it("rejects mixed policies and a missing store", () => {
    // @ts-expect-error — apiKey and access are mutually exclusive
    createBeezpingHandler({ store, apiKey: "k", access: { authenticate: sessionUser } });

    // @ts-expect-error — publicEndpoints belongs to the apiKey policy
    createBeezpingHandler({ store, access: { authenticate: sessionUser }, publicEndpoints: ["GET"] });

    // @ts-expect-error — redaction is access.canReadAuthorEmail's job under access
    createBeezpingHandler({ store, access: { authenticate: sessionUser }, redactUnauthenticatedEmails: false });

    // @ts-expect-error — a store is required
    createBeezpingHandler({ apiKey: "k" });
  });
});

describe("the principal", () => {
  it("is null in hooks and transforms under the apiKey policy", () => {
    createBeezpingHandler({
      store,
      apiKey: "k",
      beforeCreate: (input, { principal }) => {
        expectTypeOf(principal).toEqualTypeOf<null>();
        return input;
      },
      hooks: {
        onDeleted: (target, { principal }) => {
          expectTypeOf(principal).toEqualTypeOf<null>();
          expectTypeOf(target.projectName).toEqualTypeOf<string>();
        },
      },
    });
  });

  it("is never a boolean, whose false would read as a signed-in caller", () => {
    // @ts-expect-error — authenticate must resolve who is calling, not whether
    createBeezpingHandler({ store, access: { authenticate: (request) => request.headers.has("x-token") } });

    const tokenCheck = (request: Request) => request.headers.get("x-token") === "secret";
    // @ts-expect-error — nor through a policy typed on its own
    const standalone: BeezpingAccessControl<boolean> = { authenticate: tokenCheck };
    void standalone;
  });

  it("is inferred from access.authenticate, without null", () => {
    createBeezpingHandler({
      store,
      access: {
        authenticate: sessionUser,
        authorize: ({ principal, action, feedbackId, commentId, dryRun }) => {
          expectTypeOf(principal).toEqualTypeOf<Reviewer>();
          expectTypeOf(feedbackId).toEqualTypeOf<string | undefined>();
          expectTypeOf(commentId).toEqualTypeOf<string | undefined>();
          expectTypeOf(dryRun).toEqualTypeOf<boolean | undefined>();
          return action === "create" || principal.isAdmin;
        },
        canReadAuthorEmail: (principal) => {
          expectTypeOf(principal).toEqualTypeOf<Reviewer>();
          return principal.isAdmin;
        },
        canCommentAsTeam: (principal) => {
          expectTypeOf(principal).toEqualTypeOf<Reviewer>();
          return principal.isAdmin;
        },
      },
      presentFeedback: (feedback, { principal }) => {
        expectTypeOf(principal).toEqualTypeOf<Reviewer>();
        return feedback;
      },
      beforeComment: (input, { principal }) => {
        expectTypeOf(principal).toEqualTypeOf<Reviewer>();
        expectTypeOf(input).toEqualTypeOf<CommentPayload>();
        return input;
      },
      hooks: {
        onCreated: (_feedback, { principal }) => {
          expectTypeOf(principal).toEqualTypeOf<Reviewer>();
        },
      },
    });
  });
});

describe("the actions authorize decides about", () => {
  it("include the comment writes", () => {
    expectTypeOf<BeezpingAction>().toEqualTypeOf<
      "create" | "list" | "update" | "delete" | "deleteAll" | "createComment" | "deleteComment"
    >();
  });
});
