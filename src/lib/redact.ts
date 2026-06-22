/**
 * Redaction utilities for debug logging. Two layers of defense:
 *
 *  1. A denylist of sensitive field names (secrets, credentials, one-time
 *     codes, and PII) is always stripped — case-insensitive.
 *  2. A value heuristic strips token-like strings (JWTs, long base64 blobs,
 *     the `base64|timestamp|uuid` challenge) regardless of their field name, so
 *     a newly added sensitive field cannot leak before the denylist catches up.
 *
 * `"strict"` mode flips to an allowlist: every field is redacted unless its
 * name is explicitly known to be safe. Use it when logs may reach a low-trust
 * sink and you would rather lose diagnostic detail than risk a leak.
 */
export type RedactionMode = "balanced" | "strict";

export const REDACTED = "[redacted]";

const SENSITIVE_FIELDS = new Set(
  [
    // secrets & credentials
    "password",
    "encrypted",
    "accesstoken",
    "idtoken",
    "apikey",
    "x-api-key",
    "authorization",
    "session",
    "code",
    "chresp",
    "challenge",
    "privatekey",
    "encprivatekey",
    "encryptedprivatekey",
    "pgpkey",
    // personally identifiable information
    "email",
    "extemail",
    "phone",
    "name",
  ].map((field) => field.toLowerCase()),
);

/**
 * Field names known to carry no secret or PII. Only consulted in `"strict"`
 * mode, where anything outside this set is redacted.
 */
const SAFE_FIELDS = new Set(
  [
    "responsecode",
    "responsetext",
    "requestid",
    "status",
    "filetype",
    "filereference",
    "filetimestamp",
    "targetid",
    "serviceid",
    "pgpkeyid",
    "pgpkeypurpose",
    "adminmode",
    "datamode",
    "export",
    "certname",
    "issuer",
    "subject",
    "serial",
    "expires",
    "bank",
    "mode",
  ].map((field) => field.toLowerCase()),
);

const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const LONG_TOKEN_PATTERN = /^[A-Za-z0-9+/=_-]{40,}$/;
const CHALLENGE_PATTERN = /^[A-Za-z0-9+/=]+\|\d+\|[0-9a-f-]+$/i;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi;
// Phone numbers carry a country-code prefix (`+`, or `%2B` once URL-encoded into
// a path), so this stays precise and won't match plain numeric ids.
const PHONE_PATTERN = /(?:%2B|\+)\d{6,}/gi;

function looksSecret(value: string): boolean {
  return JWT_PATTERN.test(value) || LONG_TOKEN_PATTERN.test(value) || CHALLENGE_PATTERN.test(value);
}

function shouldRedactKey(key: string, mode: RedactionMode): boolean {
  const lower = key.toLowerCase();
  if (mode === "strict") {
    return !SAFE_FIELDS.has(lower);
  }
  return SENSITIVE_FIELDS.has(lower);
}

/** Deep-redacts a request/response value, returning a safe-to-log copy. */
export function redactValue(value: unknown, mode: RedactionMode = "balanced"): unknown {
  if (typeof value === "string") {
    return looksSecret(value) ? REDACTED : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, mode));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = shouldRedactKey(key, mode) ? REDACTED : redactValue(entry, mode);
    }
    return result;
  }
  return value;
}

/** Masks email addresses and phone numbers embedded in a request URL (the account/phone paths). */
export function redactUrl(url: string): string {
  return url.replace(EMAIL_PATTERN, REDACTED).replace(PHONE_PATTERN, REDACTED);
}
