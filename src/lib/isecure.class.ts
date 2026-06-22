import {
  classifyAuthResponse,
  classifyVerificationResponse,
  mergeTokens,
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
} from "./api-types.js";
import { encryptPasswordChallenge } from "./challenge-crypto.js";
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

export class WSChannel {
  private readonly transport: Transport;
  private readonly logger: Logger;
  private tokens: SessionTokens = {};

  constructor(
    public props: IWSChannel,
    options: WSChannelOptions = {},
  ) {
    this.logger = options.logger ?? new NoopLogger();
    const baseTransport = options.transport ?? new AxiosTransport();
    // Only pay the redaction/clone cost when a logger is actually injected;
    // the default NoopLogger path uses the bare transport. Logging stays gated
    // by LogLevel so an injected logger can still be silenced.
    this.transport = options.logger
      ? new LoggingTransport(baseTransport, {
          logger: options.logger,
          enabled: () => LOG_LEVEL_PRIORITY[this.props.LogLevel ?? "debug"] >= LOG_LEVEL_PRIORITY.debug,
        })
      : baseTransport;
  }

  get session(): Readonly<SessionTokens> {
    return this.tokens;
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

    const data = await this.call<RegisterResponse, RegisterRequest>("PUT", this.accountUrl(), { body: request });

    this.tokens = { ...this.tokens, apiKey: data.ApiKey };
    this.log("debug", "registered account", { mode: this.props.Mode, email: this.props.Email });
    return data;
  }

  async initPasswordReset(): Promise<InitPasswordResetResponse> {
    return this.call<InitPasswordResetResponse>("GET", this.passwordUrl());
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

    return this.call<PasswordResetResponse, PasswordResetRequest>("POST", this.passwordUrl(), { body: request });
  }

  async login(): Promise<AuthState> {
    const ChResp = await this.getSessionChallenge();
    const request: LoginRequest = {
      ChResp,
      Encrypted: await this.encryptPasswordChallenge(ChResp),
    };

    const data = await this.call<LoginResponse, LoginRequest>("POST", this.sessionUrl(), { body: request });
    return this.applyAuthResponse(data);
  }

  async submitMfaCode(code: string): Promise<AuthState> {
    if (!this.tokens.session) {
      throw new Error("Cannot submit MFA code before login returns a session token");
    }

    const request: LoginMfaRequest = { Code: code, Session: this.tokens.session };
    const data = await this.call<LoginMfaResponse, LoginMfaRequest>("PUT", `${this.sessionUrl()}/mfacode`, {
      body: request,
    });

    return this.applyAuthResponse(data);
  }

  async loginMFA(code: string): Promise<AuthState> {
    return this.submitMfaCode(code);
  }

  async verifyPhone(code: string): Promise<AuthState> {
    const request: VerifyPhoneRequest = { Code: code };
    const data = await this.call<ApiResponse, VerifyPhoneRequest>(
      "POST",
      `${this.accountUrl()}/${encodeURIComponent(this.props.Phone)}`,
      { body: request },
    );

    return classifyVerificationResponse(this.props.Mode, "phone", data);
  }

  async verifyEmail(code: string): Promise<AuthState> {
    if (!this.tokens.accessToken) {
      throw new Error("Cannot verify email before login returns an access token");
    }

    const request: VerifyEmailRequest = { AccessToken: this.tokens.accessToken, Code: code };
    const data = await this.call<ApiResponse, VerifyEmailRequest>("POST", this.accountUrl(), { body: request });

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
    return this.call<ApiResponse, UploadKeyRequest>("PUT", this.pgpUrl(), { body: request, auth: true });
  }

  async listKeys(): Promise<ListKeysResponse> {
    return this.call<ListKeysResponse>("GET", this.pgpUrl(), { auth: true });
  }

  async deleteKey(PgpKeyId: string): Promise<DeleteKeyResponse> {
    const request: DeleteKeyRequest = { PgpKeyId };
    return this.call<DeleteKeyResponse, DeleteKeyRequest>("DELETE", this.pgpUrl(), { body: request, auth: true });
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

    return this.call<ApiResponse, UploadFileRequest>("PUT", this.filesUrl(), { body: request, auth: true });
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

    return this.call<ListFilesResponse>("GET", this.filesUrl(), { query, auth: true });
  }

