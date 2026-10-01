/**
 * Issue tracker integration for Beezping. Build hooks with
 * `createIssueTrackerHooks` and pick a provider entry:
 *
 * - `@beezping/integration-issues/github` — GitHub Issues (github.com / Enterprise Server)
 * - `@beezping/integration-issues/gitlab` — GitLab Issues (gitlab.com / self-managed)
 *
 * Or implement `IssueTracker` for any other tracker.
 */
export { createIssueTrackerHooks, type IssueTrackerHooks, type IssueTrackerHooksOptions } from "./core/hooks.js";
export {
  IssueTrackerRequestError,
  isIssueTrackerRequestError,
  isUnlabelledIssueError,
  UnlabelledIssueError,
} from "./core/http-client.js";
export type { IssueContent, IssueFormatOptions } from "./core/issue-format.js";
export { formatIssue } from "./core/issue-format.js";
export type { IssueDraft, IssueListing, IssueReference, IssueTracker, TrackedIssue } from "./core/issue-tracker.js";
