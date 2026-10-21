<div align="center">

# docs2mcp

**Turn any documentation site into an MCP server. One command, zero config, zero dependencies.**

Point an agent at your docs — no API key, no vector database, no Python, no `npm install`.

[![node](https://img.shields.io/badge/node-%3E%3D18.17-brightgreen)](https://nodejs.org)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](#design-notes)
[![license](https://img.shields.io/github/license/muguang1224/docs2mcp?color=blue)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-compatible-8a2be2)](https://modelcontextprotocol.io)

**Not on npm yet** — install from source, see [Quickstart](#quickstart). The `npx` form below is
what it will look like once published; the code is identical either way.

<!--
  TODO: record a 20-30s GIF and drop it here. This single asset is worth more
  stars than any feature on the roadmap.

  <img src="./assets/demo.gif" width="820" alt="docs2mcp crawling a docs site and answering a question">

  Recording script: see DEMO.md
-->

</div>

```console
$ npx docs2mcp https://fastapi.tiangolo.com/

docs2mcp v0.1.0
→ https://fastapi.tiangolo.com/

strategy  sitemap (120 urls)   scope  /

✓ [  1/120]  375ms  https://fastapi.tiangolo.com/
✓ [  2/120]  562ms  https://fastapi.tiangolo.com/features
✓ [  3/120]  934ms  https://fastapi.tiangolo.com/learn
  …
✓ crawled 120 pages (via sitemap, 9.8s)
✓ indexed 120 pages → 2230 passages (1.7MB)

✓ wrote ./fastapi-mcp
    server.mjs     2.2KB
    runtime.mjs    10.6KB
    index.json     3.8MB
    mcp.json       209B

Add to your MCP client:

  {
    "mcpServers": {
      "fastapi": {
        "command": "node",
        "args": ["/abs/path/fastapi-mcp/server.mjs"]
      }
    }
  }

Then ask your agent: "search the docs for …"
```

That's it. Your agent now has grounded, citation-bearing access to the docs.

> Those numbers are real: 120 pages of the FastAPI docs, 9.8s, on a laptop.

---

## Why

Documentation is where coding agents are weakest. Models hallucinate API signatures, invent parameters, and cite the wrong page. Pasting a URL only gets an agent **one** page.

`docs2mcp` fixes the retrieval layer: crawl the whole docs tree once, keep it as a local index, and expose three boring tools the model actually uses well — `search_docs`, `get_page`, `list_pages`. Every answer carries a source URL.

**What it deliberately does not do:** no embeddings, no API key, no external service, no telemetry. The index is a JSON file you can read, diff, and commit.

---

## Quickstart

Requires Node 18.17+. Nothing else.

```bash
# from source (works today)
git clone https://github.com/muguang1224/docs2mcp
node docs2mcp/bin/docs2mcp.js https://docs.example.com

# once the package is on npm
npx docs2mcp https://docs.example.com

# then run the generated server — it speaks MCP over stdio
node example-mcp/server.mjs
```

> Not on npm yet: publishing is blocked on npm's granular-token policy for this account.
> The from-source command above is the same code and runs identically.

### Claude Desktop

Edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "example": {
      "command": "node",
      "args": ["/abs/path/example-mcp/server.mjs"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add --transport stdio example -- node /abs/path/example-mcp/server.mjs
```

### Cursor

`.cursor/mcp.json` in your project — same JSON shape as above.

### VS Code (Copilot)

`.vscode/mcp.json`:

```json
{
  "servers": {
    "example": { "command": "node", "args": ["/abs/path/example-mcp/server.mjs"] }
  }
}
```

Every generated directory also contains an `mcp.json` with the absolute path already filled in — copy-paste it.

---

## What you get

```
example-mcp/
├── server.mjs    # stdio entry point — launched by your MCP client
├── runtime.mjs   # BM25 search + tool handlers
├── index.json    # the crawl: pages + heading-aware passages
├── mcp.json      # ready-to-paste client config
├── package.json  # so you can `npm start` it
└── README.md     # generated, includes your page count and config
```

### Tools

| Tool | Input | What the model gets back |
|---|---|---|
| `search_docs` | `query`, `limit` | Ranked passages, each with its source URL and a score |
| `get_page` | `url` | The full page as clean Markdown (code fences preserved) |
| `list_pages` | `query?`, `limit?` | Every indexed page with title, URL, and size |

### Options

| Flag | Default | Meaning |
|---|---|---|
| `-o, --out <dir>` | `./<host>-mcp` | Where to write the server |
| `--max-pages <n>` | `150` | Stop after n pages |
| `--max-depth <n>` | `4` | Link-follow depth when there is no sitemap |
| `--include <re>` | — | Keep only matching URLs, e.g. `--include "/api/"` |
| `--exclude <re>` | — | Drop matching URLs, e.g. `--exclude "/blog/"` |
| `--all` | off | Crawl the whole host, not just the first path segment |
| `--concurrency <n>` | `6` | Parallel requests |
| `--timeout <ms>` | `15000` | Per-request timeout |
| `--no-robots` | off | Ignore `robots.txt` (please don't) |
| `--force` | off | Write into a non-empty output directory |
| `--verbose` | off | One line per page, useful in CI |

Examples:

```bash
# Only the API reference, not the marketing site
npx docs2mcp https://docs.example.com --include "/api/" --max-pages 400

# A Chinese docs site (CJK search is handled)
npx docs2mcp https://docs.example.cn/guide

# A docs site with no sitemap: walk links, but stop early
npx docs2mcp https://example.dev/docs --max-depth 2 --max-pages 50
```

---

## How it works

1. **Discover** — reads `robots.txt` for sitemap locations, then `sitemap.xml`. If the site publishes a usable sitemap, that list *is* the crawl. Otherwise it walks `<a href>` breadth-first inside the start URL's path scope.
2. **Extract** — prefers `<main>` / `<article>`, drops nav, footer, aside, scripts and styles, and converts to Markdown. Code blocks are pulled out before whitespace normalization so their indentation survives.
3. **Index** — splits at headings into ~1.2 KB passages. Headings become the passage's title context, which is what makes search results feel obvious instead of random.
4. **Serve** — BM25 with title/heading boosts, over stdio, in ~300 lines of dependency-free JavaScript.

### Design notes

- **Zero dependencies.** The npm package has no `dependencies` field, and the generated server has none either. There is nothing to audit, nothing to break, and `npx` starts in milliseconds.
- **No embeddings.** BM25 is boring, deterministic, instant, and works offline. For "where in these 400 pages does it mention X", it is genuinely enough. You can always add a reranker later.
- **CJK aware.** Latin text is tokenized by word, Chinese/Japanese/Korean by character *and* bigram — so `签名验证` matches `验证 webhook 签名` without spaces. Most naive setups silently fail at this.
- **The index is yours.** `index.json` is readable JSON. Diff it between releases, commit it, gate it in CI, serve it from a CDN.

### Tested against

Real crawls, not fixtures:

| Site | Generator | Result |
|---|---|---|
| `fastapi.tiangolo.com` | MkDocs Material | 120 pages via sitemap, 9.8s, 0 chrome leaks |
| `docs.astro.build` | Starlight | 120 pages via links, 8.8s, fences balanced |
| `vitejs.dev/guide` | VitePress | 24 pages via links, 6.8s, 0 chrome leaks |

Each of those exposed a trap that is now a regression test: MkDocs puts its sidebar *and* its
right-hand TOC **inside** `<main>`, Shiki moves the language class onto a wrapper `<div>` and
renders a visible `lang` label, and MkDocs appends a `¶` permalink anchor to every heading.

---

## Limitations

Being honest about these is cheaper than a bug report:

- **Static HTML only.** Client-rendered docs (a bare SPA shell with no server-rendered content) will crawl as empty. The CLI skips pages with too little text and reports how many it skipped.
- **Regex HTML parsing.** No DOM, so pathological markup can produce noisy Markdown. It handles Docusaurus, MkDocs, VitePress, GitBook, ReadMe, Slate and hand-written HTML well; it is not a browser.
- **No auth.** Private docs behind a login aren't supported. `--header` support is on the roadmap.
- **Sitemap `<lastmod>` is ignored.** Every run is a full crawl. Incremental re-crawl is on the roadmap.
- **Split code fences.** A passage that starts mid–code-block loses its opening fence. It affects formatting, not retrieval.
- **The output is a snapshot.** Re-run the crawler when the docs change; nothing auto-updates.

---

## FAQ

**Why not just give the agent the docs URL?**
An agent with a URL fetches one page, if it fetches at all, and can't search. It can't tell whether `rate_limited` appears in the docs or is a plausible-sounding invention. `search_docs` gives it a ranked, citable set of passages and `get_page` gives the full context.

**Why not a vector database?**
For a few hundred pages, BM25 answers the same questions with zero infrastructure and zero cold-start latency. If you're indexing a million pages, this is the wrong tool.

**Does it send my docs anywhere?**
No. It fetches the site you point it at, writes JSON to disk, and serves it locally. No telemetry, no API calls beyond the crawl.

**Can I commit the generated directory?**
Yes, and it's a good idea for internal docs: the index becomes a reviewed, diffable artifact, and the server needs no network to run.

**How big is the index?**
Roughly 3 MB per 120 pages of prose for typical docs — the FastAPI example above produces a 3.8 MB `index.json` from 1.7 MB of text.

**Does it work with Chinese / Japanese docs?**
Yes — CJK is tokenized into characters and bigrams, so space-free queries match. There's a test for it.

---

## Roadmap

- [ ] `--header` for authenticated / private docs
- [ ] Incremental re-crawl using `sitemap.xml` `lastmod`
- [ ] `--format json|markdown|html` for non-docs sites (changelogs, handbooks)
- [ ] Optional reranker hook
- [ ] `docs2mcp serve <dir>` to skip the client config step
- [ ] Publish to the MCP registry

Open an issue if you want one of these, or something else.

---

## Development

```bash
git clone https://github.com/muguang1224/docs2mcp
cd docs2mcp
npm test          # extraction unit tests + end-to-end crawl + MCP protocol
npm run fixture   # serves a fake docs site on :8787 for manual testing
```

`npm test` needs no network: the end-to-end suite spins up a local fixture site, crawls it, generates a server, and drives its JSON-RPC surface.

To check the stdio layer by hand:

```bash
node bin/docs2mcp.js http://127.0.0.1:8787/docs/getting-started.html -o ./out/demo
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
  | node out/demo/server.mjs
```

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

MIT — do whatever you want.

<div align="center">

**If this saved you from one hallucinated API call, [a star](https://github.com/muguang1224/docs2mcp) is the whole tip jar.** ⭐

</div>