  async downloadFile(FileType: string, FileReference: string): Promise<DownloadFileResponse> {
    return this.call<DownloadFileResponse>("GET", this.fileUrl(FileType, FileReference), { auth: true });
  }

  async deleteFile(FileType: string, FileReference: string): Promise<DeleteFileResponse> {
    return this.call<DeleteFileResponse>("DELETE", this.fileUrl(FileType, FileReference), { auth: true });
  }

  async listCerts(): Promise<ListCertsResponse> {
    return this.call<ListCertsResponse>("GET", this.certsUrl(), { auth: true });
  }

  async configCerts(requestOrExport: ConfigCertsRequest | string): Promise<ConfigCertsResponse> {
    const request: ConfigCertsRequest =
      typeof requestOrExport === "string" ? { Export: requestOrExport } : requestOrExport;
    return this.call<ConfigCertsResponse, ConfigCertsRequest>("POST", this.certsUrl(), { body: request, auth: true });
  }

  async shareCerts(ExtEmail: string): Promise<ShareCertsResponse> {
    return this.call<ShareCertsResponse>("PUT", this.sharedCertsUrl(ExtEmail), { auth: true });
  }

  async unshareCerts(ExtEmail: string): Promise<UnshareCertsResponse> {
    return this.call<UnshareCertsResponse>("DELETE", this.sharedCertsUrl(ExtEmail), { auth: true });
  }

  async exportCert(PgpKeyId: string): Promise<ExportCertResponse> {
    const query: ExportCertQuery = { PgpKeyId };
    return this.call<ExportCertResponse>("GET", this.certUrl(), { query, auth: true });
  }

  async importCert(request: ImportCertRequest): Promise<ImportCertResponse> {
    return this.call<ImportCertResponse, ImportCertRequest>("PUT", this.certUrl(), { body: request, auth: true });
  }

  async enrollCert(request: EnrollCertRequest): Promise<EnrollCertResponse> {
    return this.call<EnrollCertResponse, EnrollCertRequest>("POST", this.certUrl(), { body: request, auth: true });
  }

  async listAccounts(): Promise<ListAccountsResponse> {
    return this.call<ListAccountsResponse>("GET", this.integratorAccountsUrl(), { auth: true });
  }

  async logout(): Promise<LogoutResponse> {
    const data = await this.call<LogoutResponse>("DELETE", this.sessionUrl(), { auth: true });
    this.tokens = {};
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
    options: { body?: Req; query?: QueryParams; auth?: boolean } = {},
  ): Promise<Res> {
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

  private async getRegistrationChallenge(): Promise<string> {
    const data = await this.call<InitRegisterResponse>("GET", this.accountUrl());
    return data.Challenge;
  }

  private async getSessionChallenge(): Promise<string> {
    const data = await this.call<InitLoginResponse>("GET", this.sessionUrl());
    return data.Challenge;
  }

  private applyAuthResponse(response: LoginResponse | LoginMfaResponse): AuthState {
    this.tokens = mergeTokens(this.tokens, response);
    return classifyAuthResponse(this.props.Mode, response, this.tokens);
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

  private accountUrl(): string {
    return this.url("account", this.props.Email, this.props.Mode);
  }

  private sessionUrl(): string {
    return this.url("session", this.props.Email, this.props.Mode);
  }

  private passwordUrl(): string {
    return this.url("account", this.props.Email, this.props.Mode, "password");
  }

  private filesUrl(): string {
    return this.url("files", this.props.Bank);
  }

  private fileUrl(fileType: string, fileReference: string): string {
    return this.url("files", this.props.Bank, fileType, fileReference);
  }

  private certsUrl(): string {
    return `${this.props.BaseUrl.replace(/\/+$/, "")}/certs/`;
  }

  private certUrl(): string {
    return this.url("certs", this.props.Bank);
  }

  private sharedCertsUrl(extEmail: string): string {
    return this.url("certs", "shared", extEmail);
  }

  private integratorAccountsUrl(): string {
    return this.url("integrator", "accounts");
  }

  private pgpUrl(): string {
    return this.url("pgp");
  }

  private url(...segments: string[]): string {
    return `${this.props.BaseUrl.replace(/\/+$/, "")}/${segments.map(encodeURIComponent).join("/")}`;
  }
}

function promptStepFor(status: AuthState["status"]): AuthStep | undefined {
  switch (status) {
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
