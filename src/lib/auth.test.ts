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

  it("prefers explicit email verification over the session/sms-code MFA heuristic", () => {
    // Regression: the iSecure server returns "Login OK. Verify email address."
    // together with a session token and an access token; this must classify as
    // email verification, not MFA, and carry the access token needed to drive it.
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
