import { describe, expect, it } from "vitest";
import { classifyAuthResponse, classifyVerificationResponse, mergeTokens } from "./auth.js";
import type { LoginResponse } from "./api-types.js";

describe("auth state classification", () => {
  it("merges session tokens without losing existing values", () => {
    expect(
      mergeTokens(
        { session: "session-token", accessToken: "access-token" },
        {
          ApiKey: "api-key",
          IdToken: "id-token",
          ResponseCode: "00",
          ResponseText: "Login OK",
        },
      ),
    ).toEqual({
      accessToken: "access-token",
      apiKey: "api-key",
      expiresIn: undefined,
      idToken: "id-token",
      session: "session-token",
    });
  });

  it("classifies authenticated responses from token presence", () => {
    const response: LoginResponse = {
      ApiKey: "api-key",
      IdToken: "id-token",
      ResponseCode: "00",
      ResponseText: "Login OK",
    };

    expect(classifyAuthResponse("data", response, mergeTokens({}, response))).toMatchObject({
      status: "authenticated",
      tokens: { apiKey: "api-key", idToken: "id-token" },
    });
  });

  it("classifies required verification and failure states", () => {
    expect(
      classifyAuthResponse(
        "data",
        {
          AccessToken: "access-token",
          ResponseCode: "00",
          ResponseText: "Login OK. Verify email address.",
        },
        { accessToken: "access-token" },
      ),
    ).toMatchObject({ status: "needs_email_verification", accessToken: "access-token" });

    expect(
      classifyAuthResponse(
        "data",
        {
          ResponseCode: "00",
          ResponseText: "User authentication failed. Verify phone number with received SMS.",
        },
        {},
      ),
    ).toMatchObject({ status: "needs_phone_verification" });

    expect(classifyVerificationResponse("data", "phone", { ResponseCode: "00", ResponseText: "ok" })).toMatchObject({
      status: "verification_accepted",
      verification: "phone",
    });

    expect(classifyVerificationResponse("data", "email", { ResponseCode: "01", ResponseText: "bad" })).toMatchObject({
      status: "failed",
      responseCode: "01",
    });

    expect(classifyAuthResponse("data", { ResponseCode: "00", ResponseText: "Unexpected success" }, {})).toMatchObject({
      status: "failed",
      responseCode: "00",
      responseText: "Unexpected success",
    });
  });

  it("prefers explicit phone verification over the session/sms-code MFA heuristic", () => {
    // A phone-verification login can also carry a Cognito session token and the
    // words "sms code"; it must still classify as phone verification, not MFA.
    expect(
      classifyAuthResponse(
        "admin",
        {
          ResponseCode: "00",
          ResponseText: "Verify phone number with received SMS code.",
          Session: "session-token",
        },
        { session: "session-token" },
      ),
    ).toMatchObject({ status: "needs_phone_verification" });
  });

  it("classifies the real token-less email-verification prompt as a typed failure, not MFA", () => {
    // Regression for the observed iSecure response: "Login OK. Verify email
    // address." arrives with a Cognito *session* token and NO access token. The
    // §1 bug misread it as needs_mfa (driving /mfacode in a loop). It must not
    // be MFA; and since email verification needs an access token the SDK does
    // not have, it resolves to a self-consistent typed failure rather than a
    // needs_email_verification state that verifyEmail() would reject.
    const state = classifyAuthResponse(
      "admin",
      {
        ResponseCode: "00",
        ResponseText: "Login OK. Verify email address.",
        Session: "session-token",
      },
      { session: "session-token" },
    );

    expect(state.status).not.toBe("needs_mfa");
    expect(state).toMatchObject({ status: "failed", reason: "missing_access_token" });
  });

  it("classifies the email-verification prompt as needs_email_verification when an access token is present", () => {
    // The documented contract path: an email-not-verified login returns an
    // access token, which the state carries so verifyEmail() can drive it.
    expect(
      classifyAuthResponse(
        "admin",
        {
          AccessToken: "access-token",
          ResponseCode: "00",
          ResponseText: "Login OK. Verify email address.",
          Session: "session-token",
        },
        { accessToken: "access-token", session: "session-token" },
      ),
    ).toMatchObject({ status: "needs_email_verification", accessToken: "access-token" });
  });

  it("still classifies a genuine MFA challenge as needs_mfa", () => {
    expect(
      classifyAuthResponse(
        "admin",
        { ResponseCode: "00", ResponseText: "Give SMS code", Session: "session-token" },
        { session: "session-token" },
      ),
    ).toMatchObject({ status: "needs_mfa", session: "session-token" });
  });

  it("classifies phone verification from stable response text fragments", () => {
    expect(
      classifyAuthResponse("data", { ResponseCode: "00", ResponseText: "User must verify phone number by SMS." }, {}),
    ).toMatchObject({ status: "needs_phone_verification" });
  });

  it("fails self-consistently when email verification is requested without an access token", () => {
    // needs_email_verification must always carry a usable access token, so an
    // email-verification prompt with no token surfaces a typed failure instead
    // of a state that verifyEmail() would reject.
    expect(
      classifyAuthResponse(
        "data",
        { ResponseCode: "00", ResponseText: "Please VERIFY EMAIL address before login." },
        {},
      ),
    ).toMatchObject({ status: "failed", reason: "missing_access_token" });
  });

  it("maps verification failures to discriminable error reasons", () => {
    expect(
      classifyVerificationResponse("data", "email", { ResponseCode: "01", ResponseText: "Invalid code provided" }),
    ).toMatchObject({ status: "failed", reason: "invalid_code" });

    expect(
      classifyVerificationResponse("data", "phone", { ResponseCode: "01", ResponseText: "Code has expired" }),
    ).toMatchObject({ status: "failed", reason: "expired_code" });

    expect(
      classifyVerificationResponse("data", "email", { ResponseCode: "01", ResponseText: "Too many attempts" }),
    ).toMatchObject({ status: "failed", reason: "too_many_attempts" });

    expect(
      classifyVerificationResponse("data", "email", { ResponseCode: "01", ResponseText: "Some opaque server error" }),
    ).toMatchObject({ status: "failed", reason: "unknown" });
  });
});
