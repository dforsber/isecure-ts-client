# ISECure TypeScript Client

TypeScript SDK for the ISECure WS Channel API.

The checked-in OpenAPI contract is [`wsapi_v2.json`](wsapi_v2.json). The live source at <https://isecure.fi/wsapi_v2.json> currently matches this repository copy and reports API version `v2.6.0`.

## Install

```sh
npm install isecure-ts-client
```

```ts
import { WSChannel } from "isecure-ts-client";
```

## Customer Start Steps

1. Install `isecure-ts-client`.
2. Configure account, bank, endpoint, password, and RSA public key values.
3. Create `WSChannel`.
4. Call `register()` for first-time account setup, or `login()` for an existing account.
5. Complete any returned auth state: MFA, email verification, or phone verification.
6. Use supported operations such as `listFiles`, `uploadFile`, and `uploadPgpKey`.

## Configuration

| Environment variable     | Required | Description                                                                       |
| ------------------------ | -------- | --------------------------------------------------------------------------------- |
| `ISECURE_BASE_URL`       | No       | API endpoint. Defaults to `https://ws-api.test.isecure.fi/v2` in examples.        |
| `ISECURE_API_KEY`        | No       | Existing integrator API key. Use `0` or omit for initial integrator registration. |
| `ISECURE_COMPANY`        | Yes      | Company name for registration.                                                    |
| `ISECURE_NAME`           | Yes      | Full user name for registration.                                                  |
| `ISECURE_EMAIL`          | Yes      | Account email address.                                                            |
| `ISECURE_PHONE`          | Yes      | Phone number with country code, for example `+358401234567`.                      |
| `ISECURE_PASSWORD`       | Yes      | Account password.                                                                 |
| `ISECURE_PUBLIC_KEY_PEM` | Yes      | ISECure RSA public key in PEM format.                                             |
| `ISECURE_MODE`           | No       | `admin` or `data`. Defaults to `data` in examples.                                |
| `ISECURE_BANK`           | No       | Bank identifier. Defaults to `nordea` in examples.                                |

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

## First Registration

```ts
const registration = await client.register();
console.log(registration.ApiKey);

let state = await client.login();

while (state.status !== "authenticated") {
  if (state.status === "needs_mfa") {
    state = await client.submitMfaCode("123456");
    continue;
  }

  if (state.status === "needs_email_verification") {
    await client.verifyEmail("123456");
    state = await client.login();
    continue;
  }

  if (state.status === "needs_phone_verification") {
    await client.verifyPhone("123456");
    state = await client.login();
    continue;
  }

  if (state.status === "failed") {
    throw new Error(state.responseText);
  }

  state = await client.login();
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
- `InitPasswordReset`
- `PasswordReset`
- `InitLogin`
- `Login`
- `LoginMFA`
- `VerifyEmail`
- `VerifyPhone`
- `ListCerts`
- `ConfigCerts`
- `ShareCerts`
- `UnshareCerts`
- `ExportCert`
- `ImportCert`
- `EnrollCert`
- `UploadKey`
- `UploadFile`
- `ListFiles`
- `DownloadFile`
- `DeleteFile`
- `ListAccounts`
- `ListKeys`
- `DeleteKey`
- `Logout`

All operations in `wsapi_v2.json` are now represented by `WSChannel` methods. The operation list is exported as `SUPPORTED_OPERATIONS`; `UNSUPPORTED_OPERATIONS` is empty.

## Development

```sh
yarn install --frozen-lockfile
yarn audit
yarn format:check
yarn lint
yarn typecheck
yarn test
yarn pack:check
```

Important gates:

- `yarn generate:types` converts Swagger 2.0 to OpenAPI 3.0 and generates TypeScript types.
- `yarn audit` checks dependency advisories.
- `yarn format:check` checks Prettier formatting.
- `yarn lint` runs ESLint with type-aware rules.
- `yarn typecheck` runs strict TypeScript for the SDK and examples.
- `yarn test` runs Vitest with coverage thresholds.
- `yarn pack:check` verifies the library-only package payload.

Examples compile separately to `dist-examples`; they are not part of the npm package payload.

## Releases

Semantic versions are prepared by Release Please from conventional commits:

- `fix: ...` creates a patch release.
- `feat: ...` creates a minor release.
- `feat!: ...` or `BREAKING CHANGE:` creates a major release.

Release Please opens a version/changelog PR. Merging that PR creates the GitHub release, and the publish workflow publishes the package to npm.

Fully automated publishing requires repository secret `RELEASE_PLEASE_TOKEN` with a fine-grained GitHub token that can write contents, pull requests, and issues. The release workflow intentionally fails without that secret, because GitHub releases created by `GITHUB_TOKEN` do not trigger the npm publish workflow.
