import {
  classifyAuthResponse,
  classifyVerificationResponse,
  mergeTokens,
  methodToCognito,
  type AuthPromptAdapter,
  type AuthState,
  type AuthStep,
  type SessionTokens,
} from "./auth.js";
import {
  type ApiResponse,
  type ConfigCertsRequest,
  type ConfigCertsResponse,
  type DeleteFileResponse,
  type DeleteKeyRequest,
  type DeleteKeyResponse,
  type DownloadFileResponse,
  type EnrollCertRequest,
  type EnrollCertResponse,
  type ExportCertQuery,
  type ExportCertResponse,
  type ImportCertRequest,
  type ImportCertResponse,
  type InitLoginResponse,
  type InitPasswordResetResponse,
  type InitRegisterResponse,
  type ListAccountsResponse,
  type ListCertsResponse,
  type ListFilesQuery,
  type ListFilesResponse,
  type ListKeysResponse,
  type LogLevel,
  type LoginMfaRequest,
  type LoginMfaResponse,
  type LoginRequest,
  type LoginResponse,
  type Mode,
  type LogoutResponse,
  type PasswordResetRequest,
  type PasswordResetResponse,
  type PgpKeyPurpose,
  type RegisterRequest,
  type RegisterResponse,
  type ShareCertsResponse,
  type UnshareCertsResponse,
  type UploadFileRequest,
  type UploadKeyRequest,
  type VerifyEmailRequest,
  type VerifyPhoneRequest,
  type SelectMfaRequest,
  type SelectMfaResponse,
  type VerifyTotpRequest,
  type VerifyTotpResponse,
} from "./api-types.js";
import { encryptPasswordChallenge } from "./challenge-crypto.js";
import { ISecureError } from "./errors.js";
import type { RedactionMode } from "./redact.js";
import { UrlBuilder } from "./urls.js";
import {
  AxiosTransport,
  LoggingTransport,
  type HttpHeaders,
  type HttpMethod,
  type QueryParams,
  type Transport,
} from "./transport.js";

export interface IWSChannel {
  Company: string;
  Name: string;
  Password: string;
  Email: string;
  Mode: Mode;
  Phone: string;
  PublicKey: string;
  BaseUrl: string;
  Bank: string;
  ApiKey?: string;
  LogLevel?: LogLevel;
}

export interface WSChannelOptions {
  transport?: Transport;
  logger?: Logger;
  /** Redaction strategy for injected-logger debug output. Defaults to "balanced". */
  redaction?: RedactionMode;
  /**
   * Optional hook invoked before an authenticated call when the current session
   * has expired (see {@link WSChannel.isSessionExpired}). Use it to re-establish
   * a session (e.g. `loginWithPrompt`). It must not itself call authenticated
   * operations, to avoid re-entry. When absent, an expired session throws an
   * {@link ISecureError} instead of sending a request doomed to 401.
   */
  onSessionExpired?: (channel: WSChannel) => Promise<unknown>;
  /**
   * Clock skew, in milliseconds, treated as already-expired ahead of the real
   * expiry so refresh happens slightly early. Defaults to 5000.
   */
  expirySkewMs?: number;
}

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

class NoopLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}

const DEFAULT_EXPIRY_SKEW_MS = 5_000;

export class WSChannel {
  private readonly transport: Transport;
  private readonly logger: Logger;
  private readonly onSessionExpired: ((channel: WSChannel) => Promise<unknown>) | undefined;
  private readonly expirySkewMs: number;
  private readonly urls = new UrlBuilder(() => this.props);
  private tokens: SessionTokens = {};
  /** Absolute epoch ms when the current id token expires, if known. */
  private expiresAt: number | undefined;
  /** ChallengeName from the last login response, echoed back on the mfacode call. */
  private lastChallengeName: string | undefined;

