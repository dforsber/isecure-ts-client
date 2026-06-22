import { describe, expect, it } from "vitest";
import { ISecureAbortError, ISecureError, ISecureHttpError, ISecureNetworkError, isISecureError } from "./errors.js";

describe("error hierarchy", () => {
  it("extracts ResponseCode/ResponseText/RequestId from an error body", () => {
    const error = ISecureHttpError.fromResponse(503, "Service Unavailable", {
      RequestId: "req-9",
      ResponseCode: "99",
      ResponseText: "Down for maintenance",
    });

    expect(error).toBeInstanceOf(ISecureError);
    expect(error.status).toBe(503);
    expect(error.responseCode).toBe("99");
    expect(error.responseText).toBe("Down for maintenance");
    expect(error.requestId).toBe("req-9");
    expect(error.message).toContain("503 Service Unavailable");
    expect(error.message).toContain("RequestId req-9");
    expect(error.message).toContain("Down for maintenance");
  });

  it("tolerates a non-object error body", () => {
    const error = ISecureHttpError.fromResponse(500, "Server Error", "plain text");
    expect(error.responseCode).toBeUndefined();
    expect(error.requestId).toBeUndefined();
    expect(error.body).toBe("plain text");
  });

  it("flags timeouts on network errors and preserves the cause", () => {
    const cause = new Error("timeout of 30000ms exceeded");
    const error = new ISecureNetworkError("ISECure request failed: request timed out", {
      cause,
      code: "ECONNABORTED",
      timedOut: true,
    });

    expect(error.timedOut).toBe(true);
    expect(error.code).toBe("ECONNABORTED");
    expect(error.cause).toBe(cause);
  });

  it("identifies all SDK errors via isISecureError", () => {
    expect(isISecureError(new ISecureAbortError())).toBe(true);
    expect(isISecureError(new ISecureNetworkError("x"))).toBe(true);
    expect(isISecureError(new ISecureHttpError({ status: 400, statusText: "Bad Request" }))).toBe(true);
    expect(isISecureError(new Error("plain"))).toBe(false);
    expect(isISecureError("nope")).toBe(false);
  });
});
