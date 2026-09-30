import { MemoryStore } from "@siteping/adapter-memory";
import type { FeedbackRecord } from "@siteping/core";
import { createSitepingHandler, type SitepingHandler } from "@siteping/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGitHubTracker } from "../src/github/index.js";
import { createGitLabTracker } from "../src/gitlab/index.js";
import { createIssueTrackerHooks, type IssueTracker, type IssueTrackerHooksOptions } from "../src/index.js";
import { createFakeGitHub, createFakeGitLab, type FakeTracker } from "./fake-trackers.js";

const ENDPOINT = "http://localhost/api/siteping";
const TOKEN = "tracker-secret-token";
const JSON_HEADERS = { "Content-Type": "application/json" };

const payload = {
  projectName: "site",
  type: "bug" as const,
  message: "Checkout fails with token=abc123",
  url: "https://example.com/checkout?step=2",
  viewport: "1280x720",
  userAgent: "Mozilla/5.0",
  authorName: "Alice",
  authorEmail: "alice@example.com",
  annotations: [],
};

interface ProviderUnderTest {
  name: string;
  createFake(): FakeTracker;
  createTracker(fake: FakeTracker): IssueTracker;
  /** Assert the provider-specific closed state for a feedback status. */
  expectClosedAs(issue: FakeTracker["issues"][number], status: "resolved" | "wont_fix"): void;
}

const providers: ProviderUnderTest[] = [
  {
    name: "GitHub",
    createFake: () => createFakeGitHub("acme/site"),
    createTracker: (fake) => createGitHubTracker({ repository: "acme/site", token: TOKEN, fetch: fake.fetch }),
    expectClosedAs: (issue, status) => {
      expect(issue.isOpen).toBe(false);
      expect(issue.stateReason).toBe(status === "resolved" ? "completed" : "not_planned");
    },
  },
  {
    name: "GitLab",
    createFake: () => createFakeGitLab("acme/site"),
    createTracker: (fake) => createGitLabTracker({ project: "acme/site", token: TOKEN, fetch: fake.fetch }),
    expectClosedAs: (issue) => expect(issue.isOpen).toBe(false),
  },
];

const silentLogger = () => ({ error: vi.fn() });

