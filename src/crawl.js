/**
 * Crawl a documentation site.
 *
 * Two strategies, picked automatically:
 *   1. sitemap  - if the site publishes one with enough in-scope URLs, use it. Fast + complete.
 *   2. links    - otherwise breadth-first walk following <a href> within scope.
 *
 * Politeness: reads /robots.txt and skips disallowed paths.
 */

import {
  fetchText,
  normalizeUrl,
  originOf,
  scopeOf,
  withinScope,
  pool,
  c,
  log,
  warn,
} from './util.js';

export const DEFAULT_UA = 'docs2mcp/0.1 (+https://github.com/muguang1224/docs2mcp)';

const SKIP_EXT =
  /\.(png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|map|woff2?|ttf|eot|otf|mp4|webm|mp3|wav|zip|gz|tar|tgz|rar|7z|pdf|docx?|xlsx?|pptx?|exe|dmg|apk|bin|iso|wasm)$/i;

const NON_DOC_PATH =
  /^\/(?:login|signin|sign-in|signup|sign-up|register|logout|cart|checkout|pricing|blog\/page|search|404|500)(\/|$)/i;

export function parseRobots(txt) {
  const rules = [];
  let applies = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      applies = value === '*';
      continue;
    }
    if (!applies) continue;
    if (key === 'disallow' || key === 'allow') {
      rules.push({ path: value, disallow: key === 'disallow' });
    }
  }
  return rules;
}

export function robotsAllows(pathname, rules) {
  if (!rules.length) return true;
  let best = null;
  for (const rule of rules) {
    if (!rule.path) continue;
    if (!pathname.startsWith(rule.path)) continue;
    if (!best || rule.path.length > best.path.length) best = rule;
  }
  return !best || !best.disallow;
}

async function loadRobots(origin, opts) {
  try {
    const txt = await fetchText(`${origin}/robots.txt`, { ...opts, timeout: 8000 });
    return parseRobots(txt);
  } catch {
    return [];
  }
}

function extractLocTags(xml) {
  const out = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml))) out.push(m[1].replace(/&amp;/g, '&'));
  return out;
}

async function collectSitemap(url, opts, seen, depth = 0) {
  if (depth > 2 || seen.has(url)) return [];
  seen.add(url);
  let xml;
  try {
    xml = await fetchText(url, { ...opts, timeout: 12000 });
  } catch {
    return [];
  }
  const locs = extractLocTags(xml);
  if (/<sitemapindex\b/i.test(xml)) {
    const nested = await pool(locs.slice(0, 10), 4, (child) =>
      collectSitemap(child, opts, seen, depth + 1),
    );
    return nested.flat();
  }
  return locs;
}

