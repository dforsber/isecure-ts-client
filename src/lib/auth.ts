import type { Mode } from "./api-types.js";
import type { AuthErrorReason, AuthResponse, AuthState, ResponseEnvelope, SessionTokens } from "./auth-state.js";

// State shapes live in auth-state.ts; this module owns the classification logic
// that maps WS API responses onto those shapes. Re-exported for a stable import
// surface (`./auth.js`).
export type {
  AuthErrorReason,
  AuthPromptAdapter,
  AuthResponse,
  AuthState,
  AuthStep,
  ResponseEnvelope,
  SessionTokens,
} from "./auth-state.js";

export function mergeTokens(current: SessionTokens, response: AuthResponse): SessionTokens {
  return {
    accessToken: response.AccessToken ?? current.accessToken,
    apiKey: response.ApiKey ?? current.apiKey,
    expiresIn: response.ExpiresIn ?? current.expiresIn,
    idToken: response.IdToken ?? current.idToken,
    session: "Session" in response ? (response.Session ?? current.session) : current.session,
  };
}

/**
 * A single classification rule. Rules are evaluated in array order, so the
 * precedence between overlapping signals (a verification prompt that also
 * carries a session token or "sms code") is explicit and reviewable in one
 * place — the §1 regression was an ordering bug in a hand-written if-ladder.
 */
type AuthRule = (mode: Mode, response: AuthResponse, tokens: SessionTokens) => AuthState | undefined;

/**
 * Ordered classification rules for a successful (`ResponseCode === "00"`)
 * login/MFA response. The order IS the contract:
 *   1. fully authenticated (id token + API key present)
 *   2. explicit phone-verification prompt
 *   3. email-verification prompt with a usable access token
 *   4. email-verification prompt without a token (cannot be driven by the SDK)
 *   5. MFA challenge (session token or "sms code" fallback)
 * Verification prompts deliberately precede the MFA heuristic because such a
 * response can also carry a Cognito session token or the substring "sms code"
 * (e.g. "Verify phone number with received SMS code").
 */
const AUTH_RULES: readonly AuthRule[] = [
  // Authentication is keyed on the id token from *this* response, not the merged
  // session. A refresh re-login (e.g. via loginWithPrompt) still holds the prior
  // session's id token/API key, so keying on the merged tokens would misclassify
  // an MFA-stage re-login as already authenticated.
  (mode, response, tokens) =>
    response.IdToken && tokens.apiKey && tokens.idToken
      ? {
          status: "authenticated",
          mode,
          tokens: { ...tokens, apiKey: tokens.apiKey, idToken: tokens.idToken },
          response,
        }
      : undefined,
  (mode, response) =>
    responseTextIncludes(response, "verify phone") ? { status: "needs_phone_verification", mode, response } : undefined,
  // Email verification is driven via the access-token attribute path, so the
  // state only carries a usable token. Key on the access token from *this*
  // response, not the merged session: a later MFA-stage re-login carries only a
  // session token, and a lingering access token from the email-verification
  // stage must not re-trigger email verification.
  (mode, response) =>
    response.AccessToken
      ? { status: "needs_email_verification", mode, accessToken: response.AccessToken, response }
      : undefined,
  // Email verification was requested but no access token was returned: the SDK
  // cannot drive it, so surface a typed failure instead of an unusable state.
  (mode, response) =>
    responseTextIncludes(response, "verify email")
      ? {
          status: "failed",
          mode,
          reason: "missing_access_token",
          responseCode: response.ResponseCode,
          responseText: response.ResponseText,
          response,
        }
      : undefined,
  (mode, response, tokens) =>
    tokens.session || responseTextIncludes(response, "sms code")
      ? { status: "needs_mfa", mode, session: tokens.session ?? "", response }
      : undefined,
];

export function classifyAuthResponse(mode: Mode, response: AuthResponse, tokens: SessionTokens): AuthState {
  if (response.ResponseCode !== "00") {
    return failed(mode, response);
  }

  for (const rule of AUTH_RULES) {
    const state = rule(mode, response, tokens);
    if (state) {
      return state;
    }
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
  if (
    text.includes("not confirmed") ||
    text.includes("unconfirmed") ||
    text.includes("must confirm") ||
    text.includes("confirm your") ||
    text.includes("confirm registration")
  ) {
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
