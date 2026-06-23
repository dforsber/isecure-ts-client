import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WSChannel, type IWSChannel } from "./isecure.class.js";
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

// Minimal RFC 6238 TOTP so tests derive real codes from the enrollment secret
// (deterministic, no SMS, no extra dependency).
function base32Decode(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of secret.replace(/=+$/u, "").toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secret: string, counter = 0): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
  const b0 = hmac[offset] ?? 0;
  const b1 = hmac[offset + 1] ?? 0;
  const b2 = hmac[offset + 2] ?? 0;
  const b3 = hmac[offset + 3] ?? 0;
  const bin = ((b0 & 0x7f) << 24) | ((b1 & 0xff) << 16) | ((b2 & 0xff) << 8) | (b3 & 0xff);
  return (bin % 1_000_000).toString().padStart(6, "0");
}

describe("WSChannel TOTP MFA", () => {
  // ---- SMS path: covered once, proving it still works -------------------
  it("classifies an SMS challenge and submits the code unchanged (SMS regression)", async () => {
    const transport = new FakeTransport();
    transport.respond((request) => {
      if (match("GET", "/session/user%40example.test/admin")(request)) {
        return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
      }
      if (match("POST", "/session/user%40example.test/admin")(request)) {
        return response({
          ResponseCode: "00",
          ResponseText: "Give SMS code",
          Session: "sess",
          ChallengeName: "SMS_MFA",
        });
      }
      if (match("PUT", "/session/user%40example.test/admin/mfacode")(request)) {
        return response({ ApiKey: "api-key", IdToken: "id-token", ResponseCode: "00", ResponseText: "Login OK" });
      }
      return undefined;
    });

    const client = new WSChannel(props(), { transport });
    const loginState = await client.login();
    expect(loginState).toMatchObject({ status: "needs_mfa", method: "sms" });

    const authed = await client.submitMfaCode("123456");
    expect(authed.status).toBe("authenticated");
    expect(transport.requests[2]?.body).toEqual({ Code: "123456", Session: "sess", ChallengeName: "SMS_MFA" });
  });

  // ---- TOTP login -------------------------------------------------------
  it("classifies a SOFTWARE_TOKEN_MFA challenge as method totp and echoes the challenge name", async () => {
    const transport = new FakeTransport();
    transport.respond((request) => {
      if (match("GET", "/session/user%40example.test/admin")(request)) {
        return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
      }
      if (match("POST", "/session/user%40example.test/admin")(request)) {
        return response({
          ResponseCode: "00",
          ResponseText: "Give authenticator code",
          Session: "sess",
          ChallengeName: "SOFTWARE_TOKEN_MFA",
        });
      }
      if (match("PUT", "/session/user%40example.test/admin/mfacode")(request)) {
        return response({ ApiKey: "api-key", IdToken: "id-token", ResponseCode: "00", ResponseText: "Login OK" });
      }
      return undefined;
    });

    const client = new WSChannel(props(), { transport });
    const loginState = await client.login();
    expect(loginState).toMatchObject({ status: "needs_mfa", method: "totp" });

    const authed = await client.submitMfaCode(totp("JBSWY3DPEHPK3PXP"));
    expect(authed.status).toBe("authenticated");
    expect(transport.requests[2]?.body).toMatchObject({ Session: "sess", ChallengeName: "SOFTWARE_TOKEN_MFA" });
  });

  // ---- TOTP enrollment --------------------------------------------------
  it("requests TOTP setup, surfaces the enrollment payload, and confirms it via verifyTotp", async () => {
    const transport = new FakeTransport();
    transport.respond((request) => {
      if (match("GET", "/session/user%40example.test/admin")(request)) {
        return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
      }
      if (match("POST", "/session/user%40example.test/admin")(request)) {
        return response({ ResponseCode: "00", ResponseText: "Give SMS code", Session: "sess", ChallengeName: "SMS_MFA" });
      }
      if (match("PUT", "/session/user%40example.test/admin/mfacode")(request)) {
        return response({
          ApiKey: "api-key",
          ExpiresIn: "3600",
          IdToken: "id-token",
          AccessToken: "enroll-access-token",
          SecretCode: "JBSWY3DPEHPK3PXP",
          OtpauthUri: "otpauth://totp/ISECure:user%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=ISECure",
          ResponseCode: "00",
          ResponseText: "Login OK, verify TOTP",
        });
      }
      if (match("PUT", "/session/user%40example.test/admin/verifytotp")(request)) {
        return response({ ResponseCode: "00", ResponseText: "TOTP enabled" });
      }
      return undefined;
    });

    const client = new WSChannel(props(), { transport });
    await client.login();
    const setup = await client.submitMfaCode("123456", { setupTotp: true });

    expect(setup.status).toBe("authenticated");
    if (setup.status !== "authenticated") throw new Error("unreachable");
    expect(transport.requests[2]?.body).toMatchObject({ SetupTOTP: true, ChallengeName: "SMS_MFA" });
    const enrollment = setup.totpEnrollment;
    expect(enrollment).toEqual({
      secret: "JBSWY3DPEHPK3PXP",
      otpauthUri: "otpauth://totp/ISECure:user%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=ISECure",
      accessToken: "enroll-access-token",
    });
    if (!enrollment) throw new Error("unreachable");
    // The enrollment access token must NOT be retained in the session.
    expect(client.session.accessToken).toBeUndefined();

    const code = totp(enrollment.secret);
    expect(code).toMatch(/^[0-9]{6}$/u);

    const verified = await client.verifyTotp(enrollment.accessToken, code);
    expect(verified).toMatchObject({ status: "verification_accepted", verification: "totp" });
    expect(transport.requests[3]?.body).toEqual({ AccessToken: "enroll-access-token", Code: code });
  });
});
