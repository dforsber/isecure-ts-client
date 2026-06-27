import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WSChannel, type IWSChannel } from "./isecure.class.js";
import { cognitoToMethod, methodToCognito } from "./auth.js";
import { classifyAuthResponse } from "./auth.js";
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

// ---- Unit: factor-name mapping helper ------------------------------------

describe("factor-name mapping helpers", () => {
  it("cognitoToMethod maps SMS_MFA → sms", () => {
    expect(cognitoToMethod("SMS_MFA")).toBe("sms");
  });

  it("cognitoToMethod maps SOFTWARE_TOKEN_MFA → totp", () => {
    expect(cognitoToMethod("SOFTWARE_TOKEN_MFA")).toBe("totp");
  });

  it("cognitoToMethod falls back to sms for unrecognised values", () => {
    expect(cognitoToMethod("UNKNOWN_FACTOR")).toBe("sms");
  });

  it("methodToCognito maps sms → SMS_MFA", () => {
    expect(methodToCognito("sms")).toBe("SMS_MFA");
  });

  it("methodToCognito maps totp → SOFTWARE_TOKEN_MFA", () => {
    expect(methodToCognito("totp")).toBe("SOFTWARE_TOKEN_MFA");
  });
});

// ---- Unit: classify SELECT_MFA_TYPE response ----------------------------

describe("classifyAuthResponse — needs_mfa_selection", () => {
  it("classifies a SELECT_MFA_TYPE response as needs_mfa_selection with mapped methods", () => {
    const result = classifyAuthResponse(
      "admin",
      {
        ResponseCode: "00",
        ResponseText: "Select MFA type",
        Session: "select-session",
        ChallengeName: "SELECT_MFA_TYPE",
        MfaOptions: ["SMS_MFA", "SOFTWARE_TOKEN_MFA"],
        SmsDestination: "+*****5507",
      },
      { session: "select-session" },
    );

    expect(result.status).toBe("needs_mfa_selection");
    if (result.status !== "needs_mfa_selection") throw new Error("unreachable");
    expect(result.methods).toEqual(["sms", "totp"]);
    expect(result.smsDestination).toBe("+*****5507");
    expect(result.session).toBe("select-session");
    expect(result.mode).toBe("admin");
  });

  it("classifies SELECT_MFA_TYPE with only TOTP offered", () => {
    const result = classifyAuthResponse(
      "admin",
      {
        ResponseCode: "00",
        ResponseText: "Select MFA type",
        Session: "select-session",
        ChallengeName: "SELECT_MFA_TYPE",
        MfaOptions: ["SOFTWARE_TOKEN_MFA"],
      },
      { session: "select-session" },
    );

    expect(result.status).toBe("needs_mfa_selection");
    if (result.status !== "needs_mfa_selection") throw new Error("unreachable");
    expect(result.methods).toEqual(["totp"]);
    expect(result.smsDestination).toBeUndefined();
  });

  it("classifies SELECT_MFA_TYPE without MfaOptions as needs_mfa_selection with empty methods", () => {
    const result = classifyAuthResponse(
      "admin",
      {
        ResponseCode: "00",
        ResponseText: "Select MFA type",
        Session: "select-session",
        ChallengeName: "SELECT_MFA_TYPE",
      },
      { session: "select-session" },
    );

    expect(result.status).toBe("needs_mfa_selection");
    if (result.status !== "needs_mfa_selection") throw new Error("unreachable");
    expect(result.methods).toEqual([]);
  });

  it("does NOT classify SMS_MFA as needs_mfa_selection (still needs_mfa)", () => {
    const result = classifyAuthResponse(
      "admin",
      {
        ResponseCode: "00",
        ResponseText: "Give SMS code",
        Session: "mfa-session",
        ChallengeName: "SMS_MFA",
      },
      { session: "mfa-session" },
    );

    expect(result.status).toBe("needs_mfa");
    if (result.status !== "needs_mfa") throw new Error("unreachable");
    expect(result.method).toBe("sms");
  });
});

// ---- Unit: selectMfaType method -----------------------------------------

