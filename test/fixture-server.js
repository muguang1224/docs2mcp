/**
 * A tiny fake documentation site used by the test suite (and handy for demos
 * without touching the network).
 *
 *   node test/fixture-server.js        -> prints the URL, serves forever
 */

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const DOCS = {
  '/docs/getting-started.html': {
    title: 'Getting started | Acme Docs',
    description: 'Install the Acme SDK and make your first API call in under a minute.',
    body: `
      <h1>Getting started</h1>
      <p>Install the SDK with your package manager of choice.</p>
      <pre><code class="language-bash">npm install acme-sdk</code></pre>
      <p>Then create a client with your secret API key.</p>
      <pre><code class="language-js">import { Acme } from 'acme-sdk';
const acme = new Acme({ apiKey: process.env.ACME_KEY });</code></pre>
      <h2>Your first request</h2>
      <p>Every resource lives under a project. Call <code>acme.projects.create</code> to make one.</p>
      <ul>
        <li>Keys are scoped per environment.</li>
        <li>Requests are idempotent when you pass an idempotency key.</li>
      </ul>
    `,
  },
  '/docs/webhooks.html': {
    title: 'Webhooks | Acme Docs',
    description: 'Receive and verify Acme webhook events.',
    body: `
      <h1>Webhooks</h1>
      <p>Acme sends a signed POST request to your endpoint for every event.</p>
      <h2>Verifying webhook signatures</h2>
      <p>Compute an HMAC-SHA256 of the raw request body using your signing secret,
      then compare it to the <code>Acme-Signature</code> header in constant time.</p>
      <pre><code class="language-js">const expected = crypto
  .createHmac('sha256', secret)
  .update(rawBody)
  .digest('hex');
if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
  throw new Error('invalid signature');
}</code></pre>
      <h2>Retry policy</h2>
      <table>
        <thead><tr><th>Attempt</th><th>Delay</th></tr></thead>
        <tbody>
          <tr><td>1</td><td>immediate</td></tr>
          <tr><td>2</td><td>30 seconds</td></tr>
          <tr><td>3</td><td>5 minutes</td></tr>
        </tbody>
      </table>
      <p>See <a href="/docs/errors.html">error codes</a> if deliveries keep failing.</p>
    `,
  },
  '/docs/errors.html': {
    title: 'Error codes | Acme Docs',
    description: 'Every error code the Acme API can return.',
    body: `
      <h1>Error codes</h1>
      <p>The API returns a stable machine-readable <code>code</code> field.</p>
      <table>
        <thead><tr><th>Code</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td>rate_limited</td><td>Too many requests, back off and retry.</td></tr>
          <tr><td>invalid_api_key</td><td>The key is missing, revoked, or for another environment.</td></tr>
          <tr><td>idempotency_conflict</td><td>The same idempotency key was reused with a different body.</td></tr>
        </tbody>
      </table>
      <h2>Rate limits</h2>
      <p>Limits are per project and reset every minute. Check the
      <code>Acme-RateLimit-Remaining</code> header before you burst.</p>
    `,
  },
  '/docs/zh/quickstart.html': {
    title: '快速开始 | Acme 文档',
    description: '在几分钟内安装 Acme SDK 并完成第一次接口调用。',
    body: `
      <h1>快速开始</h1>
      <p>使用包管理器安装 SDK。</p>
      <pre><code class="language-bash">npm install acme-sdk</code></pre>
      <h2>验证 webhook 签名</h2>
      <p>使用签名密钥对原始请求体做 HMAC-SHA256 计算，再与请求头中的签名值做恒定时间比较。</p>
      <h2>错误码</h2>
      <p>当请求过于频繁时会返回 <code>rate_limited</code>，请退避后重试。</p>
    `,
  },
  '/pricing.html': {
    title: 'Pricing | Acme',
    description: 'Plans and pricing.',
    body: `<h1>Pricing</h1><p>This page must never appear in the index: it is outside the /docs/ scope.</p>`,
  },
};

function render(slug, page) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${page.title}</title>
  <meta name="description" content="${page.description}">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <nav class="sidebar">
    <a href="/docs/getting-started.html">Getting started</a>
    <a href="/docs/webhooks.html">Webhooks</a>
    <a href="/docs/errors.html">Error codes</a>
    <a href="/docs/zh/quickstart.html">中文快速开始</a>
  </nav>
  <main>${page.body}</main>
  <footer>© Acme Inc. All rights reserved.</footer>
</body>
</html>`;
}

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${Object.keys(DOCS)
  .map((path) => `  <url><loc>{ORIGIN}${path}</loc></url>`)
  .join('\n')}
  <url><loc>{ORIGIN}/pricing.html</loc></url>
</urlset>`;

export function createFixtureServer() {
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const origin = `http://${req.headers.host}`;
    const send = (status, type, body) => {
      res.writeHead(status, { 'content-type': type });
      res.end(body);
    };

    if (url.pathname === '/robots.txt') {
      send(200, 'text/plain', 'User-agent: *\nAllow: /\n');
      return;
    }
    if (url.pathname === '/sitemap.xml') {
      send(200, 'application/xml', SITEMAP.replaceAll('{ORIGIN}', origin));
      return;
    }
    if (url.pathname === '/' || url.pathname === '/docs/' || url.pathname === '/docs') {
      send(
        200,
        'text/html',
        `<!doctype html><html><head><title>Acme Docs</title></head><body><main>
         <h1>Acme documentation</h1>
         <ul>${Object.keys(DOCS)
           .filter((p) => p.startsWith('/docs/'))
           .map((p) => `<li><a href="${p}">${p}</a></li>`)
           .join('')}</ul></main></body></html>`,
      );
      return;
    }
    const page = DOCS[url.pathname];
    if (page) {
      send(200, 'text/html; charset=utf-8', render(url.pathname, page));
      return;
    }
    send(404, 'text/plain', 'not found');
  });
}

export function startFixture(port = 0) {
  const server = createFixtureServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        port: address.port,
        origin: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const fixture = await startFixture(Number(process.env.PORT) || 8787);
  process.stdout.write(`fixture docs site: ${fixture.origin}/docs/getting-started.html\n`);
  process.stdout.write('press Ctrl+C to stop\n');
}
