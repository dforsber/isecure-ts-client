import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from "axios";
import { ISecureAbortError, ISecureHttpError, ISecureNetworkError } from "./errors.js";
import { redactUrl, redactValue, type RedactionMode } from "./redact.js";
import { USER_AGENT } from "./version.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
export type HttpHeaders = Record<string, string>;
export type QueryParams = Record<string, string | undefined>;

export interface TransportRequest<Body = unknown> {
  method: HttpMethod;
  url: string;
  headers?: HttpHeaders;
  query?: QueryParams;
  body?: Body;
  /** Aborts the request (and any pending retry backoff) when signalled. */
  signal?: AbortSignal;
}

export interface TransportResponse<Body> {
  status: number;
  statusText: string;
  data: Body;
}

export interface Transport {
  request<ResponseBody, RequestBody = unknown>(
    request: TransportRequest<RequestBody>,
  ): Promise<TransportResponse<ResponseBody>>;
}

/**
 * `User-Agent` is a forbidden header in browsers (the runtime drops it and
 * logs a console warning), so it is only attached on Node-like runtimes.
 */
function isNodeRuntime(): boolean {
  return typeof process !== "undefined" && process.versions?.node != null && typeof window === "undefined";
}

export interface AxiosTransportOptions {
  /** Custom axios instance. Defaults to a fresh `axios.create()`. */
  client?: AxiosInstance;
  /** Per-request timeout in milliseconds. Defaults to 30000. Use 0 to disable. */
  timeoutMs?: number;
  /** Max retry attempts for transient failures (network/429/5xx). Defaults to 2. */
  retries?: number;
  /** Base backoff delay in milliseconds (exponential with full jitter). Defaults to 300. */
  retryBaseDelayMs?: number;
  /** Upper bound for a single backoff delay. Defaults to 5000. */
  maxRetryDelayMs?: number;
  /**
   * Allow retrying non-idempotent methods (anything but GET) on network errors
   * and 5xx. Off by default: a timeout *after* the server processed a mutation
   * (e.g. a file upload or a one-time verification code) would otherwise be
   * replayed. A 429 is always safe to retry regardless of this flag, since the
   * request was rate-limited rather than processed.
   */
  retryNonIdempotent?: boolean;
  /** Random source for jitter; injectable for deterministic tests. Defaults to Math.random. */
  random?: () => number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 300;
const DEFAULT_MAX_RETRY_MS = 5_000;
// Transient statuses worth retrying for an idempotent request.
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
// A rate-limited request was never processed, so it is safe to retry for any method.
const ALWAYS_RETRYABLE_STATUS = 429;

function isIdempotentMethod(method: HttpMethod): boolean {
  // Only GET is treated as safe to replay. The WS API's PUT/POST/DELETE
  // operations have side effects (file uploads, one-time codes, enrollment)
  // that must not be duplicated by an automatic retry.
  return method === "GET";
}

/**
 * Axios-backed transport with production defaults: a request timeout, bounded
 * exponential-backoff retries (with full jitter and `Retry-After` support) for
 * transient failures, `AbortSignal` propagation, and normalization of failures
 * into the typed {@link ISecureError} hierarchy. Retries are idempotency-aware:
 * non-idempotent methods are only retried on a 429 (or when
 * `retryNonIdempotent` is set), so a mutation is never silently replayed.
 * Non-2xx responses throw {@link ISecureHttpError} (the `ResponseCode !== "00"`
 * logical-failure path stays on 2xx and is handled above the transport).
 */
export class AxiosTransport implements Transport {
  private readonly client: AxiosInstance;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryBaseDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly retryNonIdempotent: boolean;
  private readonly random: () => number;

  constructor(clientOrOptions: AxiosInstance | AxiosTransportOptions = {}) {
    // Backwards-compatible: a bare axios instance (a callable function) is still
    // accepted; otherwise the argument is an options object.
    const options: AxiosTransportOptions =
      typeof clientOrOptions === "function" ? { client: clientOrOptions } : clientOrOptions;
    this.client = options.client ?? axios.create();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = Math.max(0, options.retries ?? DEFAULT_RETRIES);
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_MS;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_MS;
    this.retryNonIdempotent = options.retryNonIdempotent ?? false;
    this.random = options.random ?? Math.random;
  }

  async request<ResponseBody, RequestBody = unknown>(
    request: TransportRequest<RequestBody>,
  ): Promise<TransportResponse<ResponseBody>> {
    const config = this.buildConfig(request);
    const retriable = this.retryNonIdempotent || isIdempotentMethod(request.method);

    for (let attempt = 0; ; attempt += 1) {
      this.throwIfAborted(request.signal);

      let response: AxiosResponse<ResponseBody>;
      try {
        response = await this.client.request<ResponseBody, AxiosResponse<ResponseBody>, RequestBody>(config);
      } catch (error) {
        if (isAbortError(error, request.signal)) {
          throw new ISecureAbortError(undefined, { cause: error });
        }
        // A network error may have reached the server, so only retry when the
        // method is safe to replay.
        if (retriable && attempt < this.retries) {
          await this.backoff(attempt, undefined, request.signal);
          continue;
        }
        throw toNetworkError(error);
      }

      if (response.status >= 200 && response.status < 300) {
        return { status: response.status, statusText: response.statusText, data: response.data };
      }

      const canRetryStatus =
        response.status === ALWAYS_RETRYABLE_STATUS || (retriable && RETRYABLE_STATUSES.has(response.status));
      if (canRetryStatus && attempt < this.retries) {
        await this.backoff(attempt, retryAfterMs(response.headers), request.signal);
        continue;
      }

      throw ISecureHttpError.fromResponse(response.status, response.statusText, response.data);
    }
  }

