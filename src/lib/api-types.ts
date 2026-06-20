import type { components, operations } from "../generated/wsapi-v2.js";

type JsonResponse<Operation extends keyof operations, Status extends keyof operations[Operation]["responses"]> =
  operations[Operation]["responses"][Status] extends {
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
export type RegisterRequest = JsonRequest<"Register">;
export type RegisterResponse = JsonResponse<"Register", 201>;
export type InitRegisterResponse = JsonResponse<"InitRegister", 200>;
export type InitLoginResponse = JsonResponse<"InitLogin", 200>;
export type LoginRequest = JsonRequest<"Login">;
export type LoginResponse = JsonResponse<"Login", 200>;
export type LoginMfaRequest = JsonRequest<"LoginMFA">;
export type LoginMfaResponse = JsonResponse<"LoginMFA", 200>;
export type VerifyEmailRequest = JsonRequest<"VerifyEmail">;
export type VerifyPhoneRequest = JsonRequest<"VerifyPhone">;
export type UploadKeyRequest = JsonRequest<"UploadKey">;
export type UploadFileRequest = JsonRequest<"UploadFile">;
export type ListFilesResponse = JsonResponse<"ListFiles", 200>;
export type ListFilesQuery = NonNullable<operations["ListFiles"]["parameters"]["query"]>;
export type OperationId = keyof operations;

export const SUPPORTED_OPERATIONS = [
  "InitRegister",
  "Register",
  "InitLogin",
  "Login",
  "LoginMFA",
  "VerifyEmail",
  "VerifyPhone",
  "UploadKey",
  "UploadFile",
  "ListFiles",
] as const satisfies readonly OperationId[];

export type SupportedOperation = (typeof SUPPORTED_OPERATIONS)[number];

export const UNSUPPORTED_OPERATIONS = [
  "InitPasswordReset",
  "PasswordReset",
  "ListCerts",
  "ConfigCerts",
  "ShareCerts",
  "UnshareCerts",
  "ExportCert",
  "ImportCert",
  "EnrollCert",
  "DownloadFile",
  "DeleteFile",
  "ListAccounts",
  "ListKeys",
  "DeleteKey",
  "Logout",
] as const satisfies readonly OperationId[];
