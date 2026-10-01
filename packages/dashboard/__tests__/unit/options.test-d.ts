/**
 * Type-level locks for the dashboard's public API surface (vitest typecheck
 * mode — never executed).
 */

import type { BeezpingStore, CommentCreateInput, CommentRecord, FeedbackPage, FeedbackRecord } from "@beezping/core";
import { describe, expectTypeOf, it } from "vitest";
import type { BeezpingCapabilities, FeedbackPermissions, InboxRecord } from "../../src/index.js";
import type { BeezpingInboxProps, InboxSource, InboxState, UseBeezpingInboxOptions } from "../../src/types.js";
import { useBeezpingInbox } from "../../src/use-inbox.js";

declare const store: BeezpingStore;
declare const source: InboxSource;

describe("UseBeezpingInboxOptions XOR union", () => {
  it("accepts each source mode on its own", () => {
    expectTypeOf({ projects: "p", source }).toExtend<UseBeezpingInboxOptions>();
    expectTypeOf({ projects: "p", store }).toExtend<UseBeezpingInboxOptions>();
    expectTypeOf({ projects: "p", endpoint: "/api", apiKey: "k" }).toExtend<UseBeezpingInboxOptions>();
  });

  it("rejects no source and mixed sources", () => {
    // @ts-expect-error — one of source/store/endpoint is required
    useBeezpingInbox({ projects: "p" });

    // @ts-expect-error — store and endpoint are mutually exclusive
    useBeezpingInbox({ projects: "p", store, endpoint: "/api" });

    // @ts-expect-error — apiKey is endpoint-mode only
    useBeezpingInbox({ projects: "p", store, apiKey: "leaked" });
  });

  it("takes an `author` in every mode — a shared option, outside the union", () => {
    const author = { name: "Studio", email: "team@studio.example" };
    expectTypeOf({ projects: "p", source, author }).toExtend<UseBeezpingInboxOptions>();
    expectTypeOf({ projects: "p", store, author: { name: "Studio" } }).toExtend<UseBeezpingInboxOptions>();
    expectTypeOf({ projects: "p", endpoint: "/api", author }).toExtend<UseBeezpingInboxOptions>();

    // @ts-expect-error — a reply needs a name to be attributed to
    useBeezpingInbox({ projects: "p", store, author: { email: "team@studio.example" } });
  });

  it("takes readOnly in every mode — a shared option, outside the union", () => {
    expectTypeOf({ projects: "p", source, readOnly: true }).toExtend<UseBeezpingInboxOptions>();
    expectTypeOf({ projects: "p", store, readOnly: true }).toExtend<UseBeezpingInboxOptions>();
    expectTypeOf({ projects: "p", endpoint: "/api", readOnly: false }).toExtend<UseBeezpingInboxOptions>();
    expectTypeOf<UseBeezpingInboxOptions["readOnly"]>().toEqualTypeOf<boolean | undefined>();
  });
});

describe("InboxSource", () => {
  it("keeps the thread methods optional, so a source written before threads still fits", () => {
    const legacy = {
      list: async (): Promise<FeedbackPage> => ({ feedbacks: [], total: 0 }),
      setStatus: async () => ({}) as never,
      remove: async () => {},
    };
    expectTypeOf(legacy).toExtend<InboxSource>();
    expectTypeOf<NonNullable<InboxSource["addComment"]>>().toEqualTypeOf<
      (feedbackId: string, projectName: string, input: CommentCreateInput) => Promise<CommentRecord>
    >();
  });

  it("names the capabilities list() may return through the package itself", () => {
    expectTypeOf<Awaited<ReturnType<InboxSource["list"]>>["capabilities"]>().toEqualTypeOf<
      BeezpingCapabilities | undefined
    >();
  });

  it("lets records carry the requester's permissions, and plain records still fit", () => {
    expectTypeOf<Awaited<ReturnType<InboxSource["list"]>>["feedbacks"]>().toEqualTypeOf<InboxRecord[]>();
    expectTypeOf<InboxRecord["permissions"]>().toEqualTypeOf<FeedbackPermissions | undefined>();
    expectTypeOf<FeedbackRecord>().toExtend<InboxRecord>();
    expectTypeOf<Awaited<ReturnType<InboxSource["setStatus"]>>>().toEqualTypeOf<InboxRecord>();
  });
});

describe("InboxState", () => {
  it("exposes the derived view discriminant", () => {
    expectTypeOf<InboxState["view"]>().toEqualTypeOf<"loading" | "error" | "empty" | "ready">();
  });

  it("exposes the thread actions", () => {
    expectTypeOf<InboxState["canComment"]>().toEqualTypeOf<boolean>();
    expectTypeOf<InboxState["canDeleteComment"]>().toEqualTypeOf<boolean>();
    expectTypeOf<InboxState["addComment"]>().toEqualTypeOf<
      (id: string, body: string, clientId?: string) => Promise<void>
    >();
    expectTypeOf<InboxState["deleteComment"]>().toEqualTypeOf<(id: string, commentId: string) => Promise<void>>();
  });

  it("says what the user may do with each record", () => {
    expectTypeOf<InboxState["permissionsOf"]>().toEqualTypeOf<(record: InboxRecord) => FeedbackPermissions>();
    expectTypeOf<InboxState["items"]>().toEqualTypeOf<InboxRecord[]>();
    expectTypeOf<InboxState["opened"]>().toEqualTypeOf<InboxRecord | null>();
  });
});

describe("BeezpingInboxProps", () => {
  it("combines source modes with presentation props", () => {
    expectTypeOf({ projects: "p", store, theme: "dark" as const }).toExtend<BeezpingInboxProps>();

    // @ts-expect-error — "sepia" is not an InboxTheme
    const badTheme: BeezpingInboxProps = { projects: "p", store, theme: "sepia" };
    void badTheme;
  });
});
