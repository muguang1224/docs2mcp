#!/usr/bin/env node
/**
 * docs2mcp generated server.
 *
 * A dependency-free MCP (Model Context Protocol) server over stdio. It reads
 * index.json sitting next to this file and exposes three tools:
 *
 *   search_docs  ranked passages (BM25 with title/heading boosts, CJK aware)
 *   get_page     full Markdown of one page
 *   list_pages   inventory of every indexed page
 *
 * Generated code. Regenerate with `npx docs2mcp <url>` instead of editing.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createRuntime } from './runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = resolve(process.env.DOCS2MCP_INDEX || join(HERE, 'index.json'));

let index;
try {
  index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
} catch (err) {
  process.stderr.write(
    `[docs2mcp] cannot read index at ${INDEX_PATH}: ${err.message}\n` +
      '[docs2mcp] regenerate with: npx docs2mcp <url>\n',
  );
  process.exit(1);
}

const runtime = createRuntime(index);

process.stderr.write(
  `[docs2mcp] serving ${runtime.stats.pages} pages / ${runtime.stats.chunks} passages` +
    `${runtime.stats.source ? ` from ${runtime.stats.source}` : ''}\n`,
);

function send(message) {
  if (message) process.stdout.write(`${JSON.stringify(message)}\n`);
}

let buffer = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      continue;
    }

    try {
      send(runtime.handle(message));
    } catch (err) {
      const id = message && message.id !== undefined ? message.id : null;
      send({ jsonrpc: '2.0', id, error: { code: -32603, message: err.message } });
    }
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
