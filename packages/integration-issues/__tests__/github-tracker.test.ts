import { describe, expect, it } from "vitest";
import { createGitHubTracker } from "../src/github/index.js";
import { IssueTrackerRequestError } from "../src/index.js";
import { createFakeGitHub } from "./fake-trackers.js";

const REPOSITORY = "acme/site";
const LABELS_PATH = `/repos/${REPOSITORY}/labels`;
const MARKER = "<!-- siteping-feedback";

const draft = (title: string) => ({ title, body: `${MARKER} ${title} -->`, labels: ["siteping", "feedback"] });

const setup = () => {
  const fake = createFakeGitHub(REPOSITORY);
  const tracker = createGitHubTracker({ repository: REPOSITORY, token: "token", fetch: fake.fetch });
  const labelCreations = () =>
    fake.requests.filter((request) => request.method === "POST" && request.path === LABELS_PATH).length;
  return { fake, tracker, labelCreations };
};

describe("createGitHubTracker — labels", () => {
  it("creates the missing labels once, so every issue is found by the siteping label", async () => {
    const { fake, tracker, labelCreations } = setup();
    fake.labels.add("feedback");

    await tracker.createIssue(draft("first"));
    await tracker.createIssue(draft("second"));

    expect([...fake.labels]).toEqual(["feedback", "siteping"]);
    expect(labelCreations()).toBe(1);
    expect(fake.issues.map((issue) => issue.labels)).toEqual([
      ["siteping", "feedback"],
      ["siteping", "feedback"],
    ]);
    expect(await tracker.findSitepingIssues(MARKER)).toHaveLength(2);
  });

  it("tolerates a label created concurrently by another instance", async () => {
    const { fake, tracker } = setup();
    fake.labels.add("siteping");
    fake.labels.add("feedback");
    fake.failWhen(new RegExp(`^GET ${LABELS_PATH}/`), 404);

    await tracker.createIssue(draft("raced"));

    expect(fake.issues).toHaveLength(1);
  });

  it("opens no issue when the label cannot be created, and retries on the next one", async () => {
    const { fake, tracker } = setup();
    fake.labels.add("feedback");
    fake.failWhen(new RegExp(`^POST ${LABELS_PATH}$`), 403);

    const failure = await tracker.createIssue(draft("forbidden")).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(IssueTrackerRequestError);
    expect((failure as IssueTrackerRequestError).status).toBe(403);
    expect(fake.issues).toHaveLength(0);

    fake.labels.add("siteping");
    await tracker.createIssue(draft("after the label was created"));
    expect(fake.issues).toHaveLength(1);
  });
});
