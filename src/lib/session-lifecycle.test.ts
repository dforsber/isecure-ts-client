import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { WSChannel, type IWSChannel } from "./isecure.class.js";
import { ISecureError } from "./errors.js";
import { FakeTransport, type TransportResponse } from "./transport.js";

const publicKey = readFileSync(new URL("../../examples/gpg-encryption-test/test.pem", import.meta.url), "utf8");
const challenge = "challenge-bytes|1475429754114|4017bda8-0a15-4154-a8b7-88069b05cb4e";

function props(overrides: Partial<IWSChannel> = {}): IWSChannel {
  return {
    ApiKey: "0",
    Company: "Example Company",
    Name: "Example User",
    Password: "Example-password-123!",
    Phone: "+358401234567",
    PublicKey: publicKey,
    BaseUrl: "https://ws-api.test.isecure.fi/v2",
    Email: "user@example.test",
    Mode: "data",
    Bank: "nordea",
    ...overrides,
  };
}

function response<T>(data: T, status = 200): TransportResponse<T> {
  return { status, statusText: "OK", data };
}

/** Transport that logs a session in (with ExpiresIn) and answers listKeys/logout. */
function authenticatingTransport(expiresIn = "3600"): FakeTransport {
  const transport = new FakeTransport();
  transport.respond((request) => {
    if (request.method === "GET" && request.url.includes("/session/")) {
      return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
    }
    if (request.method === "POST" && request.url.includes("/session/")) {
      return response({
        ApiKey: "api-key",
        ExpiresIn: expiresIn,
        IdToken: "id-token",
        ResponseCode: "00",
        ResponseText: "Login OK",
      });
    }
    if (request.method === "GET" && request.url.endsWith("/pgp")) {
      return response({ PgpKeys: [], ResponseCode: "00", ResponseText: "keys" });
    }
    if (request.method === "DELETE" && request.url.includes("/session/")) {
      return response({ ResponseCode: "00", ResponseText: "logged out" });
    }
    return undefined;
  });
  return transport;
}

describe("session lifecycle", () => {
  it("records expiry and reports a fresh session as not expired", async () => {
    const client = new WSChannel(props(), { transport: authenticatingTransport("3600") });
    await client.login();

    expect(client.isAuthenticated()).toBe(true);
    expect(client.isSessionExpired()).toBe(false);
    expect(client.sessionExpiresAt).toBeGreaterThan(Date.now());
    await expect(client.listKeys()).resolves.toMatchObject({ PgpKeys: [] });
  });

  it("has no expiry to reason about when the backend omits ExpiresIn", async () => {
    const transport = new FakeTransport();
    transport.respond((request) => {
      if (request.method === "GET") return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
      return response({ ApiKey: "api-key", IdToken: "id-token", ResponseCode: "00", ResponseText: "Login OK" });
    });
    const client = new WSChannel(props(), { transport });
    await client.login();

    expect(client.isAuthenticated()).toBe(true);
    expect(client.sessionExpiresAt).toBeUndefined();
    expect(client.isSessionExpired()).toBe(false);
  });

  it("invokes the refresh hook before an authenticated call once the session has expired", async () => {
    vi.useFakeTimers();
    try {
      const onSessionExpired = vi.fn(async (channel: WSChannel) => {
        await channel.login();
      });
      const client = new WSChannel(props(), { transport: authenticatingTransport("3600"), onSessionExpired });
      await client.login();
      expect(client.isSessionExpired()).toBe(false);

      // Advance past the id-token expiry so the next authenticated call refreshes.
      vi.setSystemTime(Date.now() + 3_600_000 + 10_000);
      expect(client.isSessionExpired()).toBe(true);

      await expect(client.listKeys()).resolves.toMatchObject({ PgpKeys: [] });
      expect(onSessionExpired).toHaveBeenCalledOnce();
      expect(onSessionExpired).toHaveBeenCalledWith(client);
      expect(client.isSessionExpired()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws when the refresh hook runs but does not actually refresh the session", async () => {
    const onSessionExpired = vi.fn(async () => undefined); // no-op hook
    const client = new WSChannel(props(), {
      transport: authenticatingTransport("3600"),
      expirySkewMs: 1_000_000_000_000, // treat any expiry as already expired
      onSessionExpired,
    });
    await client.login();
    expect(client.isSessionExpired()).toBe(true);

    await expect(client.listKeys()).rejects.toThrow(/still expired/);
    expect(onSessionExpired).toHaveBeenCalledOnce();
  });

  it("throws a typed error on an expired session when no refresh hook is configured", async () => {
    const client = new WSChannel(props(), {
      transport: authenticatingTransport("3600"),
      expirySkewMs: 1_000_000_000_000,
    });
    await client.login();

    await expect(client.listKeys()).rejects.toBeInstanceOf(ISecureError);
    await expect(client.listKeys()).rejects.toThrow(/expired/);
  });

  it("still allows logout on an expired session and clears local state", async () => {
    const client = new WSChannel(props(), {
      transport: authenticatingTransport("3600"),
      expirySkewMs: 1_000_000_000_000,
    });
    await client.login();
    expect(client.isSessionExpired()).toBe(true);

    await expect(client.logout()).resolves.toMatchObject({ ResponseText: "logged out" });
    expect(client.isAuthenticated()).toBe(false);
    expect(client.sessionExpiresAt).toBeUndefined();
  });
});
