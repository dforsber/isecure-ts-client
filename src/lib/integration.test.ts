import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WSChannel, type IWSChannel } from "./isecure.class.js";
import { FakeTransport, type TransportRequest, type TransportResponse } from "./transport.js";

const publicKey = readFileSync(new URL("../../examples/gpg-encryption-test/test.pem", import.meta.url), "utf8");
const challenge = "challenge-bytes|1475429754114|4017bda8-0a15-4154-a8b7-88069b05cb4e";

function props(): IWSChannel {
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
  };
}

function res<T>(data: T, status = 200): TransportResponse<T> {
  return { status, statusText: "OK", data };
}

/**
 * A stateful fake backend that advances a freshly registered admin account
 * through email verification, phone verification, and MFA, mirroring the real
 * multi-step login the SDK is designed to drive.
 */
function statefulBackend(): FakeTransport {
  const transport = new FakeTransport();
  let emailVerified = false;
  let phoneVerified = false;

  transport.respond((request: TransportRequest) => {
    const { method, url } = request;

    // Challenge fetches for register/login.
    if (method === "GET" && (url.includes("/account/") || url.includes("/session/"))) {
      return res({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
    }

    // Register (PUT /account/{Email}/{Mode}).
    if (method === "PUT" && /\/account\/[^/]+\/admin$/.test(url)) {
      return res({ ApiKey: "integrator-key", ResponseCode: "00", ResponseText: "Created" }, 201);
    }

    // Email verification (POST /account/{Email}/{Mode}).
    if (method === "POST" && /\/account\/[^/]+\/admin$/.test(url)) {
      emailVerified = true;
      return res({ ResponseCode: "00", ResponseText: "Email verification successful." });
    }

    // Phone verification (POST /account/{Email}/{Mode}/{Phone}).
    if (method === "POST" && url.includes("/account/") && url.endsWith(encodeURIComponent("+358401234567"))) {
      phoneVerified = true;
      return res({ ResponseCode: "00", ResponseText: "Phone confirmation successful." });
    }

    // Login (POST /session/{Email}/{Mode}) — returns the next pending step.
    if (method === "POST" && url.includes("/session/")) {
      if (!emailVerified) {
        return res({
          AccessToken: "access-token",
          ResponseCode: "00",
          ResponseText: "Login OK. Verify email address.",
        });
      }
      if (!phoneVerified) {
        return res({
          Session: "sess",
          ResponseCode: "00",
          ResponseText: "Verify phone number with received SMS code.",
        });
      }
      return res({ Session: "sess", ResponseCode: "00", ResponseText: "Give SMS code" });
    }

    // MFA submission (PUT /session/{Email}/{Mode}/mfacode) — issues tokens.
    if (method === "PUT" && url.endsWith("/mfacode")) {
      return res({
        ApiKey: "session-key",
        ExpiresIn: "3600",
        IdToken: "id-token",
        ResponseCode: "00",
        ResponseText: "Login OK",
      });
    }

    // An authenticated operation.
    if (method === "GET" && url.endsWith("/pgp")) {
      return res({ PgpKeys: [], ResponseCode: "00", ResponseText: "keys" });
    }

    return undefined;
  });

  return transport;
}

describe("end-to-end onboarding (SDK boundary)", () => {
  it("drives register -> verify email -> verify phone -> MFA -> authenticated via the SDK only", async () => {
    const codes: string[] = [];
    const client = new WSChannel(props(), { transport: statefulBackend() });

    const registration = await client.register();
    expect(registration.ApiKey).toBe("integrator-key");

    const state = await client.loginWithPrompt({
      async requestMfaCode() {
        codes.push("mfa");
        return "111111";
      },
      async requestEmailCode() {
        codes.push("email");
        return "222222";
      },
      async requestPhoneCode() {
        codes.push("phone");
        return "333333";
      },
    });

    expect(state.status).toBe("authenticated");
    // Every verification step was driven exactly once, in order.
    expect(codes).toEqual(["email", "phone", "mfa"]);
    expect(client.isAuthenticated()).toBe(true);
    expect(client.isSessionExpired()).toBe(false);

    // The resulting session can make an authenticated call.
    await expect(client.listKeys()).resolves.toMatchObject({ PgpKeys: [] });
  });
});
