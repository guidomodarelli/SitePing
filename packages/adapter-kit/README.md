# @beezping/adapter-kit

Everything needed to build — and conformance-test — a custom [Beezping](https://github.com/guidomodarelli/beezping) store adapter.

```ts
import { createCollectionStore, type BeezpingStore } from "@beezping/adapter-kit";

// A complete adapter over any snapshot backend, in ~15 lines:
export function createMyStore(): BeezpingStore {
  let records = load();
  return createCollectionStore({
    load: () => records,
    persist: (next) => save((records = next)),
    generateId: () => crypto.randomUUID(),
  });
}
```

Verify it with the shared conformance suite (vitest):

```ts
import { testBeezpingStore } from "@beezping/adapter-kit/testing";
import { createMyStore } from "../src/index.js";

testBeezpingStore(() => createMyStore());
```

**[Full guide → github.com/guidomodarelli/beezping/docs/adapters/writing-an-adapter](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/adapters/writing-an-adapter.mdx)**

## License

MIT
