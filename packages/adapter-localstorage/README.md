[![npm version](https://img.shields.io/npm/v/@beezping/adapter-localstorage)](https://www.npmjs.com/package/@beezping/adapter-localstorage)
[![Docs](https://img.shields.io/badge/docs-github.com/guidomodarelli/beezping-0066ff)](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/adapters/localstorage.mdx)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

# @beezping/adapter-localstorage

Client-side store for [Beezping](https://github.com/guidomodarelli/beezping) — the whole feedback loop in the browser, no server required. Ideal for demos, prototypes, and docs sites.

**[Documentation](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/adapters/localstorage.mdx)**

## Install

```bash
npm install @beezping/adapter-localstorage
```

## Usage

```ts
import { initBeezping } from "@beezping/widget";
import { LocalStorageStore } from "@beezping/adapter-localstorage";

initBeezping({
  store: new LocalStorageStore(),   // options: { key?: string } — default "beezping_feedbacks"
  projectName: "my-demo",
});
```

Each visitor sees only their own feedback — data never leaves their browser. Corrupted stored data never crashes and is backed up to `<key>.corrupt` instead of being overwritten, quota pressure drops the screenshot before ever dropping the comment, and dates come back as real `Date` objects.

## License

[MIT](https://github.com/guidomodarelli/beezping/blob/main/LICENSE)