  constructor(
    public props: IWSChannel,
    options: WSChannelOptions = {},
  ) {
    this.onSessionExpired = options.onSessionExpired;
    this.expirySkewMs = options.expirySkewMs ?? DEFAULT_EXPIRY_SKEW_MS;
    this.logger = options.logger ?? new NoopLogger();
    const baseTransport = options.transport ?? new AxiosTransport();
    // Only pay the redaction/clone cost when a logger is actually injected;
    // the default NoopLogger path uses the bare transport. Logging stays gated
    // by LogLevel so an injected logger can still be silenced.
    this.transport = options.logger
      ? new LoggingTransport(baseTransport, {
          logger: options.logger,
          enabled: () => LOG_LEVEL_PRIORITY[this.props.LogLevel ?? "debug"] >= LOG_LEVEL_PRIORITY.debug,
          ...(options.redaction ? { redaction: options.redaction } : {}),
        })
      : baseTransport;
  }

  get session(): Readonly<SessionTokens> {
    return this.tokens;
  }

  /** Absolute epoch-ms expiry of the current id token, or `undefined` if unknown. */
  get sessionExpiresAt(): number | undefined {
    return this.expiresAt;
  }

  /** True once an id token + API key are present, regardless of expiry. */
  isAuthenticated(): boolean {
    return Boolean(this.tokens.idToken && this.tokens.apiKey);
  }

  /**
   * True when an authenticated session exists but its id token has expired
   * (within the configured skew). Returns false when no session exists or when
   * the backend supplied no expiry to reason about.
   */
  isSessionExpired(): boolean {
    if (!this.isAuthenticated() || this.expiresAt === undefined) {
      return false;
    }
    return Date.now() + this.expirySkewMs >= this.expiresAt;
  }

  updateProps(overrideProps: Partial<IWSChannel>): void {
    this.props = { ...this.props, ...overrideProps };
  }

  async register(): Promise<RegisterResponse> {
    const ChResp = await this.getRegistrationChallenge();
    const request: RegisterRequest = {
      ApiKey: this.props.ApiKey ?? "0",
      ChResp,
      Company: this.props.Company,
      Encrypted: await this.encryptPasswordChallenge(ChResp),
      Name: this.props.Name,
      Phone: this.props.Phone,
    };

    const data = await this.call<RegisterResponse, RegisterRequest>("PUT", this.urls.account(), { body: request });

    this.tokens = { ...this.tokens, apiKey: data.ApiKey };
    this.log("debug", "registered account", { mode: this.props.Mode, email: this.props.Email });
    return data;
  }

  async initPasswordReset(): Promise<InitPasswordResetResponse> {
    return this.call<InitPasswordResetResponse>("GET", this.urls.password());
  }

  async passwordReset(request: PasswordResetRequest): Promise<PasswordResetResponse>;
  async passwordReset(code: string, newPassword: string, challenge: string): Promise<PasswordResetResponse>;
  async passwordReset(
    requestOrCode: PasswordResetRequest | string,
    newPassword?: string,
    challenge?: string,
  ): Promise<PasswordResetResponse> {
    const request: PasswordResetRequest =
      typeof requestOrCode === "string"
        ? {
            ChResp: requireValue(challenge, "challenge"),
            Code: requestOrCode,
            Encrypted: await this.encryptPasswordChallenge(
              requireValue(challenge, "challenge"),
              requireValue(newPassword, "newPassword"),
            ),
          }
        : requestOrCode;

    return this.call<PasswordResetResponse, PasswordResetRequest>("POST", this.urls.password(), { body: request });
  }

  async login(): Promise<AuthState> {
    const ChResp = await this.getSessionChallenge();
    const request: LoginRequest = {
      ChResp,
      Encrypted: await this.encryptPasswordChallenge(ChResp),
    };

    const data = await this.call<LoginResponse, LoginRequest>("POST", this.urls.session(), { body: request });
    return this.applyAuthResponse(data);
  }

