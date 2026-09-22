import { App, normalizePath, parseYaml, stringifyYaml, TFile, Vault } from 'obsidian';
import { ReadestApi } from './api';
import { imageExtension } from './cover';
import type { HighlightState, ReadestAnnotation, ReadestBook, ReadestSettings, SyncSummary } from './types';
import { hash, initialBookBody, mergeHighlights } from './markdown';

export class LibraryWriter {
  constructor(private app: App, private settings: ReadestSettings, private highlightState: HighlightState, private api: ReadestApi) {}

  async write(books: ReadestBook[], annotations: ReadestAnnotation[]): Promise<SyncSummary> {
    await ensureFolder(this.app.vault, this.settings.booksFolder);
    await ensureFolder(this.app.vault, this.settings.coversFolder);
    const activeBooks = books.filter((book) => !book.deleted_at && book.uploaded_at && /^[a-zA-Z0-9_-]+$/.test(book.book_hash));
    const byBook = groupAnnotations(annotations.filter((item) => !item.deleted_at));
    const noteIndex = await this.indexBookNotes();
    const template = await this.readTemplate();
    let created = 0;
    let updated = 0;
    let newHighlights = 0;

    for (const book of activeBooks) {
      const coverPath = await this.ensureCover(book);
      const existing = noteIndex.get(book.book_hash) ?? null;
      const path = existing?.path ?? this.uniqueBookPath(book);
      const before = existing ? await this.app.vault.read(existing) : null;
      const current = before !== null ? splitDocument(before) : template;
      const frontmatter = renderFrontmatter(current.properties, book, coverPath, this.settings.coversFolder);
      const currentBody = existing ? current.body : initialBookBody(current.body);
      // If the Markdown note was deleted, its sidecar still exists. A newly
      // created note must rebuild from Readest rather than trusting that stale
      // index and incorrectly treating every highlight as already present.
      const previousState = existing ? this.highlightState[book.book_hash] : {};
      const bookAnnotations = byBook.get(book.book_hash) ?? [];
      let merged = mergeHighlights(currentBody, bookAnnotations, previousState);
      const content = `${frontmatter}\n${merged.text}`;
      if (existing) {
        if (before !== content) {
          let changed = false;
          await this.app.vault.process(existing, (latest) => {
            if (latest === before) {
              changed = true;
              return content;
            }
            // Rebase onto the current note if it changed while the cover was
            // loading, so prose added in another Obsidian pane is retained.
            const parts = splitDocument(latest);
            merged = mergeHighlights(parts.body, bookAnnotations, previousState);
            const next = `${renderFrontmatter(parts.properties, book, coverPath, this.settings.coversFolder)}\n${merged.text}`;
            changed = latest !== next;
            return next;
          });
          if (changed) updated += 1;
        }
      } else {
        const file = await this.app.vault.create(path, content);
        noteIndex.set(book.book_hash, file);
        created += 1;
      }
      this.highlightState[book.book_hash] = merged.state;
      newHighlights += merged.added;
    }
    return { books: activeBooks.length, created, updated, newHighlights };
  }

  private async readTemplate(): Promise<DocumentParts> {
    if (!this.settings.templatePath) return { properties: {}, body: '' };
    const file = this.app.vault.getAbstractFileByPath(this.settings.templatePath);
    if (!(file instanceof TFile)) return { properties: {}, body: '' };
    return splitDocument(await this.app.vault.read(file));
  }

