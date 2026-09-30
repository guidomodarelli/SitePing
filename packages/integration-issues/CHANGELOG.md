# Changelog

## [Unreleased]

## [0.1.0] - 2026-09-30

### Added

- First release: `createIssueTrackerHooks` keeps one GitHub or GitLab issue per feedback through the `@siteping/server` lifecycle hooks — created on feedback, closed or reopened with its status (`syncStatus`), and closed with a comment when the feedback is deleted.
- GitHub (`@siteping/integration-issues/github`) and GitLab (`@siteping/integration-issues/gitlab`) trackers, plus the `IssueTracker` interface for other providers.
- Issue formatting with a deep link back to the page (`siteUrl` resolves the widget's relative URLs), a `redact` callback applied to every exported free-text field, and an opt-in `includeAuthorEmail`.

