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

For CLI scripts, pass a prompt adapter. `loginWithPrompt` drives the whole MFA → email → phone verification machine to completion and is bounded, so you never re-implement the verify/re-login loop yourself:

```ts
const state = await client.loginWithPrompt({
  requestMfaCode: async () => "...",
  requestEmailCode: async () => "...",
  requestPhoneCode: async () => "...",
});

if (state.status === "authenticated") {
  // ready to call authenticated operations
} else if (state.status === "stalled") {
  // an accepted verification did not advance login (e.g. backend did not flip
  // confirmation). `state.step` names the stuck step instead of looping.
  console.error(`Login stalled on ${state.step} after ${state.transitions} steps`);
} else if (state.status === "failed") {
  // `state.reason` is a discriminable AuthErrorReason such as "invalid_code",
  // "expired_code", "too_many_attempts", or "missing_access_token".
  console.error(`Login failed (${state.reason}): ${state.responseText}`);
}
```

Verification helpers (`verifyEmail`, `verifyPhone`) and `classifyVerificationResponse` return the same typed `failed` state with an `AuthErrorReason`, so invalid/expired codes, rate limiting, and already-verified cases are discriminable rather than collapsed into a single error string.

## Debug Logging

Logging is opt-in. By default the SDK uses a no-op logger and emits nothing. Inject a `logger` and keep `LogLevel` at `debug` (the default) to get redacted request/response debug lines for every call — secrets, tokens, and one-time codes are stripped before logging:

```ts
const client = new WSChannel(
  { ...props, LogLevel: "debug" },
  {
    logger: {
      debug: (message, meta) => console.debug(message, meta),
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  },
);
```

Set `LogLevel: "silent"` (or omit the logger) to disable transport logging. The redaction lives in `LoggingTransport`, which wraps whatever transport you provide, so a custom transport is logged too.

Redaction strips known secrets and PII (tokens, passwords, codes, email, phone, name), masks token-like values regardless of field name, and removes emails from logged URLs. For low-trust log sinks, pass `redaction: "strict"` (via `WSChannelOptions` or `LoggingTransportOptions`) to redact everything except an allowlist of known-safe fields.

## Errors and Resilience

Logical failures returned by the API as HTTP 200 with `ResponseCode !== "00"` surface through the typed auth/verification states described above. Transport-level failures throw a typed error hierarchy instead of raw `AxiosError`s:

- `ISecureHttpError` — a non-2xx response, exposing `status`, `responseCode`, `responseText`, `requestId` (quote this in support tickets), and the raw `body`.
- `ISecureNetworkError` — a network failure or timeout (`timedOut`, `code`, `cause`).
- `ISecureAbortError` — a request cancelled via `AbortSignal`.

All extend `ISecureError`; use `isISecureError(err)` to narrow.

```ts
import { isISecureError, ISecureHttpError } from "isecure-ts-client";

try {
  await client.listFiles({ Status: "ALL" });
} catch (err) {
  if (err instanceof ISecureHttpError) {
    console.error(`HTTP ${err.status} (RequestId ${err.requestId}): ${err.responseText}`);
  } else if (isISecureError(err)) {
    console.error(err.message);
  }
}
```

The default `AxiosTransport` applies production defaults — a 30s timeout and bounded exponential-backoff retries (with jitter and `Retry-After` support) for transient failures (network errors, 408/425/429/5xx). Tune them via `AxiosTransportOptions`:

```ts
const client = new WSChannel(props, {
  transport: new AxiosTransport({ timeoutMs: 10_000, retries: 3 }),
});
```

The transport also honors an `AbortSignal` on each `TransportRequest` (cancelling an in-flight request or a pending retry backoff), which custom transports and integrations can use directly.

## Session Lifecycle

The SDK tracks the id-token expiry returned at login. Inspect it with `client.isAuthenticated()`, `client.isSessionExpired()`, and `client.sessionExpiresAt`. When an authenticated call is made on an expired session, the SDK invokes an optional refresh hook so you can re-establish the session in one place instead of handling 401s everywhere:

```ts
const client = new WSChannel(props, {
  expirySkewMs: 30_000, // refresh 30s early
  onSessionExpired: async (channel) => {
    await channel.loginWithPrompt(promptAdapter);
  },
});
```

Without a hook, an authenticated call on an expired session throws `ISecureError` rather than sending a request that would 401. `logout()` always works, even when expired.

## Runtime Support

The SDK supports Node.js and modern browser bundlers. Password challenge encryption uses WebCrypto-compatible RSA-OAEP with SHA-1, so browser runtimes must provide `globalThis.crypto.subtle`.

Browser applications also need the ISECure WS API endpoint to allow the application origin with CORS. Avoid exposing production passwords, API keys, or id tokens in untrusted browser code; for most customer-facing web apps, run this SDK on your backend and call that backend from the browser.

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
yarn browser:check
yarn pack:check
```

Important gates:

- `yarn generate:types` converts Swagger 2.0 to OpenAPI 3.0 and generates TypeScript types.
- `yarn audit` checks dependency advisories.
- `yarn format:check` checks Prettier formatting.
- `yarn lint` runs ESLint with type-aware rules.
- `yarn typecheck` runs strict TypeScript for the SDK and examples.
- `yarn test` runs Vitest with coverage thresholds.
- `yarn browser:check` verifies the package entrypoint bundles for browser targets.
- `yarn pack:check` verifies the library-only package payload.

Examples compile separately to `dist-examples`; they are not part of the npm package payload.

## Releases

Semantic versions are prepared by Release Please from conventional commits:

- `fix: ...` creates a patch release.
- `feat: ...` creates a minor release.
- `feat!: ...` or `BREAKING CHANGE:` creates a major release.

Release Please opens a version/changelog PR. Merging that PR creates the GitHub release, and the publish workflow publishes the package to npm.

Fully automated publishing requires repository secret `RELEASE_PLEASE_TOKEN` with a fine-grained GitHub token that can write contents, pull requests, and issues. The release workflow intentionally fails without that secret, because GitHub releases created by `GITHUB_TOKEN` do not trigger the npm publish workflow.

The npm package must also be configured with a trusted publisher:

- Publisher: GitHub Actions
- Organization or user: `dforsber`
- Repository: `isecure-ts-client`
- Workflow filename: `publish.yml`
- Environment name: `npm`
- Allowed action: `npm publish`
