import assert from 'node:assert/strict';
import test from 'node:test';
import { annotationWebUrl, initialBookBody, mergeHighlights, renderHighlight } from '../src/markdown.ts';

const annotation = (id, page, text = `Passage ${id}`, updated = '2026-01-01T00:00:00Z') => ({
  book_hash: 'book', meta_hash: 'meta', id, type: 'annotation', cfi: `epubcfi(/6/${page})`,
  page, text, style: 'highlight', color: 'yellow', note: '', created_at: updated, updated_at: updated,
});

test('sync emits no HTML metadata and repolling is byte-for-byte idempotent', () => {
  const first = mergeHighlights(initialBookBody(), [annotation('a', 1), annotation('c', 3)]);
  assert.equal(first.text.includes('<!--'), false);
  const second = mergeHighlights(first.text, [annotation('a', 1), annotation('c', 3)], first.state);
  assert.equal(second.text, first.text);
  assert.equal(second.added, 0);
  assert.equal(second.updated, 0);
});

test('highlight and note titles link to the exact Readest web annotation', () => {
  const item = { ...annotation('note-1', 12), note: 'My note' };
  const url = annotationWebUrl(item);
  assert.equal(url, 'https://web.readest.com/o/book/book/annotation/note-1?cfi=epubcfi%28%2F6%2F12%29');
  const block = renderHighlight(item);
  assert.match(block, /\[Page 12\]\(https:\/\/web\.readest\.com\/o\/book\/book\/annotation\/note-1\?cfi=epubcfi%28%2F6%2F12%29\)/);
  assert.match(block, /\[Note\]\(https:\/\/web\.readest\.com\/o\/book\/book\/annotation\/note-1\?cfi=epubcfi%28%2F6%2F12%29\)/);
  assert.match(block, /> > \[!readest-note\]/);
});

test('old managed blocks gain web links without replacing local edits', () => {
  const item = annotation('a', 1);
  const oldBlock = '> [!readest-highlight|yellow] Page 1\n>\n> Passage a';
  const current = mergeHighlights(initialBookBody(), [item]);
  const previous = { a: { ...current.state.a, rendered: oldBlock } };
  const upgraded = mergeHighlights(`# Highlights\n\n${oldBlock}\n`, [item], previous);
  assert.equal(upgraded.added, 0);
  assert.match(upgraded.text, /\[Page 1\]\(https:\/\/web\.readest\.com\/o\/book\/book\/annotation\/a/);
  const edited = mergeHighlights('# Highlights\n\n> [!readest-highlight|yellow] Page 1\n>\n> My edit\n', [item], previous);
  assert.match(edited.text, /My edit/);
  assert.doesNotMatch(edited.text, /web\.readest\.com/);
});

test('a new middle highlight is inserted in page order without moving prose', () => {
  const first = mergeHighlights(initialBookBody(), [annotation('a', 1), annotation('c', 3)]);
  const edited = first.text.replace(renderHighlight(annotation('c', 3)), `My note after passage A.\n\n${renderHighlight(annotation('c', 3))}`);
  const merged = mergeHighlights(edited, [annotation('a', 1), annotation('b', 2), annotation('c', 3)], first.state);
  assert.ok(merged.text.indexOf('My note') < merged.text.indexOf('Passage b'));
  assert.ok(merged.text.indexOf('Passage b') < merged.text.indexOf('Passage c'));
});

test('locally edited highlight blocks are not overwritten by remote changes', () => {
  const first = mergeHighlights(initialBookBody(), [annotation('a', 1)]);
  const edited = first.text.replace('Passage a', 'My locally edited passage');
  const merged = mergeHighlights(edited, [annotation('a', 1, 'Changed remotely', '2026-02-01T00:00:00Z')], first.state);
  assert.match(merged.text, /My locally edited passage/);
  assert.doesNotMatch(merged.text, /Changed remotely/);
});

test('obsolete inline marker comments are removed without duplicating blocks', () => {
  const block = renderHighlight(annotation('a', 1));
  const legacy = `# Highlights\n\n<!-- readest:highlights:start -->\n\n<!-- readest:highlight id="a" source="x" generated="y" -->\n${block}\n<!-- /readest:highlight -->\n\n<!-- readest:highlights:end -->\n`;
  const merged = mergeHighlights(legacy, [annotation('a', 1)]);
  assert.equal(merged.text.includes('<!--'), false);
  assert.equal(merged.text.split('Passage a').length - 1, 1);
  assert.doesNotMatch(merged.text, /> Passage a\n> \[!readest-highlight/);
});

test('damaged adjacent callouts are separated again, including after a Readest note', () => {
  const withNote = { ...annotation('a', 1), note: 'A personal note.' };
  const damaged = `# Highlights\n\n${renderHighlight(withNote)}\n${renderHighlight(annotation('b', 2))}\n## Notes\n`;
  const repaired = mergeHighlights(damaged, [withNote, annotation('b', 2)]);
  assert.match(repaired.text, /A personal note\.\n\n> \[!readest-highlight\|yellow\] \[Page 2\]/);
  assert.match(repaired.text, /Passage b\n\n## Notes/);
  const repoll = mergeHighlights(repaired.text, [withNote, annotation('b', 2)], repaired.state);
  assert.equal(repoll.text, repaired.text);
});

test('a regenerated note rebuilds every highlight when its old sidecar is discarded', () => {
  const annotations = [annotation('a', 1), annotation('b', 2)];
  const original = mergeHighlights(initialBookBody(), annotations);
  assert.equal(Object.keys(original.state).length, 2);
  const regenerated = mergeHighlights(initialBookBody(), annotations, {});
  assert.match(regenerated.text, /Passage a/);
  assert.match(regenerated.text, /Passage b/);
  assert.equal(regenerated.added, 2);
});