for (const provider of providers) {
  describe(`createIssueTrackerHooks — ${provider.name}`, () => {
    let fake: FakeTracker;
    let store: MemoryStore;
    let logger: ReturnType<typeof silentLogger>;

    const createHandler = (options: Partial<IssueTrackerHooksOptions> = {}): SitepingHandler =>
      createSitepingHandler({
        store,
        requireAuthForDestructive: false,
        logger,
        hooks: createIssueTrackerHooks({ tracker: provider.createTracker(fake), ...options }),
      });

    const send = async (handler: SitepingHandler, overrides: Partial<typeof payload> = {}) => {
      const response = await handler.POST(
        new Request(ENDPOINT, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ ...payload, clientId: crypto.randomUUID(), ...overrides }),
        }),
      );
      expect(response.status).toBe(201);
      return (await response.json()) as FeedbackRecord;
    };

    const patch = (handler: SitepingHandler, id: string, status: string) =>
      handler.PATCH(
        new Request(ENDPOINT, {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify({ id, projectName: "site", status }),
        }),
      );

    const remove = (handler: SitepingHandler, body: Record<string, unknown>) =>
      handler.DELETE(new Request(ENDPOINT, { method: "DELETE", headers: JSON_HEADERS, body: JSON.stringify(body) }));

    beforeEach(() => {
      fake = provider.createFake();
      store = new MemoryStore();
      logger = silentLogger();
    });

    it("opens one labelled issue per feedback, linked by a hidden marker", async () => {
      const handler = createHandler({ labels: ["feedback"] });

      const feedback = await send(handler);

      expect(fake.issues).toHaveLength(1);
      const [issue] = fake.issues;
      expect(issue?.title).toBe("[SitePing] Checkout fails with token=abc123");
      expect(issue?.labels).toEqual(["siteping", "feedback"]);
      expect(issue?.body).toContain(`<!-- siteping-feedback {"id":"${feedback.id}","project":"site"} -->`);
      expect(issue?.body).toContain(`https://example.com/checkout?step=2&siteping=${feedback.id}`);
      expect(fake.requests[0]?.authorization).toContain(TOKEN);
    });

    it("builds the deep link from the widget's default pathname-only page URL when siteUrl is set", async () => {
      const handler = createHandler({ siteUrl: "https://example.com" });

      const feedback = await send(handler, { url: "/checkout" });

      expect(fake.issues[0]?.body).toContain(`https://example.com/checkout?siteping=${feedback.id}`);
    });

    it("rejects a siteUrl that is not an absolute http(s) URL", () => {
      for (const siteUrl of ["/checkout", "example.com", "ftp://example.com"]) {
        expect(() => createIssueTrackerHooks({ tracker: provider.createTracker(fake), siteUrl })).toThrow(
          `\`siteUrl\` must be an absolute http(s) URL, received "${siteUrl}"`,
        );
      }
    });

    it("redacts free text and leaves the reviewer email out by default", async () => {
      const handler = createHandler({ redact: (text) => text.replace(/token=\S+/g, "token=[redacted]") });

      await send(handler);

      const [issue] = fake.issues;
      expect(issue?.title).toBe("[SitePing] Checkout fails with token=[redacted]");
      expect(issue?.body).not.toContain("abc123");
      expect(issue?.body).not.toContain(payload.authorEmail);
      expect(issue?.body).toContain(payload.authorName);
    });

    it("keeps the linking marker when a custom format replaces the body", async () => {
      const handler = createHandler({ formatIssue: (feedback) => ({ title: feedback.message, body: "Custom body" }) });

      const feedback = await send(handler);
      await patch(handler, feedback.id, "resolved");

      expect(fake.issues[0]?.body).toMatch(/^Custom body\n\n<!-- siteping-feedback /);
      expect(fake.issues[0]?.isOpen).toBe(false);
    });

    it("mirrors status changes on the issue", async () => {
      const handler = createHandler();
      const resolved = await send(handler);
      const declined = await send(handler);

      await patch(handler, resolved.id, "resolved");
      await patch(handler, declined.id, "wont_fix");

      provider.expectClosedAs(fake.issues[0] as FakeTracker["issues"][number], "resolved");
      provider.expectClosedAs(fake.issues[1] as FakeTracker["issues"][number], "wont_fix");

      await patch(handler, resolved.id, "open");
      expect(fake.issues[0]?.isOpen).toBe(true);
    });

    it("closes the new issue when beforeCreate stores the feedback already closed", async () => {
      const createClosingHandler = (options: Partial<IssueTrackerHooksOptions> = {}) =>
        createSitepingHandler({
          store,
          requireAuthForDestructive: false,
          logger,
          beforeCreate: (input) => ({ ...input, status: input.message === "Declined" ? "wont_fix" : "resolved" }),
          hooks: createIssueTrackerHooks({ tracker: provider.createTracker(fake), ...options }),
        });
      const handler = createClosingHandler();

      const resolved = await send(handler);
      const declined = await send(handler, { message: "Declined" });

      expect(resolved.status).toBe("resolved");
      expect(declined.status).toBe("wont_fix");
      provider.expectClosedAs(fake.issues[0] as FakeTracker["issues"][number], "resolved");
      provider.expectClosedAs(fake.issues[1] as FakeTracker["issues"][number], "wont_fix");

      await send(createClosingHandler({ syncStatus: false }));
      expect(fake.issues[2]?.isOpen).toBe(true);
    });

    it("leaves issues untouched on status changes when syncStatus is off", async () => {
      const handler = createHandler({ syncStatus: false });
      const feedback = await send(handler);

      await patch(handler, feedback.id, "resolved");

      expect(fake.issues[0]?.isOpen).toBe(true);
    });

    it("closes the issue with a single comment when the feedback is deleted, even when retried", async () => {
      const handler = createHandler();
      const feedback = await send(handler);
      const [issue] = fake.issues;

      // First attempt: the comment lands, then the delete itself is retried.
      await (createIssueTrackerHooks({ tracker: provider.createTracker(fake) }).onDeleting?.(
        { kind: "single", id: feedback.id, projectName: "site" },
        { request: new Request(ENDPOINT), principal: null },
      ) as Promise<void>);
      const response = await remove(handler, { id: feedback.id, projectName: "site" });

      expect(response.status).toBe(200);
      expect(issue?.isOpen).toBe(false);
      expect(issue?.comments.filter((comment) => !comment.startsWith("system:"))).toEqual([
        `SitePing feedback \`${feedback.id}\` was deleted.`,
      ]);
    });

    it("finds the deletion comment past the first thousand comments when the delete is retried", async () => {
      const handler = createHandler();
      const feedback = await send(handler);
      const [issue] = fake.issues;
      const earlierCommentCount = 1_000;
      for (let index = 1; index <= earlierCommentCount; index++) issue?.comments.push(`earlier comment ${index}`);
      const deletionComment = `SitePing feedback \`${feedback.id}\` was deleted.`;

      // First attempt: the deletion comment lands after every earlier comment, then the delete is retried.
      await (createIssueTrackerHooks({ tracker: provider.createTracker(fake) }).onDeleting?.(
        { kind: "single", id: feedback.id, projectName: "site" },
        { request: new Request(ENDPOINT), principal: null },
      ) as Promise<void>);
      const response = await remove(handler, { id: feedback.id, projectName: "site" });

      expect(response.status).toBe(200);
      expect(issue?.comments.filter((comment) => comment === deletionComment)).toHaveLength(1);
    });

    it("aborts the delete and keeps the feedback when the tracker fails", async () => {
      const handler = createHandler();
      const feedback = await send(handler);
      fake.failWhen(/^(PATCH|PUT) /, 503);

      const response = await remove(handler, { id: feedback.id, projectName: "site" });

      expect(response.status).toBe(502);
      expect((await store.getFeedbacks({ projectName: "site" })).total).toBe(1);
      const [, context] = logger.error.mock.calls[0] ?? [];
      expect(String((context as { error: Error }).error.message)).toMatch(
        new RegExp(`${provider.name} API (PATCH|PUT) \\S+ failed with status 503`),
      );
      expect(String((context as { error: Error }).error.message)).not.toContain(TOKEN);
    });

    it("closes only the issues of the project on deleteAll", async () => {
      const handler = createHandler();
      await send(handler);
      await send(handler);
      await send(handler, { projectName: "other-site" });

      await remove(handler, { projectName: "site", deleteAll: true });

      expect(fake.issues.map((issue) => issue.isOpen)).toEqual([false, false, true]);
    });

    it("finds the issue of a feedback past the first thousand labelled issues", async () => {
      const unrelatedIssueCount = 1_000;
      for (let index = 1; index <= unrelatedIssueCount; index++) {
        fake.issues.push({
          key: String(index),
          title: `unrelated ${index}`,
          body: "created outside this feedback",
          labels: ["siteping"],
          isOpen: true,
          stateReason: null,
          comments: [],
        });
      }
      const handler = createHandler();
      const feedback = await send(handler);

      await patch(handler, feedback.id, "resolved");

      const feedbackIssue = fake.issues[unrelatedIssueCount];
      expect(feedbackIssue?.title).not.toMatch(/^unrelated/);
      provider.expectClosedAs(feedbackIssue as FakeTracker["issues"][number], "resolved");
    });

    it("still creates the feedback when opening the issue fails", async () => {
      fake.failWhen(/^POST /, 500);
      const handler = createHandler();

      await send(handler);

      expect(fake.issues).toHaveLength(0);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("hook onCreated failed"), expect.anything());
      expect((await store.getFeedbacks({ projectName: "site" })).total).toBe(1);
    });
  });
}
