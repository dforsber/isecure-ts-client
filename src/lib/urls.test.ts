import { describe, expect, it } from "vitest";
import { UrlBuilder, type UrlParts } from "./urls.js";

const parts: UrlParts = {
  BaseUrl: "https://ws-api.test.isecure.fi/v2/",
  Email: "user@example.test",
  Mode: "admin",
  Bank: "nordea",
  Phone: "+358401234567",
};

function builder(overrides: Partial<UrlParts> = {}): UrlBuilder {
  return new UrlBuilder(() => ({ ...parts, ...overrides }));
}

describe("UrlBuilder", () => {
  it("percent-encodes path segments and trims a trailing base slash", () => {
    const urls = builder();
    expect(urls.account()).toBe("https://ws-api.test.isecure.fi/v2/account/user%40example.test/admin");
    expect(urls.session()).toBe("https://ws-api.test.isecure.fi/v2/session/user%40example.test/admin");
    expect(urls.mfacode()).toBe("https://ws-api.test.isecure.fi/v2/session/user%40example.test/admin/mfacode");
    expect(urls.password()).toBe("https://ws-api.test.isecure.fi/v2/account/user%40example.test/admin/password");
    expect(urls.accountPhone()).toBe(
      "https://ws-api.test.isecure.fi/v2/account/user%40example.test/admin/%2B358401234567",
    );
  });

  it("builds files, certs, pgp, and integrator endpoints", () => {
    const urls = builder();
    expect(urls.files()).toBe("https://ws-api.test.isecure.fi/v2/files/nordea");
    expect(urls.file("CAMT", "123")).toBe("https://ws-api.test.isecure.fi/v2/files/nordea/CAMT/123");
    expect(urls.certs()).toBe("https://ws-api.test.isecure.fi/v2/certs/");
    expect(urls.cert()).toBe("https://ws-api.test.isecure.fi/v2/certs/nordea");
    expect(urls.sharedCerts("other@example.test")).toBe(
      "https://ws-api.test.isecure.fi/v2/certs/shared/other%40example.test",
    );
    expect(urls.integratorAccounts()).toBe("https://ws-api.test.isecure.fi/v2/integrator/accounts");
    expect(urls.pgp()).toBe("https://ws-api.test.isecure.fi/v2/pgp");
  });

  it("reflects live prop changes through the provider", () => {
    let mode: UrlParts["Mode"] = "admin";
    const urls = new UrlBuilder(() => ({ ...parts, Mode: mode }));
    expect(urls.account()).toContain("/admin");
    mode = "data";
    expect(urls.account()).toContain("/data");
  });
});
