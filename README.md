# ISECure TypeScript Client

TypeScript SDK for the ISECure WS Channel API.

The checked-in OpenAPI contract is [`wsapi_v2.json`](wsapi_v2.json). The live source at <https://isecure.fi/wsapi_v2.json> currently matches this repository copy and reports API version `v2.6.0`.

## Install

```sh
yarn add isecure-ts-client
```

```ts
import { WSChannel } from "isecure-ts-client";
```

## Basic Usage

```ts
const client = new WSChannel({
  ApiKey: process.env.ISECURE_API_KEY ?? "0",
  Company: "Example Company",
  Name: "Example User",
  Password: process.env.ISECURE_PASSWORD!,
  Phone: "+358401234567",
  PublicKey: process.env.ISECURE_PUBLIC_KEY_PEM!,
  BaseUrl: "https://ws-api.test.isecure.fi/v2",
  Email: "user@example.test",
  Mode: "data",
  Bank: "nordea",
});

const state = await client.login();

if (state.status === "authenticated") {
  const files = await client.listFiles({ Status: "ALL" });
  console.log(files.FileDescriptors);
}
```

Admin login and first-time registration may require MFA, email, or phone verification. The SDK returns typed auth states instead of reading from the terminal:

```ts
const state = await client.login();

if (state.status === "needs_mfa") {
  await client.submitMfaCode("123456");
}

if (state.status === "needs_email_verification") {
  await client.verifyEmail("123456");
}

if (state.status === "needs_phone_verification") {
  await client.verifyPhone("123456");
}
```

For CLI scripts, pass a prompt adapter:

```ts
await client.loginWithPrompt({
  requestMfaCode: async () => "...",
  requestEmailCode: async () => "...",
  requestPhoneCode: async () => "...",
});
```

The runnable terminal implementation lives in [`examples/full-workflow/full-workflow.ts`](examples/full-workflow/full-workflow.ts).

## Supported Operations

Generated request and response types are built from `wsapi_v2.json` with `swagger2openapi` and `openapi-typescript`.

Currently supported:

- `InitRegister`
- `Register`
- `InitLogin`
- `Login`
- `LoginMFA`
- `VerifyEmail`
- `VerifyPhone`
- `UploadKey`
- `UploadFile`
- `ListFiles`

Not yet implemented:

- `InitPasswordReset`
- `PasswordReset`
- `ListCerts`
- `ConfigCerts`
- `ShareCerts`
- `UnshareCerts`
- `ExportCert`
- `ImportCert`
- `EnrollCert`
- `DownloadFile`
- `DeleteFile`
- `ListAccounts`
- `ListKeys`
- `DeleteKey`
- `Logout`

The operation lists are exported as `SUPPORTED_OPERATIONS` and `UNSUPPORTED_OPERATIONS`.

## Development

```sh
yarn install
yarn typecheck
yarn test
yarn pack:check
```

Important gates:

- `yarn generate:types` converts Swagger 2.0 to OpenAPI 3.0 and generates TypeScript types.
- `yarn typecheck` runs strict TypeScript for the SDK and examples.
- `yarn test` runs Vitest with coverage thresholds.
- `yarn pack:check` verifies the library-only package payload.

Examples compile separately to `dist-examples`; they are not part of the npm package payload.
