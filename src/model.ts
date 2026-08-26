import { isRecord, readString, readStringArray } from "./json";

/** One queued article as served by `GET /api/export/pending`. */
export interface PendingItem {
  queueId: string;
  sourceId: string;
  title: string | null;
  url: string;
  publishedAt: string;
  feedTitle: string | null;
  summary: string | null;
  body: string | null;
  isSaved: boolean;
  tags: string[];
}

export interface PendingResponse {
  items: PendingItem[];
  /** Entries the server sent that were unusable (missing queueId/sourceId/url). */
  malformed: number;
}

function parsePendingItem(value: unknown): PendingItem | null {
  if (!isRecord(value)) return null;
  const queueId = readString(value, "queueId");
  const sourceId = readString(value, "sourceId");
  const url = readString(value, "url");
  // Without these three there is nothing to write and nothing safe to ack.
  if (queueId === null || sourceId === null || url === null) return null;
  return {
    queueId,
    sourceId,
    url,
    title: readString(value, "title"),
    publishedAt: readString(value, "publishedAt") ?? "",
    feedTitle: readString(value, "feedTitle"),
    summary: readString(value, "summary"),
    body: readString(value, "body"),
    isSaved: value["isSaved"] === true,
    tags: readStringArray(value, "tags"),
  };
}

export function parsePendingResponse(payload: unknown): PendingResponse {
  if (!isRecord(payload)) return { items: [], malformed: 0 };
  const raw = payload["items"];
  if (!Array.isArray(raw)) return { items: [], malformed: 0 };

  const items: PendingItem[] = [];
  let malformed = 0;
  for (const entry of raw) {
    const item = parsePendingItem(entry);
    if (item === null) {
      malformed += 1;
      continue;
    }
    items.push(item);
  }
  return { items, malformed };
}

/** Number of queue entries the server confirmed as acknowledged. */
export function parseAckCount(payload: unknown): number {
  if (!isRecord(payload)) return 0;
  const acked = payload["acked"];
  return typeof acked === "number" && Number.isFinite(acked) ? acked : 0;
}
