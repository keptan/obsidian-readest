import { App, Notice, PluginSettingTab, Setting, type SettingDefinitionItem } from 'obsidian';
import type ReadestPlugin from './main';

type SettingKey = 'email' | 'booksFolder' | 'coversFolder' | 'templatePath' | 'pollMinutes' | 'syncOnStartup';

export class ReadestSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ReadestPlugin) { super(app, plugin); }

  getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
    return [
      {
        type: 'group',
        heading: 'Account',
        items: [
          {
            name: 'Readest email',
            desc: 'The email address used to sign in to Readest.',
            aliases: ['account', 'login', 'username'],
            control: {
              type: 'text', key: 'email', placeholder: 'you@example.com',
              validate: (value) => value.length === 0 || /^\S+@\S+\.\S+$/.test(value.trim())
                ? undefined : 'Enter a valid email address.',
            },
          },
          {
            name: this.plugin.isConnected() ? 'Readest account connected' : 'Connect Readest account',
            desc: this.plugin.isConnected()
              ? 'The renewable session is protected by Obsidian SecretStorage. The plugin never stores your password.'
              : 'Enter your password to create a renewable session. Your password is used once and never saved.',
            aliases: ['password', 'sign in', 'disconnect', 'session'],
            render: (setting) => this.renderConnection(setting),
          },
        ],
      },
      {
        type: 'group',
        heading: 'Library',
        items: [
          { name: 'Book notes folder', desc: 'One editable Markdown note is created for each Readest book.', aliases: ['books', 'notes', 'location'], control: { type: 'folder', key: 'booksFolder', placeholder: 'Readest/Books', validate: validateVaultPath } },
          { name: 'Covers folder', desc: 'Local cover images linked from book note properties.', aliases: ['images', 'artwork'], control: { type: 'folder', key: 'coversFolder', placeholder: 'Readest/Covers', validate: validateVaultPath } },
          { name: 'Book note template', desc: 'Optional Markdown template for new book notes. Its properties, tags, and body are preserved; Readest properties are added or refreshed.', aliases: ['template', 'frontmatter', 'properties', 'tags'], control: { type: 'file', key: 'templatePath', placeholder: 'Templates/Book.md', filter: (file) => file.extension === 'md', validate: (value) => value.length === 0 ? undefined : validateVaultPath(value) } },
        ],
      },
      {
        type: 'group',
        heading: 'Synchronization',
        items: [
          { name: 'Sync on startup', desc: 'Check for new books and highlights after Obsidian opens.', aliases: ['automatic import'], control: { type: 'toggle', key: 'syncOnStartup', defaultValue: true } },
          { name: 'Polling interval', desc: 'Minutes between checks while Obsidian is open. Set to 0 for manual sync only.', aliases: ['frequency', 'automatic sync'], control: { type: 'number', key: 'pollMinutes', defaultValue: 15, min: 0, max: 1440, step: 1, validate: (value) => Number.isInteger(value) ? undefined : 'Use a whole number of minutes.' } },
          { name: 'Sync now', desc: 'Import the latest library and highlights. Nothing is written back to Readest.', aliases: ['import', 'refresh'], disabled: () => !this.plugin.isConnected(), action: () => this.plugin.triggerSync(true) },
        ],
      },
    ];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const settingKey = key as SettingKey;
    if (!(settingKey in this.plugin.settings)) return;
    (this.plugin.settings as unknown as Record<string, unknown>)[settingKey] = typeof value === 'string' ? value.trim() : value;
    await this.plugin.saveSettings();
    if (settingKey === 'pollMinutes') this.plugin.resetPolling();
  }

  private renderConnection(setting: Setting): () => void {
    let password = '';
    let passwordInput: HTMLInputElement | null = null;
    setting.addText((text) => {
      text.setPlaceholder('Password');
      text.inputEl.type = 'password';
      text.inputEl.autocomplete = 'current-password';
      passwordInput = text.inputEl;
      text.onChange((value) => { password = value; });
    });
    setting.addButton((button) => button.setButtonText(this.plugin.isConnected() ? 'Reconnect' : 'Connect').setCta().onClick(async () => {
      button.setDisabled(true);
      try {
        await this.plugin.connect(password);
        password = '';
        new Notice('Connected to Readest.');
        this.update();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : 'Could not connect to Readest.');
      } finally {
        button.setDisabled(false);
      }
    }));
    setting.addExtraButton((button) => button.setIcon('log-out').setTooltip('Disconnect Readest account').setDisabled(!this.plugin.isConnected()).onClick(async () => {
      await this.plugin.disconnect();
      new Notice('Disconnected from Readest.');
      this.update();
    }));
    return () => { if (passwordInput) passwordInput.value = ''; };
  }
}

function validateVaultPath(value: string): string | undefined {
  const path = value.trim();
  if (!path) return 'Enter a vault-relative path.';
  if (path.startsWith('/') || path.includes('..') || /[\\:*?"<>|]/.test(path)) return 'Use a safe path relative to the vault root.';
  return undefined;
}
