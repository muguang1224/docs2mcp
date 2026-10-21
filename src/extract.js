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
  return (
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(
        /<(script|style|noscript|template|svg|canvas|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi,
        '',
      )
      .replace(/<(script|style|link|meta|base)\b[^>]*\/?>/gi, '')
      // Code-block chrome: copy buttons and the language label. Shiki, VitePress
      // and Expressive Code render these as siblings of <pre>, which is why the
      // label would otherwise leak into the text right above every code block.
      .replace(
        /<(button|span)\b[^>]*class\s*=\s*["'][^"']*(?:\bcopy\b|\blang\b|\blanguage-label\b)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi,
        '',
      )
      // Heading permalinks. MkDocs Material and friends append an anchor whose
      // text is ¶, which would otherwise end up inside every heading.
      .replace(
        /<a\b[^>]*class\s*=\s*["'][^"']*(?:headerlink|anchor-link|permalink|hash-link)[^"']*["'][^>]*>[\s\S]*?<\/a>/gi,
        '',
      )
  );
}

/** Last match of a global regex, i.e. the occurrence closest to the cursor. */
function matchLast(text, re) {
  let found = null;
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(text))) found = m[1];
  return found;
}

/**
 * Pick the most content-dense container. Preferring <main>/<article> means we get
 * the prose without the site chrome, even on sites that render a huge sidebar.
 */
/**
 * Pick the most content-dense container.
 *
 * Ordering alone is not enough: MkDocs Material puts the left nav AND the right
 * "on this page" TOC *inside* <main>, so preferring <main> yields a page that
 * starts with 40 sidebar links. Instead, take the smallest container that still
 * holds most of the page's text — that is the prose wrapper on every generator
 * checked so far (MkDocs article, Docusaurus article, VitePress main, plain body).
 */
function pickContent(html) {
  const textLen = (fragment) => collapseSpace(stripTags(fragment)).length;
  const candidates = [];

  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html);
  if (article) candidates.push(article[1]);
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
  if (main) candidates.push(main[1]);
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
  candidates.push(body ? body[1] : html);

  const sized = candidates
    .map((fragment) => ({ fragment, len: textLen(fragment) }))
    .filter((c) => c.len > 200)
    .sort((a, b) => a.len - b.len);

  let content;
  if (sized.length) {
    const largest = sized[sized.length - 1].len;
    content = (sized.find((c) => c.len >= largest * 0.6) || sized[sized.length - 1]).fragment;
  } else {
    // Tiny page: nothing is large enough to score, so fall back to the body.
    content = candidates[candidates.length - 1];
  }

  // Never keep site chrome. <aside> is left alone on purpose: Starlight and
  // several other generators use it for in-content callouts.
  return content
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, '');
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
  {
    const re = /<pre\b[^>]*>([\s\S]*?)<\/pre>/gi;
    let kept = '';
    let cursor = 0;
    let m;
    while ((m = re.exec(content))) {
      kept += content.slice(cursor, m.index);
      cursor = m.index + m[0].length;

      // Modern docs put the language on a wrapper div, not on the <pre>, so look
      // just behind the block for the closest language-* hint.
      const behind = content.slice(Math.max(0, m.index - 400), m.index);
      const lang =
        matchLast(behind, /language-([\w+#.-]+)/gi) ||
        matchLast(m[0], /language-([\w+#.-]+)/gi) ||
        matchLast(behind, /data-language\s*=\s*["']([\w+#.-]+)["']/gi);

      const code = decodeEntities(stripTags(m[1]))
        .replace(/\r\n?/g, '\n')
        .replace(/^\n+|\n+$/g, '');

      if (!code.trim()) continue;
      codeBlocks.push({ lang: lang ? lang.toLowerCase() : '', code });
      kept += `\n\n\u0000CODE${codeBlocks.length - 1}\u0000\n\n`;
    }
    content = kept + content.slice(cursor);
  }

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
    // Docs about Markdown contain ``` inside their examples. Emit a longer fence
    // in that case so the block stays balanced when the Markdown is re-read.
    let fenceLength = 3;
    for (const line of block.code.split('\n')) {
      const run = /^\s*(`{3,})/.exec(line);
      if (run) fenceLength = Math.max(fenceLength, run[1].length + 1);
    }
    const fence = '`'.repeat(fenceLength);
    return `${fence}${block.lang}\n${block.code}\n${fence}`;
  });

  return { title: title || pageUrl, description, markdown: md };
}

export { collapseSpace, textOf };
