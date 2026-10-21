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

test('extractPage ignores MkDocs sidebars that live inside <main>', () => {
  // MkDocs Material wraps the left nav and the right TOC inside <main>, so a
  // naive "first <main> wins" rule starts the page with 40 sidebar links.
  const prose = `
    <h1>FastAPI features</h1>
    <p>FastAPI is a modern, fast web framework for building APIs with Python
    based on standard Python type hints. It gives you automatic interactive
    documentation, data validation, serialization, and dependency injection.</p>
    <p>Key features include very high performance, fast to code, fewer bugs,
    easy to learn, short, robust, and standards-based.</p>`;

  const html = `<html><body>
    <div class="md-container">
      <main class="md-main">
        <div class="md-sidebar md-sidebar--primary">
          <nav><a href="/">Home</a><a href="/features/">Features</a></nav>
        </div>
        <div class="md-content">
          <article class="md-content__inner md-typeset">${prose}</article>
        </div>
        <div class="md-sidebar md-sidebar--secondary">
          <nav><a href="#a">On this page</a><a href="#b">Based on open standards</a></nav>
        </div>
      </main>
    </div>
    <footer>FooterJunk</footer>
  </body></html>`;

  const { markdown } = extractPage(html, 'https://fastapi.tiangolo.com/features/');

  assert.match(markdown, /FastAPI is a modern, fast web framework/);
  assert.doesNotMatch(markdown, /On this page/, 'the right-hand TOC must not leak');
  assert.doesNotMatch(markdown, /FooterJunk/);
  assert.ok(
    markdown.indexOf('FastAPI is a modern') < 40,
    `prose should start the page, got: ${JSON.stringify(markdown.slice(0, 80))}`,
  );
});

test('extractPage recovers the language of a code block wrapped by a shiki-style div', () => {
  // VitePress / Shiki render: the language lives on the wrapper, plus a copy
  // button and a visible label span that must not leak into the prose.
  const html = `<html><body><main>
    <p>Install it:</p>
    <div class="language-bash vp-adaptive-theme">
      <button class="copy" title="Copy code"></button>
      <span class="lang">bash</span>
      <pre class="shiki"><code>npm install acme</code></pre>
    </div>
    <p>Then use it.</p>
    </main></body></html>`;

  const { markdown } = extractPage(html, 'https://acme.dev/start');

  assert.match(markdown, /```bash\nnpm install acme\n```/);
  assert.doesNotMatch(markdown, /^bash$/m, 'the language label must not leak as its own line');
  assert.doesNotMatch(markdown, /Copy code/);
  assert.doesNotMatch(markdown, /```\nnpm install acme/, 'the fence must carry the language');
});

test('extractPage widens the fence when the code itself contains ```', () => {
  // A docs page about Markdown contains triple backticks inside its examples.
  const html = `<html><body><main>
    <p>Use a fence like this:</p>
    <pre><code class="language-markdown">\`\`\`js
console.log(1)
\`\`\`</code></pre>
    <p>That is all.</p>
    </main></body></html>`;

  const { markdown } = extractPage(html, 'https://acme.dev/markdown');

  assert.match(markdown, /````markdown\n```js\nconsole\.log\(1\)\n```\n````/);
  const fences = markdown.split('\n').filter((line) => line.startsWith('```'));
  assert.equal(fences.length % 2, 0, `fences must balance, got ${fences.length}`);
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
