import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPPORTED_OPERATIONS, UNSUPPORTED_OPERATIONS, type OperationId } from "./api-types.js";
import { WSChannel, type IWSChannel } from "./isecure.class.js";
import { FakeTransport, type TransportRequest, type TransportResponse } from "./transport.js";

interface SwaggerOperation {
  operationId: OperationId;
  parameters?: SwaggerParameter[];
}

interface SwaggerSpec {
  paths: Record<string, Record<string, SwaggerOperation>>;
  definitions: Record<string, SwaggerSchema>;
}

interface SwaggerParameter {
  in: "body" | "header" | "path" | "query";
  name: string;
  required?: boolean;
  schema?: SwaggerSchema;
}

interface SwaggerSchema {
  $ref?: string;
  properties?: Record<string, unknown>;
  required?: string[];
}

interface OperationContract {
  sdkMethod: keyof WSChannel;
  path: string;
  method: string;
  invoke: (client: WSChannel, context: ContractContext) => Promise<unknown>;
  setup?: (client: WSChannel, context: ContractContext) => Promise<void>;
  requestIndex?: number;
}

interface ContractContext {
  transport: FakeTransport;
  loginResponse: "authenticated" | "mfa" | "email";
}

const publicKey = readFileSync(new URL("../../examples/gpg-encryption-test/test.pem", import.meta.url), "utf8");
const spec = JSON.parse(readFileSync(new URL("../../wsapi_v2.json", import.meta.url), "utf8")) as SwaggerSpec;
const challenge = "challenge-bytes|1475429754114|4017bda8-0a15-4154-a8b7-88069b05cb4e";

const contract = {
  InitRegister: {
    sdkMethod: "register",
    method: "GET",
    path: "/account/{Email}/{Mode}",
    requestIndex: 0,
    invoke: (client) => client.register(),
  },
  Register: {
    sdkMethod: "register",
    method: "PUT",
    path: "/account/{Email}/{Mode}",
    requestIndex: 1,
    invoke: (client) => client.register(),
  },
  InitPasswordReset: {
    sdkMethod: "initPasswordReset",
    method: "GET",
    path: "/account/{Email}/{Mode}/password",
    invoke: (client) => client.initPasswordReset(),
  },
  PasswordReset: {
    sdkMethod: "passwordReset",
    method: "POST",
    path: "/account/{Email}/{Mode}/password",
    invoke: (client) => client.passwordReset("123456", "New-example-password-123!", challenge),
  },
  InitLogin: {
    sdkMethod: "login",
    method: "GET",
    path: "/session/{Email}/{Mode}",
    requestIndex: 0,
    invoke: (client) => client.login(),
  },
  Login: {
    sdkMethod: "login",
    method: "POST",
    path: "/session/{Email}/{Mode}",
    requestIndex: 1,
    invoke: (client) => client.login(),
  },
  LoginMFA: {
    sdkMethod: "loginMFA",
    method: "PUT",
    path: "/session/{Email}/{Mode}/mfacode",
    setup: async (client, context) => {
      context.loginResponse = "mfa";
      await client.login();
      context.transport.requests.length = 0;
    },
    invoke: (client) => client.loginMFA("123456"),
  },
  VerifyEmail: {
    sdkMethod: "verifyEmail",
    method: "POST",
    path: "/account/{Email}/{Mode}",
    setup: async (client, context) => {
      context.loginResponse = "email";
      await client.login();
      context.transport.requests.length = 0;
    },
    invoke: (client) => client.verifyEmail("123456"),
  },
  VerifyPhone: {
    sdkMethod: "verifyPhone",
    method: "POST",
    path: "/account/{Email}/{Mode}/{Phone}",
    setup: authenticate,
    invoke: (client) => client.verifyPhone("123456"),
  },
  ListCerts: {
    sdkMethod: "listCerts",
    method: "GET",
    path: "/certs/",
    setup: authenticate,
    invoke: (client) => client.listCerts(),
  },
  ConfigCerts: {
    sdkMethod: "configCerts",
    method: "POST",
    path: "/certs/",
    setup: authenticate,
    invoke: (client) => client.configCerts("disabled"),
  },
  ShareCerts: {
    sdkMethod: "shareCerts",
    method: "PUT",
    path: "/certs/shared/{ExtEmail}",
    setup: authenticate,
    invoke: (client) => client.shareCerts("other@example.test"),
  },
  UnshareCerts: {
    sdkMethod: "unshareCerts",
    method: "DELETE",
    path: "/certs/shared/{ExtEmail}",
    setup: authenticate,
    invoke: (client) => client.unshareCerts("other@example.test"),
  },
  ExportCert: {
    sdkMethod: "exportCert",
    method: "GET",
    path: "/certs/{Bank}",
    setup: authenticate,
    invoke: (client) => client.exportCert("3A3A59B2"),
  },
  ImportCert: {
    sdkMethod: "importCert",
    method: "PUT",
    path: "/certs/{Bank}",
    setup: authenticate,
    invoke: (client) =>
      client.importCert({
        Certificate: "certificate",
        Company: "EXAMPLE COMPANY",
        PrivateKey: "private-key",
        WsUserId: "ws-user",
      }),
  },
  EnrollCert: {
    sdkMethod: "enrollCert",
    method: "POST",
    path: "/certs/{Bank}",
    setup: authenticate,
    invoke: (client) => client.enrollCert({ Code: "123456", Company: "EXAMPLE COMPANY", WsUserId: "ws-user" }),
  },
  ListFiles: {
    sdkMethod: "listFiles",
    method: "GET",
    path: "/files/{Bank}",
    setup: authenticate,
    invoke: (client) => client.listFiles({ FileType: "CAMT", Status: "ALL" }),
  },
  UploadFile: {
    sdkMethod: "uploadFile",
    method: "PUT",
    path: "/files/{Bank}",
    setup: authenticate,
    invoke: (client) => client.uploadFile("Zm9v", "test.xml", "DUMMY", "signature"),
  },
  DownloadFile: {
    sdkMethod: "downloadFile",
    method: "GET",
    path: "/files/{Bank}/{FileType}/{FileReference}",
    setup: authenticate,
    invoke: (client) => client.downloadFile("CAMT", "123"),
  },
  DeleteFile: {
    sdkMethod: "deleteFile",
    method: "DELETE",
    path: "/files/{Bank}/{FileType}/{FileReference}",
    setup: authenticate,
    invoke: (client) => client.deleteFile("CAMT", "123"),
  },
  ListAccounts: {
    sdkMethod: "listAccounts",
    method: "GET",
    path: "/integrator/accounts",
    setup: authenticate,
    invoke: (client) => client.listAccounts(),
  },
  ListKeys: {
    sdkMethod: "listKeys",
    method: "GET",
    path: "/pgp",
    setup: authenticate,
    invoke: (client) => client.listKeys(),
  },
  UploadKey: {
    sdkMethod: "uploadPgpKey",
    method: "PUT",
    path: "/pgp",
    setup: authenticate,
    invoke: (client) => client.uploadPgpKey("-----BEGIN PGP PUBLIC KEY BLOCK-----", "authorize"),
  },
  DeleteKey: {
    sdkMethod: "deleteKey",
    method: "DELETE",
    path: "/pgp",
    setup: authenticate,
    invoke: (client) => client.deleteKey("3A3A59B2"),
  },
  Logout: {
    sdkMethod: "logout",
    method: "DELETE",
    path: "/session/{Email}/{Mode}",
    setup: authenticate,
    invoke: (client) => client.logout(),
  },
} satisfies Record<OperationId, OperationContract>;

