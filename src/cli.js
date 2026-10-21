#!/usr/bin/env node
/**
 * docs2mcp CLI.
 *
 *   npx docs2mcp https://docs.example.com
 */

import { readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { crawl, DEFAULT_UA } from './crawl.js';
import { buildIndex } from './indexer.js';
import { emit, directoryIsEmptyOrMissing } from './emit.js';
import { c, log, bytes, formatMs, fail, serverNameFor } from './util.js';

const HELP = `
${c.bold('docs2mcp')} — turn any documentation site into an MCP server.

${c.bold('Usage')}
  npx docs2mcp <url> [options]

${c.bold('Examples')}
  npx docs2mcp https://docs.stripe.com
  npx docs2mcp https://vitejs.dev/guide --max-pages 60 -o ./vite-mcp
  npx docs2mcp https://docs.example.com --all --include "/api/" --exclude "/blog/"

${c.bold('Options')}
  -o, --out <dir>      Output directory (default: ./<hostname>-mcp)
      --max-pages <n>  Maximum pages to crawl (default: 150)
      --max-depth <n>  Link-follow depth when no sitemap is found (default: 4)
      --include <re>   Only crawl URLs matching this regex
      --exclude <re>   Skip URLs matching this regex
      --all            Crawl the whole host, not just the first path segment
      --concurrency <n>Parallel requests (default: 6)
      --timeout <ms>   Per-request timeout (default: 15000)
      --no-robots      Ignore robots.txt (respect it if you can)
      --force          Write into a non-empty output directory
      --verbose        Print one line per page (useful in CI)
  -h, --help           Show this help
  -v, --version        Show the version

${c.bold('What you get')}
  <out>/server.mjs   zero-dependency MCP server over stdio
  <out>/index.json   the crawled + chunked index
  <out>/mcp.json     ready-to-paste client config
`;

const FLAGS = new Set(['help', 'version', 'all', 'no-robots', 'force', 'verbose']);
const VALUES = new Set([
  'out',
  'max-pages',
  'max-depth',
  'include',
  'exclude',
  'concurrency',
  'timeout',
  'ua',
]);

const ALIASES = { o: 'out', h: 'help', v: 'version' };

export function parseArgs(argv) {
  const opts = {
    maxPages: 150,
    maxDepth: 4,
    concurrency: 6,
    timeout: 15000,
    all: false,
    robots: true,
    force: false,
    include: null,
    exclude: null,
    out: null,
    ua: DEFAULT_UA,
    help: false,
    version: false,
  };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('-')) {
      positional.push(raw);
      continue;
    }
    const eq = raw.indexOf('=');
    const rawFlag = (eq === -1 ? raw : raw.slice(0, eq)).replace(/^--?/, '');
    const flag = ALIASES[rawFlag] || rawFlag;
    const inlineValue = eq === -1 ? null : raw.slice(eq + 1);

    if (FLAGS.has(flag)) {
      if (flag === 'no-robots') opts.robots = false;
      else opts[flag] = true;
      continue;
    }

    if (!VALUES.has(flag)) {
      throw new Error(`unknown option: ${raw}`);
    }

    const value = inlineValue !== null ? inlineValue : argv[(i += 1)];
    if (value === undefined) throw new Error(`missing value for --${flag}`);

    switch (flag) {
      case 'out':
        opts.out = value;
        break;
      case 'max-pages':
        opts.maxPages = Math.max(1, Number(value) || 0);
        break;
      case 'max-depth':
        opts.maxDepth = Math.max(0, Number(value) || 0);
        break;
      case 'concurrency':
        opts.concurrency = Math.min(Math.max(1, Number(value) || 1), 16);
        break;
      case 'timeout':
        opts.timeout = Math.max(1000, Number(value) || 15000);
        break;
      case 'include':
        opts.include = value;
        break;
      case 'exclude':
        opts.exclude = value;
        break;
      case 'ua':
        opts.ua = value;
        break;
      default:
        break;
    }
  }

  return { opts, positional };
}

function defaultOutDir(url) {
  return `./${serverNameFor(new URL(url).hostname)}-mcp`;
}

