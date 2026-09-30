import type { FeedbackRecord } from "@siteping/core";
import { describe, expect, it } from "vitest";
import { buildIssueMarker, formatIssue, parseIssueMarker } from "../src/core/issue-format.js";

const redactTokens = (text: string) => text.replace(/token=[^\s&]+/g, "token=[redacted]");

const feedback: FeedbackRecord = {
  id: "feedback-1",
  type: "bug",
  message: "Checkout fails",
  status: "open",
  projectName: "site",
  url: "https://example.com/checkout",
  urlPattern: null,
  authorName: "Alice token=name-secret",
  authorEmail: "alice@example.com",
  viewport: "1280x720",
  userAgent: "Mozilla/5.0",
  clientId: "client-1",
  resolvedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  annotations: [],
  screenshotUrl: "https://cdn.example.com/shot.png?token=url-secret",
  screenshotRegion: null,
  diagnostics: null,
};

describe("issue marker", () => {
  it("round-trips ids and project names with characters that need escaping", () => {
    const link = { feedbackId: 'id-with-"quotes"', projectName: "Site --> <!-- tricky" };

    expect(parseIssueMarker(`Body text\n\n${buildIssueMarker(link)}`)).toEqual(link);
  });

  it("trusts only the last marker, ignoring markers quoted in user-controlled content", () => {
    const forged = buildIssueMarker({ feedbackId: "someone-else", projectName: "site" });
    const genuine = { feedbackId: "feedback-1", projectName: "site" };

    expect(parseIssueMarker(`Message quoting ${forged}\n\n${buildIssueMarker(genuine)}`)).toEqual(genuine);
  });

  it("treats missing, truncated or malformed markers as absent", () => {
    expect(parseIssueMarker("An issue written by hand")).toBeNull();
    expect(parseIssueMarker('<!-- siteping-feedback {"id":"a" -->')).toBeNull();
    expect(parseIssueMarker('<!-- siteping-feedback {"id":1,"project":"site"} -->')).toBeNull();
  });
});

describe("formatIssue", () => {
  const options = { redact: redactTokens, deepLinkParam: false as const, includeAuthorEmail: false };

  it("redacts the author name and the embedded screenshot URL", () => {
    const { body } = formatIssue(feedback, options);

    expect(body).not.toContain("name-secret");
    expect(body).not.toContain("url-secret");
    expect(body).toContain("Alice token=[redacted]");
    expect(body).toContain("![Screenshot](https://cdn.example.com/shot.png?token=[redacted])");
  });

  it("omits the screenshot when redaction leaves no embeddable HTTPS URL", () => {
    const { body } = formatIssue(feedback, {
      ...options,
      redact: (text) => text.replace(/https:\/\/cdn\.\S+/g, "[screenshot removed]"),
    });

    expect(body).not.toContain("## Screenshot");
    expect(body).not.toContain("cdn.example.com");
  });
});
