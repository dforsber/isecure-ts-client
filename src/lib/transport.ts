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

export class FakeTransport implements Transport {
  readonly requests: TransportRequest[] = [];
  private readonly handlers: Array<(request: TransportRequest) => TransportResponse<unknown> | undefined> = [];

  respond(handler: (request: TransportRequest) => TransportResponse<unknown> | undefined): void {
    this.handlers.push(handler);
  }

  async request<ResponseBody, RequestBody = unknown>(
    request: TransportRequest<RequestBody>,
  ): Promise<TransportResponse<ResponseBody>> {
    this.requests.push(request);

    for (const handler of this.handlers) {
      const response = handler(request);
      if (response) {
        return response as TransportResponse<ResponseBody>;
      }
    }

    throw new Error(`No fake transport response for ${request.method} ${request.url}`);
  }
}
