# LAUNCH.md — how to actually get the stars

Read this before you push the repo public. The code is the easy part; the launch is where the outcome is decided.

**Honest base rates.** Most repos get 0–20 stars and stop. A repo that reaches the front page of Hacker News lands roughly 200–800. A repo that stays small but answers issues fast compounds to a few hundred over months. Nobody can promise which one you get — but the checklist below meaningfully raises the floor.

---

## Part 1 — Blocking checklist

Do every item. Each one is a real reason people bounce.

- [x] **GitHub handle filled in** — set to `muguang1224` in `README.md`, `package.json`, `src/crawl.js`, `src/emit.js`, `CONTRIBUTING.md`. Change it if you publish under a different account.
- [ ] **npm name is actually yours.** Run `npm view docs2mcp version`. If it 404s, the name is free — publish immediately to claim it. If it exists, pick `docs2mcp-cli` / `@you/docs2mcp` and update the README.
- [ ] **`npm test` is green** on a clean clone
- [ ] **`npx` path works end to end** — `npx . <some real docs site>` from a machine that is not yours
- [ ] **Demo GIF in the README** — see `DEMO.md`. This is not optional.
- [ ] **Social preview image uploaded** (repo → Settings → Social preview)
- [ ] **Repo description** filled in: *Turn any documentation site into an MCP server. One command, zero dependencies.*
- [ ] **Topics set**: `mcp`, `model-context-protocol`, `llm`, `ai`, `documentation`, `rag`, `cli`, `crawler`, `claude`, `cursor`
- [ ] **LICENSE visible** in the About sidebar (GitHub detects it automatically)
- [ ] **Issues enabled**, with the templates in `.github/ISSUE_TEMPLATE/`
- [ ] **You have 2–3 hours free right after posting** — the first hour decides the rest

---

## Part 2 — Where to post, in this order

Post **one place at a time**, 45–90 minutes apart, and only after the previous one settles. Simultaneous posting looks like spam and gets you banned.

| Order | Where | Why |
|---|---|---|
| 1 | **Hacker News** (`Show HN`) | Highest ceiling by far. Also the harshest. |
| 2 | **Reddit** — `r/LLMDevs`, `r/mcp`, `r/ClaudeAI`, `r/coolgithubprojects` | Read each sub's self-promotion rules first. Some require a non-link post. |
| 3 | **X / Twitter** | Thread with the GIF. Tag nothing, just post. |
| 4 | **V2EX** (`分享创造` node) + **掘金** + **即刻** | Chinese audience, fast and generous feedback, less brutal than HN |
| 5 | **MCP community** — the official Discord / GitHub discussions, `awesome-mcp-servers` PR | Slow burn but the most *qualified* audience |

**Timing.** Hacker News: Tuesday–Thursday, 08:00–10:00 US Eastern. Avoid Friday afternoons and weekends — the front page moves slower but so does attention.

---

## Part 3 — Copy

### Hacker News

