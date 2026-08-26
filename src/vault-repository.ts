import { normalizePath, TFile, type App } from "obsidian";
import type { NoteRepository } from "./notes";
import { SOURCE_ID_KEY } from "./template";

/**
 * {@link NoteRepository} backed by the real vault.
 *
 * `findBySourceId` is a full scan of the metadata cache, so results are indexed
 * once per sync cycle instead of once per item.
 */
export class VaultNoteRepository implements NoteRepository {
  private readonly app: App;
  private index: Map<string, string> | null = null;

  constructor(app: App) {
    this.app = app;
  }

  beginCycle(): void {
    this.index = null;
  }

  async ensureFolder(folder: string): Promise<void> {
    const normalized = normalizePath(folder);
    if (normalized.length === 0 || normalized === "/" || normalized === ".") return;

    // createFolder does not reliably create intermediate folders across
    // versions, and throws when a folder already exists, so walk the segments.
    const segments = normalized.split("/").filter((segment) => segment.length > 0);
    let current = "";
    for (const segment of segments) {
      current = current.length > 0 ? `${current}/${segment}` : segment;
      if (this.app.vault.getAbstractFileByPath(current) !== null) continue;
      await this.app.vault.createFolder(current);
    }
  }

  fileExists(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(normalizePath(path)) !== null;
  }

  sourceIdAt(path: string): string | null {
    const file = this.noteAt(path);
    return file === null ? null : this.readSourceId(file);
  }

  findBySourceId(sourceId: string): string | null {
    if (this.index === null) {
      const index = new Map<string, string>();
      for (const file of this.app.vault.getMarkdownFiles()) {
        const id = this.readSourceId(file);
        // First match wins; a duplicated id in the vault is the user's doing.
        if (id !== null && !index.has(id)) index.set(id, file.path);
      }
      this.index = index;
    }
    return this.index.get(sourceId) ?? null;
  }

  async overwrite(path: string, contents: string): Promise<void> {
    const file = this.noteAt(path);
    if (file === null) throw new Error(`ノートが見つかりません: ${path}`);
    await this.app.vault.modify(file, contents);
  }

  async create(path: string, contents: string): Promise<void> {
    const file = await this.app.vault.create(normalizePath(path), contents);
    if (this.index !== null) {
      const id = this.readSourceId(file);
      if (id !== null) this.index.set(id, file.path);
    }
  }

  private noteAt(path: string): TFile | null {
    const found = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return found instanceof TFile ? found : null;
  }

  private readSourceId(file: TFile): string | null {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (frontmatter === undefined) return null;
    // FrontMatterCache is an `any` index signature; Reflect.get keeps it unknown.
    const value: unknown = Reflect.get(frontmatter, SOURCE_ID_KEY);
    return typeof value === "string" && value.length > 0 ? value : null;
  }
}
