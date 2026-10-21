/**
 * Small shared helpers. No dependencies.
 */

const useColor =
  process.stdout.isTTY &&
  !process.env.NO_COLOR &&
  process.env.TERM !== 'dumb';

const wrap = (open, close) => (s) => (useColor ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};

export function log(...args) {
  process.stderr.write(args.join(' ') + '\n');
}

export function warn(...args) {
  process.stderr.write(c.yellow('warn') + ' ' + args.join(' ') + '\n');
}

export function fail(msg) {
  process.stderr.write(c.red('error') + ' ' + msg + '\n');
  process.exitCode = 1;
}

/** Strip fragments and normalize the trailing slash so URLs dedupe correctly. */
export function normalizeUrl(input, base) {
  let u;
  try {
    u = base ? new URL(input, base) : new URL(input);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  // Drop common tracking params so the same page is not crawled twice.
  for (const key of [...u.searchParams.keys()]) {
    if (/^(utm_|ref|source|fbclid|gclid)/i.test(key)) u.searchParams.delete(key);
  }
  // Normalize "/docs/" and "/docs" only when there is no query string.
  if (!u.search && u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/+$/, '');
  }
  return u.toString();
}

export function originOf(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

/**
 * Derive a crawl scope from the start URL: the first path segment.
 * https://x.dev/docs/v2/intro -> "/docs/"
 * https://x.dev/intro         -> "/"
 */
export function scopeOf(url) {
  const seg = new URL(url).pathname.split('/').filter(Boolean)[0];
  return seg ? `/${seg}/` : '/';
}

export function withinScope(url, scope) {
  if (scope === '/') return true;
  const p = new URL(url).pathname;
  return p === scope.slice(0, -1) || p.startsWith(scope);
}

/** Run `fn` over items with bounded concurrency, preserving input order. */
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function fetchText(url, { timeout = 15000, userAgent, signal } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'user-agent': userAgent,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en,zh-CN;q=0.8',
      },
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const type = res.headers.get('content-type') || '';
    if (!/text\/html|application\/xml|text\/plain|application\/xhtml/i.test(type)) {
      const err = new Error(`unsupported content-type: ${type.split(';')[0]}`);
      err.skipped = true;
      throw err;
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

export function formatMs(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function bytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

/** Very small YAML/JSON-free config writer is not needed; but a stable stringifier is. */
export function json(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

const SKIP_HOST_LABELS = new Set([
  'www',
  'docs',
  'doc',
  'documentation',
  'developer',
  'developers',
  'dev',
  'api',
  'reference',
  'ref',
  'help',
  'guide',
  'learn',
  'site',
  'readme',
]);

/**
 * A short, human name for a docs host.
 *   docs.stripe.com -> stripe
 *   developer.mozilla.org -> mozilla
 *   vitejs.dev -> vitejs
 *   127.0.0.1 / localhost -> docs
 */
export function serverNameFor(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
    return 'docs';
  }
  const labels = host.split('.').filter(Boolean);
  const meaningful = labels.filter((label) => !SKIP_HOST_LABELS.has(label));
  const pick = meaningful[0] || labels[0] || 'docs';
  const slug = pick.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'docs';
}
