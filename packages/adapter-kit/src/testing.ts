/**
 * The `SitepingStore` conformance suite, published for third-party adapter
 * authors (requires `vitest` — an optional peer dependency of this
 * package).
 *
 * @example
 * ```ts
 * import { testSitepingStore } from "@beezping/adapter-kit/testing";
 * import { DrizzleStore } from "../src/index.js";
 *
 * testSitepingStore(() => new DrizzleStore(db));
 * ```
 */

export type { StoreConformanceOptions } from "@beezping/core/testing";
export { testSitepingStore } from "@beezping/core/testing";
