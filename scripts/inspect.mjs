/**
 * Report extraction quality for a generated index.
 *
 * Useful after changing anything in src/extract.js: run a real crawl, then check
 * that chrome leaks and unbalanced code fences did not go up.
 *
 *   node scripts/inspect.mjs out/fastapi/index.json
 */

import { readFileSync } from 'node:fs';

const indexPath = process.argv[2];
if (!indexPath) {
  console.error('usage: node scripts/inspect.mjs <path/to/index.json>');
  process.exit(1);
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const page =
  index.pages.find((p) => p.url.includes('features')) || index.pages[3] || index.pages[0];

if (!page) {
  console.error('no pages in index');
  process.exit(1);
}

const md = page.markdown;
console.log(`=== ${page.title} | ${md.length} chars | ${page.url} ===`);
console.log(md.split('\n').slice(0, 40).join('\n'));

const JUNK = [
  'Skip to content',
  'On this page',
  'Edit this page',
  'Previous page',
  'Next page',
  'Toggle',
  'Appearance',
  'Copy code',
  'Scroll to top',
  'Navigation',
];

console.log('\n=== this page ===');
let leaks = 0;
for (const needle of JUNK) {
  const hits = md.split(needle).length - 1;
  if (hits > 0) {
    leaks += hits;
    console.log(`  LEAK: "${needle}" x${hits}`);
  }
}
const fences = md.split('\n').filter((line) => line.startsWith('```')).length;
const headings = (md.match(/^#{1,6} /gm) || []).length;
const tags = (md.match(/<[a-z][a-z0-9]*[ />]/gi) || []).length;
const links = (md.match(/\]\(https?:/g) || []).length;

console.log(`  chrome leaks   : ${leaks}`);
console.log(`  code fences    : ${fences} ${fences % 2 === 0 ? '(balanced)' : '(UNBALANCED)'}`);
console.log(`  headings       : ${headings}`);
console.log(`  leftover tags  : ${tags}`);
console.log(`  absolute links : ${links}`);

const whole = index.pages.reduce(
  (acc, p) => {
    acc.fences += p.markdown.split('\n').filter((line) => line.startsWith('```')).length;
    acc.tags += (p.markdown.match(/<[a-z][a-z0-9]*[ />]/gi) || []).length;
    return acc;
  },
  { fences: 0, tags: 0 },
);

console.log('\n=== index-wide ===');
console.log(`  source         : ${index.source}`);
console.log(`  pages          : ${index.pages.length}`);
console.log(`  passages       : ${index.stats.chunks}`);
console.log(
  `  fence markers  : ${whole.fences} ${whole.fences % 2 === 0 ? '(balanced)' : '(UNBALANCED)'}`,
);
console.log(`  leftover tags  : ${whole.tags}`);

const odd = index.pages.filter((p) => {
  const n = p.markdown.split('\n').filter((line) => line.startsWith('```')).length;
  return n % 2 === 1;
});
console.log(`  pages with odd fence count: ${odd.length}`);
for (const p of odd.slice(0, 8)) {
  const n = p.markdown.split('\n').filter((line) => line.startsWith('```')).length;
  console.log(`    ${n} fences  ${p.url}`);
}
