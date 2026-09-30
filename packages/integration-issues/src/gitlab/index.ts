import { isClosedStatus } from "@siteping/core";
import {
  GITLAB_API_BASE_URL,
  GITLAB_LABEL_SEPARATOR,
  GITLAB_PAGE_SIZE,
  GITLAB_STATE_EVENT,
} from "../constants/gitlab.js";
import { SITEPING_ISSUE_LABEL } from "../constants/issue-format.js";
import { createJsonHttpClient } from "../core/http-client.js";
import type { IssueTracker, TrackedIssue } from "../core/issue-tracker.js";
import { collectAllPages } from "../core/paginate.js";

export interface GitLabTrackerOptions {
  /** Numeric project id or full path (`group/subgroup/project`). */
  project: string | number;
  /** Personal, project or group access token with the `api` scope. */
  token: string;
  /** Self-managed instance API root, e.g. `https://gitlab.acme.com/api/v4`. */
  apiBaseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface GitLabIssue {
  iid: number;
  web_url: string;
  description: string | null;
  state: "opened" | "closed";
}

interface GitLabNote {
  body: string;
  /** Notes GitLab writes itself (state changes, label edits). */
  system: boolean;
}

/**
 * `IssueTracker` on GitLab Issues (gitlab.com or self-managed). GitLab has
 * no close reason, so `resolved` and `wont_fix` both close the issue.
 */
export function createGitLabTracker({
  project,
  token,
  apiBaseUrl = GITLAB_API_BASE_URL,
  fetch,
  timeoutMs,
}: GitLabTrackerOptions): IssueTracker {
  const request = createJsonHttpClient({
    tracker: "GitLab",
    baseUrl: apiBaseUrl,
    headers: { "PRIVATE-TOKEN": token },
    ...(fetch ? { fetch } : {}),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  const issuesPath = `/projects/${encodeURIComponent(String(project))}/issues`;

  /** Every item of a paginated GitLab listing endpoint. */
  const listAll = <Item>(path: string, query: Record<string, string> = {}): Promise<Item[]> =>
    collectAllPages(
      (pageNumber) =>
        request<Item[]>({
          method: "GET",
          path,
          query: { ...query, per_page: String(GITLAB_PAGE_SIZE), page: String(pageNumber) },
        }),
      GITLAB_PAGE_SIZE,
    );

  return {
    name: "GitLab",

    async createIssue({ title, body, labels }) {
      const issue = await request<GitLabIssue>({
        method: "POST",
        path: issuesPath,
        body: { title, description: body, labels: labels.join(GITLAB_LABEL_SEPARATOR) },
      });
      return { key: String(issue.iid), url: issue.web_url };
    },

    async updateIssueStatus(reference, status) {
      const stateEvent = isClosedStatus(status) ? GITLAB_STATE_EVENT.close : GITLAB_STATE_EVENT.reopen;
      await request({ method: "PUT", path: `${issuesPath}/${reference.key}`, body: { state_event: stateEvent } });
    },

    async addComment(reference, body) {
      await request({ method: "POST", path: `${issuesPath}/${reference.key}/notes`, body: { body } });
    },

    async listComments(reference) {
      const notes = await listAll<GitLabNote>(`${issuesPath}/${reference.key}/notes`);
      return notes.filter((note) => !note.system).map((note) => note.body);
    },

    async findSitepingIssues(marker) {
      const issues = await listAll<GitLabIssue>(issuesPath, { labels: SITEPING_ISSUE_LABEL, state: "all" });
      const matches: TrackedIssue[] = [];
      for (const issue of issues) {
        if (!issue.description?.includes(marker)) continue;
        matches.push({
          reference: { key: String(issue.iid), url: issue.web_url },
          body: issue.description,
          isOpen: issue.state === "opened",
        });
      }
      return matches;
    },
  };
}

export type { IssueReference, IssueTracker } from "../core/issue-tracker.js";
