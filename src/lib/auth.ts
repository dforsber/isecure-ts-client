import type { LoginMfaResponse, LoginResponse, Mode } from "./api-types.js";

export interface SessionTokens {
  accessToken?: string | undefined;
  apiKey?: string | undefined;
  expiresIn?: string | undefined;
  idToken?: string | undefined;
  session?: string | undefined;
}

export type AuthResponse = LoginResponse | LoginMfaResponse;

export type ResponseEnvelope = { ResponseCode: string; ResponseText: string };

/**
 * Discriminable reasons for a failed authentication, verification, or
 * confirmation step. The mapping is best-effort: it is derived from the
 * backend `ResponseText` (and `ResponseCode` where distinguishable) because the
 * WS API does not yet return machine-readable error codes for these cases.
 * Reasons the backend cannot currently be told apart collapse to `"unknown"`.
 */
export type AuthErrorReason =
  | "invalid_code"
  | "expired_code"
  | "resend_required"
  | "too_many_attempts"
  | "not_verified"
  | "already_verified"
  | "unconfirmed"
  | "missing_access_token"
  | "unknown";

/** The verification/MFA step a multi-step login is waiting on. */
export type AuthStep = "mfa" | "email_verification" | "phone_verification";

export type AuthState =
  | {
      status: "authenticated";
      mode: Mode;
      tokens: Required<Pick<SessionTokens, "apiKey" | "idToken">> & SessionTokens;
      response: AuthResponse;
    }
  | {
      status: "needs_mfa";
      mode: Mode;
      session: string;
      response: AuthResponse;
    }
  | {
      status: "needs_email_verification";
      mode: Mode;
      accessToken: string;
      response: AuthResponse;
    }
  | {
      status: "needs_phone_verification";
      mode: Mode;
      response: AuthResponse;
    }
  | {
      status: "verification_accepted";
      mode: Mode;
      verification: "email" | "phone";
      response: { ResponseCode: string; ResponseText: string };
    }
  | {
      status: "stalled";
      mode: Mode;
      step: AuthStep;
      transitions: number;
      response: AuthResponse | ResponseEnvelope;
    }
  | {
      status: "failed";
      mode: Mode;
      reason: AuthErrorReason;
      responseCode: string;
      responseText: string;
      response: ResponseEnvelope;
    };

export interface AuthPromptAdapter {
  requestMfaCode(state: Extract<AuthState, { status: "needs_mfa" }>): Promise<string>;
  requestEmailCode(state: Extract<AuthState, { status: "needs_email_verification" }>): Promise<string>;
  requestPhoneCode(state: Extract<AuthState, { status: "needs_phone_verification" }>): Promise<string>;
}

export function mergeTokens(current: SessionTokens, response: AuthResponse): SessionTokens {
  return {
    accessToken: response.AccessToken ?? current.accessToken,
    apiKey: response.ApiKey ?? current.apiKey,
    expiresIn: response.ExpiresIn ?? current.expiresIn,
    idToken: response.IdToken ?? current.idToken,
    session: "Session" in response ? (response.Session ?? current.session) : current.session,
  };
}

export function classifyAuthResponse(mode: Mode, response: AuthResponse, tokens: SessionTokens): AuthState {
  if (response.ResponseCode !== "00") {
    return failed(mode, response);
  }

  if (tokens.apiKey && tokens.idToken) {
    return {
      status: "authenticated",
      mode,
      tokens: {
        ...tokens,
        apiKey: tokens.apiKey,
        idToken: tokens.idToken,
      },
      response,
    };
  }

  // Explicit verification prompts are classified before the session/"sms code"
  // MFA heuristic. A phone- or email-verification response can also carry a
  // Cognito session token or the substring "sms code" (e.g. "Verify phone
  // number with received SMS code"), which would otherwise be misread as an MFA
  // challenge and route the client to the wrong endpoint.
  if (responseTextIncludes(response, "verify phone")) {
    return {
      status: "needs_phone_verification",
      mode,
      response,
    };
  }

  // Email verification is driven via the access-token attribute path, so the
  // state only carries a usable token. If the backend asks for email
  // verification without returning an access token, the SDK cannot drive it —
  // surface a typed failure instead of a state that verifyEmail() would reject.
  if (tokens.accessToken) {
    return {
      status: "needs_email_verification",
      mode,
      accessToken: tokens.accessToken,
      response,
    };
  }

  if (responseTextIncludes(response, "verify email")) {
    return {
      status: "failed",
      mode,
      reason: "missing_access_token",
      responseCode: response.ResponseCode,
      responseText: response.ResponseText,
      response,
    };
  }

  if (tokens.session || responseTextIncludes(response, "sms code")) {
    return {
      status: "needs_mfa",
      mode,
      session: tokens.session ?? "",
      response,
    };
  }

  return failed(mode, response);
}

function responseTextIncludes(response: { ResponseText: string }, expectedText: string): boolean {
  return response.ResponseText.toLowerCase().includes(expectedText);
}

function failed(mode: Mode, response: ResponseEnvelope): Extract<AuthState, { status: "failed" }> {
  return {
    status: "failed",
    mode,
    reason: classifyErrorReason(response),
    responseCode: response.ResponseCode,
    responseText: response.ResponseText,
    response,
  };
}

/**
 * Best-effort mapping from a backend response to a discriminable error reason.
 * Driven by `ResponseText` fragments since the WS API does not yet expose
 * dedicated codes for these cases; unmatched responses fall back to "unknown"
 * and are tracked as a backend follow-up.
 */
export function classifyErrorReason(response: ResponseEnvelope): AuthErrorReason {
  const text = response.ResponseText.toLowerCase();

  if (text.includes("too many") || text.includes("attempt limit") || text.includes("limit exceeded")) {
    return "too_many_attempts";
  }
  if (text.includes("expired") || text.includes("no longer valid")) {
    return "expired_code";
  }
  if (text.includes("resend") || text.includes("request a new")) {
    return "resend_required";
  }
  if (text.includes("already") && (text.includes("verif") || text.includes("confirm"))) {
    return "already_verified";
  }
  if (text.includes("not confirmed") || text.includes("unconfirmed") || text.includes("confirm")) {
    return "unconfirmed";
  }
  if (text.includes("not verif") || text.includes("unverified")) {
    return "not_verified";
  }
  if (
    text.includes("invalid") ||
    text.includes("incorrect") ||
    text.includes("mismatch") ||
    text.includes("wrong code")
  ) {
    return "invalid_code";
  }

  return "unknown";
}

export function classifyVerificationResponse(
  mode: Mode,
  verification: "email" | "phone",
  response: ResponseEnvelope,
): AuthState {
  if (response.ResponseCode === "00") {
    return {
      status: "verification_accepted",
      mode,
      verification,
      response,
    };
  }

  return failed(mode, response);
}