  /**
   * Submits an MFA code (SMS or authenticator/TOTP). The `ChallengeName` from
   * the login response is echoed automatically so the API answers the right
   * factor. Pass `{ setupTotp: true }` to begin TOTP enrollment: the returned
   * `authenticated` state then also carries a `totpEnrollment` payload (secret,
   * QR URI, and an access token) to drive {@link verifyTotp}.
   */
  async submitMfaCode(code: string, options: { setupTotp?: boolean } = {}): Promise<AuthState> {
    if (!this.tokens.session) {
      throw new Error("Cannot submit MFA code before login returns a session token");
    }

    const request: LoginMfaRequest = { Code: code, Session: this.tokens.session };
    if (this.lastChallengeName) {
      request.ChallengeName = this.lastChallengeName;
    }
    if (options.setupTotp) {
      request.SetupTOTP = true;
    }
    const data = await this.call<LoginMfaResponse, LoginMfaRequest>("PUT", this.urls.mfacode(), {
      body: request,
    });

    return this.applyAuthResponse(data);
  }

  async loginMFA(code: string): Promise<AuthState> {
    return this.submitMfaCode(code);
  }

  /**
   * Selects an MFA factor after the server returns a `SELECT_MFA_TYPE` challenge
   * (i.e. when `login()` resolves to `needs_mfa_selection`). Posts the chosen
   * factor to the `selectmfa` endpoint; the server returns the factor's own
   * challenge, which this method classifies and returns as `needs_mfa` with the
   * chosen `method`. Call `submitMfaCode(code)` next to complete authentication.
   *
   * Throws if called before a session token is available (i.e. before `login()`
   * returns `needs_mfa_selection`).
   */
  async selectMfaType(method: "sms" | "totp"): Promise<AuthState> {
    if (!this.tokens.session) {
      throw new Error("Cannot select MFA type before login returns a SELECT_MFA_TYPE session token");
    }

    const request: SelectMfaRequest = {
      MfaType: methodToCognito(method),
      Session: this.tokens.session,
    };

    const data = await this.call<SelectMfaResponse, SelectMfaRequest>("PUT", this.urls.selectmfa(), { body: request });
    return this.applyAuthResponse(data);
  }

  /**
   * Confirms a TOTP enrollment started via `submitMfaCode(code, { setupTotp: true })`.
   * Pass the `accessToken` from the returned `totpEnrollment` (held in memory by
   * the caller) and the first 6-digit code from the authenticator app. On success
   * TOTP becomes the preferred factor; SMS stays enabled as a fallback.
   */
  async verifyTotp(accessToken: string, code: string): Promise<AuthState> {
    const request: VerifyTotpRequest = { AccessToken: accessToken, Code: code };
    const data = await this.call<VerifyTotpResponse, VerifyTotpRequest>("PUT", this.urls.verifytotp(), {
      body: request,
    });

    return classifyVerificationResponse(this.props.Mode, "totp", data);
  }

  async verifyPhone(code: string): Promise<AuthState> {
    const request: VerifyPhoneRequest = { Code: code };
    const data = await this.call<ApiResponse, VerifyPhoneRequest>("POST", this.urls.accountPhone(), { body: request });

    return classifyVerificationResponse(this.props.Mode, "phone", data);
  }

  async verifyEmail(code: string): Promise<AuthState> {
    if (!this.tokens.accessToken) {
      throw new Error("Cannot verify email before login returns an access token");
    }

    const request: VerifyEmailRequest = { AccessToken: this.tokens.accessToken, Code: code };
    const data = await this.call<ApiResponse, VerifyEmailRequest>("POST", this.urls.account(), { body: request });

    return classifyVerificationResponse(this.props.Mode, "email", data);
  }