**Title** (pick one, don't overthink it):

```
Show HN: docs2mcp – Turn any docs site into an MCP server in one command
Show HN: I made a zero-dependency tool that turns docs sites into MCP servers
Show HN: docs2mcp – Local MCP server from any documentation site, no API key
```

**URL:** your GitHub repo.

**First comment** — post it yourself immediately. This is where the real conversation happens:

> Author here. I built this because I kept watching agents hallucinate API signatures against docs they'd only seen one page of.
>
> It crawls a docs site (sitemap if there is one, otherwise BFS within the start path), converts pages to Markdown, splits them into heading-aware passages, and writes a self-contained MCP server — `server.mjs` + `index.json`. Search is BM25, not embeddings, which is a deliberate choice: for a few hundred pages it's deterministic, instant, offline, and needs no vector DB.
>
> Two things I'd flag as honest limitations:
> - It's regex HTML parsing, not a DOM. It handles the common doc generators but pathological markup will produce noisy output.
> - Client-rendered docs with no server-rendered content crawl as empty. It reports how many pages it skipped, but it can't fix that.
>
> CJK docs work (character + bigram tokenization) because I needed it for Chinese docs and the usual word-splitting silently fails there.
>
> Happy to answer anything, and I'll ship fixes live during this thread if you hit something.

Why this works: it states the motivation, explains one non-obvious decision, **names its own weaknesses first**, and offers to fix things. HN punishes hype and rewards candor.

### Reddit

Use the same body, then adjust per sub. For `r/coolgithubprojects` keep it short:

```
**docs2mcp** — turn any documentation site into an MCP server.

npx docs2mcp https://docs.example.com

Zero dependencies, no API key, no vector DB. Writes a self-contained MCP server (BM25 search + full-page reads) that you point your agent at. Index is a JSON file you can diff and commit.

Honest limitations in the README — regex HTML parsing, no auth, static HTML only.
```

### X / Twitter

```
Your agent guesses API signatures because it only ever saw one docs page.

docs2mcp crawls the whole docs site and gives your agent a local MCP server:

  npx docs2mcp https://docs.stripe.com

• zero dependencies
• no API key, no vector DB
• BM25 + full-page reads, every hit cites a URL
• CJK works

[GIF]
```

### 中文文案（V2EX / 掘金 / 即刻）

```
把任意文档站变成 MCP server，一条命令，零依赖。

npx docs2mcp https://docs.example.com

做的事很简单：抓 sitemap（没有就顺着链接爬）→ 抽正文 → 按标题切段 → 生成一个自包含的 MCP server。检索用 BM25，不做 embedding——几百页的量级，确定性检索又快又准，还不用部署向量库。

特意做了中文支持：中文字符 + 双字切分，所以「签名验证」能命中「验证 webhook 签名」，不会像常规分词那样静默失败。

已知问题都写在 README 的 Limitations 里：正则解析 HTML、不支持需要登录的私有文档、纯客户端渲染的站点抓不到内容。

欢迎试用和提 issue。
```

---

## Part 4 — The first hour

This is where launches succeed or die.

1. **Reply to every comment within 10 minutes.** Slow replies read as "author posted and left".
2. **When someone reports a bug, fix it live and reply with the commit.** This converts skeptics into stargazers faster than anything else. It is also the single most common pattern behind repos that break out.
3. **Never argue about a limitation.** Say "you're right, that's out of scope for v1, added to the roadmap" and move on.
4. **Don't ask for stars.** Not in the README's first screen, not in the post, not in replies. One quiet line at the very bottom of the README is the maximum.
5. **Do not ask friends to upvote.** HN detects voting rings and will kill the post permanently.

---

## Part 5 — The day after

The spike is not the win. Retention is.

| Day | Do this |
|---|---|
| +1 | Open a "Welcome — what should this support next?" issue. Every new stargazer is a potential contributor. |
| +2 | Ship one fix from the thread. Post it as a comment on the launch thread ("fixed the X you mentioned"). |
| +3 | Submit to `awesome-mcp-servers` and 2–3 other relevant lists. |
| +7 | Write a short "what I learned launching this" post. It gets a second, smaller wave and ranks for your name forever. |
| +14 | If nobody has opened an issue yet, **your README's limitations section is doing its job** — or nobody is using it. Check npm download counts to tell which. |

### What to actually measure

Stars are vanity. Watch these instead:

- **npm weekly downloads** — the only number that means someone is using it
- **Issues opened by strangers** — the only number that means someone cares
- **Repeat visitors to the repo** (via your GitHub traffic tab)
- **"Used by" links on GitHub** — the strongest signal a project is real

If downloads are flat after two weeks but stars grew, you got a launch, not a project. That's fine — it's the normal outcome, and the asset you keep is the repo in your portfolio.

---

## Part 6 — What not to do

- ❌ Buy stars, use star-exchange groups, or trade upvotes. GitHub and HN both detect it; the reputational cost is permanent.
- ❌ Post the same link to 8 subreddits in an hour.
- ❌ Launch without the GIF. You get one first impression.
- ❌ Put "⭐ Star this repo!" as the first line of the README. It converts worse than showing the tool working.
- ❌ Claim it's faster/better than a named competitor unless you actually measured it.

---

## Afterword

If this lands 30 stars, that is a **success** — 30 strangers found it useful enough to click. That's 30 more than the overwhelming majority of repos ever get, and it's the first 30 of a compounding curve if you keep answering issues.

If it lands 0, you still own a working tool, a clean repo, and a README you can point at in a job interview. That asset does not disappear.
