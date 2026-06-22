/**
 * SDK version, sent as part of the `User-Agent` on Node runtimes for
 * server-side diagnostics. Kept in sync with `package.json` by the release
 * process (see CHANGELOG); a unit test asserts they match.
 */
export const SDK_VERSION = "1.0.2";

/** Product token used in the outbound `User-Agent` header. */
export const USER_AGENT = `isecure-ts-client/${SDK_VERSION}`;