  /**
   * Drives the full login -> verify -> re-login state machine to completion
   * using the supplied prompt adapter. Bounded by `maxTransitions`. Instead of
   * throwing when the flow does not settle, it returns a typed `stalled` state
   * naming the step the backend keeps re-requesting, so callers never have to
   * re-implement the loop or guess where it got stuck.
   */
  async loginWithPrompt(prompt: AuthPromptAdapter, maxTransitions = 8): Promise<AuthState> {
    let state = await this.login();
    const driven: Partial<Record<AuthStep, number>> = {};
    let lastStep: AuthStep | undefined;

    for (let transition = 0; transition < maxTransitions; transition += 1) {
      if (state.status === "authenticated" || state.status === "failed" || state.status === "stalled") {
        return state;
      }

      const step = promptStepFor(state.status);
      if (step) {
        // We already satisfied this step once; the backend re-requesting it
        // means an accepted verification did not advance the login.
        if ((driven[step] ?? 0) >= 1) {
          return { status: "stalled", mode: this.props.Mode, step, transitions: transition, response: state.response };
        }
        driven[step] = (driven[step] ?? 0) + 1;
        lastStep = step;
      }

      if (state.status === "needs_mfa_selection") {
        // Factor selection is forward progress toward MFA — do not count it in
        // `driven` so the subsequent needs_mfa step is not mistaken for a stall.
        // Pick a method: delegate to the adapter hook if provided, otherwise
        // default to TOTP when offered (spec default), else the first option.
        let method: "sms" | "totp";
        if (prompt.requestMfaSelection) {
          method = await prompt.requestMfaSelection(state);
        } else {
          method = state.methods.includes("totp") ? "totp" : (state.methods[0] ?? "totp");
        }
        // Roll back the driven count so the following needs_mfa step is seen fresh.
        driven.mfa = 0;
        state = await this.selectMfaType(method);
        continue;
      }

      if (state.status === "needs_mfa") {
        state = await this.submitMfaCode(await prompt.requestMfaCode(state));
        continue;
      }

      if (state.status === "needs_email_verification") {
        state = await this.verifyEmail(await prompt.requestEmailCode(state));
        continue;
      }

      if (state.status === "needs_phone_verification") {
        state = await this.verifyPhone(await prompt.requestPhoneCode(state));
        continue;
      }

      state = await this.login();
    }

    const step = promptStepFor(state.status) ?? lastStep ?? "mfa";
    return { status: "stalled", mode: this.props.Mode, step, transitions: maxTransitions, response: state.response };
  }

  async uploadPgpKey(armoredKey: string, purpose: PgpKeyPurpose): Promise<ApiResponse> {
    const request: UploadKeyRequest = { PgpKey: armoredKey, PgpKeyPurpose: purpose };
    return this.call<ApiResponse, UploadKeyRequest>("PUT", this.urls.pgp(), { body: request, auth: true });
  }

  async listKeys(): Promise<ListKeysResponse> {
    return this.call<ListKeysResponse>("GET", this.urls.pgp(), { auth: true });
  }

  async deleteKey(PgpKeyId: string): Promise<DeleteKeyResponse> {
    const request: DeleteKeyRequest = { PgpKeyId };
    return this.call<DeleteKeyResponse, DeleteKeyRequest>("DELETE", this.urls.pgp(), { body: request, auth: true });
  }

  async uploadFile(request: UploadFileRequest): Promise<ApiResponse>;
  async uploadFile(FileContents: string, FileName: string, FileType: string, Signature: string): Promise<ApiResponse>;
  async uploadFile(
    requestOrContents: UploadFileRequest | string,
    FileName?: string,
    FileType?: string,
    Signature?: string,
  ): Promise<ApiResponse> {
    const request: UploadFileRequest =
      typeof requestOrContents === "string"
        ? {
            FileContents: requestOrContents,
            FileName: requireValue(FileName, "FileName"),
            FileType: requireValue(FileType, "FileType"),
            Signature: requireValue(Signature, "Signature"),
          }
        : requestOrContents;

    return this.call<ApiResponse, UploadFileRequest>("PUT", this.urls.files(), { body: request, auth: true });
  }

