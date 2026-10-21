# Contributing

Thanks for looking. This project is deliberately small — that's the point. Small means a change has to earn its place.

## The two rules

1. **Zero runtime dependencies.** If your change needs a package, it needs a very good reason. Regex HTML parsing and hand-written BM25 are features here, not accidents.
2. **The generated server must stay self-contained.** `node server.mjs` has to work on a clean machine with no `npm install`.

## Getting set up

```bash
git clone https://github.com/muguang1224/docs2mcp
cd docs2mcp
npm test
```

No install step. There is nothing to install.

| Command | What it does |
|---|---|
| `npm test` | Extraction unit tests + full end-to-end crawl and MCP protocol suite |
| `npm run fixture` | Serves a fake docs site on `http://127.0.0.1:8787` |
| `npm run inspect -- out/<dir>/index.json` | Extraction quality report: chrome leaks, fence balance, leftover tags |
| `node bin/docs2mcp.js <url>` | Run the CLI from source |

The end-to-end test makes no network calls: it starts a local fixture site, crawls it, generates a server, and drives its JSON-RPC methods in-process.

## What makes a good PR

- **A failing test first.** For extraction bugs, add the smallest HTML snippet that reproduces it to `test/extract.test.js`. For crawler bugs, add a route to `test/fixture-server.js`.
- **A note on the blast radius.** Extraction is one big regex pipeline; a "harmless" change can mangle code blocks on 30% of sites. Say what you tested against.
- **Real-world evidence.** If you're fixing extraction for a specific generator (Docusaurus, MkDocs, VitePress, GitBook, ReadMe, Slate, ...), include the URL or a trimmed snippet. "Some sites" is not actionable.

## What will probably be rejected

- Adding a bundler, a transpiler, or a build step
- Adding an embedding model or a hosted service as a hard requirement
- Anything that makes the first run slower than one command
- Telemetry, analytics, or "usage reporting"

## Reporting a bug

Please include:

```
Node version:
Site crawled (or "the fixture"):
Command:
Expected:
Actual:
```

If a page extracted badly, paste the relevant HTML — a trimmed `<main>` is usually enough. Privacy note: don't paste private docs.

## Commit style

`verb(scope): what changed` — for example:

```
fix(extract): keep tables inside <article>
feat(crawl): follow sitemap index files
docs: examples for --include
```

Not enforced, just appreciated.

## License

By contributing you agree your work is released under the MIT license.
