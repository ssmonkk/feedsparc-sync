import { describeError, PENDING_LIMIT, FeedSparcApi } from "./api";
import type { PendingItem, PendingResponse } from "./model";
import { NoteUpserter, type NoteRepository, type SourceMap } from "./notes";
import type { FeedSparcSettings } from "./settings";
import {
  assembleNote,
  buildTemplateSource,
  renderBody,
  renderFileName,
  renderFrontmatter,
} from "./template";

/** What the sync engine needs from the plugin instance. */
export interface SyncHost {
  readonly settings: FeedSparcSettings;
  readonly sourceMap: SourceMap;
  /** Writes settings and the source map back to plugin data. */
  persist(): Promise<void>;
  notify(message: string): void;
}

export interface SyncSummary {
  fetched: number;
  created: number;
  updated: number;
  failed: number;
  acked: number;
  /** Entries the server sent that could not be parsed into an item. */
  malformed: number;
}

export interface SyncOptions {
  /** Interval runs stay quiet unless something happened or went wrong. */
  silent: boolean;
}

/**
 * Runs one pull cycle: fetch queued items, upsert a note per item, then ack only
 * the queue entries whose notes actually landed. A failed write therefore leaves
 * its item queued for the next run, and because the upsert is keyed on
 * `sourceId`, re-delivering an item never produces a second note.
 */
export class SyncEngine {
  private readonly repository: NoteRepository;
  private readonly host: SyncHost;
  private running = false;

  constructor(repository: NoteRepository, host: SyncHost) {
    this.repository = repository;
    this.host = host;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Returns null when the run was skipped because one was already in flight. */
  async run(options: SyncOptions): Promise<SyncSummary | null> {
    if (this.running) {
      if (!options.silent) this.host.notify("FeedSparc: 同期はすでに実行中です。");
      return null;
    }
    this.running = true;
    try {
      return await this.cycle(options);
    } finally {
      this.running = false;
    }
  }

  private async cycle(options: SyncOptions): Promise<SyncSummary> {
    const settings = this.host.settings;
    const summary: SyncSummary = {
      fetched: 0,
      created: 0,
      updated: 0,
      failed: 0,
      acked: 0,
      malformed: 0,
    };

    const api = new FeedSparcApi({ baseUrl: settings.baseUrl, token: settings.token });

    let pending: PendingResponse;
    try {
      pending = await api.fetchPending(PENDING_LIMIT);
    } catch (error) {
      // Nothing was written, so nothing is acked and the queue is untouched.
      this.host.notify(`FeedSparc: 取得に失敗しました — ${describeError(error)}`);
      summary.failed = 1;
      return summary;
    }

    summary.fetched = pending.items.length;
    summary.malformed = pending.malformed;

    if (pending.items.length === 0) {
      if (!options.silent) this.host.notify("FeedSparc: 新しい記事はありません。");
      return summary;
    }

    this.repository.beginCycle();
    const upserter = new NoteUpserter(this.repository, this.host.sourceMap);
    const written: string[] = [];
    const failures: string[] = [];

    for (const item of pending.items) {
      try {
        const outcome = await this.writeNote(upserter, settings, item);
        if (outcome === "created") summary.created += 1;
        else summary.updated += 1;
        written.push(item.queueId);
      } catch (error) {
        summary.failed += 1;
        failures.push(`${item.title ?? item.url}: ${describeError(error)}`);
      }
    }

    // Persist the mapping before acking: if the ack request fails, the items come
    // back next cycle and must resolve to the notes just written.
    await this.host.persist();

    if (written.length > 0) {
      try {
        summary.acked = await api.acknowledge(written);
      } catch (error) {
        // The notes are on disk; leaving the queue entries unacked means the
        // next cycle re-delivers them and the upsert updates the same notes.
        this.host.notify(
          `FeedSparc: ${written.length}件を保存しましたが、完了通知に失敗しました — ${describeError(error)}`,
        );
        this.logFailures(failures);
        return summary;
      }
    }

    this.report(summary);
    this.logFailures(failures);
    return summary;
  }

  private async writeNote(
    upserter: NoteUpserter,
    settings: FeedSparcSettings,
    item: PendingItem,
  ): Promise<"created" | "updated" | "adopted"> {
    const source = buildTemplateSource(item);
    const contents = assembleNote(
      renderFrontmatter(settings.frontmatterTemplate, source),
      renderBody(settings.bodyTemplate, source),
    );
    const outcome = await upserter.upsert({
      sourceId: item.sourceId,
      folder: settings.folder.trim().replace(/^\/+|\/+$/g, ""),
      baseName: renderFileName(settings.fileNameTemplate, source),
      contents,
    });
    return outcome.action;
  }

  /** Emits one summary Notice, or none when the cycle changed nothing. */
  private report(summary: SyncSummary): void {
    const parts: string[] = [];
    if (summary.created > 0 || summary.updated > 0) {
      parts.push(`新規 ${summary.created}件 / 更新 ${summary.updated}件`);
    }
    if (summary.failed > 0) parts.push(`失敗 ${summary.failed}件`);
    if (summary.malformed > 0) parts.push(`不正なデータ ${summary.malformed}件`);
    if (parts.length === 0) return;
    this.host.notify(`FeedSparc: ${parts.join(" / ")}`);
  }

  private logFailures(failures: string[]): void {
    if (failures.length === 0) return;
    // Failure detail goes to the console; it never contains the token.
    console.error("[feedsparc-sync] 書き込みに失敗した記事:", failures);
  }
}
