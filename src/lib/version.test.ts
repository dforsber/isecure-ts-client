import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SDK_VERSION, USER_AGENT } from "./version.js";

describe("version", () => {
  it("stays in sync with package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect(SDK_VERSION).toBe(pkg.version);
  });

  it("builds a User-Agent product token from the version", () => {
    expect(USER_AGENT).toBe(`isecure-ts-client/${SDK_VERSION}`);
  });
});
