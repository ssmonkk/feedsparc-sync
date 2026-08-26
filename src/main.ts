import { Notice, Plugin } from "obsidian";
import { VaultNoteRepository } from "./vault-repository";
import { SyncEngine } from "./sync";
import { parsePersistedData, RSSAgentSettingTab, type PersistedData } from "./settings";
import { DEFAULT_SETTINGS } from "./settings";

export default class RSSAgentPlugin extends Plugin {
  private data: PersistedData = {
    settings: { ...DEFAULT_SETTINGS },
    sourceMap: {},
  };
  private engine!: SyncEngine;
  private intervalId: number | null = null;

  override async onload(): Promise<void> {
    const raw = await this.loadData();
    this.data = parsePersistedData(raw);

    const repository = new VaultNoteRepository(this.app);
    this.engine = new SyncEngine(repository, {
      settings: this.data.settings,
      sourceMap: this.data.sourceMap,
      persist: async () => await this.saveData(this.data),
      notify: (message: string) => new Notice(message),
    });

    this.addSettingTab(
      new RSSAgentSettingTab(this.app, {
        settings: this.data.settings,
        persist: async () => await this.saveData(this.data),
        applyInterval: () => this.applyInterval(),
      }),
    );

    this.addCommand({
      id: "rssagent-sync-now",
      name: "Sync now",
      callback: () => {
        // Errors are surfaced as Notices inside the engine.
        this.engine.run({ silent: false }).catch(() => {});
      },
    });

    this.applyInterval();
  }

  override onunload(): void {
    if (this.intervalId !== null) window.clearInterval(this.intervalId);
  }

  /**
   * Schedules the background sync interval, replacing any existing one.
   * `registerInterval` ensures Obsidian also clears it if the plugin unloads,
   * while tracking the id ourselves lets us tear it down on setting changes.
   */
  private applyInterval(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }

    const minutes = this.data.settings.intervalMinutes;
    if (minutes <= 0) return;

    this.intervalId = window.setInterval(() => {
      this.engine.run({ silent: true }).catch(() => {});
    }, minutes * 60 * 1000);
    
    // Register so Obsidian cleans it up; safe to call repeatedly with stale IDs.
    this.registerInterval(this.intervalId);
  }
}
