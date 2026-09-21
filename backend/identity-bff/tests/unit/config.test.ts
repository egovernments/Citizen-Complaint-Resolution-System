import { describe, expect, it } from "vitest";
import { parseAllowedOrigins } from "../../src/infrastructure/config.js";

describe("identity configuration", () => {
  it("normalizes allowlisted URLs to exact origins", () => {
    expect(parseAllowedOrigins(
      "https://digit.example.org/, http://localhost:5173,https://digit.example.org",
    )).toEqual(["https://digit.example.org", "http://localhost:5173"]);
  });

  it("rejects paths, credentials, and non-http schemes in the origin allowlist", () => {
    expect(() => parseAllowedOrigins("https://digit.example.org/configurator")).toThrow(/origins only/);
    expect(() => parseAllowedOrigins("https://user:secret@digit.example.org")).toThrow(/origins only/);
    expect(() => parseAllowedOrigins("javascript:alert(1)")).toThrow(/origins only/);
  });
});
