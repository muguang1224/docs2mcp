/**
 * Turn extracted pages into a compact, searchable index.
 *
 * Structure:
 *   pages[]  - one record per URL, keeps the full Markdown for `get_page`
 *   chunks[] - heading-aware passages, the unit that `search_docs` ranks
 */

import { extractPage } from './extract.js';

const MAX_CHUNK = 1200;
// CJK is information-dense: a 30-character Chinese passage is a full thought,
// so the floor must stay low enough for non-English docs to remain searchable.
const MIN_CHUNK = 20;
const MIN_PAGE_CHARS = 80;
const MAX_PAGE_CHARS = 120_000;

/** Split Markdown into `{heading, text}` sections at heading boundaries. */
export function splitSections(markdown) {
  const sections = [];
  let current = { heading: '', lines: [] };
  let inFence = false;

  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const heading = !inFence && /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const text = current.lines.join('\n').trim();
      if (text) sections.push({ heading: current.heading, text });
      current = { heading: heading[2].replace(/[*_`]/g, '').trim(), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  const tail = current.lines.join('\n').trim();
  if (tail) sections.push({ heading: current.heading, text: tail });
  return sections;
}

function hardSplit(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

export function splitLong(text, max = MAX_CHUNK) {
  if (text.length <= max) return [text];
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());
  const out = [];
  let buffer = '';
  for (const paragraph of paragraphs) {
    if (buffer && buffer.length + paragraph.length + 2 > max) {
      out.push(buffer);
      buffer = paragraph;
    } else {
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    }
  }
  if (buffer.trim()) out.push(buffer);
  return out.flatMap((chunk) => (chunk.length <= max * 2 ? [chunk] : hardSplit(chunk, max)));
}

/**
 * @param {{pages: {url: string, html: string}[], meta: object}} input
 */
export function buildIndex({ pages, meta = {} }) {
  const indexedPages = [];
  const chunks = [];
  let skipped = 0;

  for (const { url, html } of pages) {
    const { title, description, markdown } = extractPage(html, url);
    if (!markdown || markdown.replace(/\s/g, '').length < MIN_PAGE_CHARS) {
      skipped += 1;
      continue;
    }
    const trimmed = markdown.length > MAX_PAGE_CHARS ? markdown.slice(0, MAX_PAGE_CHARS) : markdown;
    indexedPages.push({ url, title, description, chars: trimmed.length, markdown: trimmed });

    const before = chunks.length;
    for (const section of splitSections(trimmed)) {
      for (const piece of splitLong(section.text)) {
        const text = piece.trim();
        if (text.length < MIN_CHUNK) continue;
        chunks.push({
          id: chunks.length,
          url,
          title,
          heading: section.heading,
          text,
        });
      }
    }

    // Terse pages (very common in CJK docs and in API reference stubs) can end
    // up with no passage above the floor. Keep the whole page as one passage so
    // it stays reachable instead of silently vanishing from search.
    if (chunks.length === before) {
      chunks.push({ id: chunks.length, url, title, heading: '', text: trimmed });
    }
  }

  const totalChars = indexedPages.reduce((sum, p) => sum + p.chars, 0);

  return {
    version: 1,
    generator: 'docs2mcp',
    generatedAt: new Date().toISOString(),
    source: meta.source || '',
    strategy: meta.strategy || '',
    stats: {
      pages: indexedPages.length,
      skipped,
      chunks: chunks.length,
      chars: totalChars,
    },
    pages: indexedPages,
    chunks,
  };
}
