import { describe, expect, it } from "vitest";
import { isLogLevel, isMode, parseLogLevel, parseMode } from "./guards.js";

describe("input guards", () => {
  it("recognizes valid modes and log levels", () => {
    expect(isMode("admin")).toBe(true);
    expect(isMode("data")).toBe(true);
    expect(isMode("Admin")).toBe(false);
    expect(isMode(undefined)).toBe(false);
    expect(isMode(2)).toBe(false);

    expect(isLogLevel("debug")).toBe(true);
    expect(isLogLevel("silent")).toBe(true);
    expect(isLogLevel("verbose")).toBe(false);
  });

  it("parses valid values and throws a clear error otherwise", () => {
    expect(parseMode("admin")).toBe("admin");
    expect(parseLogLevel("warn")).toBe("warn");

    expect(() => parseMode("ADMIN")).toThrow(/Invalid ISECure mode/);
    expect(() => parseMode(undefined)).toThrow(/expected one of admin, data/);
    expect(() => parseLogLevel("loud")).toThrow(/Invalid log level/);
  });
});
