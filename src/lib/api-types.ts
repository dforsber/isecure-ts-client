import type { components, operations } from "../generated/wsapi-v2.js";

type JsonResponse<
  Operation extends keyof operations,
  Status extends keyof operations[Operation]["responses"],
> = operations[Operation]["responses"][Status] extends {
  content: { "application/json": infer Body };
}
  ? Body
  : never;

type JsonRequest<Operation extends keyof operations> = operations[Operation] extends {
  requestBody: { content: { "application/json": infer Body } };
}
  ? Body
  : never;

export type Mode = "admin" | "data";
export type LogLevel = "error" | "warn" | "info" | "debug" | "silent";
export type PgpKeyPurpose = "authorize" | "export";

export type ApiResponse = components["schemas"]["Response"];
export type ApiErrorResponse = components["schemas"]["ErrorResponse"];
export type InitPasswordResetResponse = JsonResponse<"InitPasswordReset", 200>;
export type PasswordResetRequest = JsonRequest<"PasswordReset">;
export type PasswordResetResponse = JsonResponse<"PasswordReset", 200>;
export type RegisterRequest = JsonRequest<"Register">;
export type RegisterResponse = JsonResponse<"Register", 201>;
export type InitRegisterResponse = JsonResponse<"InitRegister", 200>;
export type InitLoginResponse = JsonResponse<"InitLogin", 200>;
export type LoginRequest = JsonRequest<"Login">;

/**
 * TOTP-related fields layered on top of the generated login/MFA shapes. They are
 * declared here (rather than regenerated into wsapi-v2.ts) so the SDK can add
 * Google Authenticator support ahead of the OpenAPI spec being regenerated; once
 * the spec carries them these intersections become redundant no-ops.
 */
type TotpResponseFields = {
  /** Cognito challenge name echoed by login: `SMS_MFA` or `SOFTWARE_TOKEN_MFA`. */
  ChallengeName?: string;
  /** TOTP shared secret, present only when `SetupTOTP` enrollment was requested. */
  SecretCode?: string;
  /** `otpauth://` URI for the enrollment QR code, present with `SecretCode`. */
  OtpauthUri?: string;
};

export type LoginResponse = JsonResponse<"Login", 200> & TotpResponseFields;
export type LoginMfaRequest = JsonRequest<"LoginMFA"> & {
  /** Echo the `ChallengeName` from the login response so the API answers the right factor. */
  ChallengeName?: string;
  /** Request TOTP enrollment: the response then also carries SecretCode/OtpauthUri/AccessToken. */
  SetupTOTP?: boolean;
};
export type LoginMfaResponse = JsonResponse<"LoginMFA", 200> & TotpResponseFields;

/** Confirm TOTP enrollment. No generated operation yet (see TotpResponseFields). */
export interface VerifyTotpRequest {
  Code: string;
  AccessToken: string;
}
export type VerifyTotpResponse = ApiResponse;
export type VerifyEmailRequest = JsonRequest<"VerifyEmail">;
export type VerifyPhoneRequest = JsonRequest<"VerifyPhone">;
export type UploadKeyRequest = JsonRequest<"UploadKey">;
export type UploadFileRequest = JsonRequest<"UploadFile">;
export type ListCertsResponse = JsonResponse<"ListCerts", 200>;
export type ConfigCertsRequest = JsonRequest<"ConfigCerts">;
export type ConfigCertsResponse = JsonResponse<"ConfigCerts", 200>;
export type ShareCertsResponse = JsonResponse<"ShareCerts", 201>;
export type UnshareCertsResponse = JsonResponse<"UnshareCerts", 200>;
export type ExportCertResponse = JsonResponse<"ExportCert", 200>;
export type ExportCertQuery = operations["ExportCert"]["parameters"]["query"];
export type ImportCertRequest = JsonRequest<"ImportCert">;
export type ImportCertResponse = JsonResponse<"ImportCert", 201>;
export type EnrollCertRequest = JsonRequest<"EnrollCert">;
export type EnrollCertResponse = JsonResponse<"EnrollCert", 201>;
export type ListFilesResponse = JsonResponse<"ListFiles", 200>;
export type ListFilesQuery = NonNullable<operations["ListFiles"]["parameters"]["query"]>;
export type DownloadFileResponse = JsonResponse<"DownloadFile", 200>;
export type DeleteFileResponse = JsonResponse<"DeleteFile", 200>;
export type ListAccountsResponse = JsonResponse<"ListAccounts", 200>;
export type ListKeysResponse = JsonResponse<"ListKeys", 200>;
export type DeleteKeyRequest = JsonRequest<"DeleteKey">;
export type DeleteKeyResponse = JsonResponse<"DeleteKey", 200>;
export type LogoutResponse = JsonResponse<"Logout", 200>;
export type OperationId = keyof operations;

export const SUPPORTED_OPERATIONS = [
  "InitRegister",
  "Register",
  "InitPasswordReset",
  "PasswordReset",
  "InitLogin",
  "Login",
  "LoginMFA",
  "VerifyEmail",
  "VerifyPhone",
  "ListCerts",
  "ConfigCerts",
  "ShareCerts",
  "UnshareCerts",
  "ExportCert",
  "ImportCert",
  "EnrollCert",
  "UploadKey",
  "UploadFile",
  "ListFiles",
  "DownloadFile",
  "DeleteFile",
  "ListAccounts",
  "ListKeys",
  "DeleteKey",
  "Logout",
] as const satisfies readonly OperationId[];

export type SupportedOperation = (typeof SUPPORTED_OPERATIONS)[number];
export const UNSUPPORTED_OPERATIONS = [] as const satisfies readonly OperationId[];
