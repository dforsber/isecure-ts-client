/**
 * SDK version, sent as part of the `User-Agent` on Node runtimes for
 * server-side diagnostics. Bumped automatically by Release Please (see the
 * `extra-files` entry in release-please-config.json via the annotation below),
 * so it stays in lockstep with `package.json`; a unit test asserts they match.
 */
export const SDK_VERSION = "1.0.2"; // x-release-please-version

/** Product token used in the outbound `User-Agent` header. */
export const USER_AGENT = `isecure-ts-client/${SDK_VERSION}`;
