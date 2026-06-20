import type { LoginMfaResponse, LoginResponse, Mode } from "./api-types.js";

export interface SessionTokens {
  accessToken?: string | undefined;
  apiKey?: string | undefined;
  expiresIn?: string | undefined;
  idToken?: string | undefined;
  session?: string | undefined;
}

export type AuthResponse = LoginResponse | LoginMfaResponse;

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
      status: "failed";
      mode: Mode;
      responseCode: string;
      responseText: string;
      response: { ResponseCode: string; ResponseText: string };
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
    session: "Session" in response ? response.Session ?? current.session : current.session,
  };
}

export function classifyAuthResponse(mode: Mode, response: AuthResponse, tokens: SessionTokens): AuthState {
  if (response.ResponseCode !== "00") {
    return {
      status: "failed",
      mode,
      responseCode: response.ResponseCode,
      responseText: response.ResponseText,
      response,
    };
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

  if (tokens.session || response.ResponseText === "Give SMS code") {
    return {
      status: "needs_mfa",
      mode,
      session: tokens.session ?? "",
      response,
    };
  }

  if (tokens.accessToken || response.ResponseText === "Login OK. Verify email address.") {
    return {
      status: "needs_email_verification",
      mode,
      accessToken: tokens.accessToken ?? "",
      response,
    };
  }

  if (response.ResponseText === "User authentication failed. Verify phone number with received SMS.") {
    return {
      status: "needs_phone_verification",
      mode,
      response,
    };
  }

  return {
    status: "failed",
    mode,
    responseCode: response.ResponseCode,
    responseText: response.ResponseText,
    response,
  };
}

export function classifyVerificationResponse(
  mode: Mode,
  verification: "email" | "phone",
  response: { ResponseCode: string; ResponseText: string },
): AuthState {
  if (response.ResponseCode === "00") {
    return {
      status: "verification_accepted",
      mode,
      verification,
      response,
    };
  }

  return {
    status: "failed",
    mode,
    responseCode: response.ResponseCode,
    responseText: response.ResponseText,
    response,
  };
}
