import { normalizePath, Notice, Plugin } from 'obsidian';
import { ReadestApi } from './api';
import { LibraryWriter } from './library';
import { ReadestSettingTab } from './settings';
import type { HighlightState, ReadestSettings, SyncSummary } from './types';

const DEFAULT_SETTINGS: ReadestSettings = {
  email: '',
  booksFolder: 'Readest/Books',
  coversFolder: 'Readest/Covers',
  templatePath: '',
  pollMinutes: 15,
  syncOnStartup: true,
};

const SESSION_SECRET_ID = 'readest-highlights-session';

export default class ReadestPlugin extends Plugin {
  settings: ReadestSettings = DEFAULT_SETTINGS;
  private api = new ReadestApi(null);
  private syncing: Promise<SyncSummary> | null = null;
  private statusEl: HTMLElement | null = null;
  private pollTimer: number | null = null;
  private highlightState: HighlightState = {};

  async onload(): Promise<void> {
    type StoredData = Partial<ReadestSettings> & {
      session?: import('./types').Session | null;
      highlightState?: HighlightState;
    };
    let stored = await this.loadData() as StoredData | null;
    if (!stored || Object.keys(stored).length === 0) {
      // The development builds used another plugin ID. Import their sidecar
      // once so existing highlight blocks keep their identity after renaming.
      const oldPath = normalizePath(`${this.app.vault.configDir}/plugins/readest-highlights/data.json`);
      try {
        stored = JSON.parse(await this.app.vault.adapter.read(oldPath)) as StoredData;
      } catch {
        stored = null;
      }
    }
    this.settings = {
      email: stored?.email ?? DEFAULT_SETTINGS.email,
      booksFolder: stored?.booksFolder ?? DEFAULT_SETTINGS.booksFolder,
      coversFolder: stored?.coversFolder ?? DEFAULT_SETTINGS.coversFolder,
      templatePath: stored?.templatePath ?? DEFAULT_SETTINGS.templatePath,
      pollMinutes: stored?.pollMinutes ?? DEFAULT_SETTINGS.pollMinutes,
      syncOnStartup: stored?.syncOnStartup ?? DEFAULT_SETTINGS.syncOnStartup,
    };
    this.highlightState = stored?.highlightState ?? {};
    let session = readSessionSecret(this.app.secretStorage.getSecret(SESSION_SECRET_ID));
    // Migrate sessions created by v0.1 out of data.json and into Obsidian's
    // encrypted SecretStorage on the first load under 1.13+.
    if (!session && stored?.session) {
      session = stored.session;
      this.app.secretStorage.setSecret(SESSION_SECRET_ID, JSON.stringify(session));
      delete stored.session;
      await this.saveSettings();
    }
    this.api.setSession(session);
    if (stored) await this.saveSettings();
    this.addSettingTab(new ReadestSettingTab(this.app, this));
    this.addRibbonIcon('book-open-text', 'Sync Readest highlights', () => this.triggerSync(true));
    const statusEl = this.addStatusBarItem();
    this.statusEl = statusEl;
    statusEl.addClass('readest-status');
    statusEl.setText('Readest');
    statusEl.setAttribute('aria-label', 'Readest sync is ready');
    statusEl.addEventListener('click', () => this.triggerSync(true));

    this.addCommand({ id: 'sync-now', name: 'Sync library and highlights', callback: () => this.triggerSync(true) });
    this.resetPolling();
    if (this.settings.syncOnStartup && this.isConnected()) {
      this.app.workspace.onLayoutReady(() => window.setTimeout(() => this.triggerSync(false), 1500));
    }
  }

  async connect(password: string): Promise<void> {
    if (!this.settings.email) throw new Error('Enter your Readest email address.');
    if (!password) throw new Error('Enter your Readest password.');
    const session = await this.api.login(this.settings.email, password);
    this.app.secretStorage.setSecret(SESSION_SECRET_ID, JSON.stringify(session));
    await this.saveSettings();
  }

  async disconnect(): Promise<void> {
    this.api.setSession(null);
    this.app.secretStorage.setSecret(SESSION_SECRET_ID, '');
    await this.saveSettings();
  }

  isConnected(): boolean {
    return this.api.getSession() !== null;
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ ...this.settings, highlightState: this.highlightState });
  }

  resetPolling(): void {
    if (this.pollTimer != null) window.clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.settings.pollMinutes > 0) {
      this.pollTimer = window.setInterval(() => this.triggerSync(false), this.settings.pollMinutes * 60_000);
      this.registerInterval(this.pollTimer);
    }
  }

  async sync(showNotice: boolean): Promise<SyncSummary> {
    if (this.syncing) return this.syncing;
    this.syncing = this.performSync(showNotice).finally(() => { this.syncing = null; });
    return this.syncing;
  }

  triggerSync(showNotice: boolean): void {
    void this.sync(showNotice).catch(() => {
      // performSync has already surfaced the error through plugin status and,
      // for user-triggered syncs, a Notice.
    });
  }

  private async performSync(showNotice: boolean): Promise<SyncSummary> {
    this.setStatus('syncing', 'Readest: syncing…');
    try {
      const [bookResponse, noteResponse] = await Promise.all([this.api.pull('books'), this.api.pull('notes')]);
      const writer = new LibraryWriter(this.app, this.settings, this.highlightState, this.api);
      const summary = await writer.write(bookResponse.books ?? [], noteResponse.notes ?? []);
      const refreshedSession = this.api.getSession();
      if (refreshedSession) this.app.secretStorage.setSecret(SESSION_SECRET_ID, JSON.stringify(refreshedSession));
      await this.saveSettings();
      const message = `Readest: ${summary.books} books · ${summary.newHighlights} new highlights`;
      this.setStatus('ready', message);
      if (showNotice) new Notice(message);
      return summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Readest sync failed.';
      this.setStatus('error', `Readest: ${message}`);
      if (showNotice) new Notice(message, 8000);
      throw error;
    }
  }

  private setStatus(state: 'syncing' | 'ready' | 'error', label: string): void {
    if (!this.statusEl) return;
    this.statusEl.dataset.state = state;
    this.statusEl.setText(state === 'syncing' ? 'Readest ↻' : state === 'error' ? 'Readest !' : 'Readest ✓');
    this.statusEl.setAttribute('aria-label', label);
  }
}

function readSessionSecret(value: string | null): import('./types').Session | null {
  if (!value) return null;
  try {
    const session = JSON.parse(value) as import('./types').Session;
    return session.accessToken && session.refreshToken && session.anonKey ? session : null;
  } catch {
    return null;
  }
}
