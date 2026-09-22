export interface ReadestBook {
  book_hash: string;
  format: string;
  title: string;
  author: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  uploaded_at: string | null;
  progress?: unknown[];
  reading_status?: string | null;
  cover_hash?: string | null;
  metadata?: string | null;
}

export interface ReadestAnnotation {
  book_hash: string;
  meta_hash: string;
  id: string;
  type: string;
  cfi?: string | null;
  page?: number | null;
  text?: string | null;
  style?: string | null;
  color?: string | null;
  note?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface SyncResponse {
  books?: ReadestBook[];
  notes?: ReadestAnnotation[];
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  anonKey: string;
  userId: string;
}

export interface ReadestSettings {
  email: string;
  booksFolder: string;
  coversFolder: string;
  templatePath: string;
  pollMinutes: number;
  syncOnStartup: boolean;
}

export interface HighlightStateEntry {
  source: string;
  rendered: string;
  page: number | null;
  cfi: string;
}

export type HighlightBookState = Record<string, HighlightStateEntry>;
export type HighlightState = Record<string, HighlightBookState>;

export interface SyncSummary {
  books: number;
  created: number;
  updated: number;
  newHighlights: number;
}