describe("WSChannel.selectMfaType", () => {
  it("throws if called before a session token exists", async () => {
    const transport = new FakeTransport();
    const client = new WSChannel(props(), { transport });

    await expect(client.selectMfaType("totp")).rejects.toThrow(
      "Cannot select MFA type before login returns a SELECT_MFA_TYPE session token",
    );
  });

  it("selectMfaType(totp) PUTs {MfaType: SOFTWARE_TOKEN_MFA, Session} and returns needs_mfa with method totp", async () => {
    const transport = new FakeTransport();
    transport.respond((request) => {
      if (match("GET", "/session/user%40example.test/admin")(request)) {
        return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
      }
      if (match("POST", "/session/user%40example.test/admin")(request)) {
        return response({
          ResponseCode: "00",
          ResponseText: "Select MFA type",
          Session: "select-sess",
          ChallengeName: "SELECT_MFA_TYPE",
          MfaOptions: ["SMS_MFA", "SOFTWARE_TOKEN_MFA"],
          SmsDestination: "+*****5507",
        });
      }
      if (match("PUT", "/session/user%40example.test/admin/selectmfa")(request)) {
        return response({
          ResponseCode: "00",
          ResponseText: "Give authenticator code",
          Session: "totp-sess",
          ChallengeName: "SOFTWARE_TOKEN_MFA",
        });
      }
      return undefined;
    });

    const client = new WSChannel(props(), { transport });
    const loginState = await client.login();
    expect(loginState.status).toBe("needs_mfa_selection");

    const selectState = await client.selectMfaType("totp");
    expect(selectState.status).toBe("needs_mfa");
    if (selectState.status !== "needs_mfa") throw new Error("unreachable");
    expect(selectState.method).toBe("totp");
    expect(selectState.session).toBe("totp-sess");

    // Verify the body sent to selectmfa
    const selectReq = transport.requests[2];
    expect(selectReq?.body).toEqual({ MfaType: "SOFTWARE_TOKEN_MFA", Session: "select-sess" });
  });

  it("selectMfaType(sms) PUTs {MfaType: SMS_MFA, Session} and returns needs_mfa with method sms", async () => {
    const transport = new FakeTransport();
    transport.respond((request) => {
      if (match("GET", "/session/user%40example.test/admin")(request)) {
        return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
      }
      if (match("POST", "/session/user%40example.test/admin")(request)) {
        return response({
          ResponseCode: "00",
          ResponseText: "Select MFA type",
          Session: "select-sess",
          ChallengeName: "SELECT_MFA_TYPE",
          MfaOptions: ["SMS_MFA", "SOFTWARE_TOKEN_MFA"],
          SmsDestination: "+*****5507",
        });
      }
      if (match("PUT", "/session/user%40example.test/admin/selectmfa")(request)) {
        return response({
          ResponseCode: "00",
          ResponseText: "Give SMS code",
          Session: "sms-sess",
          ChallengeName: "SMS_MFA",
        });
      }
      return undefined;
    });

    const client = new WSChannel(props(), { transport });
    const loginState = await client.login();
    expect(loginState.status).toBe("needs_mfa_selection");

    const selectState = await client.selectMfaType("sms");
    expect(selectState.status).toBe("needs_mfa");
    if (selectState.status !== "needs_mfa") throw new Error("unreachable");
    expect(selectState.method).toBe("sms");
    expect(selectState.session).toBe("sms-sess");

    // Verify the body sent to selectmfa
    const selectReq = transport.requests[2];
    expect(selectReq?.body).toEqual({ MfaType: "SMS_MFA", Session: "select-sess" });
  });
});

// ---- Integration: full flow with FakeTransport --------------------------

