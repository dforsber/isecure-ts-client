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
});
