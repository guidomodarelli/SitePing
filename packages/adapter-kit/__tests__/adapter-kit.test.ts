/**
 * Dogfood test: build a complete adapter using ONLY the kit's public
 * exports, then run the published conformance suite against it — proving
 * the kit is sufficient for a third-party adapter with zero access to
 * `@beezping/core`.
 */

import { type BeezpingStore, createCollectionStore, type FeedbackRecord } from "../src/index.js";
import { testBeezpingStore } from "../src/testing.js";

/** The simplest possible third-party adapter: a snapshot store over a plain array. */
function createArrayStore(): BeezpingStore {
  let feedbacks: FeedbackRecord[] = [];
  let counter = 1;
  return createCollectionStore({
    load: () => feedbacks,
    persist: (next) => {
      feedbacks = next;
    },
    generateId: () => `kit-${counter++}`,
    comments: true,
  });
}

testBeezpingStore(() => createArrayStore());
