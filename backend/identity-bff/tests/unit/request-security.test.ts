import { describe, expect, it } from "vitest";
import type express from "express";
import { bearerMatches } from "../../src/app/request-security.js";

const req = (authorization?: string) => ({ get: (name: string) => name.toLowerCase() === "authorization" ? authorization : undefined }) as unknown as express.Request;

describe("bearerMatches", () => {
  it("accepts any configured token and nothing else", () => {
    expect(bearerMatches(req("Bearer one"), ["one", "two"])).toBe(true);
    expect(bearerMatches(req("Bearer two"), ["one", "two"])).toBe(true);
    expect(bearerMatches(req("Bearer three"), ["one", "two"])).toBe(false);
    expect(bearerMatches(req("Bearer on"), ["one"])).toBe(false);
  });
  it("rejects missing, non-bearer and empty credentials, and never matches an empty token", () => {
    expect(bearerMatches(req(), ["one"])).toBe(false);
    expect(bearerMatches(req("one"), ["one"])).toBe(false);
    expect(bearerMatches(req("Basic one"), ["one"])).toBe(false);
    expect(bearerMatches(req("Bearer "), ["", "one"])).toBe(false);
    expect(bearerMatches(req("Bearer one"), [])).toBe(false);
  });
});
