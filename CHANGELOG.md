# Changelog

All notable changes to this project will be documented in this file.

## 0.1.6

- fix npm Trusted Publishing metadata by normalizing `package.json` `repository.url` to the exact GitHub repository URL expected by npm
- update the GitHub release publish workflow to use a modern Node runtime compatible with npm's current trusted publishing requirements
- retain the existing release verification flow, including full test, build, and integration validation before publish

## 0.1.5

- merge the Dependabot Vitest 4 upgrade after reconciling the paired `vitest` and `@vitest/coverage-v8` updates into one green PR
- stabilize GitHub Actions coverage accounting for Vitest 4 by excluding barrel-only re-export files from thresholds and marking CLI entrypoint-only branches that are only exercised out-of-process
- keep the full CI matrix green on the upgraded toolchain, including typecheck, unit coverage, and Docker-backed integration tests

## 0.1.4

- fix the GitHub Actions coverage path for package version injection so CI retains 100% statement, line, and branch coverage
- switch build-time version injection to an environment slot that is directly testable under Vitest while preserving the generated header behavior

## 0.1.3

- fix generated file headers so the emitted `Package version` matches the installed package version instead of a stale hardcoded value
- normalize golden snapshots and add regression coverage for version resolution and packed-install header output
- add a GitHub Actions publish workflow for npm Trusted Publishing via GitHub Releases

## 0.1.2

- normalize the published npm `bin` path to avoid npm auto-correct removing the executable entry during publish

## 0.1.1

- fixed package executable routing so `provider = "prisma-sqlmodel-gen"` works directly with `prisma generate`
- added a packed-install regression test to prevent the CLI entrypoint from being invoked as the Prisma generator

## 0.1.0

- Initial public release of `prisma-sqlmodel-gen`
- Prisma 7 custom generator and standalone CLI
- PostgreSQL and MySQL schema support
- strict diagnostics for unsupported constructs
- deterministic Python `SQLModel` emission
- docker-backed Postgres and MySQL integration tests
- Prisma-query to SQLModel-query parity coverage for a complex Postgres fixture
