# Changelog

All notable changes to this project will be documented in this file.

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