export async function discoverSitemapUrls(startUrl, opts) {
  const origin = originOf(startUrl);
  const seen = new Set();
  const candidates = [];

  // Sitemap locations declared in robots.txt come first, they are authoritative.
  try {
    const robotsTxt = await fetchText(`${origin}/robots.txt`, { ...opts, timeout: 8000 });
    for (const line of robotsTxt.split(/\r?\n/)) {
      const m = /^\s*sitemap\s*:\s*(\S+)\s*$/i.exec(line);
      if (m) candidates.push(m[1]);
    }
  } catch {
    /* no robots.txt is fine */
  }
  candidates.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`);

  for (const candidate of [...new Set(candidates)].slice(0, 4)) {
    const urls = await collectSitemap(candidate, opts, seen);
    if (urls.length) return urls;
  }
  return [];
}

export function extractLinks(html, pageUrl) {
  const found = new Set();
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const normalized = normalizeUrl(m[1], pageUrl);
    if (normalized) found.add(normalized);
  }
  return [...found];
}

/**
 * @param {object} options
 * @param {string} options.startUrl
 * @param {number} [options.maxPages]
 * @param {number} [options.maxDepth]
 * @param {number} [options.concurrency]
 * @param {number} [options.timeout]
 * @param {boolean} [options.all] ignore the /first-segment/ scope restriction
 * @param {string} [options.include] regex, keep only matching URLs
 * @param {string} [options.exclude] regex, drop matching URLs
 * @param {boolean} [options.respectRobots]
 * @param {string} [options.userAgent]
 * @param {(ev: object) => void} [options.onEvent]
 */
export async function crawl(options) {
  const {
    startUrl,
    maxPages = 150,
    maxDepth = 4,
    concurrency = 6,
    timeout = 15000,
    all = false,
    include,
    exclude,
    respectRobots = true,
    userAgent = DEFAULT_UA,
    onEvent = () => {},
  } = options;

  const origin = originOf(startUrl);
  const scope = all ? '/' : scopeOf(startUrl);
  const includeRe = include ? new RegExp(include, 'i') : null;
  const excludeRe = exclude ? new RegExp(exclude, 'i') : null;

  const accept = (url) => {
    if (!url) return false;
    if (originOf(url) !== origin) return false;
    if (!withinScope(url, scope)) return false;
    const { pathname } = new URL(url);
    if (SKIP_EXT.test(pathname)) return false;
    if (NON_DOC_PATH.test(pathname)) return false;
    if (includeRe && !includeRe.test(url)) return false;
    if (excludeRe && excludeRe.test(url)) return false;
    return true;
  };

  const fetchOpts = { timeout, userAgent };
  const robots = respectRobots ? await loadRobots(origin, fetchOpts) : [];
  const robotsOk = (url) => robotsAllows(new URL(url).pathname, robots);

  const start = normalizeUrl(startUrl);
  if (!start) throw new Error(`not a valid http(s) URL: ${startUrl}`);

  // --- strategy 1: sitemap -------------------------------------------------
  let sitemapUrls = [];
  try {
    sitemapUrls = (await discoverSitemapUrls(start, fetchOpts))
      .map((u) => normalizeUrl(u))
      .filter((u) => accept(u) && robotsOk(u));
  } catch {
    sitemapUrls = [];
  }
  sitemapUrls = [...new Set(sitemapUrls)].slice(0, maxPages);

  const usingSitemap = sitemapUrls.length >= 3;
  onEvent({
    type: 'plan',
    strategy: usingSitemap ? 'sitemap' : 'links',
    scope,
    origin,
    queued: usingSitemap ? sitemapUrls.length : null,
  });

  const pages = [];
  const failed = [];
  const visited = new Set();

  if (usingSitemap) {
    const targets = sitemapUrls.includes(start) ? sitemapUrls : [start, ...sitemapUrls].slice(0, maxPages);
    const started = Date.now();
    for (let i = 0; i < targets.length; i += concurrency) {
      const batch = targets.slice(i, i + concurrency).filter((u) => !visited.has(u));
      for (const u of batch) visited.add(u);
      const results = await pool(batch, concurrency, async (url) => {
        const t0 = Date.now();
        try {
          const html = await fetchText(url, fetchOpts);
          return { url, html, ms: Date.now() - t0, ok: true };
        } catch (err) {
          return { url, ms: Date.now() - t0, ok: false, error: err.message };
        }
      });
      for (const r of results) {
        if (r.ok) {
          pages.push({ url: r.url, html: r.html });
          onEvent({ type: 'page', ok: true, url: r.url, ms: r.ms, index: pages.length, total: targets.length });
        } else {
          failed.push({ url: r.url, error: r.error });
          onEvent({ type: 'page', ok: false, url: r.url, ms: r.ms, error: r.error, index: pages.length + failed.length, total: targets.length });
        }
      }
    }
    onEvent({ type: 'done', strategy: 'sitemap', pages: pages.length, failed: failed.length, ms: Date.now() - started });
    return { pages, failed, strategy: 'sitemap', scope, origin };
  }

  // --- strategy 2: breadth-first link walk ---------------------------------
  const started = Date.now();
  let frontier = [{ url: start, depth: 0, seed: true }];
  visited.add(start);
  let seedWarningShown = false;

  while (frontier.length > 0 && pages.length < maxPages) {
    const room = maxPages - pages.length;
    const batch = frontier.splice(0, Math.min(concurrency, room)).filter((it) => robotsOk(it.url));
    if (!batch.length) break;

    const results = await pool(batch, concurrency, async (item) => {
      const t0 = Date.now();
      try {
        const html = await fetchText(item.url, fetchOpts);
        return { ...item, html, ms: Date.now() - t0, ok: true };
      } catch (err) {
        return { ...item, ms: Date.now() - t0, ok: false, error: err.message };
      }
    });

    for (const r of results) {
      if (!r.ok) {
        failed.push({ url: r.url, error: r.error });
        onEvent({ type: 'page', ok: false, url: r.url, ms: r.ms, error: r.error, index: pages.length + failed.length, total: null });
        continue;
      }
      pages.push({ url: r.url, html: r.html });
      onEvent({ type: 'page', ok: true, url: r.url, ms: r.ms, index: pages.length, total: null });

      // The start URL is always fetched so link discovery can begin, but if the
      // user's own filters exclude it, say so instead of silently indexing it.
      if (r.seed && !seedWarningShown && !accept(r.url)) {
        seedWarningShown = true;
        warn(
          `start URL does not match --include/--exclude; it is indexed anyway so link discovery can run`,
        );
      }

      if (r.depth >= maxDepth) continue;
      for (const link of extractLinks(r.html, r.url)) {
        if (visited.has(link) || !accept(link)) continue;
        visited.add(link);
        frontier.push({ url: link, depth: r.depth + 1 });
      }
      if (frontier.length > maxPages * 6) {
        warn(`link frontier capped at ${maxPages * 6} entries; raise --max-pages for full coverage`);
        frontier = frontier.slice(0, maxPages * 6);
      }
    }
  }

  onEvent({ type: 'done', strategy: 'links', pages: pages.length, failed: failed.length, ms: Date.now() - started });
  return { pages, failed, strategy: 'links', scope, origin };
}

export { c, log };
