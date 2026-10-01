import { type FeedbackRecord, isClosedStatus } from "@beezping/core";
import type { SitepingDeletionTarget, SitepingLifecycleHooks } from "@beezping/server";
import {
  DEFAULT_DEEP_LINK_PARAM,
  DELETED_FEEDBACK_COMMENT_TEMPLATE,
  INVALID_SITE_URL_MESSAGE_TEMPLATE,
  SITE_URL_PROTOCOLS,
  SITEPING_ISSUE_LABEL,
} from "../constants/issue-format.js";
import {
  buildIssueMarker,
  feedbackMarkerFragment,
  formatIssue,
  type IssueContent,
  type IssueFormatOptions,
  parseIssueMarker,
  projectMarkerFragment,
} from "./issue-format.js";
import type { IssueTracker, TrackedIssue } from "./issue-tracker.js";

export interface IssueTrackerHooksOptions {
  /** Where issues live — `createGitHubTracker`, `createGitLabTracker` or your own. */
  tracker: IssueTracker;
  /** Extra labels on trackers that support them (the `siteping` label is always added). */
  labels?: readonly string[];
  /** Redact secrets from free text before it leaves your server. Defaults to no redaction. */
  redact?: (text: string) => string;
  /** Query parameter of the widget's deep link (`SitepingConfig.deepLink`), or `false` to omit it. */
  deepLinkParam?: string | false;
  /**
   * Absolute http(s) URL of your site (e.g. `https://example.com`), used to
   * resolve relative page URLs into the deep link — the widget stores
   * `window.location.pathname` by default. Without it, feedbacks with a
   * relative page URL get no deep link.
   */
  siteUrl?: string;
  /** Include reviewer emails in issues. Defaults to `false` — issues are often public. */
  includeAuthorEmail?: boolean;
  /** Replace the default Markdown. The linking marker is appended to whatever you return. */
  formatIssue?: (feedback: FeedbackRecord, defaults: IssueFormatOptions) => IssueContent;
  /**
   * Close / reopen the issue when the feedback status changes — including a
   * feedback stored already closed (e.g. by `beforeCreate`). Defaults to `true`.
   */
  syncStatus?: boolean;
  /** Comment left on issues whose feedback is deleted. */
  deletedCommentText?: (feedbackId: string) => string;
}

/** Throw at setup when `siteUrl` cannot resolve page URLs, instead of silently dropping deep links later. */
function assertSiteUrl(siteUrl: string): void {
  let protocol: string | null = null;
  try {
    protocol = new URL(siteUrl).protocol;
  } catch {
    // Not an absolute URL — reported below.
  }
  if (protocol === null || !SITE_URL_PROTOCOLS.includes(protocol)) {
    throw new TypeError(INVALID_SITE_URL_MESSAGE_TEMPLATE.replace("{siteUrl}", siteUrl));
  }
}

const noRedaction = (text: string): string => text;
const defaultDeletedComment = (feedbackId: string): string =>
  DELETED_FEEDBACK_COMMENT_TEMPLATE.replace("{feedbackId}", feedbackId);

/**
 * Keep one tracker issue per feedback through `@beezping/server` hooks:
 * create it on `onCreated`, sync its state on `onUpdated`, and close it with
 * a comment on `onDeleting` — a failure there aborts the delete, so the
 * feedback survives until its issue could be cleaned up.
 *
 * Issues are linked to feedbacks by a hidden marker in their body, so no
 * extra column is needed in your database.
 *
 * @example
 * ```ts
 * import { createIssueTrackerHooks } from "@beezping/integration-issues";
 * import { createGitHubTracker } from "@beezping/integration-issues/github";
 *
 * createSitepingHandler({
 *   store,
 *   access,
 *   hooks: createIssueTrackerHooks({
 *     tracker: createGitHubTracker({ repository: "acme/site", token: process.env.GITHUB_TOKEN! }),
 *   }),
 * });
 * ```
 */
export function createIssueTrackerHooks({
  tracker,
  labels = [],
  redact = noRedaction,
  deepLinkParam = DEFAULT_DEEP_LINK_PARAM,
  siteUrl,
  includeAuthorEmail = false,
  formatIssue: customFormatIssue,
  syncStatus = true,
  deletedCommentText = defaultDeletedComment,
}: IssueTrackerHooksOptions): SitepingLifecycleHooks<unknown> {
  if (siteUrl !== undefined) assertSiteUrl(siteUrl);
  const formatOptions: IssueFormatOptions = {
    redact,
    deepLinkParam,
    includeAuthorEmail,
    ...(siteUrl === undefined ? {} : { siteUrl }),
  };
  const issueLabels = [SITEPING_ISSUE_LABEL, ...labels.filter((label) => label !== SITEPING_ISSUE_LABEL)];

  const issueOf = async (feedbackId: string): Promise<TrackedIssue | null> => {
    const candidates = await tracker.findSitepingIssues(feedbackMarkerFragment(feedbackId));
    return candidates.find((issue) => parseIssueMarker(issue.body)?.feedbackId === feedbackId) ?? null;
  };

  const issuesOfProject = async (projectName: string): Promise<TrackedIssue[]> => {
    const candidates = await tracker.findSitepingIssues(projectMarkerFragment(projectName));
    return candidates.filter((issue) => parseIssueMarker(issue.body)?.projectName === projectName);
  };

  /** Close as not planned and leave the deletion comment once, even across retries. */
  const closeDeleted = async (issue: TrackedIssue, feedbackId: string): Promise<void> => {
    if (issue.isOpen) await tracker.updateIssueStatus(issue.reference, "wont_fix");
    const comment = deletedCommentText(feedbackId);
    const comments = await tracker.listComments(issue.reference);
    if (!comments.includes(comment)) await tracker.addComment(issue.reference, comment);
  };

  const closeDeletedTarget = async (target: SitepingDeletionTarget): Promise<void> => {
    if (target.kind === "single") {
      const issue = await issueOf(target.id);
      if (issue) await closeDeleted(issue, target.id);
      return;
    }
    for (const issue of await issuesOfProject(target.projectName)) {
      const link = parseIssueMarker(issue.body);
      if (link) await closeDeleted(issue, link.feedbackId);
    }
  };

  return {
    async onCreated(feedback) {
      const content = customFormatIssue
        ? customFormatIssue(feedback, formatOptions)
        : formatIssue(feedback, formatOptions);
      const marker = buildIssueMarker({ feedbackId: feedback.id, projectName: feedback.projectName });
      const reference = await tracker.createIssue({
        title: content.title,
        body: `${content.body}\n\n${marker}`,
        labels: issueLabels,
      });
      // `beforeCreate` may store the feedback already closed and no `onUpdated`
      // follows, so mirror that initial status on the new (open) issue now.
      if (syncStatus && isClosedStatus(feedback.status)) await tracker.updateIssueStatus(reference, feedback.status);
    },
    async onUpdated(feedback) {
      if (!syncStatus) return;
      const issue = await issueOf(feedback.id);
      if (issue) await tracker.updateIssueStatus(issue.reference, feedback.status);
    },
    onDeleting: closeDeletedTarget,
  };
}