describe("WSChannel MFA selection — integration flows", () => {
  // Full flow: login → SELECT_MFA_TYPE → selectMfaType(totp) → submitMfaCode → authenticated
  it("TOTP path: login → selection → selectMfaType(totp) → submitMfaCode → authenticated", async () => {
    const transport = new FakeTransport();
    transport.respond((request) => {
      if (match("GET", "/session/user%40example.test/admin")(request)) {
        return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
      }
      if (match("POST", "/session/user%40example.test/admin")(request)) {
        return response({
          ResponseCode: "00",
          ResponseText: "Select MFA type",
          Session: "select-sess",
          ChallengeName: "SELECT_MFA_TYPE",
          MfaOptions: ["SMS_MFA", "SOFTWARE_TOKEN_MFA"],
          SmsDestination: "+*****5507",
        });
      }
      if (match("PUT", "/session/user%40example.test/admin/selectmfa")(request)) {
        return response({
          ResponseCode: "00",
          ResponseText: "Give authenticator code",
          Session: "totp-sess",
          ChallengeName: "SOFTWARE_TOKEN_MFA",
        });
      }
      if (match("PUT", "/session/user%40example.test/admin/mfacode")(request)) {
        return response({
          ApiKey: "api-key",
          IdToken: "id-token",
          ResponseCode: "00",
          ResponseText: "Login OK",
        });
      }
      return undefined;
    });

    const client = new WSChannel(props(), { transport });
    const loginState = await client.login();
    expect(loginState.status).toBe("needs_mfa_selection");
    if (loginState.status !== "needs_mfa_selection") throw new Error("unreachable");
    expect(loginState.methods).toContain("totp");
    expect(loginState.smsDestination).toBe("+*****5507");

    const selectState = await client.selectMfaType("totp");
    expect(selectState.status).toBe("needs_mfa");
    if (selectState.status !== "needs_mfa") throw new Error("unreachable");
    expect(selectState.method).toBe("totp");

    const authed = await client.submitMfaCode("123456");
    expect(authed.status).toBe("authenticated");

    // Assert session chaining: selectmfa used the SELECT_MFA_TYPE session; mfacode used the TOTP session
    const selectReq = transport.requests[2];
    expect(selectReq?.body).toMatchObject({ Session: "select-sess", MfaType: "SOFTWARE_TOKEN_MFA" });
    const mfaReq = transport.requests[3];
    expect(mfaReq?.body).toMatchObject({ Session: "totp-sess", ChallengeName: "SOFTWARE_TOKEN_MFA" });
  });

  // Full flow: login → SELECT_MFA_TYPE → selectMfaType(sms) → submitMfaCode → authenticated
  it("SMS path: login → selection → selectMfaType(sms) → submitMfaCode → authenticated", async () => {
    const transport = new FakeTransport();
    transport.respond((request) => {
      if (match("GET", "/session/user%40example.test/admin")(request)) {
        return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
      }
      if (match("POST", "/session/user%40example.test/admin")(request)) {
        return response({
          ResponseCode: "00",
          ResponseText: "Select MFA type",
          Session: "select-sess",
          ChallengeName: "SELECT_MFA_TYPE",
          MfaOptions: ["SMS_MFA", "SOFTWARE_TOKEN_MFA"],
          SmsDestination: "+*****5507",
        });
      }
      if (match("PUT", "/session/user%40example.test/admin/selectmfa")(request)) {
        return response({
          ResponseCode: "00",
          ResponseText: "Give SMS code",
          Session: "sms-sess",
          ChallengeName: "SMS_MFA",
        });
      }
      if (match("PUT", "/session/user%40example.test/admin/mfacode")(request)) {
        return response({
          ApiKey: "api-key",
          IdToken: "id-token",
          ResponseCode: "00",
          ResponseText: "Login OK",
        });
      }
      return undefined;
    });

    const client = new WSChannel(props(), { transport });
    const loginState = await client.login();
    expect(loginState.status).toBe("needs_mfa_selection");

    const selectState = await client.selectMfaType("sms");
    expect(selectState.status).toBe("needs_mfa");
    if (selectState.status !== "needs_mfa") throw new Error("unreachable");
    expect(selectState.method).toBe("sms");

    const authed = await client.submitMfaCode("999888");
    expect(authed.status).toBe("authenticated");

    // Assert session chaining: selectmfa used SELECT_MFA_TYPE session; mfacode used SMS session
    const selectReq = transport.requests[2];
    expect(selectReq?.body).toMatchObject({ Session: "select-sess", MfaType: "SMS_MFA" });
    const mfaReq = transport.requests[3];
    expect(mfaReq?.body).toMatchObject({ Session: "sms-sess", ChallengeName: "SMS_MFA" });
  });

  // loginWithPrompt defaults to TOTP when both factors are offered
  it("loginWithPrompt defaults to TOTP selection when both SMS and TOTP are offered", async () => {
    const transport = new FakeTransport();
    transport.respond((request) => {
      if (match("GET", "/session/user%40example.test/admin")(request)) {
        return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
      }
      if (match("POST", "/session/user%40example.test/admin")(request)) {
        return response({
          ResponseCode: "00",
          ResponseText: "Select MFA type",
          Session: "select-sess",
          ChallengeName: "SELECT_MFA_TYPE",
          MfaOptions: ["SMS_MFA", "SOFTWARE_TOKEN_MFA"],
          SmsDestination: "+*****5507",
        });
      }
      if (match("PUT", "/session/user%40example.test/admin/selectmfa")(request)) {
        // Verify that the default is TOTP
        const body = request.body as { MfaType: string };
        if (body.MfaType !== "SOFTWARE_TOKEN_MFA") {
          return response({ ResponseCode: "01", ResponseText: "Unexpected MfaType" });
        }
        return response({
          ResponseCode: "00",
          ResponseText: "Give authenticator code",
          Session: "totp-sess",
          ChallengeName: "SOFTWARE_TOKEN_MFA",
        });
      }
      if (match("PUT", "/session/user%40example.test/admin/mfacode")(request)) {
        return response({
          ApiKey: "api-key",
          IdToken: "id-token",
          ResponseCode: "00",
          ResponseText: "Login OK",
        });
      }
      return undefined;
    });

    const client = new WSChannel(props(), { transport });
    const state = await client.loginWithPrompt({
      async requestMfaCode() {
        return "123456";
      },
      async requestEmailCode() {
        return "000000";
      },
      async requestPhoneCode() {
        return "000000";
      },
    });

    expect(state.status).toBe("authenticated");

    // Confirm selectmfa was called with TOTP as default
    const selectReq = transport.requests[2];
    expect(selectReq?.body).toMatchObject({ MfaType: "SOFTWARE_TOKEN_MFA" });
  });

  // loginWithPrompt respects requestMfaSelection hook when provided
  it("loginWithPrompt calls requestMfaSelection hook when provided and uses its choice (sms)", async () => {
    const transport = new FakeTransport();
    transport.respond((request) => {
      if (match("GET", "/session/user%40example.test/admin")(request)) {
        return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "OK" });
      }
      if (match("POST", "/session/user%40example.test/admin")(request)) {
        return response({
          ResponseCode: "00",
          ResponseText: "Select MFA type",
          Session: "select-sess",
          ChallengeName: "SELECT_MFA_TYPE",
          MfaOptions: ["SMS_MFA", "SOFTWARE_TOKEN_MFA"],
          SmsDestination: "+*****5507",
        });
      }
      if (match("PUT", "/session/user%40example.test/admin/selectmfa")(request)) {
        return response({
          ResponseCode: "00",
          ResponseText: "Give SMS code",
          Session: "sms-sess",
          ChallengeName: "SMS_MFA",
        });
      }
      if (match("PUT", "/session/user%40example.test/admin/mfacode")(request)) {
        return response({
          ApiKey: "api-key",
          IdToken: "id-token",
          ResponseCode: "00",
          ResponseText: "Login OK",
        });
      }
      return undefined;
    });

    let selectionStateSeen: string[] = [];
    const client = new WSChannel(props(), { transport });
    const state = await client.loginWithPrompt({
      async requestMfaCode() {
        return "777777";
      },
      async requestEmailCode() {
        return "000000";
      },
      async requestPhoneCode() {
        return "000000";
      },
      async requestMfaSelection(selectionState) {
        selectionStateSeen = selectionState.methods;
        return "sms"; // explicitly pick SMS
      },
    });

    expect(state.status).toBe("authenticated");
    expect(selectionStateSeen).toEqual(["sms", "totp"]);

    // Confirm selectmfa was called with SMS
    const selectReq = transport.requests[2];
    expect(selectReq?.body).toMatchObject({ MfaType: "SMS_MFA" });
  });
});
