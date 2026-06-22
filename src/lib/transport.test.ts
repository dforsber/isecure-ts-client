import { describe, expect, it } from "vitest";
import { AxiosTransport, FakeTransport, type TransportRequest } from "./transport.js";
import { USER_AGENT } from "./version.js";

describe("transport adapters", () => {
  it("maps SDK transport requests to axios config", async () => {
    const calls: unknown[] = [];
    const axiosLike = {
      async request(config: unknown) {
        calls.push(config);
        return { status: 202, statusText: "Accepted", data: { ok: true } };
      },
    };

    const transport = new AxiosTransport(axiosLike as never);
    const response = await transport.request<{ ok: boolean }, { value: string }>({
      method: "POST",
      url: "https://example.test/resource",
      query: { Status: "ALL" },
      headers: { Authorization: "token" },
      body: { value: "body" },
    });

    expect(response).toEqual({ status: 202, statusText: "Accepted", data: { ok: true } });
    // On Node runtimes the transport adds a User-Agent for server-side diagnostics.
    expect(calls).toEqual([
      {
        method: "POST",
        url: "https://example.test/resource",
        params: { Status: "ALL" },
        headers: { Authorization: "token", "User-Agent": USER_AGENT },
        data: { value: "body" },
      },
    ]);
  });

  it("attaches only the User-Agent header when no headers are supplied (Node)", async () => {
    const calls: unknown[] = [];
    const transport = new AxiosTransport({
      async request(config: unknown) {
        calls.push(config);
        return { status: 200, statusText: "OK", data: "ok" };
      },
    } as never);

    await transport.request<string>({ method: "GET", url: "https://example.test/resource" });

    expect(calls).toEqual([
      { method: "GET", url: "https://example.test/resource", headers: { "User-Agent": USER_AGENT } },
    ]);
  });

  it("throws useful fake transport errors for missing handlers", async () => {
    const transport = new FakeTransport();
    const request: TransportRequest = { method: "GET", url: "https://example.test/missing" };

    await expect(transport.request(request)).rejects.toThrow("No fake transport response for GET");
    expect(transport.requests).toEqual([request]);
  });
});
