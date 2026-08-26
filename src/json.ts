/**
 * Canonical narrowing helpers for JSON that arrives from the network. Obsidian's
 * `requestUrl` hands back `any`, so every payload is funnelled through these
 * guards before any property is touched. This module is the plugin's only
 * type-guard module; call sites must not re-declare these.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a string property, collapsing missing/blank/non-string values to `null`. */
export function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (typeof value !== "string") return null;
  return value.trim().length > 0 ? value : null;
}

/** Reads an array of strings, dropping non-string and blank entries. */
export function readStringArray(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim().length > 0) result.push(entry);
  }
  return result;
}

/**
 * Extracts a human-readable message from an error response body without
 * assuming a shape. Returns `null` so callers can fall back to a generic message.
 */
export function readErrorMessage(payload: unknown): string | null {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    return trimmed.length > 0 && trimmed.length < 400 ? trimmed : null;
  }
  if (!isRecord(payload)) return null;
  return readString(payload, "error") ?? readString(payload, "message");
}