  async listFiles(query?: ListFilesQuery): Promise<ListFilesResponse>;
  async listFiles(fileType: string, fileStatus: string): Promise<ListFilesResponse>;
  async listFiles(queryOrFileType: ListFilesQuery | string = {}, fileStatus = ""): Promise<ListFilesResponse> {
    const query: ListFilesQuery = {};
    if (typeof queryOrFileType === "string") {
      if (queryOrFileType) query.FileType = queryOrFileType;
      if (fileStatus) query.Status = fileStatus;
    } else {
      if (queryOrFileType.FileType) query.FileType = queryOrFileType.FileType;
      if (queryOrFileType.Status) query.Status = queryOrFileType.Status;
    }

    return this.call<ListFilesResponse>("GET", this.urls.files(), { query, auth: true });
  }

  async downloadFile(FileType: string, FileReference: string): Promise<DownloadFileResponse> {
    return this.call<DownloadFileResponse>("GET", this.urls.file(FileType, FileReference), { auth: true });
  }

  async deleteFile(FileType: string, FileReference: string): Promise<DeleteFileResponse> {
    return this.call<DeleteFileResponse>("DELETE", this.urls.file(FileType, FileReference), { auth: true });
  }

  async listCerts(): Promise<ListCertsResponse> {
    return this.call<ListCertsResponse>("GET", this.urls.certs(), { auth: true });
  }

  async configCerts(requestOrExport: ConfigCertsRequest | string): Promise<ConfigCertsResponse> {
    const request: ConfigCertsRequest =
      typeof requestOrExport === "string" ? { Export: requestOrExport } : requestOrExport;
    return this.call<ConfigCertsResponse, ConfigCertsRequest>("POST", this.urls.certs(), { body: request, auth: true });
  }

  async shareCerts(ExtEmail: string): Promise<ShareCertsResponse> {
    return this.call<ShareCertsResponse>("PUT", this.urls.sharedCerts(ExtEmail), { auth: true });
  }

  async unshareCerts(ExtEmail: string): Promise<UnshareCertsResponse> {
    return this.call<UnshareCertsResponse>("DELETE", this.urls.sharedCerts(ExtEmail), { auth: true });
  }

  async exportCert(PgpKeyId: string): Promise<ExportCertResponse> {
    const query: ExportCertQuery = { PgpKeyId };
    return this.call<ExportCertResponse>("GET", this.urls.cert(), { query, auth: true });
  }

  async importCert(request: ImportCertRequest): Promise<ImportCertResponse> {
    return this.call<ImportCertResponse, ImportCertRequest>("PUT", this.urls.cert(), { body: request, auth: true });
  }

  async enrollCert(request: EnrollCertRequest): Promise<EnrollCertResponse> {
    return this.call<EnrollCertResponse, EnrollCertRequest>("POST", this.urls.cert(), { body: request, auth: true });
  }

  async listAccounts(): Promise<ListAccountsResponse> {
    return this.call<ListAccountsResponse>("GET", this.urls.integratorAccounts(), { auth: true });
  }

  async logout(): Promise<LogoutResponse> {
    // Logout must work on an expired session, so it skips the freshness guard.
    const data = await this.call<LogoutResponse>("DELETE", this.urls.session(), { auth: true, skipFreshness: true });
    this.tokens = {};
    this.expiresAt = undefined;
    return data;
  }

  /**
   * Single funnel for every WS API call: selects JSON vs. authenticated
   * headers, forwards an optional body/query, and returns the response body.
   * Centralizing this keeps header selection in one place and removes the
   * request/`response.data` boilerplate repeated across every operation.
   */
  private async call<Res, Req = unknown>(
    method: HttpMethod,
    url: string,
    options: { body?: Req; query?: QueryParams; auth?: boolean; skipFreshness?: boolean } = {},
  ): Promise<Res> {
    if (options.auth && !options.skipFreshness) {
      await this.ensureFreshSession();
    }

    const request: { method: HttpMethod; url: string; headers: HttpHeaders; body?: Req; query?: QueryParams } = {
      method,
      url,
      headers: options.auth ? this.authHeaders() : this.jsonHeaders(),
    };
    if (options.body !== undefined) request.body = options.body;
    if (options.query) request.query = options.query;

    const response = await this.transport.request<Res, Req>(request);
    return response.data;
  }