  private buildConfig<RequestBody>(request: TransportRequest<RequestBody>): AxiosRequestConfig<RequestBody> {
    const config: AxiosRequestConfig<RequestBody> = {
      method: request.method,
      url: request.url,
      // Inspect every status ourselves so retry/typed-error logic owns failures.
      validateStatus: () => true,
    };
    if (this.timeoutMs > 0) config.timeout = this.timeoutMs;
    if (request.signal) config.signal = request.signal;
    if (request.query) config.params = request.query;
    if (request.body !== undefined) config.data = request.body;

    const headers: HttpHeaders = { ...request.headers };
    if (isNodeRuntime() && headers["User-Agent"] === undefined) {
      headers["User-Agent"] = USER_AGENT;
    }
    if (Object.keys(headers).length > 0) config.headers = headers;

    return config;
  }

  private async backoff(attempt: number, retryAfter: number | undefined, signal?: AbortSignal): Promise<void> {
    const exponential = this.retryBaseDelayMs * 2 ** attempt;
    const jittered = this.random() * Math.min(this.maxRetryDelayMs, exponential);
    const delay = Math.min(this.maxRetryDelayMs, Math.max(retryAfter ?? 0, jittered));
    await sleep(delay, signal);
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new ISecureAbortError();
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ISecureAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (axios.isCancel(error)) return true;
  const code = (error as { code?: string } | null)?.code;
  return code === "ERR_CANCELED";
}

function toNetworkError(error: unknown): ISecureNetworkError {
  const code = (error as { code?: string } | null)?.code;
  const timedOut = code === "ECONNABORTED" || code === "ETIMEDOUT";
  const reason = timedOut ? "request timed out" : "network error";
  return new ISecureNetworkError(`ISECure request failed: ${reason}`, {
    cause: error,
    ...(code !== undefined ? { code } : {}),
    timedOut,
  });
}

function retryAfterMs(headers: unknown): number | undefined {
  const value = headerValue(headers, "retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const record = headers as Record<string, unknown>;
  const direct = record[name] ?? record[name.toLowerCase()];
  return typeof direct === "string" ? direct : undefined;
}

/** Minimal logging sink used by {@link LoggingTransport}. */
export interface TransportLogger {
  debug(message: string, meta?: unknown): void;
}

export interface LoggingTransportOptions {
  logger: TransportLogger;
  /** Gate evaluated per request; when it returns false nothing is logged. */
  enabled?: () => boolean;
  /**
   * Redaction strategy. `"balanced"` (default) strips known-sensitive fields
   * plus token-like values; `"strict"` redacts everything except an allowlist
   * of known-safe fields. See {@link RedactionMode}.
   */
  redaction?: RedactionMode;
}

/**
 * Transport decorator that emits redacted debug logs for every request and
 * response (and request failures) around an inner transport. Secrets, one-time
 * codes, and PII are stripped before logging (see {@link redactValue} /
 * {@link redactUrl}). Logging is opt-in: by default the SDK wraps a
 * {@link NoopLogger}, so nothing is emitted until a logger is injected and the
 * configured log level enables it.
 */
export class LoggingTransport implements Transport {
  private readonly mode: RedactionMode;

  constructor(
    private readonly inner: Transport,
    private readonly options: LoggingTransportOptions,
  ) {
    this.mode = options.redaction ?? "balanced";
  }

  async request<ResponseBody, RequestBody = unknown>(
    request: TransportRequest<RequestBody>,
  ): Promise<TransportResponse<ResponseBody>> {
    const enabled = this.options.enabled?.() ?? true;
    const url = redactUrl(request.url);
    if (enabled) {
      this.options.logger.debug(`request ${request.method} ${url}`, {
        query: redactValue(request.query, this.mode),
        headers: redactValue(request.headers, this.mode),
        body: redactValue(request.body, this.mode),
      });
    }

    try {
      const response = await this.inner.request<ResponseBody, RequestBody>(request);
      if (enabled) {
        this.options.logger.debug(`response ${response.status} ${request.method} ${url}`, {
          body: redactValue(response.data, this.mode),
        });
      }
      return response;
    } catch (error) {
      if (enabled) {
        this.options.logger.debug(`error ${request.method} ${url}`, {
          message: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  }
}

export class FakeTransport implements Transport {
  readonly requests: TransportRequest[] = [];
  private readonly handlers: ((request: TransportRequest) => TransportResponse<unknown> | undefined)[] = [];

  respond(handler: (request: TransportRequest) => TransportResponse<unknown> | undefined): void {
    this.handlers.push(handler);
  }

  request<ResponseBody, RequestBody = unknown>(
    request: TransportRequest<RequestBody>,
  ): Promise<TransportResponse<ResponseBody>> {
    this.requests.push(request);

    for (const handler of this.handlers) {
      const response = handler(request);
      if (response) {
        return Promise.resolve(response as TransportResponse<ResponseBody>);
      }
    }

    return Promise.reject(new Error(`No fake transport response for ${request.method} ${request.url}`));
  }
}
