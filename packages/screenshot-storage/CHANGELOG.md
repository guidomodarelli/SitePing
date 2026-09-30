# Changelog

## [Unreleased]

## [0.1.0] - 2026-09-30

### Added

- First release: stores feedback screenshots outside the feedback record, behind one `ScreenshotObjectStore` contract.
- Backends for Cloudflare Images, any S3-compatible bucket, your database through Drizzle (PostgreSQL and Turso/libSQL), the local filesystem and memory, or your own implementation.
- `createScreenshotServeHandler` serves stored screenshots for backends without public URLs (database, filesystem, memory).

