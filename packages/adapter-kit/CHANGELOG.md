# Changelog

## [Unreleased]

## [0.2.0] - 2026-09-30

### Added

- Add optional `SitepingStore.createFeedbackIfAbsent` and the exported `FeedbackCreateOutcome` type to distinguish new feedback from duplicate submissions; `createCollectionStore` provides this method.
- Export `isUnreachableOffset` so custom adapters can return empty pages with the correct total for pagination offsets beyond the safe integer range.
- Extend `@siteping/adapter-kit/testing` conformance checks to cover concurrent feedback deduplication and pagination far beyond the last page.

### Changed

- Clarify that `ScreenshotStorage.upload` must return a URL unique to the supplied feedback ID, and that `delete` may also clean up uploads whose feedback was not stored.
- Document that stores used with custom authorization in `@siteping/server` must implement `verifyProjectOwnership`.

### Fixed

- Prevent concurrent mutations on a single `createCollectionStore` instance from losing changes or creating duplicate feedback.
- Make `isStoreNotFound` and `isStoreDuplicate` recognize store errors across separately bundled Siteping packages by their stable error codes.

## [0.1.1](https://github.com/NeosiaNexus/SitePing/compare/adapter-kit-v0.1.0...adapter-kit-v0.1.1) (2026-09-03)


### Bug Fixes

* harden webhooks, validation, store engine and adapter contracts (audit 2026-09) ([#279](https://github.com/NeosiaNexus/SitePing/issues/279)) ([7336eea](https://github.com/NeosiaNexus/SitePing/commit/7336eea220938df4b34c8ece9270d246f772e61d))

## 0.1.0 (2026-07-28)


### Features

* type-safe contracts + mechanical extension paths (adapters, locales, packages) ([#247](https://github.com/NeosiaNexus/SitePing/issues/247)) ([75cd2f5](https://github.com/NeosiaNexus/SitePing/commit/75cd2f5024509e5552bfbcf7587a0d67819909a6))

## Changelog
