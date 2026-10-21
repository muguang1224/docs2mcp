/**
 * End-to-end: crawl the fixture site -> build an index -> emit a server ->
 * drive the emitted runtime through the MCP JSON-RPC surface.
 *
 * The stdio bootstrap (server.mjs) is a 40-line adapter; everything it calls is
 * exercised here. See `npm run smoke` for a real subprocess check.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { startFixture } from './fixture-server.js';
import { crawl } from '../src/crawl.js';
import { buildIndex } from '../src/indexer.js';
import { emit } from '../src/emit.js';
import { createRuntime, tokenize } from '../src/mcp-runtime.js';

test('tokenize splits latin and CJK without spaces', () => {
  const tokens = tokenize('verify HMAC-SHA256 签名验证');
  assert.ok(tokens.includes('hmac'));
  assert.ok(tokens.includes('hmac-sha256'));
  assert.ok(tokens.includes('sha256'));
  assert.ok(tokens.includes('签名'), 'CJK bigram must be produced');
  assert.ok(tokens.includes('名验'));
  assert.ok(tokens.includes('验'));

  // Bigrams are what let a space-free Chinese query match.
  const query = new Set(tokenize('签名验证'));
  const doc = new Set(tokenize('使用签名密钥验证 webhook'));
  assert.ok([...query].some((t) => doc.has(t)));
});

test('end to end: fixture site becomes a working MCP server', async (t) => {
  const fixture = await startFixture(0);
  const outDir = await mkdtemp(join(process.cwd(), 'tmp-e2e-'));
  t.after(async () => {
    await fixture.close();
    await rm(outDir, { recursive: true, force: true });
  });

  const startUrl = `${fixture.origin}/docs/getting-started.html`;

  // ---------------------------------------------------------------- crawl
  const result = await crawl({ startUrl, maxPages: 20, concurrency: 2 });
  assert.equal(result.strategy, 'sitemap', 'the fixture publishes a sitemap, it must be used');

  const urls = result.pages.map((p) => p.url).sort();
  assert.equal(urls.length, 4, `expected 4 in-scope pages, got ${JSON.stringify(urls)}`);
  assert.ok(
    urls.some((u) => u.endsWith('/docs/zh/quickstart.html')),
    'the Chinese page must be crawled',
  );
  assert.ok(
    !urls.some((u) => u.endsWith('/pricing.html')),
    '/pricing.html is outside the /docs/ scope and must be excluded',
  );

  // ---------------------------------------------------------------- index
  const index = buildIndex({
    pages: result.pages,
    meta: { source: startUrl, strategy: result.strategy },
  });
  assert.equal(index.stats.pages, 4);
  assert.ok(index.stats.chunks >= 4, `expected several passages, got ${index.stats.chunks}`);
  assert.ok(
    index.pages.every((p) => !p.markdown.includes('All rights reserved')),
    'the site footer must not leak into page content',
  );

  // ---------------------------------------------------------------- emit
  const written = await emit({ index, outDir, source: startUrl });
  for (const name of ['server.mjs', 'runtime.mjs', 'index.json', 'mcp.json', 'README.md']) {
    const info = await stat(join(outDir, name));
    assert.ok(info.size > 0, `${name} must be written and non-empty`);
  }

  const serverCode = await readFile(join(outDir, 'server.mjs'), 'utf8');
  assert.match(serverCode, /from '\.\/runtime\.mjs'/, 'server.mjs must import the sibling runtime');

  const runtimeCode = await readFile(join(outDir, 'runtime.mjs'), 'utf8');
  const sourceRuntime = await readFile(new URL('../src/mcp-runtime.js', import.meta.url), 'utf8');
  assert.equal(runtimeCode, sourceRuntime, 'emitted runtime must be identical to the source');

  const emittedIndex = JSON.parse(await readFile(join(outDir, 'index.json'), 'utf8'));
  assert.equal(emittedIndex.source, startUrl);

  // ---------------------------------------------------------------- protocol
  const runtime = createRuntime(emittedIndex);

  const init = runtime.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
  });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'docs2mcp');
  assert.ok(init.result.capabilities.tools);
  assert.match(init.result.instructions, /4 pages/);

  assert.equal(
    runtime.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    null,
    'notifications must never produce a response',
  );

  const list = runtime.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(
    list.result.tools.map((tool) => tool.name).sort(),
    ['get_page', 'list_pages', 'search_docs'],
  );

  // English query
  const search = runtime.handle({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'search_docs', arguments: { query: 'verify webhook signature hmac', limit: 3 } },
  });
  const searchText = search.result.content[0].text;
  assert.ok(!search.result.isError, searchText);
  assert.match(searchText, /docs\/webhooks\.html/, 'the webhook page must rank first');
  assert.match(searchText, /hmac|signature/i);

  // Chinese query
  const zh = runtime.handle({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'search_docs', arguments: { query: '签名验证', limit: 3 } },
  });
  assert.match(
    zh.result.content[0].text,
    /docs\/zh\/quickstart\.html/,
    'the Chinese page must be reachable with a Chinese query',
  );

  // Full page
  const page = runtime.handle({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'get_page', arguments: { url: `${fixture.origin}/docs/webhooks.html` } },
  });
  const pageText = page.result.content[0].text;
  assert.match(pageText, /Verifying webhook signatures/);
  assert.match(pageText, /```js/);
  assert.match(pageText, /timingSafeEqual/);
  assert.match(pageText, /\| immediate \|/, 'tables must survive extraction');

  // Inventory
  const inventory = runtime.handle({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: { name: 'list_pages', arguments: {} },
  });
  assert.match(inventory.result.content[0].text, /4 page\(s\) indexed/);

  // Error paths
  const missing = runtime.handle({
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: { name: 'get_page', arguments: { url: 'https://nope.example/none' } },
  });
  assert.equal(missing.result.isError, true);

  const unknownTool = runtime.handle({
    jsonrpc: '2.0',
    id: 8,
    method: 'tools/call',
    params: { name: 'nope', arguments: {} },
  });
  assert.equal(unknownTool.error.code, -32602);

  const unknownMethod = runtime.handle({ jsonrpc: '2.0', id: 9, method: 'does/not/exist' });
  assert.equal(unknownMethod.error.code, -32601);

  // Every response echoes the request id and the JSON-RPC version.
  for (const response of [init, list, search, zh, page, inventory]) {
    assert.equal(response.jsonrpc, '2.0');
    assert.ok(response.id !== undefined);
  }
});
