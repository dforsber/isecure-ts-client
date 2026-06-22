import type { LogLevel, Mode } from "./api-types.js";

const MODES: readonly Mode[] = ["admin", "data"];
const LOG_LEVELS: readonly LogLevel[] = ["error", "warn", "info", "debug", "silent"];

export function isMode(value: unknown): value is Mode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && (LOG_LEVELS as readonly string[]).includes(value);
}

/**
 * Narrows an untrusted value (e.g. an environment variable) to a {@link Mode},
 * throwing a clear error instead of letting an invalid string flow into request
 * URLs as an unchecked cast.
 */
export function parseMode(value: unknown): Mode {
  if (isMode(value)) {
    return value;
  }
  throw new TypeError(`Invalid ISECure mode ${JSON.stringify(value)}; expected one of ${MODES.join(", ")}`);
}

/** Narrows an untrusted value to a {@link LogLevel}, throwing on anything else. */
export function parseLogLevel(value: unknown): LogLevel {
  if (isLogLevel(value)) {
    return value;
  }
  throw new TypeError(`Invalid log level ${JSON.stringify(value)}; expected one of ${LOG_LEVELS.join(", ")}`);
}