describe("OpenAPI contract honesty", () => {
  it("supports every operationId declared in wsapi_v2.json", () => {
    expect(operationIdsFromSpec()).toEqual([...SUPPORTED_OPERATIONS].sort());
    expect(Object.keys(contract).sort()).toEqual(operationIdsFromSpec());
    expect(UNSUPPORTED_OPERATIONS).toHaveLength(0);
  });

  it("maps every supported operation to an existing WSChannel method", () => {
    const client = new WSChannel(clientProps(), { transport: new FakeTransport() });

    for (const operationId of SUPPORTED_OPERATIONS) {
      expect(typeof client[contract[operationId].sdkMethod], operationId).toBe("function");
    }
  });

  it("emits the HTTP method, path, headers, query, and body shape declared by wsapi_v2.json", async () => {
    const operationsById = operationsFromSpec();

    for (const operationId of SUPPORTED_OPERATIONS) {
      const operation = operationsById.get(operationId);
      const operationContract = contract[operationId];
      if (!operation) {
        throw new Error(`Missing OpenAPI operation ${operationId}`);
      }
      expect(operation, operationId).toMatchObject({
        method: operationContract.method,
        path: operationContract.path,
      });

      const transport = createContractTransport();
      const context: ContractContext = { transport, loginResponse: "authenticated" };
      contextByTransport.set(transport, context);
      const client = new WSChannel(clientProps(), { transport });
      await operationContract.setup?.(client, context);

      await operationContract.invoke(client, context);

      const request = transport.requests[operationContract.requestIndex ?? 0];
      expect(request, operationId).toBeDefined();
      expect(request?.method, operationId).toBe(operationContract.method);
      expect(pathname(request?.url), operationId).toBe(fillPath(operationContract.path));
      expect(requestMatchesSpec(operationId, request, operation)).toBe(true);
    }
  });
});

