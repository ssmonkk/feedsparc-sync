import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { FeedSparcApi } from "./api";
import { isRecord, readString } from "./json";
import type { SourceMap } from "./notes";
import { DEFAULT_BODY_TEMPLATE, DEFAULT_FILENAME_TEMPLATE, DEFAULT_FRONTMATTER_TEMPLATE, TEMPLATE_VARIABLES } from "./template";

export interface FeedSparcSettings {
  baseUrl: string;
  token: string;
  folder: string;
  intervalMinutes: number;
  fileNameTemplate: string;
  frontmatterTemplate: string;
  bodyTemplate: string;
}

export const DEFAULT_SETTINGS: FeedSparcSettings = {
  baseUrl: "",
  token: "",
  folder: "FeedSparc",
  intervalMinutes: 60,
  fileNameTemplate: DEFAULT_FILENAME_TEMPLATE,
  frontmatterTemplate: DEFAULT_FRONTMATTER_TEMPLATE,
  bodyTemplate: DEFAULT_BODY_TEMPLATE,
};

export interface PersistedData {
  settings: FeedSparcSettings;
  sourceMap: SourceMap;
}

function readTemplateString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" ? value : null;
}

export function parsePersistedData(payload: unknown): PersistedData {
  const data: PersistedData = {
    settings: { ...DEFAULT_SETTINGS },
    sourceMap: {},
  };
  if (!isRecord(payload)) return data;

  const rawSettings = payload["settings"];
  if (isRecord(rawSettings)) {
    data.settings.baseUrl = readString(rawSettings, "baseUrl") ?? data.settings.baseUrl;
    data.settings.token = readString(rawSettings, "token") ?? data.settings.token;
    const rawInterval = rawSettings["intervalMinutes"];
    if (typeof rawInterval === "number" && Number.isFinite(rawInterval) && rawInterval >= 0) {
      data.settings.intervalMinutes = Math.floor(rawInterval);
    }
    
    // Blank templates are allowed (e.g. users might want no frontmatter).
    data.settings.fileNameTemplate = readTemplateString(rawSettings, "fileNameTemplate") ?? data.settings.fileNameTemplate;
    data.settings.frontmatterTemplate = readTemplateString(rawSettings, "frontmatterTemplate") ?? data.settings.frontmatterTemplate;
    data.settings.bodyTemplate = readTemplateString(rawSettings, "bodyTemplate") ?? data.settings.bodyTemplate;
  }

  const rawMap = payload["sourceMap"];
  if (isRecord(rawMap)) {
    for (const [key, value] of Object.entries(rawMap)) {
      if (typeof value === "string") data.sourceMap[key] = value;
    }
  }

  return data;
}
/** The plugin interface needed to trigger interval re-registration. */
export interface SettingsHost {
  settings: FeedSparcSettings;
  persist(): Promise<void>;
  applyInterval(): void;
}

export class FeedSparcSettingTab extends PluginSettingTab {
  private readonly host: SettingsHost;

  constructor(app: App, plugin: Plugin, host: SettingsHost) {
    super(app, plugin);
    this.host = host;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.host.settings;
    const save = async () => await this.host.persist();

    new Setting(containerEl)
      .setName("API Base URL")
      .setDesc("FeedSparc がホストされている URL（例: https://feedsparc.com）")
      .addText(text => text
        .setPlaceholder("https://")
        .setValue(s.baseUrl)
        .onChange(async value => {
          s.baseUrl = value;
          await save();
        }));

    new Setting(containerEl)
      .setName("API トークン")
      .setDesc("FeedSparc の設定画面で発行したエクスポート用トークン。")
      .addText(text => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("トークンを入力")
          .setValue(s.token)
          .onChange(async value => {
            s.token = value;
            await save();
          });
      });

    const testContainer = containerEl.createDiv({ cls: "setting-item" });
    const testButton = testContainer.createEl("button", { text: "接続テスト" });
    testButton.onclick = async () => {
      testButton.disabled = true;
      testButton.textContent = "テスト中...";
      try {
        const api = new FeedSparcApi({ baseUrl: s.baseUrl, token: s.token });
        const count = await api.testConnection();
        new Notice(`接続成功！待機中の記事: ${count}件`);
      } catch (error) {
        new Notice(`エラー: ${error instanceof Error ? error.message : "不明"}`);
      } finally {
        testButton.disabled = false;
        testButton.textContent = "接続テスト";
      }
    };

    new Setting(containerEl)
      .setName("保存先フォルダ")
      .setDesc("ノートを保存するフォルダ。空の場合は Vault 直下。")
      .addText(text => text
        .setValue(s.folder)
        .onChange(async value => {
          s.folder = value;
          await save();
        }));

    new Setting(containerEl)
      .setName("自動同期の間隔（分）")
      .setDesc("0 にすると手動同期（コマンド）のみになります。")
      .addText(text => {
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text
          .setValue(s.intervalMinutes.toString())
          .onChange(async value => {
            const parsed = Number.parseInt(value, 10);
            if (!Number.isNaN(parsed) && parsed >= 0) {
              s.intervalMinutes = parsed;
              await save();
              this.host.applyInterval();
            }
          });
      });

    const vars = `利用可能な変数: ${TEMPLATE_VARIABLES.map(v => `{{${v}}}`).join(" ")}`;

    containerEl.createEl("h3", { text: "テンプレート" });

    new Setting(containerEl)
      .setName("ファイル名")
      .setDesc(vars)
      .addText(text => text
        .setValue(s.fileNameTemplate)
        .onChange(async value => {
          s.fileNameTemplate = value;
          await save();
        }));

    new Setting(containerEl)
      .setName("フロントマター")
      .setDesc("YAML 形式。source_id が自動で追加されます。")
      .addTextArea(text => {
        text.inputEl.rows = 6;
        text.inputEl.style.width = "100%";
        text
          .setValue(s.frontmatterTemplate)
          .onChange(async value => {
            s.frontmatterTemplate = value;
            await save();
          });
      });

    new Setting(containerEl)
      .setName("本文")
      .setDesc(vars)
      .addTextArea(text => {
        text.inputEl.rows = 8;
        text.inputEl.style.width = "100%";
        text
          .setValue(s.bodyTemplate)
          .onChange(async value => {
            s.bodyTemplate = value;
            await save();
          });
      });
  }
}
