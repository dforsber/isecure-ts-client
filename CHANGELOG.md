# Changelog

## Unreleased

- Extracted WS API endpoint construction into a pure, separately tested `UrlBuilder`, shrinking the `WSChannel` class and making URL behavior unit-testable in isolation.
- Fixed stale-token classification bugs: a lingering access token from the email-verification stage no longer re-triggers email verification, and a prior session's id token/API key no longer misclassifies a refresh (re-login) MFA-stage response as already authenticated. Classification now keys both on the tokens carried by the current response. (The first was surfaced by a new end-to-end onboarding test.)
- Raised the toolchain bar: ESLint now uses `strict-type-checked` + `stylistic-type-checked`, and `tsconfig` adds `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns`, `noUnusedLocals`, and `noUnusedParameters`.
- Added a `STABILITY.md` API-stability/semver policy, a `docs` script (typedoc) for generating API reference docs, and an end-to-end onboarding integration test exercising register → verify email → verify phone → MFA → authenticated through the public SDK only.
- Added session-expiry awareness. The SDK now derives an absolute expiry from the login `ExpiresIn`, exposed via `WSChannel.sessionExpiresAt`, `isAuthenticated()`, and `isSessionExpired()`. Authenticated calls made on an expired session invoke an optional `onSessionExpired` refresh hook (configurable skew via `expirySkewMs`) and re-check afterwards — a hook that fails to refresh throws rather than letting the call proceed with a stale token — or throw a typed `ISecureError` when no hook is configured instead of firing a request doomed to 401. `logout()` still works on an expired session.
- Hardened debug-log redaction. Sensitive-field stripping now also covers PII (email, phone, name), a value heuristic redacts token-like strings (JWTs, long base64, the `base64|timestamp|uuid` challenge) regardless of field name, and request URLs have embedded email addresses and phone numbers masked. A new `"strict"` mode (selectable via `WSChannelOptions.redaction` or `LoggingTransportOptions.redaction`) switches to an allowlist that redacts everything except known-safe fields. Redaction lives in a dedicated, exported `redact` module (`redactValue` / `redactUrl`).
- Split the auth state shapes into `auth-state.ts`, leaving `auth.ts` to own the classification logic (re-exported for a stable `./auth.js` import surface).
- Added a typed error hierarchy (`ISecureError`, `ISecureHttpError`, `ISecureNetworkError`, `ISecureAbortError`, plus `isISecureError`). Non-2xx HTTP responses now throw `ISecureHttpError` carrying the HTTP status, backend `ResponseCode`/`ResponseText`, and the `RequestId` needed for support — instead of leaking raw `AxiosError`s. The `ResponseCode !== "00"` logical-failure path is unchanged (it stays on 2xx and is handled by the auth-state classifier).
- Hardened `AxiosTransport` for production: a default 30s request timeout, bounded exponential-backoff retries with full jitter and `Retry-After` support for transient failures, and `AbortSignal` propagation (including aborting a pending retry backoff). Retries are **idempotency-aware** — non-idempotent methods (anything but `GET`) are only retried on a `429` (rate-limited, not processed), so a file upload or one-time code is never silently replayed; opt in with `retryNonIdempotent`. The constructor still accepts a bare axios instance for backwards compatibility in addition to the new `AxiosTransportOptions`.
- Refactored `classifyAuthResponse` into an explicit, ordered rule table so the precedence between overlapping login signals (verification prompt vs. session/`sms code` MFA heuristic) lives in one reviewable place — the root cause of the original misclassification was an ordering bug in a hand-written if-ladder.
- Collapsed the per-operation request boilerplate into a single private `call()` funnel that centralizes JSON-vs-authenticated header selection and response unwrapping.
- Added a `User-Agent: isecure-ts-client/<version>` header on Node runtimes (skipped in browsers, where it is a forbidden header), plus exported `SDK_VERSION` / `USER_AGENT`.
- Added `parseMode` / `parseLogLevel` (and `isMode` / `isLogLevel`) input guards so untrusted values such as environment variables are validated instead of unchecked-cast.
- Tightened the `classifyErrorReason` "unconfirmed" heuristic to avoid matching unrelated responses that merely contain the word "confirm".

## 1.0.2

- Fixed `classifyAuthResponse` so explicit `verify phone` / `verify email` prompts are detected before the session/`sms code` MFA heuristic. A verification response that also carries a Cognito session token (or the words "sms code") is no longer misclassified as `needs_mfa`.
- Made the email-verification state self-consistent: `needs_email_verification` is now only returned when a usable access token is present. An email-verification prompt that arrives without an access token resolves to a typed `failed` state (`reason: "missing_access_token"`) instead of a state that `verifyEmail()` would reject.
- Replaced the `loginWithPrompt` "did not settle" exception with a typed `stalled` auth state that names the stuck `step` (`mfa` / `email_verification` / `phone_verification`) and the number of transitions, so callers never re-implement the verify/re-login loop or guess where it stopped. The loop also detects an accepted verification that fails to advance login and stops immediately.
- Added discriminable verification/confirmation error reasons via `AuthErrorReason` on the `failed` state (invalid/expired code, resend required, too many attempts, not/already verified, unconfirmed, missing access token). The mapping is best-effort over `ResponseText` until the backend exposes machine-readable codes.
- Added opt-in, redacted request/response debug logging via a `LoggingTransport` decorator wired to `LogLevel`. Secrets, tokens, and one-time codes are stripped before logging; the default `NoopLogger` keeps the SDK silent unless a logger is injected.
- Pinned the build-time `js-yaml` transitive dependency to `4.2.0` for npm consumers via `overrides` (mirroring the existing yarn `resolutions`) and refreshed `yarn.lock`, keeping `npm audit --audit-level=moderate` clean.

## 1.0.1

- Tightened release automation so semantic releases fail clearly when `RELEASE_PLEASE_TOKEN` is missing.
- Documented the full local quality gate sequence.
- Exported the remaining OpenAPI-derived request and response aliases from the root SDK entrypoint.
- Made auth prompt classification more tolerant of response text wording changes.
- Added browser bundler support by replacing Node-only challenge encryption with WebCrypto-compatible encryption and adding a browser bundle quality gate.

## 1.0.0

- Published the first stable SDK release.
- Covered every operation declared by `wsapi_v2.json`.
- Added OpenAPI contract tests for operation coverage, paths, methods, headers, query parameters, and request body shapes.
- Added GitHub Actions CI, npm provenance publishing, package metadata, and release checks.
- Added typed auth states, prompt adapters, generated OpenAPI types, and focused unit coverage.

## 0.1.0

- Fixed package shape so the declared entrypoint is `dist/index.js`.
- Split library builds from example builds.
- Added OpenAPI-derived TypeScript request and response types from `wsapi_v2.json`.
- Added explicit supported and unsupported operation lists.
- Implemented all operations in `wsapi_v2.json`.
- Replaced terminal-driven auth with typed auth states and a prompt adapter interface.
- Added fake-transport unit tests for SDK usability and request construction.
- Added strict TypeScript and Vitest coverage gates.
- Moved OpenPGP usage to dev/example scope and kept runtime dependencies narrow.
