import { requestUrl } from 'obsidian';
import type { Session, SyncResponse } from './types';

const ORIGIN = 'https://web.readest.com';
const SUPABASE = 'https://readest.supabase.co';

interface SupabaseAuthResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id?: string };
  error_description?: string;
  message?: string;
}

export class ReadestApi {
  private refreshing: Promise<Session> | null = null;

  constructor(private session: Session | null) {}

  setSession(session: Session | null): void {
    this.session = session;
  }

  getSession(): Session | null {
    return this.session;
  }

  async login(email: string, password: string): Promise<Session> {
    const anonKey = await discoverAnonKey();
    const result = await authRequest(`${SUPABASE}/auth/v1/token?grant_type=password`, anonKey, {
      email,
      password,
    });
    const session = toSession(result, anonKey);
    this.session = session;
    return session;
  }

  async refresh(): Promise<Session> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async doRefresh(): Promise<Session> {
    if (!this.session?.refreshToken) throw new Error('Please connect your Readest account again.');
    const result = await authRequest(
      `${SUPABASE}/auth/v1/token?grant_type=refresh_token`,
      this.session.anonKey,
      { refresh_token: this.session.refreshToken },
    );
    const session = toSession(result, this.session.anonKey);
    this.session = session;
    return session;
  }

  async pull(type: 'books' | 'notes'): Promise<SyncResponse> {
    await this.ensureSession();
    let response = await requestUrl({
      url: `${ORIGIN}/api/sync?since=0&type=${type}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${this.session!.accessToken}` },
      throw: false,
    });
    if (response.status === 401 || response.status === 403) {
      await this.refresh();
      response = await requestUrl({
        url: `${ORIGIN}/api/sync?since=0&type=${type}`,
        method: 'GET',
        headers: { Authorization: `Bearer ${this.session!.accessToken}` },
        throw: false,
      });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(readError(response.json, `Readest returned HTTP ${response.status}.`));
    }
    return response.json as SyncResponse;
  }

  async downloadCover(bookHash: string): Promise<ArrayBuffer | null> {
    if (!/^[a-zA-Z0-9_-]+$/.test(bookHash)) return null;
    await this.ensureSession();
    const fileKey = `${this.session!.userId}/Readest/Books/${bookHash}/cover.png`;
    let response = await requestUrl({
      url: `${ORIGIN}/api/storage/download?fileKey=${encodeURIComponent(fileKey)}`,
      headers: { Authorization: `Bearer ${this.session!.accessToken}` },
      throw: false,
    });
    if (response.status === 401 || response.status === 403) {
      await this.refresh();
      response = await requestUrl({
        url: `${ORIGIN}/api/storage/download?fileKey=${encodeURIComponent(fileKey)}`,
        headers: { Authorization: `Bearer ${this.session!.accessToken}` },
        throw: false,
      });
    }
    if (response.status === 404) return null;
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Readest cover request failed (${response.status}).`);
    }
    const downloadUrl = (response.json as { downloadUrl?: unknown }).downloadUrl;
    if (typeof downloadUrl !== 'string' || new URL(downloadUrl).protocol !== 'https:') return null;
    // Signed storage URLs are fetched without the Readest bearer token.
    const image = await requestUrl({ url: downloadUrl, throw: false });
    if (image.status < 200 || image.status >= 300) return null;
    return image.arrayBuffer.byteLength <= 10 * 1024 * 1024 ? image.arrayBuffer : null;
  }

  private async ensureSession(): Promise<void> {
    if (!this.session) throw new Error('Connect your Readest account in plugin settings first.');
    if (this.session.expiresAt < Date.now() + 60_000) await this.refresh();
  }
}

async function authRequest(url: string, anonKey: string, body: object): Promise<SupabaseAuthResponse> {
  const response = await requestUrl({
    url,
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    throw: false,
  });
  const result = response.json as SupabaseAuthResponse;
  if (response.status < 200 || response.status >= 300 || !result.access_token) {
    throw new Error(result.error_description ?? result.message ?? `Authentication failed (${response.status}).`);
  }
  return result;
}

function toSession(result: SupabaseAuthResponse, anonKey: string): Session {
  if (!result.access_token || !result.refresh_token || !result.user?.id) {
    throw new Error('Readest returned an incomplete session.');
  }
  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    expiresAt: Date.now() + (result.expires_in ?? 3600) * 1000,
    anonKey,
    userId: result.user.id,
  };
}

async function discoverAnonKey(): Promise<string> {
  const home = await requestUrl({ url: ORIGIN, throw: false });
  if (home.status < 200 || home.status >= 300) throw new Error('Could not reach Readest.');
  const paths = [...home.text.matchAll(/src=["']([^"']+\.js[^"']*)["']/g)].map((match) => match[1]!);
  for (const batch of chunk(paths, 8)) {
    const sources = await Promise.all(batch.map(async (path) => {
      try {
        return (await requestUrl({ url: new URL(path, ORIGIN).toString(), throw: false })).text;
      } catch {
        return '';
      }
    }));
    for (const source of sources) {
      const direct = source.match(/eyJ[A-Za-z0-9_-]{80,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? [];
      const encoded = [...source.matchAll(/atob\(["']([A-Za-z0-9+/=]{100,})["']\)/g)]
        .map((match) => decodeBase64(match[1]!));
      for (const candidate of [...direct, ...encoded]) {
        if (jwtRole(candidate) === 'anon') return candidate;
      }
    }
  }
  throw new Error('Readest changed its public authentication configuration. Please update the plugin.');
}

function decodeBase64(value: string): string {
  try { return atob(value); } catch { return ''; }
}

function jwtRole(jwt: string): string | null {
  try {
    const payload = jwt.split('.')[1];
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).role ?? null;
  } catch {
    return null;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function readError(value: unknown, fallback: string): string {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.error === 'string') return record.error;
    if (typeof record.message === 'string') return record.message;
  }
  return fallback;
}
