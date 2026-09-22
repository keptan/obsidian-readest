import type { HighlightBookState, HighlightStateEntry, ReadestAnnotation } from './types';

const LEGACY_MARKERS = /<!--\s*\/?readest:(?:highlight(?:s)?)\b[^>]*-->/g;
const LEGACY_HELP = /<!--\s*Write freely here,[\s\S]*?preserves your prose\.\s*-->/g;

// Matches Readest's buildAnnotationWebUrl in src/utils/deeplink.ts.
export function annotationWebUrl(annotation: Pick<ReadestAnnotation, 'book_hash' | 'id' | 'cfi'>): string {
  const base = `https://web.readest.com/o/book/${encodeURIComponent(annotation.book_hash)}/annotation/${encodeURIComponent(annotation.id)}`;
  return annotation.cfi ? `${base}?cfi=${encodeURIComponent(annotation.cfi).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}` : base;
}

export function renderHighlight(annotation: ReadestAnnotation): string {
  const color = normalizeColor(annotation.color);
  const location = annotation.page != null ? `Page ${annotation.page}` : 'Highlight';
  const quote = quoteLines(cleanText(annotation.text ?? ''));
  const note = cleanText(annotation.note ?? '');
  const url = annotationWebUrl(annotation);
  const noteBlock = note ? `\n>\n> > [!readest-note] [Note](${url})\n${note.split('\n').map((line) => `> > ${line}`).join('\n')}` : '';
  return [`> [!readest-highlight|${color}] [${location}](${url})`, '>', quote || '> *Empty highlight*', noteBlock]
    .filter(Boolean).join('\n');
}

export function mergeHighlights(
  markdown: string,
  remote: ReadestAnnotation[],
  previousState: HighlightBookState = {},
): { text: string; state: HighlightBookState; added: number; updated: number } {
  const active = remote.filter((item) => !item.deleted_at && item.type === 'annotation').sort(compareAnnotations);
  let text = prepareDocument(markdown);
  const state: HighlightBookState = { ...previousState };
  let added = 0;
  let updated = 0;

  for (const annotation of active) {
    if (state[annotation.id]) continue;
    const rendered = renderHighlight(annotation);
    if (text.includes(rendered)) state[annotation.id] = stateEntry(annotation, rendered);
  }

  for (const annotation of active) {
    const previous = state[annotation.id];
    if (!previous) continue;
    const index = text.indexOf(previous.rendered);
    if (index < 0) continue; // A locally edited highlight is preserved verbatim.
    const rendered = renderHighlight(annotation);
    if (previous.source === fingerprint(annotation) && previous.rendered === rendered) continue;
    text = replaceAt(text, index, previous.rendered.length, rendered);
    state[annotation.id] = stateEntry(annotation, rendered);
    updated += 1;
  }

  for (let index = 0; index < active.length; index += 1) {
    const annotation = active[index]!;
    if (state[annotation.id]) continue;
    const rendered = renderHighlight(annotation);
    const nextIndex = findNextManagedIndex(text, active, state, index + 1);
    text = insertBlock(text, nextIndex ?? findHighlightBoundary(text), rendered);
    state[annotation.id] = stateEntry(annotation, rendered);
    added += 1;
  }

  const activeIds = new Set(active.map((item) => item.id));
  for (const id of Object.keys(state)) if (!activeIds.has(id)) delete state[id];
  return { text: normalizeDocumentEnd(text), state, added, updated };
}

export function initialBookBody(templateBody = ''): string {
  const body = templateBody.trim();
  if (!body) return '# Highlights\n\n## Notes\n';
  if (/^#{1,6}\s+Highlights\s*$/im.test(body)) return `${body}\n`;
  return `${body}\n\n# Highlights\n`;
}

function prepareDocument(markdown: string): string {
  const cleaned = markdown
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(LEGACY_MARKERS, '')
    .replace(LEGACY_HELP, '')
    // A Markdown callout ends only when its blockquote is separated from the
    // next one. Normalize that boundary to one blank line, repairing notes
    // affected by the v0.3 marker-removal bug as well as preventing recurrence.
    .replace(/\n+(?=> \[!readest-highlight\b)/g, '\n\n')
    .replace(/\n+(?=##\s+Notes\s*$)/gim, '\n\n');
  return initialBookBody(cleaned);
}

function findNextManagedIndex(text: string, active: ReadestAnnotation[], state: HighlightBookState, start: number): number | null {
  for (let index = start; index < active.length; index += 1) {
    const entry = state[active[index]!.id];
    if (!entry) continue;
    const location = text.indexOf(entry.rendered);
    if (location >= 0) return location;
  }
  return null;
}

function findHighlightBoundary(text: string): number {
  const notes = /^##\s+Notes\s*$/im.exec(text);
  if (notes?.index != null) return notes.index;
  return text.length;
}

function insertBlock(text: string, index: number, block: string): string {
  const before = text.slice(0, index).trimEnd();
  const after = text.slice(index).trimStart();
  return after ? `${before}\n\n${block}\n\n${after}` : `${before}\n\n${block}\n`;
}

function replaceAt(text: string, index: number, length: number, replacement: string): string {
  return text.slice(0, index) + replacement + text.slice(index + length);
}

function stateEntry(annotation: ReadestAnnotation, rendered: string): HighlightStateEntry {
  return { source: fingerprint(annotation), rendered, page: annotation.page ?? null, cfi: annotation.cfi ?? '' };
}

function fingerprint(annotation: ReadestAnnotation): string {
  return hash(`${annotation.updated_at}|${annotation.text ?? ''}|${annotation.note ?? ''}|${annotation.color ?? ''}|${annotation.page ?? ''}`);
}

export function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function compareAnnotations(a: ReadestAnnotation, b: ReadestAnnotation): number {
  const pageA = a.page ?? Number.MAX_SAFE_INTEGER;
  const pageB = b.page ?? Number.MAX_SAFE_INTEGER;
  if (pageA !== pageB) return pageA - pageB;
  const cfi = (a.cfi ?? '').localeCompare(b.cfi ?? '', undefined, { numeric: true });
  return cfi || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

function quoteLines(value: string): string {
  return value.split('\n').map((line) => `> ${line}`).join('\n');
}

function cleanText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function normalizeColor(value?: string | null): string {
  const color = (value ?? 'yellow').toLowerCase().replace(/[^a-z0-9-]/g, '');
  return color || 'yellow';
}

function normalizeDocumentEnd(value: string): string {
  return `${value.trimEnd()}\n`;
}
