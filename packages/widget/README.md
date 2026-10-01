[![npm version](https://img.shields.io/npm/v/@beezping/widget)](https://www.npmjs.com/package/@beezping/widget)
[![Live Demo](https://img.shields.io/badge/demo-try%20it%20live-22c55e)](https://github.com/guidomodarelli/beezping/tree/main/apps/demo)
[![Docs](https://img.shields.io/badge/docs-github.com/guidomodarelli/beezping-0066ff)](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/widget)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

# @beezping/widget

**Client feedback, pinned to the pixel.**

A lightweight feedback widget that lets your clients annotate websites during development. Draw rectangles (or right-click), leave comments, track bugs — directly on the live site, anchored to the exact DOM element.

Part of [Beezping](https://github.com/guidomodarelli/beezping) — **[live demo](https://github.com/guidomodarelli/beezping/tree/main/apps/demo)** · **[documentation](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/widget)**.

## Install

```bash
npm install @beezping/widget
```

## Quick start

React (the hook survives StrictMode double-mounts and tears down on unmount):

```tsx
"use client";
import { useBeezping } from "@beezping/widget/react";

export function Feedback() {
  useBeezping({ endpoint: "/api/beezping", projectName: "my-app" });
  return null;
}
```

Any other framework, or none:

```ts
import { initBeezping } from "@beezping/widget";

const widget = initBeezping({ endpoint: "/api/beezping", projectName: "my-app" });
// widget.open() / .close() / .refresh() / .focusFeedback(id) / .on(...) / .destroy()
```

No server? Pass `store: new LocalStorageStore()` (from `@beezping/adapter-localstorage`) instead of `endpoint` and the whole loop runs in the browser.

## Highlights

- **DOM-anchored annotations** — CSS selector + XPath + text fallbacks; they survive deploys and layout changes
- **Dev-only by default** — hides in production builds (`NODE_ENV`); `forceShow: true` for staging. Renders at every width, with a phone layout (`minViewportWidth` keeps it off small screens)
- **Opt-in extras** — screenshots of the annotated area (with `data-beezping-ignore="true"` privacy masking), console/network diagnostics, instant right-click comments that never hijack keyboard or modifier-key menus
- **Panel actions** — your own buttons and links in the feedback detail view: create a ticket, hand a feedback to an agent, open it in your tracker
- **Reliable** — retry with backoff plus a localStorage queue; a flaky network never loses a comment
- **Isolated & light** — closed Shadow DOM, ~34 KB gzip (ESM); panel, screenshot engine, and non-English locales load on demand
- **8 built-in locales** — en, fr, de, es, it, pt, ru, ja (BCP-47 tags like `fr-CA` resolve automatically)

## Documentation

Every option with its real default and behavior: **[github.com/guidomodarelli/beezping/docs/widget/configuration](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/widget/configuration.mdx)** — plus [screenshots & masking](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/widget/screenshots.mdx), [right-click comments](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/widget/right-click.mdx), [panel actions](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/widget/panel-actions.mdx), and [how anchoring works](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/widget/anchoring.mdx).

## License

[MIT](https://github.com/guidomodarelli/beezping/blob/main/LICENSE)
