/**
 * HTML -> clean Markdown.
 *
 * Deliberately dependency-free. The goal is not a spec-perfect HTML parser but a
 * readable text extraction that works well on the vast majority of documentation
 * sites (Docusaurus, MkDocs, VitePress, GitBook, ReadMe, Slate, plain HTML).
 */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  copy: '©',
  reg: '®',
  trade: '™',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  middot: '·',
  bull: '•',
  deg: '°',
  times: '×',
  divide: '÷',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  harr: '↔',
  check: '✓',
  cross: '✗',
};

export function decodeEntities(input) {
  if (!input || input.indexOf('&') === -1) return input;
  return input.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const hit = NAMED_ENTITIES[body.toLowerCase()];
    return hit === undefined ? whole : hit;
  });
}

export function stripTags(html) {
  return html.replace(/<\/?[a-zA-Z][^>]*>/g, '');
}

function textOf(html) {
  return collapseSpace(decodeEntities(stripTags(html)));
}

function collapseSpace(s) {
  return s.replace(/[ \t\u00a0]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
}

function metaContent(html, name) {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)\\s*=\\s*["']${name}["'][^>]*>`,
    'i',
  );
  const tag = re.exec(html);
  if (!tag) return '';
  const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag[0]);
  return content ? textOf(content[1]) : '';
}

/** Remove the parts of a page that never contain documentation prose. */
function stripNoise(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|svg|canvas|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|link|meta|base)\b[^>]*\/?>/gi, '');
}

/**
 * Pick the most content-dense container. Preferring <main>/<article> means we get
 * the prose without the site chrome, even on sites that render a huge sidebar.
 */
function pickContent(html) {
  const candidates = [
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
  ];
  for (const re of candidates) {
    const m = re.exec(html);
    if (m && m[1] && stripTags(m[1]).trim().length > 200) return m[1];
  }
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
  let content = body ? body[1] : html;
  content = content
    .replace(/<(nav|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, (block) =>
      // Keep a page header only if it carries the document title.
      /<h1\b/i.test(block) ? block : '',
    );
  return content;
}

function resolveHref(href, pageUrl) {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || /^(javascript|mailto|tel|data):/i.test(trimmed)) {
    return null;
  }
  try {
    return new URL(trimmed, pageUrl).toString();
  } catch {
    return null;
  }
}

function inlineToMarkdown(html, pageUrl) {
  let out = html;

  // Images before links: both use attributes we must read before stripping tags.
  out = out.replace(/<img\b([^>]*)>/gi, (whole, attrs) => {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(attrs);
    const resolved = src ? resolveHref(src[1], pageUrl) : null;
    if (!resolved) return '';
    return `![${alt ? decodeEntities(alt[1]) : ''}](${resolved})`;
  });

  out = out.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (whole, attrs, label) => {
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const text = decodeEntities(stripTags(label)).replace(/\s+/g, ' ').trim();
    const resolved = href ? resolveHref(href[1], pageUrl) : null;
    if (!resolved) return text;
    if (!text) return '';
    return `[${text}](${resolved})`;
  });

  out = out
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (whole, inner) => {
      const code = decodeEntities(stripTags(inner)).trim();
      return code ? '`' + code.replace(/`/g, '') + '`' : '';
    });

  return out;
}

/**
 * @param {string} html raw HTML of a page
 * @param {string} pageUrl absolute URL, used to resolve relative links
 * @returns {{title: string, description: string, markdown: string}}
 */
export function extractPage(html, pageUrl) {
  if (!html) return { title: '', description: '', markdown: '' };

  const rawTitle = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  let title = rawTitle ? textOf(rawTitle[1]) : '';
  if (!title && h1) title = textOf(h1[1]);
  // "Getting started | Acme Docs" -> "Getting started"
  const shortened = title.split(/\s+[|·—–-]\s+/)[0].trim();
  if (shortened.length >= 4) title = shortened;

  const description =
    metaContent(html, 'description') || metaContent(html, 'og:description');

  let content = pickContent(stripNoise(html));

  // Pull code blocks out first so whitespace normalization cannot touch them.
  const codeBlocks = [];
  content = content.replace(/<pre\b([^>]*)>([\s\S]*?)<\/pre>/gi, (whole, attrs, inner) => {
    const langMatch =
      /language-([\w+#.-]+)/i.exec(whole) || /\bdata-language\s*=\s*["']([\w+#.-]+)["']/i.exec(whole);
    const code = decodeEntities(stripTags(inner))
      .replace(/\r\n?/g, '\n')
      .replace(/^\n+|\n+$/g, '');
    if (!code.trim()) return '';
    codeBlocks.push({ lang: langMatch ? langMatch[1].toLowerCase() : '', code });
    return `\n\n\u0000CODE${codeBlocks.length - 1}\u0000\n\n`;
  });

  let md = inlineToMarkdown(content, pageUrl);

  md = md
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (whole, level, inner) => {
      const text = collapseSpace(decodeEntities(stripTags(inner)));
      if (!text) return '';
      return `\n\n${'#'.repeat(Number(level))} ${text}\n\n`;
    })
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<(ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<\/(ul|ol)>/gi, '\n')
    .replace(/<blockquote\b[^>]*>/gi, '\n> ')
    .replace(/<\/blockquote>/gi, '\n')
    .replace(/<hr\b[^>]*\/?>/gi, '\n\n---\n\n')
    .replace(/<br\b[^>]*\/?>/gi, '\n')
    .replace(/<tr\b[^>]*>/gi, '\n| ')
    .replace(/<t[dh]\b[^>]*>/gi, '')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<\/(tr|table|thead|tbody)>/gi, '\n')
    .replace(/<(p|div|section|details|summary)\b[^>]*>/gi, '\n\n')
    .replace(/<\/(p|div|section|details|summary)>/gi, '\n\n')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '');

  md = decodeEntities(md)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Restore code blocks as fenced blocks, last so indentation survives.
  md = md.replace(/\u0000CODE(\d+)\u0000/g, (whole, i) => {
    const block = codeBlocks[Number(i)];
    if (!block) return '';
    return '```' + block.lang + '\n' + block.code + '\n```';
  });

  return { title: title || pageUrl, description, markdown: md };
}

export { collapseSpace, textOf };
