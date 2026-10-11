import { describe, it, expect } from "bun:test";
import { isAllowedBaseUrl } from "./api";

describe("isAllowedBaseUrl", () => {
  it("accepts https origins", () => {
    expect(isAllowedBaseUrl("https://feedsparc.com")).toBe(true);
    expect(isAllowedBaseUrl("https://feedsparc.example.workers.dev")).toBe(true);
  });

  it("accepts http only for localhost and 127.0.0.1", () => {
    expect(isAllowedBaseUrl("http://localhost:4321")).toBe(true);
    expect(isAllowedBaseUrl("http://127.0.0.1:4321")).toBe(true);
  });

  it("rejects http for any other host", () => {
    expect(isAllowedBaseUrl("http://feedsparc.com")).toBe(false);
    expect(isAllowedBaseUrl("http://192.168.1.10:4321")).toBe(false);
  });

  it("rejects other schemes and malformed URLs", () => {
    expect(isAllowedBaseUrl("ftp://feedsparc.com")).toBe(false);
    expect(isAllowedBaseUrl("not a url")).toBe(false);
    expect(isAllowedBaseUrl("")).toBe(false);
  });
});
