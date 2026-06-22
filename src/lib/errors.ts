/**
 * Typed error hierarchy for the SDK. Transport-level failures are normalized
 * into these so callers can branch on `instanceof` and read structured fields
 * (HTTP status, backend `ResponseCode`, and the `RequestId` needed for support
 * tickets) instead of catching raw `AxiosError`s.
 */
export class ISecureError extends Error {
  /** Service-side request id for tracing, when the response carried one. */
  readonly requestId: string | undefined;

  constructor(message: string, options?: { cause?: unknown; requestId?: string | undefined }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ISecureError";
    this.requestId = options?.requestId;
  }
}

/** A non-2xx HTTP response from the WS API. */
export class ISecureHttpError extends ISecureError {
  readonly status: number;
  readonly statusText: string;
  /** Two-digit backend response code from the error body, if present. */
  readonly responseCode: string | undefined;
  readonly responseText: string | undefined;
  /** Raw response body, for diagnostics. */
  readonly body: unknown;

  constructor(args: {
    status: number;
    statusText: string;
    responseCode?: string | undefined;
    responseText?: string | undefined;
    requestId?: string | undefined;
    body?: unknown;
  }) {
    const parts = [`${String(args.status)} ${args.statusText}`.trim()];
    if (args.responseCode) parts.push(`ResponseCode ${args.responseCode}`);
    if (args.requestId) parts.push(`RequestId ${args.requestId}`);
    const detail = args.responseText ? `: ${args.responseText}` : "";
    super(`ISECure request failed (${parts.join(", ")})${detail}`, { requestId: args.requestId });
    this.name = "ISecureHttpError";
    this.status = args.status;
    this.statusText = args.statusText;
    this.responseCode = args.responseCode;
    this.responseText = args.responseText;
    this.body = args.body;
  }

  /** Builds an {@link ISecureHttpError} from a raw status + response body. */
  static fromResponse(status: number, statusText: string, body: unknown): ISecureHttpError {
    const fields = extractErrorFields(body);
    return new ISecureHttpError({ status, statusText, body, ...fields });
  }
}

/** A request that never produced an HTTP response (network failure or timeout). */
export class ISecureNetworkError extends ISecureError {
  /** Transport error code (e.g. "ECONNABORTED", "ETIMEDOUT"), if known. */
  readonly code: string | undefined;
  /** True when the failure was a client-side timeout. */
  readonly timedOut: boolean;

  constructor(message: string, options?: { cause?: unknown; code?: string; timedOut?: boolean }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ISecureNetworkError";
    this.code = options?.code;
    this.timedOut = options?.timedOut ?? false;
  }
}

/** A request aborted via an `AbortSignal`. */
export class ISecureAbortError extends ISecureError {
  constructor(message = "ISECure request was aborted", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ISecureAbortError";
  }
}

export function isISecureError(value: unknown): value is ISecureError {
  return value instanceof ISecureError;
}

function extractErrorFields(body: unknown): {
  responseCode?: string;
  responseText?: string;
  requestId?: string;
} {
  if (!body || typeof body !== "object") {
    return {};
  }
  const record = body as Record<string, unknown>;
  const result: { responseCode?: string; responseText?: string; requestId?: string } = {};
  if (typeof record.ResponseCode === "string") result.responseCode = record.ResponseCode;
  if (typeof record.ResponseText === "string") result.responseText = record.ResponseText;
  if (typeof record.RequestId === "string") result.requestId = record.RequestId;
  return result;
}
