import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPPORTED_OPERATIONS, UNSUPPORTED_OPERATIONS } from "./api-types.js";
import { WSChannel, type IWSChannel, type Logger } from "./isecure.class.js";
import { FakeTransport, type TransportRequest, type TransportResponse } from "./transport.js";

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
    Mode: "admin",
    Bank: "nordea",
    ...overrides,
  };
}

function response<T>(data: T, status = 200): TransportResponse<T> {
  return { status, statusText: "OK", data };
}

function match(method: string, suffix: string) {
  return (request: TransportRequest) => request.method === method && request.url.endsWith(suffix);
}

describe("WSChannel", () => {
  it("documents operation coverage from the generated OpenAPI operation ids", () => {
    expect(SUPPORTED_OPERATIONS).toContain("Login");
    expect(SUPPORTED_OPERATIONS).toContain("ListFiles");
    expect(SUPPORTED_OPERATIONS).toContain("DownloadFile");
    expect(SUPPORTED_OPERATIONS).toContain("Logout");
    expect(UNSUPPORTED_OPERATIONS).toHaveLength(0);
  });

  it("updates mutable account props without rebuilding the client", () => {
    const client = new WSChannel(props({ Mode: "admin" }));
    client.updateProps({ Mode: "data", Bank: "osuuspankki" });
    expect(client.props).toMatchObject({ Mode: "data", Bank: "osuuspankki" });
  });

  it("honors configured log levels for injected loggers", async () => {
    const messages: string[] = [];
    const logger: Logger = {
      debug(message) {
        messages.push(message);
      },
      info() {},
      warn() {},
      error() {},
    };
    const transport = new FakeTransport();
    transport.respond((request) => {
      if (match("GET", "/account/user%40example.test/admin")(request)) {
        return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
      }
      if (match("PUT", "/account/user%40example.test/admin")(request)) {
        return response({ ApiKey: "registered-api-key", ResponseCode: "00", ResponseText: "Created" }, 201);
      }
      return undefined;
    });

    await new WSChannel(props({ LogLevel: "silent" }), { transport, logger }).register();
    expect(messages).toEqual([]);

    await new WSChannel(props({ LogLevel: "debug" }), { transport, logger }).register();
    expect(messages).toContain("registered account");
    // The transport also emits redacted request/response debug lines at this level.
    expect(messages.some((message) => message.startsWith("request "))).toBe(true);
    expect(messages.some((message) => message.startsWith("response "))).toBe(true);
  });

  it("redacts secrets and codes in transport debug logs", async () => {
    const meta: unknown[] = [];
    const logger: Logger = {
      debug(_message, entry) {
        meta.push(entry);
      },
      info() {},
      warn() {},
      error() {},
    };
    const transport = new FakeTransport();
    transport.respond((request) => {
      if (match("GET", "/account/user%40example.test/admin")(request)) {
        return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
      }
      if (match("PUT", "/account/user%40example.test/admin")(request)) {
        return response({ ApiKey: "super-secret-key", ResponseCode: "00", ResponseText: "Created" }, 201);
      }
      return undefined;
    });

    await new WSChannel(props(), { transport, logger }).register();

    const serialized = JSON.stringify(meta);
    expect(serialized).not.toContain("super-secret-key");
    expect(serialized).not.toContain(challenge);
    expect(serialized).toContain("[redacted]");
  });

  it("registers with a challenge response body generated from the OpenAPI Register request shape", async () => {
    const transport = new FakeTransport();
    transport.respond((request) => {
      if (match("GET", "/account/user%40example.test/admin")(request)) {
        return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
      }
      if (match("PUT", "/account/user%40example.test/admin")(request)) {
        return response({ ApiKey: "registered-api-key", ResponseCode: "00", ResponseText: "Created" }, 201);
      }
      return undefined;
    });

    const client = new WSChannel(props(), { transport });
    const result = await client.register();

    expect(result.ApiKey).toBe("registered-api-key");
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[1]?.body).toMatchObject({
      ApiKey: "0",
      ChResp: challenge,
      Company: "Example Company",
      Name: "Example User",
      Phone: "+358401234567",
    });
    expect((transport.requests[1]?.body as { Encrypted?: string }).Encrypted).toEqual(expect.any(String));
    expect(client.session.apiKey).toBe("registered-api-key");
  });

  it("starts and completes password reset with generated OpenAPI request shapes", async () => {
    const transport = new FakeTransport();
    transport.respond((request) => {
      if (match("GET", "/account/user%40example.test/admin/password")(request)) {
        return response({ ResponseCode: "00", ResponseText: "SMS sent" });
      }
      if (match("POST", "/account/user%40example.test/admin/password")(request)) {
        return response({ ResponseCode: "00", ResponseText: "Password reset" });
      }
      return undefined;
    });

    const client = new WSChannel(props(), { transport });
    await expect(client.initPasswordReset()).resolves.toMatchObject({ ResponseCode: "00" });
    await expect(client.passwordReset("123456", "New-example-password-123!", challenge)).resolves.toMatchObject({
      ResponseText: "Password reset",
    });
    await client.passwordReset({
      ChResp: challenge,
      Code: "654321",
      Encrypted: "pre-encrypted-value",
    });

    expect(transport.requests[1]?.body).toMatchObject({ ChResp: challenge, Code: "123456" });
    expect((transport.requests[1]?.body as { Encrypted?: string }).Encrypted).toEqual(expect.any(String));
    expect(transport.requests[2]?.body).toEqual({
      ChResp: challenge,
      Code: "654321",
      Encrypted: "pre-encrypted-value",
    });
  });

  it("returns typed auth states for MFA and authenticated sessions", async () => {
    const transport = new FakeTransport();
    transport.respond((request) => {
      if (match("GET", "/session/user%40example.test/admin")(request)) {
        return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
      }
      if (match("POST", "/session/user%40example.test/admin")(request)) {
        return response({ ResponseCode: "00", ResponseText: "Give SMS code", Session: "session-token" });
      }
      if (match("PUT", "/session/user%40example.test/admin/mfacode")(request)) {
        return response({
          ApiKey: "api-key",
          ExpiresIn: "3600",
          IdToken: "id-token",
          ResponseCode: "00",
          ResponseText: "Login OK",
        });
      }
      return undefined;
    });

    const client = new WSChannel(props(), { transport });

    const loginState = await client.login();
    expect(loginState).toMatchObject({ status: "needs_mfa", session: "session-token" });

    const authenticated = await client.submitMfaCode("123456");
    expect(authenticated).toMatchObject({
      status: "authenticated",
      tokens: { apiKey: "api-key", idToken: "id-token", session: "session-token" },
    });
    expect(transport.requests[2]?.body).toEqual({ Code: "123456", Session: "session-token" });

    const aliasTransport = new FakeTransport();
    aliasTransport.respond(() =>
      response({
        ApiKey: "api-key",
        IdToken: "id-token",
        ResponseCode: "00",
        ResponseText: "Login OK",
      }),
    );
    const aliasClient = new WSChannel(props(), { transport: aliasTransport });
    await expect(aliasClient.loginMFA("654321")).rejects.toThrow("before login returns a session token");
  });

  it("rejects MFA and email verification before the required prior auth state", async () => {
    const client = new WSChannel(props(), { transport: new FakeTransport() });

    await expect(client.submitMfaCode("123456")).rejects.toThrow("before login returns a session token");
    await expect(client.verifyEmail("123456")).rejects.toThrow("before login returns an access token");
    await expect(client.listFiles()).rejects.toThrow("before login returns an id token and API key");
  });

  it("uses prompt adapters without importing terminal IO into the library", async () => {
    const transport = new FakeTransport();
    const loginResponses = [
      response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" }),
      response({
        AccessToken: "access-token",
        ResponseCode: "00",
        ResponseText: "Login OK. Verify email address.",
      }),
      response({ ResponseCode: "00", ResponseText: "Email verification successful." }),
      response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" }),
      response({
        ApiKey: "api-key",
        ExpiresIn: "3600",
        IdToken: "id-token",
        ResponseCode: "00",
        ResponseText: "Login OK",
      }),
    ];
    transport.respond(() => loginResponses.shift());

    const client = new WSChannel(props({ Mode: "data" }), { transport });
    const state = await client.loginWithPrompt({
      async requestEmailCode() {
        return "email-code";
      },
      async requestMfaCode() {
        throw new Error("MFA should not be requested");
      },
      async requestPhoneCode() {
        throw new Error("phone should not be requested");
      },
    });

    expect(state.status).toBe("authenticated");
    expect(transport.requests[2]?.body).toEqual({ AccessToken: "access-token", Code: "email-code" });
  });

  it("drives MFA and phone verification through prompt adapters", async () => {
    const transport = new FakeTransport();
    const responses = [
      response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" }),
      response({ ResponseCode: "00", ResponseText: "Give SMS code", Session: "session-token" }),
      response({
        ApiKey: "api-key",
        IdToken: "id-token",
        ResponseCode: "00",
        ResponseText: "Login OK",
      }),
    ];
    transport.respond(() => responses.shift());

    const mfaClient = new WSChannel(props(), { transport });
    const mfaState = await mfaClient.loginWithPrompt({
      async requestMfaCode() {
        return "mfa-code";
      },
      async requestEmailCode() {
        throw new Error("email should not be requested");
      },
      async requestPhoneCode() {
        throw new Error("phone should not be requested");
      },
    });
    expect(mfaState.status).toBe("authenticated");

    const phoneTransport = new FakeTransport();
    const phoneResponses = [
      response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" }),
      response({
        ResponseCode: "00",
        ResponseText: "User authentication failed. Verify phone number with received SMS.",
      }),
      response({ ResponseCode: "00", ResponseText: "Phone confirmation successful." }),
      response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" }),
      response({
        ApiKey: "api-key",
        IdToken: "id-token",
        ResponseCode: "00",
        ResponseText: "Login OK",
      }),
    ];
    phoneTransport.respond(() => phoneResponses.shift());
    const phoneClient = new WSChannel(props({ Mode: "data" }), { transport: phoneTransport });
    const phoneState = await phoneClient.loginWithPrompt({
      async requestMfaCode() {
        throw new Error("MFA should not be requested");
      },
      async requestEmailCode() {
        throw new Error("email should not be requested");
      },
      async requestPhoneCode() {
        return "phone-code";
      },
    });

    expect(phoneState.status).toBe("authenticated");
    expect(phoneTransport.requests[2]?.body).toEqual({ Code: "phone-code" });
  });

  it("returns failed prompt auth states and protects against non-settling auth", async () => {
    const failedTransport = new FakeTransport();
    failedTransport.respond((request) => {
      if (request.method === "GET") return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
      return response({ ResponseCode: "01", ResponseText: "Login failed" });
    });
    const failedClient = new WSChannel(props(), { transport: failedTransport });

    await expect(
      failedClient.loginWithPrompt({
        async requestMfaCode() {
          return "mfa";
        },
        async requestEmailCode() {
          return "email";
        },
        async requestPhoneCode() {
          return "phone";
        },
      }),
    ).resolves.toMatchObject({ status: "failed", responseCode: "01" });

    const unsettledTransport = new FakeTransport();
    unsettledTransport.respond((request) => {
      if (request.method === "GET") return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
      if (request.method === "POST" && request.url.includes("/account/")) {
        return response({ ResponseCode: "00", ResponseText: "Phone confirmation successful." });
      }
      return response({
        ResponseCode: "00",
        ResponseText: "User authentication failed. Verify phone number with received SMS.",
      });
    });
    const unsettledClient = new WSChannel(props(), { transport: unsettledTransport });
    await expect(
      unsettledClient.loginWithPrompt(
        {
          async requestMfaCode() {
            return "mfa";
          },
          async requestEmailCode() {
            return "email";
          },
          async requestPhoneCode() {
            return "phone";
          },
        },
        1,
      ),
    ).resolves.toMatchObject({ status: "stalled", step: "phone_verification" });
  });

  it("reports a typed stalled state when an accepted verification does not advance login", async () => {
    // The backend keeps re-requesting phone verification even after it accepts
    // the code: loginWithPrompt must stop and name the stuck step, not loop.
    const transport = new FakeTransport();
    transport.respond((request) => {
      if (request.method === "GET") return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
      if (request.method === "POST" && request.url.includes("/account/")) {
        return response({ ResponseCode: "00", ResponseText: "Phone confirmation successful." });
      }
      return response({
        ResponseCode: "00",
        ResponseText: "User authentication failed. Verify phone number with received SMS.",
      });
    });

    const client = new WSChannel(props(), { transport });
    const state = await client.loginWithPrompt({
      async requestMfaCode() {
        throw new Error("MFA should not be requested");
      },
      async requestEmailCode() {
        throw new Error("email should not be requested");
      },
      async requestPhoneCode() {
        return "phone";
      },
    });

    expect(state).toMatchObject({ status: "stalled", step: "phone_verification" });
  });

  it("sends authenticated PGP, upload, and list requests through the public SDK interface", async () => {
    const transport = new FakeTransport();
    transport.respond((request) => {
      if (match("GET", "/session/user%40example.test/data")(request)) {
        return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
      }
      if (match("POST", "/session/user%40example.test/data")(request)) {
        return response({
          ApiKey: "api-key",
          ExpiresIn: "3600",
          IdToken: "id-token",
          ResponseCode: "00",
          ResponseText: "Login OK",
        });
      }
      if (match("PUT", "/pgp")(request)) {
        return response({ ResponseCode: "00", ResponseText: "PGP uploaded" }, 201);
      }
      if (match("PUT", "/files/nordea")(request)) {
        return response({ ResponseCode: "00", ResponseText: "File uploaded" }, 201);
      }
      if (match("GET", "/files/nordea")(request)) {
        return response({ FileDescriptors: [], ResponseCode: "00", ResponseText: "OK" });
      }
      return undefined;
    });

    const client = new WSChannel(props({ Mode: "data" }), { transport });
    await client.login();
    await client.uploadPgpKey("-----BEGIN PGP PUBLIC KEY BLOCK-----", "authorize");
    await client.uploadFile("Zm9v", "test.xml", "DUMMY", "signature");
    const files = await client.listFiles("VKEUR", "ALL");
    await client.listFiles({ FileType: "CAMT", Status: "NEW" });

    expect(files.FileDescriptors).toEqual([]);
    const protectedRequests = transport.requests.slice(2);
    expect(protectedRequests.every((request) => request.headers?.Authorization === "id-token")).toBe(true);
    expect(protectedRequests.every((request) => request.headers?.["x-api-key"] === "api-key")).toBe(true);
    expect(transport.requests[4]?.query).toEqual({ FileType: "VKEUR", Status: "ALL" });
    expect(transport.requests[5]?.query).toEqual({ FileType: "CAMT", Status: "NEW" });
  });

  it("implements every authenticated WS API operation with typed request and response shapes", async () => {
    const transport = new FakeTransport();
    transport.respond((request) => {
      if (match("GET", "/session/user%40example.test/admin")(request)) {
        return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
      }
      if (match("POST", "/session/user%40example.test/admin")(request)) {
        return response({
          ApiKey: "api-key",
          ExpiresIn: "3600",
          IdToken: "id-token",
          ResponseCode: "00",
          ResponseText: "Login OK",
        });
      }
      if (match("GET", "/certs/")(request)) {
        return response({ Certs: [], ResponseCode: "00", ResponseText: "certs" });
      }
      if (match("POST", "/certs/")(request)) {
        return response({ ResponseCode: "00", ResponseText: "configured" });
      }
      if (match("PUT", "/certs/shared/other%40example.test")(request)) {
        return response({ ResponseCode: "00", ResponseText: "shared", SharedFrom: [], SharedTo: [] }, 201);
      }
      if (match("DELETE", "/certs/shared/other%40example.test")(request)) {
        return response({ ResponseCode: "00", ResponseText: "unshared", SharedFrom: [], SharedTo: [] });
      }
      if (match("GET", "/certs/nordea")(request)) {
        return response({ CertsAndKeys: [], ResponseCode: "00", ResponseText: "exported" });
      }
      if (match("PUT", "/certs/nordea")(request)) {
        return response({ ResponseCode: "00", ResponseText: "imported" }, 201);
      }
      if (match("POST", "/certs/nordea")(request)) {
        return response({ ResponseCode: "00", ResponseText: "enrolled" }, 201);
      }
      if (match("GET", "/files/nordea/CAMT/123")(request)) {
        return response({ Content: "Zm9v", ResponseCode: "00", ResponseText: "downloaded" });
      }
      if (match("DELETE", "/files/nordea/CAMT/123")(request)) {
        return response({ ResponseCode: "00", ResponseText: "deleted" });
      }
      if (match("GET", "/integrator/accounts")(request)) {
        return response({ Accounts: [], ResponseCode: "00", ResponseText: "accounts" });
      }
      if (match("GET", "/pgp")(request)) {
        return response({ PgpKeys: [], ResponseCode: "00", ResponseText: "keys" });
      }
      if (match("DELETE", "/pgp")(request)) {
        return response({ PgpKeys: [], ResponseCode: "00", ResponseText: "deleted key" });
      }
      if (match("DELETE", "/session/user%40example.test/admin")(request)) {
        return response({ ResponseCode: "00", ResponseText: "logged out" });
      }
      return undefined;
    });

    const client = new WSChannel(props(), { transport });
    await client.login();
    await expect(client.listCerts()).resolves.toMatchObject({ Certs: [] });
    await expect(client.configCerts("disabled")).resolves.toMatchObject({ ResponseText: "configured" });
    await expect(client.configCerts({ Export: "disabled" })).resolves.toMatchObject({ ResponseText: "configured" });
    await expect(client.shareCerts("other@example.test")).resolves.toMatchObject({ SharedFrom: [] });
    await expect(client.unshareCerts("other@example.test")).resolves.toMatchObject({ SharedTo: [] });
    await expect(client.exportCert("3A3A59B2")).resolves.toMatchObject({ CertsAndKeys: [] });
    await expect(
      client.importCert({
        Certificate: "certificate",
        Company: "EXAMPLE COMPANY",
        PrivateKey: "private-key",
        WsUserId: "ws-user",
      }),
    ).resolves.toMatchObject({ ResponseText: "imported" });
    await expect(
      client.enrollCert({
        Code: "1234567890",
        Company: "EXAMPLE COMPANY",
        WsUserId: "ws-user",
      }),
    ).resolves.toMatchObject({ ResponseText: "enrolled" });
    await expect(client.downloadFile("CAMT", "123")).resolves.toMatchObject({ Content: "Zm9v" });
    await expect(client.deleteFile("CAMT", "123")).resolves.toMatchObject({ ResponseText: "deleted" });
    await expect(client.listAccounts()).resolves.toMatchObject({ Accounts: [] });
    await expect(client.listKeys()).resolves.toMatchObject({ PgpKeys: [] });
    await expect(client.deleteKey("3A3A59B2")).resolves.toMatchObject({ PgpKeys: [] });
    await expect(client.logout()).resolves.toMatchObject({ ResponseText: "logged out" });

    const protectedRequests = transport.requests.slice(2);
    expect(protectedRequests.every((request) => request.headers?.Authorization === "id-token")).toBe(true);
    expect(protectedRequests.every((request) => request.headers?.["x-api-key"] === "api-key")).toBe(true);
    expect(transport.requests.find((request) => request.url.endsWith("/certs/nordea"))?.query).toEqual({
      PgpKeyId: "3A3A59B2",
    });
    expect(
      transport.requests.find((request) => request.method === "DELETE" && request.url.endsWith("/pgp"))?.body,
    ).toEqual({
      PgpKeyId: "3A3A59B2",
    });
    expect(client.session).toEqual({});
  });

  it("rejects malformed challenges and incomplete legacy upload arguments", async () => {
    const malformedTransport = new FakeTransport();
    malformedTransport.respond(() =>
      response({ Challenge: "missing-timestamp", ResponseCode: "00", ResponseText: "OK" }),
    );

    const client = new WSChannel(props(), { transport: malformedTransport });
    await expect(client.login()).rejects.toThrow("challenge did not contain a timestamp");

    const authenticatedTransport = new FakeTransport();
    authenticatedTransport.respond((request) => {
      if (request.method === "GET") return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
      if (request.method === "POST") {
        return response({
          ApiKey: "api-key",
          IdToken: "id-token",
          ResponseCode: "00",
          ResponseText: "Login OK",
        });
      }
      return response({ ResponseCode: "00", ResponseText: "OK" });
    });
    const authenticatedClient = new WSChannel(props({ Mode: "data" }), { transport: authenticatedTransport });
    await authenticatedClient.login();
    await expect(authenticatedClient.uploadFile("contents", "", "type", "sig")).rejects.toThrow("FileName is required");
  });
});
