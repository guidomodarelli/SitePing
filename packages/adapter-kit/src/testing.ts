/**
 * The `BeezpingStore` conformance suite, published for third-party adapter
 * authors (requires `vitest` — an optional peer dependency of this
 * package).
 *
 * @example
 * ```ts
 * import { testBeezpingStore } from "@beezping/adapter-kit/testing";
 * import { DrizzleStore } from "../src/index.js";
 *
 * testBeezpingStore(() => new DrizzleStore(db));
 * ```
 */

export type { StoreConformanceOptions } from "@beezping/core/testing";
export { testBeezpingStore } from "@beezping/core/testing";
