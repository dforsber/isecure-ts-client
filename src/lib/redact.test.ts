import { describe, expect, it } from "vitest";
import { redactUrl, redactValue, REDACTED } from "./redact.js";

describe("redactValue (balanced)", () => {
  it("redacts known sensitive fields and PII by name", () => {
    expect(
      redactValue({
        ApiKey: "abc",
        Email: "user@example.test",
        Phone: "+358401234567",
        Name: "Jane Doe",
        ResponseText: "OK",
      }),
    ).toEqual({
      ApiKey: REDACTED,
      Email: REDACTED,
      Phone: REDACTED,
      Name: REDACTED,
      ResponseText: "OK",
    });
  });

  it("redacts token-like values even under unknown field names", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.s5pmf2lU7C0gFn2Yp8Xq3Rk1QmType5bGciOiJ";
    const challenge = "ezwXceQ63fV9oWTSJBAE2Zq1Cw5tBIJe7Rl8jrgbk=|1475429754114|4017bda8-0a15-4154-a8b7-88069b05cb4e";
    const result = redactValue({ FutureToken: jwt, Challenge2: challenge, ResponseCode: "00" }) as Record<
      string,
      unknown
    >;
    expect(result.FutureToken).toBe(REDACTED);
    expect(result.Challenge2).toBe(REDACTED);
    expect(result.ResponseCode).toBe("00");
  });

  it("recurses into nested objects and arrays", () => {
    const result = redactValue({
      CertsAndKeys: [{ Certificate: "PUBLIC", EncryptedPrivateKey: "secret-key-value" }],
    }) as { CertsAndKeys: { Certificate: string; EncryptedPrivateKey: string }[] };
    expect(result.CertsAndKeys[0]?.EncryptedPrivateKey).toBe(REDACTED);
    expect(result.CertsAndKeys[0]?.Certificate).toBe("PUBLIC");
  });

  it("leaves short, non-secret scalars intact", () => {
    expect(redactValue({ Status: "ALL", FileType: "CAMT" })).toEqual({ Status: "ALL", FileType: "CAMT" });
  });
});

describe("redactValue (strict)", () => {
  it("redacts everything except an allowlist of safe fields", () => {
    expect(redactValue({ ResponseCode: "00", ServiceId: "x", Subject: "1000", Surprise: "value" }, "strict")).toEqual({
      ResponseCode: "00",
      ServiceId: "x",
      Subject: "1000",
      Surprise: REDACTED,
    });
  });
});

describe("redactUrl", () => {
  it("masks email addresses in the path, encoded or plain", () => {
    expect(redactUrl("https://api.test/v2/account/user%40example.test/admin")).toBe(
      `https://api.test/v2/account/${REDACTED}/admin`,
    );
    expect(redactUrl("https://api.test/v2/certs/shared/other@example.test")).toBe(
      `https://api.test/v2/certs/shared/${REDACTED}`,
    );
  });

  it("masks phone numbers in the phone-verification path (encoded or plain)", () => {
    expect(redactUrl("https://api.test/v2/account/user%40example.test/admin/%2B358401234567")).toBe(
      `https://api.test/v2/account/${REDACTED}/admin/${REDACTED}`,
    );
    expect(redactUrl("https://api.test/v2/account/x%40y.test/admin/+358401234567")).toBe(
      `https://api.test/v2/account/${REDACTED}/admin/${REDACTED}`,
    );
  });

  it("leaves URLs without emails or phones untouched", () => {
    expect(redactUrl("https://api.test/v2/files/nordea/CAMT/227166")).toBe(
      "https://api.test/v2/files/nordea/CAMT/227166",
    );
  });
});
