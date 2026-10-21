import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPage, decodeEntities } from '../src/extract.js';
import { splitSections, splitLong } from '../src/indexer.js';

test('decodeEntities handles named, decimal and hex entities', () => {
  assert.equal(decodeEntities('a &amp; b'), 'a & b');
  assert.equal(decodeEntities('&lt;div&gt;'), '<div>');
  assert.equal(decodeEntities('&#39;quoted&#39;'), "'quoted'");
  assert.equal(decodeEntities('&#x4e2d;&#x6587;'), '中文');
  assert.equal(decodeEntities('&unknown;'), '&unknown;');
  assert.equal(decodeEntities('100%'), '100%');
});

test('extractPage keeps prose, headings and fenced code, drops chrome', () => {
  const html = `<!doctype html><html><head>
    <title>Verifying webhooks | Acme Docs</title>
    <meta name="description" content="How to verify signatures.">
    </head><body>
    <nav><a href="/">Home</a> NavbarJunk</nav>
    <main>
      <h1>Verifying webhooks</h1>
      <p>Compute an HMAC and compare it in constant time.</p>
      <pre><code class="language-js">const a = 1;
const b = 2;</code></pre>
      <h2>Retry policy</h2>
      <p>See <a href="/docs/errors.html">errors</a>.</p>
    </main>
    <footer>FooterJunk</footer>
    </body></html>`;

  const { title, description, markdown } = extractPage(html, 'https://acme.dev/docs/webhooks');

  assert.equal(title, 'Verifying webhooks');
  assert.equal(description, 'How to verify signatures.');
  assert.match(markdown, /^# Verifying webhooks/m);
  assert.match(markdown, /^## Retry policy/m);
  assert.match(markdown, /```js\nconst a = 1;\nconst b = 2;\n```/);
  assert.match(markdown, /\[errors\]\(https:\/\/acme\.dev\/docs\/errors\.html\)/);
  assert.doesNotMatch(markdown, /NavbarJunk|FooterJunk/);
  assert.doesNotMatch(markdown, /<[a-z]+>/i);
});

test('extractPage keeps Chinese text and strips tags', () => {
  const html = `<html><head><title>快速开始</title></head><body><main>
    <h1>快速开始</h1><p>使用 <code>npm install</code> 安装 SDK。</p>
    </main></body></html>`;
  const { markdown } = extractPage(html, 'https://acme.dev/zh');
  assert.match(markdown, /快速开始/);
  assert.match(markdown, /`npm install`/);
});

test('splitSections respects heading boundaries and code fences', () => {
  const md = `# Title

intro text

## Install

run this

\`\`\`bash
# this hash is a comment, not a heading
npm i
\`\`\`

## Usage

done`;
  const sections = splitSections(md);
  const headings = sections.map((s) => s.heading);
  assert.ok(headings.includes('Install'));
  assert.ok(headings.includes('Usage'));
  assert.ok(sections.some((s) => s.text.includes('# this hash is a comment')));
});

test('splitLong never returns an oversized chunk', () => {
  const paragraph = 'x'.repeat(400);
  const text = Array.from({ length: 12 }, () => paragraph).join('\n\n');
  const chunks = splitLong(text, 1200);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 2400, `chunk too long: ${chunk.length}`);
});