async function authenticate(client: WSChannel, context: ContractContext): Promise<void> {
  context.loginResponse = "authenticated";
  await client.login();
  context.transport.requests.length = 0;
}

function clientProps(): IWSChannel {
  return {
    ApiKey: "0",
    Company: "Example Company",
    Name: "Example User",
    Password: "Example-password-123!",
    Phone: "+358401234567",
    PublicKey: publicKey,
    BaseUrl: "https://ws-api.test.isecure.fi/v2",
    Email: "user@example.test",
    Mode: "admin",
    Bank: "nordea",
  };
}

function operationIdsFromSpec(): OperationId[] {
  return [...operationsFromSpec().keys()].sort();
}

function operationsFromSpec(): Map<OperationId, { method: string; path: string; operation: SwaggerOperation }> {
  const operations = new Map<OperationId, { method: string; path: string; operation: SwaggerOperation }>();
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      operations.set(operation.operationId, { method: method.toUpperCase(), path, operation });
    }
  }
  return operations;
}

function requestMatchesSpec(
  operationId: OperationId,
  request: TransportRequest | undefined,
  specOperation: { operation: SwaggerOperation },
): boolean {
  expect(request, operationId).toBeDefined();
  if (!request) return false;

  const parameters = specOperation.operation.parameters ?? [];
  assertRequestHeaders(operationId, request, parameters.filter((parameter) => parameter.in === "header"));
  assertRequestQuery(operationId, request, parameters.filter((parameter) => parameter.in === "query"));
  assertRequestBody(operationId, request, parameters.find((parameter) => parameter.in === "body"));
  return true;
}

function assertRequestHeaders(operationId: OperationId, request: TransportRequest, headerParameters: SwaggerParameter[]): void {
  const headers = request.headers ?? {};
  for (const parameter of headerParameters.filter((header) => header.required)) {
    expect(headers[parameter.name], `${operationId} ${parameter.name}`).toEqual(expect.any(String));
  }

  if (headerParameters.length === 0) {
    expect(headers.Authorization, operationId).toBeUndefined();
    expect(headers["x-api-key"], operationId).toBeUndefined();
  }
}

function assertRequestQuery(operationId: OperationId, request: TransportRequest, queryParameters: SwaggerParameter[]): void {
  expect(Object.keys(request.query ?? {}).sort(), operationId).toEqual(queryParameters.map((parameter) => parameter.name).sort());
}

function assertRequestBody(
  operationId: OperationId,
  request: TransportRequest,
  bodyParameter: SwaggerParameter | undefined,
): void {
  if (!bodyParameter) {
    expect(request.body, operationId).toBeUndefined();
    return;
  }

  const schema = resolveSchema(bodyParameter.schema);
  const allowedKeys = Object.keys(schema.properties ?? {});
  const requiredKeys = schema.required ?? [];
  const body = request.body;

  expect(body, operationId).toEqual(expect.any(Object));
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return;
  }

  const bodyKeys = Object.keys(body);
  expect(bodyKeys.every((key) => allowedKeys.includes(key)), operationId).toBe(true);
  expect(requiredKeys.every((key) => bodyKeys.includes(key)), operationId).toBe(true);
}

function resolveSchema(schema: SwaggerSchema | undefined): SwaggerSchema {
  if (!schema?.$ref) return schema ?? {};
  const refName = schema.$ref.split("/").at(-1);
  return refName ? spec.definitions[refName] ?? {} : {};
}

function createContractTransport(): FakeTransport {
  const transport = new FakeTransport();
  transport.respond((request) => contractResponse(request, transport));
  return transport;
}

