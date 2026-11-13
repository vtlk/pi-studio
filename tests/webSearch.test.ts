import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSearchResults, searchWeb } from '../src/main/pi/webSearch.ts';

test('shared search returns readable source links and ignores non-web, credentialed and duplicate links', () => {
  const html = `<a class="ad" href="https://ad.example">Ad</a>
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.swift.org%2F">Swift &amp; open source</a>
    <a class="result__snippet">A <b>programming</b> language.</a>
    <a href='https://www.swift.org/' class='result__a'>Duplicate</a>
    <a class="result__a" href="javascript:bad()">Bad</a>
    <a class="result__a" href="https://user:secret@example.com">Secret</a>`;
  assert.deepEqual(parseSearchResults(html), [
    {
      title: 'Swift & open source',
      url: 'https://www.swift.org/',
      snippet: 'A programming language.',
    },
  ]);
});
test('invalid search requests are rejected without network or paid provider calls', async () => {
  for (const value of ['', {}, 'x'.repeat(601)]) await assert.rejects(searchWeb(value));
});
