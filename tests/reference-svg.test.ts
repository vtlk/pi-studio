import assert from 'node:assert/strict';
import test from 'node:test';
import { validateStaticSvg } from '../src/main/pi/validateReferenceSvg.ts';
test('SVG accepts static artwork and rejects active/external/animated content', () => {
  validateStaticSvg('<svg><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/></svg>');
  for (const body of [
    '<script/>',
    '<foreignObject/>',
    '<animateTransform/>',
    '<g onclick="go()"/>',
    '<image href="file:///secret"/>',
    '<style>@import "https://example.org";</style>',
    '<path fill="url(https://example.org)"/>',
    '<image href="&#104;ttps://example.org"/>',
  ])
    assert.throws(() => validateStaticSvg(`<svg>${body}</svg>`));
});
