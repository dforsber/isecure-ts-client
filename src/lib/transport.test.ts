import { describe, expect, it } from "vitest";
import { AxiosTransport, FakeTransport, LoggingTransport, type Transport, type TransportRequest } from "./transport.js";
import { ISecureAbortError, ISecureHttpError, ISecureNetworkError } from "./errors.js";
import { USER_AGENT } from "./version.js";

type AxiosCall = { config: Record<string, unknown> };

function recordingClient(responder: (config: Record<string, unknown>, attempt: number) => unknown): {
  request: (config: Record<string, unknown>) => Promise<unknown>;
  calls: AxiosCall[];
} {
  const calls: AxiosCall[] = [];
  return {
    calls,
    request(config: Record<string, unknown>) {
      const attempt = calls.length;
      calls.push({ config });
      return Promise.resolve(responder(config, attempt)).then((result) => {
        if (result instanceof Error) throw result;
        return result;
      });
    },
  };
}

const ok = { status: 200, statusText: "OK", data: { ok: true }, headers: {} };

describe("transport adapters", () => {
  it("maps SDK transport requests to axios config", async () => {
    const client = recordingClient(() => ({ status: 202, statusText: "Accepted", data: { ok: true }, headers: {} }));
    const transport = new AxiosTransport({ client: client as never });

    const response = await transport.request<{ ok: boolean }, { value: string }>({
      method: "POST",
      url: "https://example.test/resource",
      query: { Status: "ALL" },
      headers: { Authorization: "token" },
      body: { value: "body" },
    });

    expect(response).toEqual({ status: 202, statusText: "Accepted", data: { ok: true } });
    expect(client.calls[0]?.config).toMatchObject({
      method: "POST",
      url: "https://example.test/resource",
      params: { Status: "ALL" },
      headers: { Authorization: "token", "User-Agent": USER_AGENT },
      data: { value: "body" },
      timeout: 30_000,
    });
    expect(typeof client.calls[0]?.config.validateStatus).toBe("function");
  });

  it("retries transient 5xx responses with backoff then succeeds", async () => {
    const client = recordingClient((_config, attempt) =>
      attempt < 2 ? { status: 503, statusText: "Unavailable", data: {}, headers: {} } : ok,
    );
    const transport = new AxiosTransport({ client: client as never, retryBaseDelayMs: 0, random: () => 0 });

    const response = await transport.request<{ ok: boolean }>({ method: "GET", url: "https://example.test/x" });

    expect(response.status).toBe(200);
    expect(client.calls).toHaveLength(3);
  });

  it("retries network errors then throws a typed network error when exhausted", async () => {
    const client = recordingClient(() => Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
    const transport = new AxiosTransport({ client: client as never, retries: 1, retryBaseDelayMs: 0, random: () => 0 });

    await expect(transport.request({ method: "GET", url: "https://example.test/x" })).rejects.toBeInstanceOf(
      ISecureNetworkError,
    );
    expect(client.calls).toHaveLength(2);
  });

  it("throws a typed HTTP error carrying RequestId and ResponseCode for non-retryable status", async () => {
    const client = recordingClient(() => ({
      status: 400,
      statusText: "Bad Request",
      data: { RequestId: "req-123", ResponseCode: "12", ResponseText: "Bad input" },
      headers: {},
    }));
    const transport = new AxiosTransport({ client: client as never });

    const error = await transport.request({ method: "POST", url: "https://example.test/x" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ISecureHttpError);
    const httpError = error as ISecureHttpError;
    expect(httpError.status).toBe(400);
    expect(httpError.requestId).toBe("req-123");
    expect(httpError.responseCode).toBe("12");
    expect(httpError.message).toContain("req-123");
    expect(client.calls).toHaveLength(1); // 400 is not retryable
  });

  it("honors an already-aborted signal without calling the client", async () => {
    const client = recordingClient(() => ok);
    const transport = new AxiosTransport({ client: client as never });
    const controller = new AbortController();
    controller.abort();

    await expect(
      transport.request({ method: "GET", url: "https://example.test/x", signal: controller.signal }),
    ).rejects.toBeInstanceOf(ISecureAbortError);
    expect(client.calls).toHaveLength(0);
  });

  it("does not retry aborted requests", async () => {
    const client = recordingClient(() => Object.assign(new Error("canceled"), { code: "ERR_CANCELED" }));
    const controller = new AbortController();
    controller.abort();
    const transport = new AxiosTransport({ client: client as never, retries: 3, retryBaseDelayMs: 0 });

    await expect(
      transport.request({ method: "GET", url: "https://example.test/x", signal: controller.signal }),
    ).rejects.toBeInstanceOf(ISecureAbortError);
  });

  it("attaches only the User-Agent header when no headers are supplied (Node)", async () => {
    const client = recordingClient(() => ok);
    const transport = new AxiosTransport({ client: client as never });

    await transport.request<{ ok: boolean }>({ method: "GET", url: "https://example.test/resource" });

    expect(client.calls[0]?.config.headers).toEqual({ "User-Agent": USER_AGENT });
  });

  it("does not retry a non-idempotent POST on 5xx (avoids replaying mutations)", async () => {
    const client = recordingClient(() => ({ status: 503, statusText: "Unavailable", data: {}, headers: {} }));
    const transport = new AxiosTransport({ client: client as never, retryBaseDelayMs: 0, random: () => 0 });

    await expect(transport.request({ method: "POST", url: "https://example.test/x" })).rejects.toBeInstanceOf(
      ISecureHttpError,
    );
    expect(client.calls).toHaveLength(1);
  });

  it("does not retry a non-idempotent POST on a network error", async () => {
    const client = recordingClient(() => Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
    const transport = new AxiosTransport({ client: client as never, retryBaseDelayMs: 0, random: () => 0 });

    await expect(transport.request({ method: "PUT", url: "https://example.test/x" })).rejects.toBeInstanceOf(
      ISecureNetworkError,
    );
    expect(client.calls).toHaveLength(1);
  });

  it("retries a non-idempotent POST on 429 (rate-limited, not processed)", async () => {
    const client = recordingClient((_config, attempt) =>
      attempt < 1 ? { status: 429, statusText: "Too Many Requests", data: {}, headers: {} } : ok,
    );
    const transport = new AxiosTransport({ client: client as never, retryBaseDelayMs: 0, random: () => 0 });

    const response = await transport.request({ method: "POST", url: "https://example.test/x" });
    expect(response.status).toBe(200);
    expect(client.calls).toHaveLength(2);
  });

  it("retries non-idempotent methods on 5xx when retryNonIdempotent is enabled", async () => {
    const client = recordingClient((_config, attempt) =>
      attempt < 1 ? { status: 503, statusText: "Unavailable", data: {}, headers: {} } : ok,
    );
    const transport = new AxiosTransport({
      client: client as never,
      retryNonIdempotent: true,
      retryBaseDelayMs: 0,
      random: () => 0,
    });

    const response = await transport.request({ method: "POST", url: "https://example.test/x" });
    expect(response.status).toBe(200);
    expect(client.calls).toHaveLength(2);
  });

  it("still accepts a bare axios instance for backwards compatibility", async () => {
    const calls: unknown[] = [];
    const axiosLike = Object.assign(
      function axiosInstance() {
        /* callable like a real axios instance */
      },
      {
        request(config: unknown) {
          calls.push(config);
          return Promise.resolve(ok);
        },
      },
    );

    const transport = new AxiosTransport(axiosLike as never);
    const response = await transport.request<{ ok: boolean }>({ method: "GET", url: "https://example.test/x" });

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("honors a numeric Retry-After header on a retryable status", async () => {
    const client = recordingClient((_config, attempt) =>
      attempt < 1 ? { status: 503, statusText: "Unavailable", data: {}, headers: { "retry-after": "0" } } : ok,
    );
    const transport = new AxiosTransport({ client: client as never, retryBaseDelayMs: 0, random: () => 0 });

    const response = await transport.request({ method: "GET", url: "https://example.test/x" });
    expect(response.status).toBe(200);
    expect(client.calls).toHaveLength(2);
  });

  it("parses an HTTP-date Retry-After header (capped by maxRetryDelayMs)", async () => {
    const client = recordingClient((_config, attempt) =>
      attempt < 1
        ? { status: 429, statusText: "Too Many", data: {}, headers: { "retry-after": "Wed, 21 Oct 2099 07:28:00 GMT" } }
        : ok,
    );
    const transport = new AxiosTransport({
      client: client as never,
      retryBaseDelayMs: 0,
      maxRetryDelayMs: 0,
      random: () => 0,
    });

    const response = await transport.request({ method: "POST", url: "https://example.test/x" });
    expect(response.status).toBe(200);
    expect(client.calls).toHaveLength(2);
  });

  it("LoggingTransport logs (with redacted URL) and rethrows when the inner transport fails", async () => {
    const messages: string[] = [];
    const inner: Transport = { request: () => Promise.reject(new Error("boom")) };
    const logging = new LoggingTransport(inner, { logger: { debug: (message) => messages.push(message) } });

    await expect(
      logging.request({ method: "GET", url: "https://api.test/v2/account/user%40example.test/admin/%2B358401234567" }),
    ).rejects.toThrow("boom");

    const errorLine = messages.find((message) => message.startsWith("error GET"));
    expect(errorLine).toBeDefined();
    expect(errorLine).not.toContain("user%40example.test");
    expect(errorLine).not.toContain("%2B358401234567");
  });

  it("throws useful fake transport errors for missing handlers", async () => {
    const transport = new FakeTransport();
    const request: TransportRequest = { method: "GET", url: "https://example.test/missing" };

    await expect(transport.request(request)).rejects.toThrow("No fake transport response for GET");
    expect(transport.requests).toEqual([request]);
  });

  it("disables the timeout when timeoutMs is 0", async () => {
    const client = recordingClient(() => ok);
    const transport = new AxiosTransport({ client: client as never, timeoutMs: 0 });
    await transport.request({ method: "GET", url: "https://example.test/x" });
    expect(client.calls[0]?.config.timeout).toBeUndefined();
  });
});
