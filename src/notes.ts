/**
 * Idempotent note upsert keyed on the FeedSparc `sourceId`.
 *
 * The vault is reached only through {@link NoteRepository}, so the resolution
 * order below is exercised by unit tests without an Obsidian runtime.
 */

/** Persisted `sourceId -> vault path` map. */
export type SourceMap = Record<string, string>;

export interface NoteRepository {
  /** Called once per sync cycle; implementations may drop per-cycle caches. */
  beginCycle(): void;
  /** Creates `folder` and any missing parents. No-op for an empty folder. */
  ensureFolder(folder: string): Promise<void>;
  fileExists(path: string): boolean;
  /** `source_id` of the note at `path`; null when absent, unreadable or not a note. */
  sourceIdAt(path: string): string | null;
  /** Path of any note whose frontmatter `source_id` matches, else null. */
  findBySourceId(sourceId: string): string | null;
  /** Overwrites an existing note; rejects if `path` holds no note. */
  overwrite(path: string, contents: string): Promise<void>;
  /** Creates a new note; rejects if `path` is taken. */
  create(path: string, contents: string): Promise<void>;
}

export interface UpsertRequest {
  sourceId: string;
  /** Destination folder, vault-relative; empty string means vault root. */
  folder: string;
  /** Sanitized base name without the `.md` extension. */
  baseName: string;
  contents: string;
}

export type UpsertAction =
  /** The persisted mapping still pointed at a live note. */
  | "updated"
  /** The mapping was stale; a note with a matching `source_id` was re-adopted. */
  | "adopted"
  /** No existing note matched; a new one was written. */
  | "created";

export interface UpsertOutcome {
  path: string;
  action: UpsertAction;
}

/** How many ` 2`, ` 3`, … variants to try before falling back to the source id. */
const MAX_COLLISION_SUFFIX = 50;

export class NoteUpserter {
  private readonly repository: NoteRepository;
  private readonly sourceMap: SourceMap;

  /** `sourceMap` is mutated in place; the caller persists it after the cycle. */
  constructor(repository: NoteRepository, sourceMap: SourceMap) {
    this.repository = repository;
    this.sourceMap = sourceMap;
  }

  async upsert(request: UpsertRequest): Promise<UpsertOutcome> {
    const mapped = this.sourceMap[request.sourceId];
    if (mapped !== undefined && this.repository.fileExists(mapped)) {
      const owner = this.repository.sourceIdAt(mapped);
      // A stale mapping can point at a note the user has since replaced. Reuse
      // the path only when it is still ours, or carries no source_id at all
      // (which is also the case while the metadata cache is still cold).
      if (owner === null || owner === request.sourceId) {
        await this.repository.overwrite(mapped, request.contents);
        return { path: mapped, action: "updated" };
      }
    }

    const existing = this.repository.findBySourceId(request.sourceId);
    if (existing !== null) {
      await this.repository.overwrite(existing, request.contents);
      this.sourceMap[request.sourceId] = existing;
      return { path: existing, action: "adopted" };
    }

    await this.repository.ensureFolder(request.folder);
    const path = this.freePath(request);
    await this.repository.create(path, request.contents);
    this.sourceMap[request.sourceId] = path;
    return { path, action: "created" };
  }

  /**
   * Finds an unused path for a brand-new note. Collisions here are notes that
   * belong to something else, so the item gets a numbered variant instead of
   * clobbering them; the source id is the last-resort unique suffix.
   */
  private freePath(request: UpsertRequest): string {
    const prefix = request.folder.length > 0 ? `${request.folder}/` : "";
    let candidate = `${prefix}${request.baseName}.md`;
    for (let suffix = 2; suffix <= MAX_COLLISION_SUFFIX; suffix += 1) {
      if (!this.repository.fileExists(candidate)) return candidate;
      candidate = `${prefix}${request.baseName} ${suffix}.md`;
    }
    if (!this.repository.fileExists(candidate)) return candidate;
    return `${prefix}${request.baseName} ${request.sourceId}.md`;
  }
}
