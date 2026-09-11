import { describe, it, expect, beforeEach } from "bun:test";
import { NoteUpserter, type NoteRepository, type SourceMap } from "./notes";

/** In-memory vault stand-in: path -> { contents, sourceId }. */
class FakeRepository implements NoteRepository {
  files = new Map<string, { contents: string; sourceId: string | null }>();
  folders = new Set<string>();

  beginCycle(): void {
    // No per-cycle cache to drop in the fake.
  }

  async ensureFolder(folder: string): Promise<void> {
    if (folder.length > 0) this.folders.add(folder);
  }

  fileExists(path: string): boolean {
    return this.files.has(path);
  }

  sourceIdAt(path: string): string | null {
    return this.files.get(path)?.sourceId ?? null;
  }

  findBySourceId(sourceId: string): string | null {
    for (const [path, file] of this.files) {
      if (file.sourceId === sourceId) return path;
    }
    return null;
  }

  async overwrite(path: string, contents: string): Promise<void> {
    const existing = this.files.get(path);
    if (existing === undefined) throw new Error(`no note at ${path}`);
    this.files.set(path, { contents, sourceId: existing.sourceId });
  }

  async create(path: string, contents: string): Promise<void> {
    if (this.files.has(path)) throw new Error(`already exists: ${path}`);
    // Simulate the vault deriving source_id from the written frontmatter.
    const match = /^source_id:\s*"([^"]*)"/m.exec(contents);
    this.files.set(path, { contents, sourceId: match?.[1] ?? null });
  }
}

function request(overrides: Partial<{ sourceId: string; folder: string; baseName: string; contents: string }> = {}) {
  return {
    sourceId: "src-1",
    folder: "FeedSparc",
    baseName: "My Article",
    contents: 'source_id: "src-1"\n---\nbody',
    ...overrides,
  };
}

describe("NoteUpserter", () => {
  let repo: FakeRepository;
  let sourceMap: SourceMap;
  let upserter: NoteUpserter;

  beforeEach(() => {
    repo = new FakeRepository();
    sourceMap = {};
    upserter = new NoteUpserter(repo, sourceMap);
  });

  it("creates a new note and records the mapping when nothing exists yet", async () => {
    const outcome = await upserter.upsert(request());
    expect(outcome).toEqual({ path: "FeedSparc/My Article.md", action: "created" });
    expect(sourceMap["src-1"]).toBe("FeedSparc/My Article.md");
    expect(repo.folders.has("FeedSparc")).toBe(true);
  });

  it("updates in place via the mapping when the mapped note is still ours", async () => {
    await upserter.upsert(request());
    const outcome = await upserter.upsert(request({ contents: 'source_id: "src-1"\n---\nnew body' }));
    expect(outcome).toEqual({ path: "FeedSparc/My Article.md", action: "updated" });
    expect(repo.files.size).toBe(1);
    expect(repo.files.get("FeedSparc/My Article.md")?.contents).toContain("new body");
  });

  it("re-adopts a note found by source_id when the mapping is stale", async () => {
    // Simulate a note that already exists in the vault (e.g. user moved it,
    // or it predates this plugin instance's sourceMap) without going through
    // upsert first.
    await repo.create("Moved/My Article.md", 'source_id: "src-1"\n---\nbody');
    const outcome = await upserter.upsert(request());
    expect(outcome).toEqual({ path: "Moved/My Article.md", action: "adopted" });
    expect(sourceMap["src-1"]).toBe("Moved/My Article.md");
  });

  it("does not reuse the mapped path when a different note now owns it", async () => {
    // The mapping points at a path, but that file now belongs to a different
    // source_id (user overwrote it with unrelated content) — must not clobber.
    sourceMap["src-1"] = "FeedSparc/Taken.md";
    await repo.create("FeedSparc/Taken.md", 'source_id: "someone-else"\n---\nbody');
    const outcome = await upserter.upsert(request());
    expect(outcome.action).toBe("created");
    expect(outcome.path).not.toBe("FeedSparc/Taken.md");
  });

  it("reuses the mapped path when its source_id is unreadable (cold metadata cache)", async () => {
    sourceMap["src-1"] = "FeedSparc/Cold.md";
    // A file exists at the mapped path but the fake reports no readable
    // source_id yet, mirroring a cold Obsidian metadataCache.
    repo.files.set("FeedSparc/Cold.md", { contents: "stale", sourceId: null });
    const outcome = await upserter.upsert(request());
    expect(outcome).toEqual({ path: "FeedSparc/Cold.md", action: "updated" });
  });

  it("numbers a colliding filename instead of clobbering an unrelated note", async () => {
    await repo.create("FeedSparc/My Article.md", "unrelated note, no source_id");
    const outcome = await upserter.upsert(request());
    expect(outcome).toEqual({ path: "FeedSparc/My Article 2.md", action: "created" });
  });

  it("falls back to the source id suffix once numbered variants are exhausted", async () => {
    await repo.create("FeedSparc/My Article.md", "unrelated");
    for (let i = 2; i <= 50; i += 1) {
      await repo.create(`FeedSparc/My Article ${i}.md`, "unrelated");
    }
    const outcome = await upserter.upsert(request());
    expect(outcome.path).toBe("FeedSparc/My Article src-1.md");
    expect(outcome.action).toBe("created");
  });

  it("writes directly to the vault root when folder is empty", async () => {
    const outcome = await upserter.upsert(request({ folder: "" }));
    expect(outcome.path).toBe("My Article.md");
    expect(repo.folders.size).toBe(0);
  });
});
