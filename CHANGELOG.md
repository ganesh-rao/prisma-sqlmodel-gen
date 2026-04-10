# Changelog

All notable changes to this project will be documented in this file.

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
