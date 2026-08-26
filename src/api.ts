import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";
import { readErrorMessage } from "./json";
import { parseAckCount, parsePendingResponse, type PendingResponse } from "./model";

/** How many queue entries one cycle pulls, matching the server default. */
export const PENDING_LIMIT = 25;

export class ApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Renders any thrown value as a message; used wherever a cycle reports failure. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "原因不明のエラー";
}

export interface ApiCredentials {
  baseUrl: string;
  token: string;
}

/**
 * Thin client over the RSSAgent export endpoints. Uses Obsidian's `requestUrl`
 * rather than `fetch` so requests are not subject to the renderer's CORS rules.
 * The token only ever leaves this class inside an Authorization header — it is
 * never interpolated into a message, URL or log line.
 */
export class RSSAgentApi {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(credentials: ApiCredentials) {
    this.baseUrl = credentials.baseUrl.trim().replace(/\/+$/, "");
    this.token = credentials.token.trim();
  }

  async fetchPending(limit: number = PENDING_LIMIT): Promise<PendingResponse> {
    const payload = await this.send(`/api/export/pending?limit=${limit}`, "GET");
    return parsePendingResponse(payload);
  }

  /** Confirms the given queue entries as delivered; returns the server's count. */
  async acknowledge(queueIds: string[]): Promise<number> {
    const payload = await this.send("/api/export/ack", "POST", { queueIds });
    return parseAckCount(payload);
  }

  /** Cheapest possible authenticated probe, used by the settings tab. */
  async testConnection(): Promise<number> {
    const response = await this.fetchPending(1);
    return response.items.length;
  }

  private async send(path: string, method: "GET" | "POST", body?: unknown): Promise<unknown> {
    if (this.baseUrl.length === 0) throw new ApiError("API の URL が設定されていません。", null);
    if (this.token.length === 0) throw new ApiError("API トークンが設定されていません。", null);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };
    const params: RequestUrlParam = {
      url: `${this.baseUrl}${path}`,
      method,
      headers,
      // Read the status ourselves so error bodies can be surfaced to the user.
      throw: false,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      params.body = JSON.stringify(body);
      params.contentType = "application/json";
    }

    let response: RequestUrlResponse;
    try {
      response = await requestUrl(params);
    } catch (error) {
      throw new ApiError(`サーバーに接続できませんでした: ${describeError(error)}`, null);
    }

    let payload: unknown = null;
    if (response.text.length > 0) {
      try {
        payload = JSON.parse(response.text);
      } catch {
        payload = response.text;
      }
    }

    if (response.status < 200 || response.status >= 300) {
      throw new ApiError(this.statusMessage(response.status, payload), response.status);
    }
    return payload;
  }

  private statusMessage(status: number, payload: unknown): string {
    const detail = readErrorMessage(payload);
    if (status === 401 || status === 403) {
      return detail ?? "API トークンが無効か、権限がありません。";
    }
    if (status === 404) {
      return detail ?? "エンドポイントが見つかりません。API の URL を確認してください。";
    }
    if (status === 429) {
      return detail ?? "リクエストが多すぎます。しばらく待ってから再試行してください。";
    }
    return `${status}: ${detail ?? "サーバーエラーが発生しました。"}`;
  }
}
