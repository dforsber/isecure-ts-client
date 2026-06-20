import {
  classifyAuthResponse,
  classifyVerificationResponse,
  mergeTokens,
  type AuthPromptAdapter,
  type AuthState,
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
import { AxiosTransport, type HttpHeaders, type Transport } from "./transport.js";

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
    this.transport = options.transport ?? new AxiosTransport();
    this.logger = options.logger ?? new NoopLogger();
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

    const response = await this.transport.request<RegisterResponse, RegisterRequest>({
      method: "PUT",
      url: this.accountUrl(),
      body: request,
      headers: this.jsonHeaders(),
    });

    this.tokens = { ...this.tokens, apiKey: response.data.ApiKey };
    this.log("debug", "registered account", { mode: this.props.Mode, email: this.props.Email });
    return response.data;
  }

  async initPasswordReset(): Promise<InitPasswordResetResponse> {
    const response = await this.transport.request<InitPasswordResetResponse>({
      method: "GET",
      url: this.passwordUrl(),
      headers: this.jsonHeaders(),
    });

    return response.data;
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

    const response = await this.transport.request<PasswordResetResponse, PasswordResetRequest>({
      method: "POST",
      url: this.passwordUrl(),
      body: request,
      headers: this.jsonHeaders(),
    });

    return response.data;
  }

  async login(): Promise<AuthState> {
    const ChResp = await this.getSessionChallenge();
    const request: LoginRequest = {
      ChResp,
      Encrypted: await this.encryptPasswordChallenge(ChResp),
    };

    const response = await this.transport.request<LoginResponse, LoginRequest>({
      method: "POST",
      url: this.sessionUrl(),
      body: request,
      headers: this.jsonHeaders(),
    });

    return this.applyAuthResponse(response.data);
  }

  async submitMfaCode(code: string): Promise<AuthState> {
    if (!this.tokens.session) {
      throw new Error("Cannot submit MFA code before login returns a session token");
    }

    const request: LoginMfaRequest = { Code: code, Session: this.tokens.session };
    const response = await this.transport.request<LoginMfaResponse, LoginMfaRequest>({
      method: "PUT",
      url: `${this.sessionUrl()}/mfacode`,
      body: request,
      headers: this.jsonHeaders(),
    });

    return this.applyAuthResponse(response.data);
  }

  async loginMFA(code: string): Promise<AuthState> {
    return this.submitMfaCode(code);
  }

  async verifyPhone(code: string): Promise<AuthState> {
    const request: VerifyPhoneRequest = { Code: code };
    const response = await this.transport.request<ApiResponse, VerifyPhoneRequest>({
      method: "POST",
      url: `${this.accountUrl()}/${encodeURIComponent(this.props.Phone)}`,
      body: request,
      headers: this.jsonHeaders(),
    });

    return classifyVerificationResponse(this.props.Mode, "phone", response.data);
  }

  async verifyEmail(code: string): Promise<AuthState> {
    if (!this.tokens.accessToken) {
      throw new Error("Cannot verify email before login returns an access token");
    }

    const request: VerifyEmailRequest = { AccessToken: this.tokens.accessToken, Code: code };
    const response = await this.transport.request<ApiResponse, VerifyEmailRequest>({
      method: "POST",
      url: this.accountUrl(),
      body: request,
      headers: this.jsonHeaders(),
    });

    return classifyVerificationResponse(this.props.Mode, "email", response.data);
  }

  async loginWithPrompt(prompt: AuthPromptAdapter, maxTransitions = 8): Promise<AuthState> {
    let state = await this.login();

    for (let transition = 0; transition < maxTransitions; transition += 1) {
      if (state.status === "authenticated" || state.status === "failed") {
        return state;
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

    throw new Error("Authentication did not settle before maxTransitions was reached");
  }

  async uploadPgpKey(armoredKey: string, purpose: PgpKeyPurpose): Promise<ApiResponse> {
    const request: UploadKeyRequest = { PgpKey: armoredKey, PgpKeyPurpose: purpose };
    const response = await this.transport.request<ApiResponse, UploadKeyRequest>({
      method: "PUT",
      url: this.pgpUrl(),
      body: request,
      headers: this.authHeaders(),
    });

    return response.data;
  }

  async listKeys(): Promise<ListKeysResponse> {
    const response = await this.transport.request<ListKeysResponse>({
      method: "GET",
      url: this.pgpUrl(),
      headers: this.authHeaders(),
    });

    return response.data;
  }

  async deleteKey(PgpKeyId: string): Promise<DeleteKeyResponse> {
    const request: DeleteKeyRequest = { PgpKeyId };
    const response = await this.transport.request<DeleteKeyResponse, DeleteKeyRequest>({
      method: "DELETE",
      url: this.pgpUrl(),
      body: request,
      headers: this.authHeaders(),
    });

    return response.data;
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

    const response = await this.transport.request<ApiResponse, UploadFileRequest>({
      method: "PUT",
      url: this.filesUrl(),
      body: request,
      headers: this.authHeaders(),
    });

    return response.data;
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

    const response = await this.transport.request<ListFilesResponse>({
      method: "GET",
      url: this.filesUrl(),
      query,
      headers: this.authHeaders(),
    });

    return response.data;
  }

  async downloadFile(FileType: string, FileReference: string): Promise<DownloadFileResponse> {
    const response = await this.transport.request<DownloadFileResponse>({
      method: "GET",
      url: this.fileUrl(FileType, FileReference),
      headers: this.authHeaders(),
    });

    return response.data;
  }

  async deleteFile(FileType: string, FileReference: string): Promise<DeleteFileResponse> {
    const response = await this.transport.request<DeleteFileResponse>({
      method: "DELETE",
      url: this.fileUrl(FileType, FileReference),
      headers: this.authHeaders(),
    });

    return response.data;
  }

  async listCerts(): Promise<ListCertsResponse> {
    const response = await this.transport.request<ListCertsResponse>({
      method: "GET",
      url: this.certsUrl(),
      headers: this.authHeaders(),
    });

    return response.data;
  }

  async configCerts(requestOrExport: ConfigCertsRequest | string): Promise<ConfigCertsResponse> {
    const request: ConfigCertsRequest =
      typeof requestOrExport === "string" ? { Export: requestOrExport } : requestOrExport;
    const response = await this.transport.request<ConfigCertsResponse, ConfigCertsRequest>({
      method: "POST",
      url: this.certsUrl(),
      body: request,
      headers: this.authHeaders(),
    });

    return response.data;
  }

  async shareCerts(ExtEmail: string): Promise<ShareCertsResponse> {
    const response = await this.transport.request<ShareCertsResponse>({
      method: "PUT",
      url: this.sharedCertsUrl(ExtEmail),
      headers: this.authHeaders(),
    });

    return response.data;
  }

  async unshareCerts(ExtEmail: string): Promise<UnshareCertsResponse> {
    const response = await this.transport.request<UnshareCertsResponse>({
      method: "DELETE",
      url: this.sharedCertsUrl(ExtEmail),
      headers: this.authHeaders(),
    });

    return response.data;
  }

  async exportCert(PgpKeyId: string): Promise<ExportCertResponse> {
    const query: ExportCertQuery = { PgpKeyId };
    const response = await this.transport.request<ExportCertResponse>({
      method: "GET",
      url: this.certUrl(),
      query,
      headers: this.authHeaders(),
    });

    return response.data;
  }

  async importCert(request: ImportCertRequest): Promise<ImportCertResponse> {
    const response = await this.transport.request<ImportCertResponse, ImportCertRequest>({
      method: "PUT",
      url: this.certUrl(),
      body: request,
      headers: this.authHeaders(),
    });

    return response.data;
  }

  async enrollCert(request: EnrollCertRequest): Promise<EnrollCertResponse> {
    const response = await this.transport.request<EnrollCertResponse, EnrollCertRequest>({
      method: "POST",
      url: this.certUrl(),
      body: request,
      headers: this.authHeaders(),
    });

    return response.data;
  }

  async listAccounts(): Promise<ListAccountsResponse> {
    const response = await this.transport.request<ListAccountsResponse>({
      method: "GET",
      url: this.integratorAccountsUrl(),
      headers: this.authHeaders(),
    });

    return response.data;
  }

  async logout(): Promise<LogoutResponse> {
    const response = await this.transport.request<LogoutResponse>({
      method: "DELETE",
      url: this.sessionUrl(),
      headers: this.authHeaders(),
    });

    this.tokens = {};
    return response.data;
  }

  private async getRegistrationChallenge(): Promise<string> {
    const response = await this.transport.request<InitRegisterResponse>({
      method: "GET",
      url: this.accountUrl(),
      headers: this.jsonHeaders(),
    });

    return response.data.Challenge;
  }

  private async getSessionChallenge(): Promise<string> {
    const response = await this.transport.request<InitLoginResponse>({
      method: "GET",
      url: this.sessionUrl(),
      headers: this.jsonHeaders(),
    });

    return response.data.Challenge;
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

function requireValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}
