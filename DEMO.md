# DEMO.md — recording the README GIF

The GIF is the single highest-leverage asset for this project. A repo whose demo is a 20-second terminal recording gets orders of magnitude more stars than the same repo with a wall of text.

Do this **before** you launch. Not after.

## What to record

One uninterrupted take. No cuts, no speed-ups, no music. Speed-ups read as fake.

| Beat | Screen | Duration |
|---|---|---|
| 1 | A blank terminal, big font | 1s |
| 2 | Type `npx docs2mcp https://docs.stripe.com` and hit enter | 2s |
| 3 | Crawl runs — the `✓ [...]` lines fly past, then the summary | 6s |
| 4 | The generated `mcp.json` block appears | 2s |
| 5 | Cut to the agent (Claude Code / Cursor): ask *"How do I verify a webhook signature?"* | 2s |
| 6 | The agent calls `search_docs`, gets passages with URLs, then `get_page` | 6s |
| 7 | The answer includes the correct `timingSafeEqual` snippet and a source URL | 3s |

Target: **18–25 seconds**, under 5 MB, 1200–1400 px wide, loops cleanly.

## How to record it

**Check your publishing rights first.** `docs.stripe.com` is a great demo because the content is public and instantly recognizable, but do not show anything you don't have the right to show. Your own project's docs, an open-source project's docs (Vite, FastAPI, Drizzle), or the bundled fixture site are all safe.

### Option A — terminal only (fastest, good enough)

1. `brew install asciinema` (or `scoop install asciinema` on Windows)
2. `asciinema rec demo.cast --cols 100 --rows 28`
3. Run the demo beats above
4. `agg demo.cast demo.gif --font-size 22 --theme dracula`

### Option B — terminal plus the agent (much more convincing)

Record the full screen with [Kap](https://getkap.co/) or OBS, then trim and convert:

```bash
ffmpeg -i raw.mov -vf "fps=14,scale=1280:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" -loop 0 demo.gif
```

## Settings that matter

- **Font size 20–24.** Anything smaller is unreadable on a phone.
- **Dark theme.** It's a dev tool; it looks right and compresses better.
- **`NO_COLOR` off.** The green `✓` and cyan `→` do real work — they make it look finished.
- **Trim the dead air.** The crawl takes 30s on a big site; record a site that finishes in 5–8s, or start the GIF mid-crawl.
- **No cursor blink hunting.** Move the mouse out of frame.

## Store it

```
docs2mcp/
└── assets/
    └── demo.gif     # < 5 MB
```

Then uncomment this block in `README.md`:

```html
<img src="./assets/demo.gif" width="820" alt="docs2mcp crawling a docs site and answering a question">
```

## Also make these, they're cheap

| Asset | Why | How |
|---|---|---|
| **Social preview** (1280×640) | Shows on X, Slack, Discord, HN cards | Settings → Social preview → upload. Use a screenshot of the terminal output on a dark background with the one-liner over it. |
| **Static screenshot** | For the npm page and blog posts | Just crop frame 3 of the GIF. |
| **`npx` one-liner card** | Reusable in every launch post | Text: `npx docs2mcp <your-docs-url>` on a dark background. |

## The script (read it while recording)

> "This is `docs2mcp`. I'm pointing it at Stripe's docs.
>
> One command. It finds the sitemap, crawls 400 pages, and writes a local MCP server — no API key, no vector database, no dependencies.
>
> Now in the agent, I just ask a normal question. It calls `search_docs`, gets the exact passages with source URLs, and pulls the full page for context.
>
> The answer cites the real page and has the real code. That's it."
