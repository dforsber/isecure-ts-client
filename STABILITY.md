# API Stability & Versioning

`isecure-ts-client` follows [Semantic Versioning](https://semver.org/).

## What the public API is

The supported surface is everything exported from the package root (`isecure-ts-client`) and the `./wsapi-types` subpath. Anything not exported from those entry points — including files under `src/lib/` imported by deep path, and the generated `src/generated/` types beyond the published `./wsapi-types` — is internal and may change at any time.

## What each release type means

- **Patch** (`x.y.Z`) — bug fixes and internal changes that do not alter the public types or documented behavior.
- **Minor** (`x.Y.z`) — backwards-compatible additions: new methods, new optional options, new fields on result objects, and new members added to discriminated unions (e.g. a new `AuthState.status`). Consumers that exhaustively `switch` over a union should include a `default` branch to stay forward-compatible.
- **Major** (`X.y.z`) — breaking changes: removing or renaming exports, changing method signatures, removing union members, or changing documented runtime behavior.

### Notes on union evolution

Adding a new `status` to `AuthState`, a new `AuthErrorReason`, or a new error subclass is treated as a **minor** change. If you narrow on these unions, handle unknown variants defensively. Removing or repurposing an existing variant is a **major** change.

## Errors

The error hierarchy (`ISecureError` and subclasses) is part of the public API. New subclasses may be added in minor releases; existing classes and their documented fields are stable within a major version.

## Runtime support

Node `>= 22` and modern browser bundlers are supported (see the README "Runtime Support" section). Dropping a supported runtime is a breaking change.

## Deprecation

Before removal in a major release, an export is marked `@deprecated` in a minor release with a documented replacement wherever practical.
