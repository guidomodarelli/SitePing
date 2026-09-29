# Changelog

## [Unreleased]

### Added

- First release: a framework- and database-agnostic HTTP API (`createSitepingHandler`) built on the Fetch API, backed by any `SitepingStore`.
- Pluggable `access` rules (`authenticate`, `authorize`, `canReadAuthorEmail`), `beforeCreate` and `presentFeedback` to adapt requests and responses.
- Lifecycle `hooks` (`onCreated`, `onUpdated`, `onDeleting`, `onDeleted`) to sync feedback with other systems; a failing `onDeleting` aborts the delete.
