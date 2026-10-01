import type { FeedbackStatus } from "@beezping/core";
import {
  GITHUB_ACCEPT_HEADER,
  GITHUB_API_BASE_URL,
  GITHUB_API_VERSION,
  GITHUB_PAGE_SIZE,
  GITHUB_STATE_REASON,
} from "../constants/github.js";
import { HTTP_STATUS_NOT_FOUND, HTTP_STATUS_UNPROCESSABLE_ENTITY } from "../constants/http.js";
import { SITEPING_ISSUE_LABEL } from "../constants/issue-format.js";
import { createJsonHttpClient, IssueTrackerRequestError } from "../core/http-client.js";
import type { IssueTracker, TrackedIssue } from "../core/issue-tracker.js";
import { collectAllPages } from "../core/paginate.js";

export interface GitHubTrackerOptions {
  /** `owner/name` of the repository issues are created in. */
  repository: string;
  /** Token with `issues: write` (fine-grained) or `repo` scope. */
  token: string;
  /** GitHub Enterprise Server API root, e.g. `https://github.acme.com/api/v3`. */
  apiBaseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface GitHubIssue {
  number: number;
  html_url: string;
  body: string | null;
  state: "open" | "closed";
  pull_request?: unknown;
}

interface GitHubComment {
  body: string | null;
}

/** GitHub issue state for a feedback status: closed as completed / not planned, or reopened. */
function toGitHubState(status: FeedbackStatus): { state: "open" | "closed"; state_reason: string } {
  if (status === "resolved") return { state: "closed", state_reason: GITHUB_STATE_REASON.completed };
  if (status === "wont_fix") return { state: "closed", state_reason: GITHUB_STATE_REASON.notPlanned };
  return { state: "open", state_reason: GITHUB_STATE_REASON.reopened };
}

/** `IssueTracker` on GitHub Issues (github.com or Enterprise Server). */
export function createGitHubTracker({
  repository,
  token,
  apiBaseUrl = GITHUB_API_BASE_URL,
  fetch,
  timeoutMs,
}: GitHubTrackerOptions): IssueTracker {
  const request = createJsonHttpClient({
    tracker: "GitHub",
    baseUrl: apiBaseUrl,
    headers: {
      Accept: GITHUB_ACCEPT_HEADER,
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
    ...(fetch ? { fetch } : {}),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  const issuesPath = `/repos/${repository}/issues`;
  const labelsPath = `/repos/${repository}/labels`;
  const ensuredLabels = new Map<string, Promise<void>>();

  /** Every item of a paginated GitHub listing endpoint. */
  const listAll = <Item>(path: string, query: Record<string, string> = {}): Promise<Item[]> =>
    collectAllPages(
      (pageNumber) =>
        request<Item[]>({
          method: "GET",
          path,
          query: { ...query, per_page: String(GITHUB_PAGE_SIZE), page: String(pageNumber) },
        }),
      GITHUB_PAGE_SIZE,
    );

  const isHttpStatus = (error: unknown, status: number): boolean =>
    error instanceof IssueTrackerRequestError && error.status === status;

  /** Create the label when missing — issue creation does not reliably do it — tolerating a concurrent creation. */
  const createLabelIfMissing = async (name: string): Promise<void> => {
    try {
      await request({ method: "GET", path: `${labelsPath}/${encodeURIComponent(name)}` });
      return;
    } catch (error) {
      if (!isHttpStatus(error, HTTP_STATUS_NOT_FOUND)) throw error;
    }
    try {
      await request({ method: "POST", path: labelsPath, body: { name } });
    } catch (error) {
      if (!isHttpStatus(error, HTTP_STATUS_UNPROCESSABLE_ENTITY)) throw error;
    }
  };

  /** Checked once per label and tracker instance; a failed check is retried on the next issue. */
  const ensureLabel = (name: string): Promise<void> => {
    let ensured = ensuredLabels.get(name);
    if (!ensured) {
      ensured = createLabelIfMissing(name).catch((error: unknown) => {
        ensuredLabels.delete(name);
        throw error;
      });
      ensuredLabels.set(name, ensured);
    }
    return ensured;
  };

  return {
    name: "GitHub",

    // Lookups filter by the `siteping` label, so it must exist before the first issue.
    async createIssue({ title, body, labels }) {
      await Promise.all(labels.map(ensureLabel));
      const issue = await request<GitHubIssue>({ method: "POST", path: issuesPath, body: { title, body, labels } });
      return { key: String(issue.number), url: issue.html_url };
    },

    async updateIssueStatus(reference, status) {
      await request({ method: "PATCH", path: `${issuesPath}/${reference.key}`, body: toGitHubState(status) });
    },

    async addComment(reference, body) {
      await request({ method: "POST", path: `${issuesPath}/${reference.key}/comments`, body: { body } });
    },

    async listComments(reference) {
      const comments = await listAll<GitHubComment>(`${issuesPath}/${reference.key}/comments`);
      return comments.map((comment) => comment.body ?? "");
    },

    // Listed by label (consistent right after creation, unlike the search index).
    async findSitepingIssues(marker) {
      const issues = await listAll<GitHubIssue>(issuesPath, { labels: SITEPING_ISSUE_LABEL, state: "all" });
      const matches: TrackedIssue[] = [];
      for (const issue of issues) {
        if (issue.pull_request || !issue.body?.includes(marker)) continue;
        matches.push({
          reference: { key: String(issue.number), url: issue.html_url },
          body: issue.body,
          isOpen: issue.state === "open",
        });
      }
      return matches;
    },
  };
}

export type { IssueReference, IssueTracker } from "../core/issue-tracker.js";
