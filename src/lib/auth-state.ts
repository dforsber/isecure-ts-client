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
      response: ResponseEnvelope;
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
