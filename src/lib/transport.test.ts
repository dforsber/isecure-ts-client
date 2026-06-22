import { describe, expect, it } from "vitest";
import { AxiosTransport, FakeTransport, type TransportRequest } from "./transport.js";
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
