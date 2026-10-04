import { describe, it, expect } from "vitest";
import { keyCompatibility, KEY_OPTIONS } from "../src/lib/musicTheory";

describe("keyCompatibility", () => {
  it("same key scores 100", () => expect(keyCompatibility("8A", "Am")).toBe(100));
  it("adjacent and relative keys score 85", () => {
    expect(keyCompatibility("8A", "9A")).toBe(85);
    expect(keyCompatibility("8A", "8B")).toBe(85);
  });
  it("distant keys score 0", () => expect(keyCompatibility("1A", "7A")).toBe(0));
  it("unknown key gives no score", () => expect(keyCompatibility("8A", undefined)).toBeUndefined());
  it("offers all 24 keys", () => expect(KEY_OPTIONS).toHaveLength(24));
});
