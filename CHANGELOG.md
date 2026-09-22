# Changelog

All notable changes to this project will be documented in this file.

## 2.0.0

- add a Prisma 8 frontend that reads `contract.json` (`schemaVersion` 1, `sql`/`postgres` target) instead of Prisma schema text: contract parsing and validation, contract-to-IR normalization, and extended Python emission for checks, text/integer/native enums, value objects, and table inheritance variants
- go PostgreSQL-only: remove the MySQL renderer, provider branches, and fixtures (the 0.x line keeps Prisma 7 with schema files and MySQL)
- remove the v7 frontend entirely: DMMF normalization, Prisma AST parsing, compatibility diagnostics, the `prisma generate` generator entrypoint, and the bin dispatcher
- make the CLI contract-only and fully offline: `--contract` replaces `--schema`/`--generator`, no Prisma engines are loaded, `--output` defaults next to the contract file, and `--check` verifies committed files against the contract
- rewire the package surface: `generateSqlModel`/`checkSqlModelGeneration` take contract input, the package root exports the programmatic library, the `bin` entry points at the CLI, and the `./bin`/`./generator` subpaths are removed
- simplify configuration to typed overrides via `resolveGeneratorConfig(overrides)`; generator-block config discovery is gone
- ship zero runtime dependencies after dropping `@prisma/*`, `@mrleebo/prisma-ast`, and related transitive advisories
- render PostgreSQL `uuid` columns as `PG_UUID` (imported as `UUID as PG_UUID`) so the `uuid.UUID` annotation is never shadowed, and import `desc`/`asc` for sorted unique constraints that render as indexes
- replace the v7 integration suite with an offline packed-install suite plus a docker-backed online suite that validates generated models against live PostgreSQL 16 on Python 3.12 with current `sqlmodel`
- validate the frontend against real `prisma contract emit` output, including execution generator ids, numeric literal coercion, ambiguous counterpart pairing, and temporal-string columns
- preserve named unique constraints end to end: composite and named single-column uniques keep their contract names, with named single-column uniques rendered as table-level `UniqueConstraint(..., name=...)` instead of silently dropping the name
- add a real-world acceptance fixture ported from a Prisma 7 schema (v7 source, v8 port, and emitted contract for 4 models with gin indexes and named uniques) plus a live-PostgreSQL roundtrip proving the DDL, including gin access methods and exact constraint names
- document the verified Prisma 7 to 8 port rules, including the required `Json` to `Jsonb` move and the Prisma 8 RC's missing index sort-direction spelling
- keep the repository bars green: typecheck, 100% unit coverage thresholds, and both integration suites

## 0.3.1

- fix CLI `--check` stability by hashing the normalized schema definition instead of raw Prisma schema text, so standalone checks match files generated through Prisma's generator protocol
- make CLI generator discovery robust for direct `node ./.../generator.js` provider blocks as well as the package provider string
- add packed-install end-to-end regressions proving `prisma generate` followed by `prisma-sqlmodel-gen --check` succeeds for both supported invocation styles

## 0.3.0

- support PostgreSQL `@@index(..., type: BTree|Hash|SpGist|Brin|Gin)` by carrying Prisma index algorithms through normalization and emitting SQLAlchemy `postgresql_using=...` index metadata
- allow plain PostgreSQL `type: Gin` indexes for JSON-backed schemas while continuing to hard-fail operator classes and expression-style indexes that are not emitted 1:1
- render generic Prisma `Json` as PostgreSQL `JSONB` so generated SQLModel metadata matches Prisma's PostgreSQL connector semantics and works with GIN-indexed JSON fields
- document the expanded PostgreSQL index support and explicit PostgreSQL `Json` -> `JSONB` behavior in the README support matrix

## 0.2.2

- regenerate `package-lock.json` with npm 11.11.0 so the lockfile matches the stricter package-entry expectations of GitHub's Node 24 runners during `npm ci`
- include the missing optional `@emnapi/core` and `@emnapi/runtime` package records required by the current runner toolchain
- ship the same workflow and packaging fixes from current `main` under a fresh release tag instead of reusing the failed `0.2.1` tag

## 0.2.1

- regenerate and commit the synchronized `package-lock.json` metadata after raising the Node engine requirement so GitHub Actions `npm ci` stays in sync with `package.json`
- disable `setup-uv` dependency caching in CI and publish workflows because this repository does not ship a Python lockfile or requirements file, avoiding persistent cache warnings in GitHub Actions
- keep the release workflow aligned to the current Node 24 / npm 11 toolchain used by the repository

## 0.2.0

- expand Prisma-to-SQLModel feature coverage beyond the original core relational subset, including PostgreSQL `@@schema`, referential actions, named/composite foreign keys, implicit many-to-many synthesis, PostgreSQL scalar and enum lists, richer native-type mapping, and `@updatedAt` support
- add strict hard-fail diagnostics for advanced or non-isomorphic Prisma features such as `relationMode = "prisma"`, ignore markers, client-side ID generators, unsupported scalar fields, and advanced index/operator-class/expression forms that cannot be emitted 1:1
- broaden validation with richer generator fixtures, Docker-backed PostgreSQL/MySQL integration tests, Prisma-vs-SQLModel parity tests, and maintained 100% source coverage
- pin the documented and tested Python ORM target to `SQLModel 0.0.38`, simplify the README introduction for new users, and align CI/runtime expectations to the current Prisma dependency tree
- change CI to run on version tag pushes and use Node 24 for GitHub Actions validation

## 0.1.7

- patch the remaining transitive GitHub Dependabot and `npm audit` findings with npm `overrides` rather than waiting on upstream direct dependency releases
- force `@hono/node-server` to `1.19.13` under Prisma's dependency tree and `lodash-es` to `4.18.1` under `chevrotain` / `@mrleebo/prisma-ast`
- keep the project validation bar unchanged by re-running the full typecheck, unit, coverage-sensitive, and Docker-backed integration suite after the lockfile refresh

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