function contractResponse(request: TransportRequest, transport: FakeTransport): TransportResponse<unknown> | undefined {
  const path = pathname(request.url);
  if (request.method === "GET" && path.startsWith("/account/") && path.endsWith("/password")) {
    return response({ ResponseCode: "00", ResponseText: "password reset initialized" });
  }
  if (request.method === "POST" && path.startsWith("/account/") && path.endsWith("/password")) {
    return response({ ResponseCode: "00", ResponseText: "password reset" });
  }
  if (request.method === "GET" && path.startsWith("/account/")) {
    return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "register initialized" });
  }
  if (request.method === "PUT" && path.startsWith("/account/")) {
    return response({ ApiKey: "registered-api-key", ResponseCode: "00", ResponseText: "registered" }, 201);
  }
  if (request.method === "POST" && path.includes("/%2B358401234567")) {
    return response({ ResponseCode: "00", ResponseText: "phone verified" });
  }
  if (request.method === "POST" && path.startsWith("/account/")) {
    return response({ ResponseCode: "00", ResponseText: "email verified" });
  }
  if (request.method === "GET" && path.startsWith("/session/")) {
    return response({ Challenge: challenge, ResponseCode: "00", ResponseText: "login initialized" });
  }
  if (request.method === "POST" && path.startsWith("/session/")) {
    return loginResponse(transport);
  }
  if (request.method === "PUT" && path.endsWith("/mfacode")) {
    return response({ ApiKey: "api-key", IdToken: "id-token", ResponseCode: "00", ResponseText: "logged in" });
  }
  if (request.method === "DELETE" && path.startsWith("/session/")) {
    return response({ ResponseCode: "00", ResponseText: "logged out" });
  }
  if (request.method === "GET" && path === "/certs/") {
    return response({ Certs: [], ResponseCode: "00", ResponseText: "certs" });
  }
  if (request.method === "POST" && path === "/certs/") {
    return response({ ResponseCode: "00", ResponseText: "certs configured" });
  }
  if (request.method === "PUT" && path === "/certs/shared/other%40example.test") {
    return response({ ResponseCode: "00", ResponseText: "shared", SharedFrom: [], SharedTo: [] }, 201);
  }
  if (request.method === "DELETE" && path === "/certs/shared/other%40example.test") {
    return response({ ResponseCode: "00", ResponseText: "unshared", SharedFrom: [], SharedTo: [] });
  }
  if (request.method === "GET" && path === "/certs/nordea") {
    return response({ CertsAndKeys: [], ResponseCode: "00", ResponseText: "exported" });
  }
  if (request.method === "PUT" && path === "/certs/nordea") {
    return response({ ResponseCode: "00", ResponseText: "imported" }, 201);
  }
  if (request.method === "POST" && path === "/certs/nordea") {
    return response({ ResponseCode: "00", ResponseText: "enrolled" }, 201);
  }
  if (request.method === "GET" && path === "/files/nordea/CAMT/123") {
    return response({ Content: "Zm9v", ResponseCode: "00", ResponseText: "downloaded" });
  }
  if (request.method === "DELETE" && path === "/files/nordea/CAMT/123") {
    return response({ ResponseCode: "00", ResponseText: "deleted" });
  }
  if (request.method === "GET" && path === "/files/nordea") {
    return response({ FileDescriptors: [], ResponseCode: "00", ResponseText: "files" });
  }
  if (request.method === "PUT" && path === "/files/nordea") {
    return response({ ResponseCode: "00", ResponseText: "uploaded" }, 201);
  }
  if (request.method === "GET" && path === "/integrator/accounts") {
    return response({ Accounts: [], ResponseCode: "00", ResponseText: "accounts" });
  }
  if (request.method === "GET" && path === "/pgp") {
    return response({ PgpKeys: [], ResponseCode: "00", ResponseText: "keys" });
  }
  if (request.method === "PUT" && path === "/pgp") {
    return response({ ResponseCode: "00", ResponseText: "key uploaded" }, 201);
  }
  if (request.method === "DELETE" && path === "/pgp") {
    return response({ PgpKeys: [], ResponseCode: "00", ResponseText: "key deleted" });
  }
  return undefined;
}

function loginResponse(transport: FakeTransport): TransportResponse<unknown> {
  const context = currentContext(transport);
  if (context?.loginResponse === "mfa") {
    return response({ ResponseCode: "00", ResponseText: "Give SMS code", Session: "session-token" });
  }
  if (context?.loginResponse === "email") {
    return response({
      AccessToken: "access-token",
      ResponseCode: "00",
      ResponseText: "Login OK. Verify email address.",
    });
  }
  return response({ ApiKey: "api-key", IdToken: "id-token", ResponseCode: "00", ResponseText: "logged in" });
}

const contextByTransport = new WeakMap<FakeTransport, ContractContext>();

function currentContext(transport: FakeTransport): ContractContext | undefined {
  return contextByTransport.get(transport);
}

function response<T>(data: T, status = 200): TransportResponse<T> {
  return { status, statusText: "OK", data };
}

function pathname(url: string | undefined): string {
  if (!url) return "";
  return new URL(url).pathname.replace(/^\/v2(?=\/)/, "");
}

function fillPath(path: string): string {
  return path
    .replace("{Email}", "user%40example.test")
    .replace("{Mode}", "admin")
    .replace("{Phone}", "%2B358401234567")
    .replace("{Bank}", "nordea")
    .replace("{FileType}", "CAMT")
    .replace("{FileReference}", "123")
    .replace("{ExtEmail}", "other%40example.test");
}
