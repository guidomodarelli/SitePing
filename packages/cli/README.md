[![npm version](https://img.shields.io/npm/v/@beezping/cli)](https://www.npmjs.com/package/@beezping/cli)
[![Docs](https://img.shields.io/badge/docs-github.com/guidomodarelli/beezping-0066ff)](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/cli.mdx)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

# @beezping/cli

Set up and check [Beezping](https://github.com/guidomodarelli/beezping) from the command line. Single self-contained binary, zero runtime dependencies, Node ≥ 20.

**[Documentation](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/cli.mdx)**

## Usage

```bash
npx @beezping/cli init
```

> Always `npx @beezping/cli …` — there is no `beezping` package on npm, so `npx beezping` only works once `@beezping/cli` is installed locally.

## Commands

| Command | What it does |
|---------|--------------|
| `init` | Interactive setup: adds the Prisma models and generates the Next.js App Router API route |
| `sync [--schema <path>]` | Non-interactive, CI-friendly schema merge — creates/updates the Beezping models, never touches your own fields |
| `status [--schema <path>]` | Health report: schema, API route, package, and widget integration (exits 1 when something's missing) |
| `doctor --url <url> --endpoint <path> [--api-key <key>]` | One HTTP request against your running server to confirm a Beezping handler answers |

Commit before `sync` — it re-prints the whole schema file, so formatting normalizes across your own models too.

## Documentation

Flags, exit codes, non-TTY behavior, and what each command writes: **[github.com/guidomodarelli/beezping/docs/cli](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/cli.mdx)**.

## License

[MIT](https://github.com/guidomodarelli/beezping/blob/main/LICENSE)
