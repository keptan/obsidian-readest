import assert from 'node:assert/strict';
import test from 'node:test';
import { imageExtension } from '../src/cover.ts';

test('cover bytes determine the vault image extension', () => {
  assert.equal(imageExtension(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]).buffer), 'png');
  assert.equal(imageExtension(Uint8Array.from([255, 216, 255, 0]).buffer), 'jpg');
  assert.equal(imageExtension(new TextEncoder().encode('RIFFxxxxWEBP').buffer), 'webp');
  assert.equal(imageExtension(new TextEncoder().encode('GIF89a').buffer), 'gif');
  assert.equal(imageExtension(new TextEncoder().encode('<svg/>').buffer), null);
});
