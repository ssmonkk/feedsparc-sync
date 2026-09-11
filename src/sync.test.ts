import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { NoteRepository, SourceMap } from "./notes";
import type { FeedSparcSettings } from "./settings";
import type { PendingItem } from "./model";

/**
 * The real `obsidian` package ships type declarations only — no runtime
 * module — so `requestUrl` only exists inside Obsidian itself. `api.ts`
 * imports it at module scope, so anything that transitively reaches `sync.ts`
 * cannot be a static import here: static imports are hoisted and would
 * evaluate before `mock.module` below runs. It is loaded via a deferred
 * dynamic import instead (test-only module-loading boundary). `settings.ts`
 * additionally imports Obsidian UI classes at module scope, so this file
 * never imports it at runtime — only `FeedSparcSettings`'s type, which
 * `import type` erases before it can trigger that.
 */
let mockRequestUrl: (params: { url: string; method: string; body?: string }) => {
  status: number;
  text: string;
};

mock.module("obsidian", () => ({
  requestUrl: (params: { url: string; method: string; body?: string }) => mockRequestUrl(params),
}));

const { SyncEngine } = await import("./sync");

const DEFAULT_SETTINGS: FeedSparcSettings = {
  baseUrl: "",
  token: "",
  folder: "FeedSparc",
  intervalMinutes: 60,
  fileNameTemplate: "{{date}} {{title}}",
  frontmatterTemplate: "source_id: {{sourceId}}\ntitle: {{title}}",
  bodyTemplate: "{{body}}",
};

/** In-memory vault stand-in, mirroring the fake used in notes.test.ts. */
class FakeRepository implements NoteRepository {
  files = new Map<string, { contents: string; sourceId: string | null }>();

  beginCycle(): void {}

  async ensureFolder(): Promise<void> {}

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
    this.files.set(path, { contents, sourceId: this.files.get(path)?.sourceId ?? null });
  }

  async create(path: string, contents: string): Promise<void> {
    const match = /^source_id:\s*"([^"]*)"/m.exec(contents);
    this.files.set(path, { contents, sourceId: match?.[1] ?? null });
  }
}

function pendingItem(overrides: Partial<PendingItem> = {}): PendingItem {
  return {
    queueId: "q1",
    sourceId: "src-1",
    title: "Title",
    url: "https://example.com/a",
    publishedAt: "2026-01-01T00:00:00.000Z",
    feedTitle: "Feed",
    summary: null,
    body: null,
    isSaved: false,
    tags: [],
    ...overrides,
  };
}

describe("SyncEngine", () => {
  let repository: FakeRepository;
  let sourceMap: SourceMap;
  let settings: FeedSparcSettings;
  let notices: string[];
  let persisted: number;
  let host: {
    settings: FeedSparcSettings;
    sourceMap: SourceMap;
    persist(): Promise<void>;
    notify(message: string): void;
  };

  beforeEach(() => {
    repository = new FakeRepository();
    sourceMap = {};
    settings = { ...DEFAULT_SETTINGS, baseUrl: "https://feedsparc.test", token: "tok" };
    notices = [];
    persisted = 0;
    host = {
      get settings() {
        return settings;
      },
      get sourceMap() {
        return sourceMap;
      },
      persist: async () => {
        persisted += 1;
      },
      notify: (message: string) => {
        notices.push(message);
      },
    };
  });

  it("fetches, writes one note per item, persists, then acks", async () => {
    const acked: string[][] = [];
    mockRequestUrl = (params) => {
      if (params.url.includes("/api/export/pending")) {
        return { status: 200, text: JSON.stringify({ items: [pendingItem()], malformed: 0 }) };
      }
      if (params.url.includes("/api/export/ack")) {
        acked.push(JSON.parse(params.body ?? "{}").queueIds);
        return { status: 200, text: JSON.stringify({ acked: 1 }) };
      }
      throw new Error(`unexpected request: ${params.url}`);
    };

    const engine = new SyncEngine(repository, host);
    const summary = await engine.run({ silent: false });

    expect(summary).toMatchObject({ fetched: 1, created: 1, updated: 0, failed: 0, acked: 1, malformed: 0 });
    expect(repository.files.size).toBe(1);
    expect(sourceMap["src-1"]).toBeDefined();
    expect(acked).toEqual([["q1"]]);
    // Mapping must be durable before the network ack round-trip, not after.
    expect(persisted).toBe(1);
  });

  it("persists written notes even when the ack request fails", async () => {
    mockRequestUrl = (params) => {
      if (params.url.includes("/api/export/pending")) {
        return { status: 200, text: JSON.stringify({ items: [pendingItem()], malformed: 0 }) };
      }
      return { status: 500, text: JSON.stringify({ error: "boom" }) };
    };

    const engine = new SyncEngine(repository, host);
    const summary = await engine.run({ silent: false });
    if (summary === null) throw new Error("expected a summary");
    // The note is on disk regardless of whether the ack succeeded, so a
    // re-delivered item next cycle upserts the same note instead of duplicating it.
    expect(repository.files.size).toBe(1);
    expect(persisted).toBe(1);
    expect(summary.acked).toBe(0);
    expect(notices.some((n) => n.includes("完了通知に失敗"))).toBe(true);
  });

  it("writes nothing and does not persist when fetchPending fails", async () => {
    mockRequestUrl = () => ({ status: 500, text: JSON.stringify({ error: "down" }) });

    const engine = new SyncEngine(repository, host);
    const summary = await engine.run({ silent: false });
    if (summary === null) throw new Error("expected a summary");
    expect(summary.failed).toBe(1);
    expect(summary.fetched).toBe(0);
    expect(repository.files.size).toBe(0);
    expect(persisted).toBe(0);
  });

  it("re-delivering the same sourceId updates the existing note instead of duplicating it", async () => {
    mockRequestUrl = (params) => {
      if (params.url.includes("/api/export/pending")) {
        return { status: 200, text: JSON.stringify({ items: [pendingItem()], malformed: 0 }) };
      }
      return { status: 200, text: JSON.stringify({ acked: 1 }) };
    };

    const engine = new SyncEngine(repository, host);
    await engine.run({ silent: false });
    const second = await engine.run({ silent: false });

    expect(repository.files.size).toBe(1);
    expect(second?.created).toBe(0);
    expect(second?.updated).toBe(1);
  });

  it("counts malformed entries without failing the cycle", async () => {
    mockRequestUrl = (params) => {
      if (params.url.includes("/api/export/pending")) {
        return {
          status: 200,
          text: JSON.stringify({
            items: [
              { sourceId: "s1", url: "https://example.com" }, // missing queueId
              { queueId: "q1", url: "https://example.com" }, // missing sourceId
            ],
          }),
        };
      }
      return { status: 200, text: JSON.stringify({ acked: 0 }) };
    };

    const engine = new SyncEngine(repository, host);
    const summary = await engine.run({ silent: false });
    if (summary === null) throw new Error("expected a summary");
    expect(summary.malformed).toBe(2);
    expect(summary.fetched).toBe(0);
    expect(persisted).toBe(0); // nothing written, so nothing to persist
  });

  it("skips a run already in flight and reports null", async () => {
    mockRequestUrl = () => ({ status: 200, text: JSON.stringify({ items: [], malformed: 0 }) });

    const engine = new SyncEngine(repository, host);
    // No await between these two calls: `running` is set synchronously at the
    // top of `run()`, before `cycle()` reaches its first await, so the second
    // call observes the guard deterministically rather than via a race.
    const first = engine.run({ silent: false });
    const second = await engine.run({ silent: true });
    expect(second).toBeNull();
    await first;
  });
});
