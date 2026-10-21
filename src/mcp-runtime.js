/**
 * The runtime behind a generated docs2mcp server.
 *
 * Pure logic: it builds a BM25 index from an `index.json` object and answers
 * MCP JSON-RPC messages. All stdio handling lives in the generated bootstrap so
 * that this file stays trivially testable in-process.
 */

export const SERVER_NAME = 'docs2mcp';
export const SERVER_VERSION = '0.1.0';
export const SUPPORTED_PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18'];
export const FALLBACK_PROTOCOL = '2025-06-18';

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/;

/**
 * Latin/number tokens plus CJK unigrams AND bigrams. The bigrams are what make
 * Chinese queries work: "签名验证" has no spaces, so whole-word matching fails.
 */
export function tokenize(text) {
  if (!text) return [];
  const lower = String(text).toLowerCase();
  const tokens = [];

  const latin = lower.match(/[a-z0-9_+#./-]{2,}/g);
  if (latin) {
    for (const token of latin) {
      tokens.push(token);
      if (/[./-]/.test(token)) {
        for (const part of token.split(/[./-]+/)) if (part.length >= 2) tokens.push(part);
      }
    }
  }

  if (CJK.test(lower)) {
    const runs =
      lower.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]+/g) || [];
    for (const run of runs) {
      for (let i = 0; i < run.length; i += 1) {
        tokens.push(run[i]);
        if (i + 1 < run.length) tokens.push(run.slice(i, i + 2));
      }
    }
  }

  return tokens;
}

export const TOOLS = [
  {
    name: 'search_docs',
    title: 'Search documentation',
    description:
      'Search the indexed documentation and return the most relevant passages with their source URL. ' +
      'Use this first for any question about this product.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language or keyword query.' },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'Maximum passages to return. Default 5.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_page',
    title: 'Read a documentation page',
    description:
      'Return the full cleaned Markdown of one documentation page. Use after search_docs when you need complete context.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Exact page URL as returned by search_docs or list_pages.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'list_pages',
    title: 'List documentation pages',
    description:
      'List every indexed page with its title and URL. Useful to see what this server covers.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional substring filter on title or URL.' },
        limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Default 100.' },
      },
    },
  },
];

function snippet(text, queryTokens, size = 700) {
  const body = String(text || '');
  if (body.length <= size) return body;
  const lower = body.toLowerCase();
  let start = 0;
  for (const token of queryTokens) {
    const at = lower.indexOf(token);
    if (at !== -1) {
      start = Math.max(0, at - 140);
      break;
    }
  }
  const slice = body.slice(start, start + size);
  return `${start > 0 ? '…' : ''}${slice}${start + size < body.length ? '…' : ''}`;
}

/**
 * @param {object} index parsed index.json
 * @returns {{tools: object[], search: Function, handle: Function, stats: object}}
 */
