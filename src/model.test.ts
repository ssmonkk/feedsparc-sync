import { describe, it, expect } from "bun:test";
import { parsePendingResponse, parseAckCount } from "./model";

describe("parsePendingResponse", () => {
  it("parses a well-formed item", () => {
    const result = parsePendingResponse({
      items: [
        {
          queueId: "q1",
          sourceId: "s1",
          url: "https://example.com",
          title: "T",
          publishedAt: "2026-01-01T00:00:00.000Z",
          feedTitle: "F",
          summary: "S",
          body: "B",
          isSaved: true,
          tags: ["a", "b"],
        },
      ],
    });
    expect(result.malformed).toBe(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      queueId: "q1",
      sourceId: "s1",
      url: "https://example.com",
      isSaved: true,
      tags: ["a", "b"],
    });
  });

  it("drops entries missing queueId, sourceId or url and counts them as malformed", () => {
    const result = parsePendingResponse({
      items: [
        { sourceId: "s1", url: "https://example.com" }, // missing queueId
        { queueId: "q1", url: "https://example.com" }, // missing sourceId
        { queueId: "q1", sourceId: "s1" }, // missing url
        { queueId: "q1", sourceId: "s1", url: "https://example.com" }, // valid
      ],
    });
    expect(result.malformed).toBe(3);
    expect(result.items).toHaveLength(1);
  });

  it("defaults publishedAt to empty string and isSaved to false when absent", () => {
    const result = parsePendingResponse({
      items: [{ queueId: "q1", sourceId: "s1", url: "https://example.com" }],
    });
    expect(result.items[0]!.publishedAt).toBe("");
    expect(result.items[0]!.isSaved).toBe(false);
    expect(result.items[0]!.tags).toEqual([]);
  });

  it("returns empty result for a non-object payload", () => {
    expect(parsePendingResponse(null)).toEqual({ items: [], malformed: 0 });
    expect(parsePendingResponse("oops")).toEqual({ items: [], malformed: 0 });
  });

  it("returns empty result when items is not an array", () => {
    expect(parsePendingResponse({ items: "nope" })).toEqual({ items: [], malformed: 0 });
  });
});

describe("parseAckCount", () => {
  it("reads a numeric acked field", () => {
    expect(parseAckCount({ acked: 3 })).toBe(3);
  });

  it("defaults to 0 for a missing or non-numeric acked field", () => {
    expect(parseAckCount({})).toBe(0);
    expect(parseAckCount({ acked: "3" })).toBe(0);
    expect(parseAckCount({ acked: Number.NaN })).toBe(0);
    expect(parseAckCount(null)).toBe(0);
  });
});