  private async indexBookNotes(): Promise<Map<string, TFile>> {
    const result = new Map<string, TFile>();
    const booksFolder = `${normalizePath(this.settings.booksFolder)}/`;
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      let bookHash = cache?.frontmatter?.readest_book_id;
      if (!bookHash && (!cache || file.path.startsWith(booksFolder))) {
        bookHash = splitDocument(await this.app.vault.cachedRead(file)).properties.readest_book_id;
      }
      if (typeof bookHash === 'string' && !result.has(bookHash)) result.set(bookHash, file);
    }
    return result;
  }

  private uniqueBookPath(book: ReadestBook): string {
    const base = safeFilename(book.title || 'Untitled book');
    let path = normalizePath(`${this.settings.booksFolder}/${base}.md`);
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${this.settings.booksFolder}/${base} ${suffix}.md`);
      suffix += 1;
    }
    return path;
  }

  private async ensureCover(book: ReadestBook): Promise<string> {
    const key = book.cover_hash && /^[a-zA-Z0-9_-]+$/.test(book.cover_hash)
      ? `${book.book_hash}-${book.cover_hash}` : book.book_hash;
    for (const extension of ['png', 'jpg', 'webp', 'gif']) {
      const path = normalizePath(`${this.settings.coversFolder}/${key}.${extension}`);
      if (this.app.vault.getAbstractFileByPath(path) instanceof TFile) return path;
    }
    if (book.cover_hash) {
      try {
        const bytes = await this.api.downloadCover(book.book_hash);
        const extension = bytes && imageExtension(bytes);
        if (bytes && extension) {
          const path = normalizePath(`${this.settings.coversFolder}/${key}.${extension}`);
          await this.app.vault.createBinary(path, bytes);
          return path;
        }
      } catch {
        // Cover storage is optional; highlight imports must still succeed.
      }
    }
    const fallbackPath = normalizePath(`${this.settings.coversFolder}/${book.book_hash}.svg`);
    // Keep existing artwork, including SVGs the user has replaced by hand.
    if (!(this.app.vault.getAbstractFileByPath(fallbackPath) instanceof TFile)) {
      await this.app.vault.create(fallbackPath, generatedCover(book));
    }
    return fallbackPath;
  }
}

function renderFrontmatter(templateProperties: Record<string, unknown>, book: ReadestBook, coverPath: string, coversFolder: string): string {
  const metadata = parseMetadata(book.metadata);
  const progress = readProgress(book.progress);
  const priorCover = templateProperties.cover;
  const cover = typeof priorCover === 'string' && priorCover && !isManagedCover(priorCover, coversFolder, book.book_hash)
    ? priorCover : `[[${coverPath}]]`;
  const properties: Record<string, unknown> = {
    ...templateProperties,
    title: book.title || metadata.title || 'Untitled book',
    author: book.author || metadata.author || 'Unknown author',
    cover,
    format: book.format,
    progress,
    readest_book_id: book.book_hash,
    readest_updated: book.updated_at,
    tags: mergeTags(templateProperties.tags),
  };
  return `---\n${stringifyYaml(properties).trimEnd()}\n---\n`;
}

function isManagedCover(value: string, folder: string, bookHash: string): boolean {
  const prefix = normalizePath(`${folder}/${bookHash}`);
  if (value === `[[${prefix}.svg]]`) return true;
  const cover = /^\[\[([^\]]+)\]\]$/.exec(value)?.[1];
  if (!cover?.startsWith(`${prefix}-`)) return false;
  return /^[a-zA-Z0-9_-]+\.(?:png|jpg|webp|gif)$/.test(cover.slice(prefix.length + 1));
}

function generatedCover(book: ReadestBook): string {
  const palette = [
    ['#182848', '#4b6cb7', '#dce8ff'],
    ['#3a1c32', '#a13d63', '#ffe1ec'],
    ['#17332c', '#287a60', '#dcfff2'],
    ['#382718', '#a76f35', '#fff0d7'],
    ['#251d3a', '#654ea3', '#eee7ff'],
  ];
  const colors = palette[parseInt(hash(book.book_hash), 36) % palette.length]!;
  const title = escapeXml(book.title || 'Untitled');
  const author = escapeXml(book.author || 'Unknown author');
  const titleLines = wrap(book.title || 'Untitled', 22, 4).map((line, i) =>
    `<tspan x="44" dy="${i === 0 ? 0 : 42}">${escapeXml(line)}</tspan>`,
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900" role="img" aria-label="${title} by ${author}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient><filter id="s"><feDropShadow dx="0" dy="10" stdDeviation="18" flood-opacity=".2"/></filter></defs>
  <rect width="600" height="900" rx="12" fill="url(#g)"/>
  <circle cx="510" cy="105" r="180" fill="#fff" opacity=".055"/><circle cx="80" cy="820" r="240" fill="#fff" opacity=".04"/>
  <path d="M44 104h92" stroke="${colors[2]}" stroke-width="5" opacity=".85"/>
  <text x="44" y="205" fill="${colors[2]}" font-family="Georgia,serif" font-size="38" font-weight="700" filter="url(#s)">${titleLines}</text>
  <text x="44" y="760" fill="${colors[2]}" opacity=".9" font-family="system-ui,sans-serif" font-size="22" letter-spacing="1.5">${author}</text>
  <text x="44" y="830" fill="${colors[2]}" opacity=".48" font-family="system-ui,sans-serif" font-size="14" letter-spacing="4">READEST</text>
</svg>\n`;
}

interface DocumentParts { properties: Record<string, unknown>; body: string }

function splitDocument(markdown: string): DocumentParts {
  const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (!match) return { properties: {}, body: normalized };
  try {
    const parsed = parseYaml(match[1]!) as unknown;
    const properties = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : {};
    return { properties, body: normalized.slice(match[0].length) };
  } catch {
    return { properties: {}, body: normalized.slice(match[0].length) };
  }
}

function parseMetadata(value?: string | null): Record<string, string> {
  try { return JSON.parse(value ?? '{}') as Record<string, string>; } catch { return {}; }
}

function readProgress(value?: unknown[]): number {
  if (!Array.isArray(value) || !value.length) return 0;
  const candidate = value.find((item) => typeof item === 'number');
  return typeof candidate === 'number' ? Math.round(candidate * (candidate <= 1 ? 100 : 1)) : 0;
}

function mergeTags(value: unknown): string[] {
  const tags = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[ ,]+/) : [];
  return [...new Set([...tags.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0), 'readest/book'])];
}

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled book';
}

function wrap(value: string, width: number, maxLines: number): string[] {
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (!last || last.length + word.length + 1 > width) lines.push(word);
    else lines[lines.length - 1] = `${last} ${word}`;
  }
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1]!.slice(0, width - 1)}…`;
  }
  return lines;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function ensureFolder(vault: Vault, path: string): Promise<void> {
  const normalized = normalizePath(path);
  if (!normalized || vault.getAbstractFileByPath(normalized)) return;
  const parent = parentPath(normalized);
  if (parent) await ensureFolder(vault, parent);
  await vault.createFolder(normalized);
}

function parentPath(path: string): string {
  return normalizePath(path.split('/').slice(0, -1).join('/'));
}

function groupAnnotations(items: ReadestAnnotation[]): Map<string, ReadestAnnotation[]> {
  const result = new Map<string, ReadestAnnotation[]>();
  for (const item of items) {
    const group = result.get(item.book_hash) ?? [];
    group.push(item);
    result.set(item.book_hash, group);
  }
  return result;
}
