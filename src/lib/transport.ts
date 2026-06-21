import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from "axios";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
export type HttpHeaders = Record<string, string>;
export type QueryParams = Record<string, string | undefined>;

export interface TransportRequest<Body = unknown> {
  method: HttpMethod;
  url: string;
  headers?: HttpHeaders;
  query?: QueryParams;
  body?: Body;
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

export class AxiosTransport implements Transport {
  constructor(private readonly client: AxiosInstance = axios.create()) {}

  async request<ResponseBody, RequestBody = unknown>(
    request: TransportRequest<RequestBody>,
  ): Promise<TransportResponse<ResponseBody>> {
    const config: AxiosRequestConfig<RequestBody> = {
      method: request.method,
      url: request.url,
    };
    if (request.query) config.params = request.query;
    if (request.body !== undefined) config.data = request.body;
    if (request.headers) config.headers = request.headers;

    const response = await this.client.request<ResponseBody, AxiosResponse<ResponseBody>, RequestBody>(config);

    return {
      status: response.status,
      statusText: response.statusText,
      data: response.data,
    };
  }
}

/** Minimal logging sink used by {@link LoggingTransport}. */
export interface TransportLogger {
  debug(message: string, meta?: unknown): void;
}

export interface LoggingTransportOptions {
  logger: TransportLogger;
  /** Gate evaluated per request; when it returns false nothing is logged. */
  enabled?: () => boolean;
}

/**
 * Field names whose values are secrets, credentials, or one-time codes. Their
 * values are replaced with `[redacted]` before anything is logged. Matching is
 * case-insensitive.
 */
const SENSITIVE_FIELDS = new Set(
  [
    "password",
    "encrypted",
    "accesstoken",
    "idtoken",
    "apikey",
    "x-api-key",
    "authorization",
    "session",
    "code",
    "chresp",
    "challenge",
    "privatekey",
    "encprivatekey",
    "encryptedprivatekey",
    "pgpkey",
  ].map((field) => field.toLowerCase()),
);

const REDACTED = "[redacted]";

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_FIELDS.has(key.toLowerCase()) ? REDACTED : redact(entry);
    }
    return result;
  }
  return value;
}

/**
 * Transport decorator that emits redacted debug logs for every request and
 * response (and request failures) around an inner transport. Secrets and
 * one-time codes are stripped before logging. Logging is opt-in: by default the
 * SDK wraps a {@link NoopLogger}, so nothing is emitted until a logger is
 * injected and the configured log level enables it.
 */
export class LoggingTransport implements Transport {
  constructor(
    private readonly inner: Transport,
    private readonly options: LoggingTransportOptions,
  ) {}

  async request<ResponseBody, RequestBody = unknown>(
    request: TransportRequest<RequestBody>,
  ): Promise<TransportResponse<ResponseBody>> {
    const enabled = this.options.enabled?.() ?? true;
    if (enabled) {
      this.options.logger.debug(`request ${request.method} ${request.url}`, {
        query: request.query,
        headers: redact(request.headers),
        body: redact(request.body),
      });
    }

    try {
      const response = await this.inner.request<ResponseBody, RequestBody>(request);
      if (enabled) {
        this.options.logger.debug(`response ${response.status} ${request.method} ${request.url}`, {
          body: redact(response.data),
        });
      }
      return response;
    } catch (error) {
      if (enabled) {
        this.options.logger.debug(`error ${request.method} ${request.url}`, {
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