export function createRuntime(index) {
  const chunks = Array.isArray(index.chunks) ? index.chunks : [];
  const pages = Array.isArray(index.pages) ? index.pages : [];
  const pageByUrl = new Map(pages.map((page) => [page.url, page]));

  const docs = chunks.map((chunk) => {
    const tokens = tokenize(`${chunk.title || ''} ${chunk.heading || ''} ${chunk.text || ''}`);
    const tf = new Map();
    for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
    return {
      tf,
      len: tokens.length,
      titleTokens: new Set(tokenize(chunk.title)),
      headingTokens: new Set(tokenize(chunk.heading)),
    };
  });

  const df = new Map();
  for (const doc of docs) {
    for (const token of new Set(doc.tf.keys())) df.set(token, (df.get(token) || 0) + 1);
  }

  const total = docs.length;
  const avgdl = total ? docs.reduce((sum, d) => sum + d.len, 0) / total : 0;
  const K1 = 1.2;
  const B = 0.75;

  function search(query, limit = 5) {
    const queryTokens = [...new Set(tokenize(query))];
    if (!queryTokens.length || !total) return [];

    const scored = [];
    for (let i = 0; i < total; i += 1) {
      const doc = docs[i];
      let score = 0;
      for (const token of queryTokens) {
        const freq = doc.tf.get(token);
        if (!freq) continue;
        const dfi = df.get(token) || 0;
        const idf = Math.log(1 + (total - dfi + 0.5) / (dfi + 0.5));
        score += (idf * (freq * (K1 + 1))) / (freq + K1 * (1 - B + (B * doc.len) / (avgdl || 1)));
      }
      if (score <= 0) continue;

      let boost = 0;
      for (const token of queryTokens) {
        if (doc.titleTokens.has(token)) boost += 0.6;
        if (doc.headingTokens.has(token)) boost += 0.4;
      }
      scored.push({ index: i, score: score * (1 + boost) });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((hit) => ({ chunk: chunks[hit.index], score: hit.score }));
  }

  function searchDocs(args) {
    const query = String(args.query || '').trim();
    if (!query) return { text: 'search_docs requires a non-empty `query`.', isError: true };

    const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);
    const hits = search(query, limit);
    if (!hits.length) {
      return {
        text:
          `No matches for "${query}". Try broader or different keywords, ` +
          'or call list_pages to see what is indexed.',
      };
    }

    const queryTokens = [...new Set(tokenize(query))];
    const body = hits
      .map((hit, i) => {
        const { chunk, score } = hit;
        const heading = chunk.heading ? ` › ${chunk.heading}` : '';
        return [
          `## ${i + 1}. ${chunk.title}${heading}`,
          `URL: ${chunk.url}`,
          `Score: ${score.toFixed(2)}`,
          '',
          snippet(chunk.text, queryTokens),
        ].join('\n');
      })
      .join('\n\n---\n\n');

    return { text: `# ${hits.length} result(s) for "${query}"\n\n${body}` };
  }

  function getPage(args) {
    const url = String(args.url || '').trim();
    if (!url) return { text: 'get_page requires a `url`.', isError: true };

    const page = pageByUrl.get(url);
    if (!page) {
      const near = pages.filter((p) => p.url.includes(url) || url.includes(p.url)).slice(0, 5);
      const hint = near.length
        ? `\n\nClosest matches:\n${near.map((p) => `- ${p.url}`).join('\n')}`
        : '\n\nCall list_pages to see every available URL.';
      return { text: `No page indexed at ${url}.${hint}`, isError: true };
    }

    const header = [
      `# ${page.title}`,
      `Source: ${page.url}`,
      page.description ? `_${page.description}_` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return { text: `${header}\n\n---\n\n${page.markdown}` };
  }

  function listPages(args) {
    const query = String(args.query || '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 500);

    let rows = pages;
    if (query) {
      rows = rows.filter(
        (p) => p.title.toLowerCase().includes(query) || p.url.toLowerCase().includes(query),
      );
    }
    if (!rows.length) return { text: 'No pages matched.' };

    const shown = rows.slice(0, limit);
    const lines = shown.map((p) => `- [${p.title}](${p.url}) — ${p.chars} chars`);
    const tail = rows.length > shown.length ? `\n\n…and ${rows.length - shown.length} more.` : '';
    return {
      text:
        `# ${rows.length} page(s) indexed from ${index.source || 'site'} ` +
        `(${index.stats?.chunks ?? chunks.length} passages)\n\n${lines.join('\n')}${tail}`,
    };
  }

  const handlers = {
    search_docs: searchDocs,
    get_page: getPage,
    list_pages: listPages,
  };

  function callTool(id, params) {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    const handler = handlers[name];
    if (!handler) return { jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool: ${name}` } };

    try {
      const outcome = handler(args);
      const result = { content: [{ type: 'text', text: outcome.text }] };
      if (outcome.isError) result.isError = true;
      return { jsonrpc: '2.0', id, result };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: `Tool failed: ${err.message}` }], isError: true },
      };
    }
  }

  /**
   * @param {any} message a parsed JSON-RPC message
   * @returns {object|null} a response object, or null for notifications
   */
  function handle(message) {
    if (!message || typeof message !== 'object') {
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } };
    }
    const hasId = Object.prototype.hasOwnProperty.call(message, 'id');
    if (!hasId) return null; // notifications never get a reply

    const { id, method, params } = message;

    switch (method) {
      case 'initialize': {
        const requested = params && params.protocolVersion;
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : FALLBACK_PROTOCOL,
            capabilities: { tools: {} },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
            instructions:
              `Documentation for ${index.source || 'this project'} ` +
              `(${pages.length} pages, ${chunks.length} passages). ` +
              'Call search_docs first, then get_page for full context.',
          },
        };
      }
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
      case 'tools/call':
        return callTool(id, params);
      case 'resources/list':
        return { jsonrpc: '2.0', id, result: { resources: [] } };
      case 'prompts/list':
        return { jsonrpc: '2.0', id, result: { prompts: [] } };
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
    }
  }

  return {
    tools: TOOLS,
    search,
    handle,
    stats: {
      pages: pages.length,
      chunks: chunks.length,
      source: index.source || '',
    },
  };
}
