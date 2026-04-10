# prisma-sqlmodel-gen v0.1.0

Initial public release of `prisma-sqlmodel-gen`.

## Highlights

- Prisma 7 custom generator for emitting Python `SQLModel` table models
- standalone CLI with `--check` mode for CI drift detection
- schema-driven generation from Prisma schema and DMMF with no database introspection
- PostgreSQL and MySQL support
- strict diagnostics for unsupported Prisma constructs
- deterministic generated output for commit-and-review workflows

## Supported features

- `@map` and `@@map`
- `@id`, `@unique`, `@@unique`, and `@@index`
- explicit one-to-one and one-to-many relations
- explicit many-to-many via join models
- multiple named relations between the same model pair
- self-relations
- Prisma enums
- PostgreSQL and MySQL native types where Prisma exposes direct schema metadata
- supported defaults including `autoincrement()`, `uuid()`, `now()`, and supported `dbgenerated(...)` cases

## Validation

- unit, golden, and integration tests are in place
- docker-backed integration coverage for PostgreSQL and MySQL
- Prisma-query vs SQLModel-query parity test for a complex PostgreSQL schema
- 100% coverage for project-authored runtime code in `src/**/*.ts` excluding the type-only file already excluded from coverage

## Known limitations

- implicit Prisma many-to-many relations hard-fail
- Prisma client-side defaults such as `cuid()`, `ulid()`, and `nanoid()` hard-fail
- Prisma `Unsupported` scalar fields hard-fail
- scalar lists and enum lists outside PostgreSQL hard-fail
- features requiring Python-only metadata that is not represented in Prisma are out of scope for v1

## Links

- npm: https://www.npmjs.com/package/prisma-sqlmodel-gen
- repository: https://github.com/ganesh-rao/prisma-sqlmodel-gen
- issues: https://github.com/ganesh-rao/prisma-sqlmodel-gen/issues
