# Changelog

All notable changes to this project will be documented in this file.

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