function makeProgress(mode) {
  const enabled = mode !== 'off';
  let lastWidth = 0;

  const describe = (ev) =>
    ev.ok
      ? `${c.green('✓')} [${String(ev.index).padStart(3)}/${ev.total ? String(ev.total).padStart(3) : '  ?'}] ` +
        `${formatMs(ev.ms).padStart(6)}  ${ev.url}`
      : `${c.red('✗')} [${String(ev.index).padStart(3)}/${ev.total ? String(ev.total).padStart(3) : '  ?'}] ` +
        `${formatMs(ev.ms).padStart(6)}  ${ev.url} ${c.red(ev.error || '')}`;

  return {
    event(ev) {
      if (!enabled) return;
      if (ev.type === 'plan') {
        process.stderr.write(
          `${c.gray('strategy')}  ${ev.strategy}${ev.queued ? ` (${ev.queued} urls)` : ''}   ` +
            `${c.gray('scope')}  ${ev.scope}\n\n`,
        );
        return;
      }
      if (ev.type !== 'page') return;

      const line = describe(ev);
      if (mode === 'lines') {
        process.stderr.write(line + '\n');
        return;
      }
      const clipped = line.length > 120 ? line.slice(0, 119) + '…' : line;
      process.stderr.write('\r' + clipped + '\x1b[K');
      lastWidth = clipped.length;
    },
    finish() {
      if (!enabled || mode !== 'tty' || !lastWidth) return;
      process.stderr.write('\r' + ' '.repeat(lastWidth) + '\r');
      lastWidth = 0;
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    fail(err.message);
    log(c.gray('run `docs2mcp --help` for usage'));
    process.exit(1);
  }
  const { opts, positional } = parsed;

  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  if (opts.version) {
    log(pkg.version);
    return;
  }
  if (opts.help || positional.length === 0) {
    process.stdout.write(HELP);
    if (positional.length === 0 && !opts.help) process.exitCode = 1;
    return;
  }

  const input = positional[0];
  let startUrl;
  try {
    const url = new URL(input.includes('://') ? input : `https://${input}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol');
    startUrl = url.toString();
  } catch {
    fail(`not a valid http(s) URL: ${input}`);
    process.exit(1);
  }

  const outDir = resolve(opts.out || defaultOutDir(startUrl));

  if (!opts.force && !(await directoryIsEmptyOrMissing(outDir))) {
    fail(`output directory is not empty: ${outDir}`);
    log(c.gray('pass --force to overwrite, or choose another -o path'));
    process.exit(1);
  }

  log('');
  log(`${c.bold('docs2mcp')} ${c.gray('v' + pkg.version)}`);
  log(`${c.cyan('→')} ${startUrl}`);
  log('');

  const progress = makeProgress(process.stderr.isTTY ? 'tty' : opts.verbose ? 'lines' : 'off');
  const started = Date.now();

  let result;
  try {
    result = await crawl({
      startUrl,
      maxPages: opts.maxPages,
      maxDepth: opts.maxDepth,
      concurrency: opts.concurrency,
      timeout: opts.timeout,
      all: opts.all,
      include: opts.include,
      exclude: opts.exclude,
      respectRobots: opts.robots,
      userAgent: opts.ua,
      onEvent: (ev) => progress.event(ev),
    });
  } catch (err) {
    progress.finish();
    fail(`crawl failed: ${err.message}`);
    process.exit(1);
  }
  progress.finish();

  if (result.pages.length === 0) {
    fail('no pages crawled');
    log(c.gray('the site may block automated requests, or the scope filter is too narrow'));
    log(c.gray('try: --all   or   --include "/docs/"'));
    process.exit(1);
  }

  const crawlMs = Date.now() - started;
  const strategyNote = result.strategy === 'sitemap' ? 'via sitemap' : 'via links';
  log(
    `${c.green('✓')} crawled ${c.bold(String(result.pages.length))} pages ${c.gray(`(${strategyNote}, ${formatMs(crawlMs)})`)}` +
      (result.failed.length ? `  ${c.yellow(`${result.failed.length} failed`)}` : ''),
  );

  for (const failure of result.failed.slice(0, 3)) {
    log(`  ${c.gray('·')} ${c.yellow(failure.url)} ${c.gray(failure.error)}`);
  }

  log('');
  const index = buildIndex({
    pages: result.pages,
    meta: { source: startUrl, strategy: result.strategy },
  });

  log(
    `${c.green('✓')} indexed ${c.bold(String(index.stats.pages))} pages → ` +
      `${c.bold(String(index.stats.chunks))} passages ${c.gray(`(${bytes(index.stats.chars)})`)}`,
  );

  const written = await emit({ index, outDir, source: startUrl });

  log('');
  log(`${c.green('✓')} wrote ${c.bold(relative(process.cwd(), written.dir) || '.')}`);
  for (const file of written.files) {
    log(`    ${file.name.padEnd(14)} ${c.gray(bytes(file.size))}`);
  }

  const name = serverNameFor(new URL(startUrl).hostname);
  const config = {
    mcpServers: {
      [name]: { command: 'node', args: [written.serverPath] },
    },
  };

  log('');
  log(c.bold('Add to your MCP client'));
  log(c.gray('  (Claude Desktop: claude_desktop_config.json · Cursor: .cursor/mcp.json)'));
  log('');
  for (const line of JSON.stringify(config, null, 2).split('\n')) {
    log('  ' + line);
  }
  log('');
  log(
    `${c.gray('Then ask your agent:')} ${c.cyan('"search the docs for …"')}`,
  );
  log('');
}

export { HELP };
