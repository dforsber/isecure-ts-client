# Changelog

## [1.1.0](https://github.com/dforsber/isecure-ts-client/compare/isecure-ts-client-v1.0.1...isecure-ts-client-v1.1.0) (2026-06-20)


### Features

* support browser bundlers ([33d3b89](https://github.com/dforsber/isecure-ts-client/commit/33d3b89333e042060f9bc681a8ab5ec938feeb89))

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