  /**
   * Guards authenticated calls against a stale id token: if the session has
   * expired, invokes the configured refresh hook (which is expected to
   * re-establish the session), or throws a typed error when none is configured
   * rather than sending a request that would 401.
   */
  private async ensureFreshSession(): Promise<void> {
    if (!this.isSessionExpired()) {
      return;
    }
    if (this.onSessionExpired) {
      await this.onSessionExpired(this);
      // Re-check: a hook that no-ops (or fails to refresh without throwing) must
      // not let the original call proceed with the still-expired token.
      if (this.isSessionExpired()) {
        throw new ISecureError("onSessionExpired hook did not refresh the session; it is still expired");
      }
      return;
    }
    throw new ISecureError("ISECure session has expired; re-authenticate before calling authenticated operations");
  }

  private async getRegistrationChallenge(): Promise<string> {
    const data = await this.call<InitRegisterResponse>("GET", this.urls.account());
    return data.Challenge;
  }

  private async getSessionChallenge(): Promise<string> {
    const data = await this.call<InitLoginResponse>("GET", this.urls.session());
    return data.Challenge;
  }

  private applyAuthResponse(response: LoginResponse | LoginMfaResponse): AuthState {
    this.tokens = mergeTokens(this.tokens, response);
    this.expiresAt = computeExpiry(this.tokens);
    if (response.ChallengeName) {
      this.lastChallengeName = response.ChallengeName;
    }
    const state = classifyAuthResponse(this.props.Mode, response, this.tokens);
    // The TOTP enrollment access token is surfaced to the caller via
    // state.totpEnrollment only; do not retain it in the persisted session.
    if (state.status === "authenticated" && state.totpEnrollment) {
      this.tokens = { ...this.tokens, accessToken: undefined };
    }
    return state;
  }

  private log(level: Exclude<LogLevel, "silent">, message: string, meta?: unknown): void {
    if (LOG_LEVEL_PRIORITY[this.props.LogLevel ?? "debug"] >= LOG_LEVEL_PRIORITY[level]) {
      this.logger[level](message, meta);
    }
  }

  private encryptPasswordChallenge(challenge: string, password = this.props.Password): Promise<string> {
    return encryptPasswordChallenge(this.props.PublicKey, challenge, password);
  }

  private authHeaders(): HttpHeaders {
    if (!this.tokens.idToken || !this.tokens.apiKey) {
      throw new Error("Cannot call authenticated ISECure operation before login returns an id token and API key");
    }

    const headers = this.jsonHeaders();
    headers.Authorization = this.tokens.idToken;
    headers["x-api-key"] = this.tokens.apiKey;
    return headers;
  }

  private jsonHeaders(): HttpHeaders {
    return { "Content-Type": "application/json" };
  }
}

/**
 * Computes an absolute expiry (epoch ms) from a freshly authenticated session.
 * Only meaningful once an id token is present and the backend returned an
 * `ExpiresIn` (seconds); otherwise expiry is unknown and refresh is skipped.
 */
function computeExpiry(tokens: SessionTokens): number | undefined {
  if (!tokens.idToken || tokens.expiresIn === undefined) {
    return undefined;
  }
  const seconds = Number(tokens.expiresIn);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }
  return Date.now() + seconds * 1000;
}

function promptStepFor(status: AuthState["status"]): AuthStep | undefined {
  switch (status) {
    case "needs_mfa_selection":
    case "needs_mfa":
      return "mfa";
    case "needs_email_verification":
      return "email_verification";
    case "needs_phone_verification":
      return "phone_verification";
    default:
      return undefined;
  }
}

function requireValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}
