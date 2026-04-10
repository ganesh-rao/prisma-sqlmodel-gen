# prisma-sqlmodel-gen

[![npm version](https://img.shields.io/npm/v/prisma-sqlmodel-gen)](https://www.npmjs.com/package/prisma-sqlmodel-gen)
[![CI](https://github.com/ganesh-rao/prisma-sqlmodel-gen/actions/workflows/ci.yml/badge.svg)](https://github.com/ganesh-rao/prisma-sqlmodel-gen/actions/workflows/ci.yml)

Generate Python `SQLModel` table models from a Prisma schema.

## What it does

`prisma-sqlmodel-gen` is a Prisma 7 custom generator written in TypeScript. It reads `schema.prisma`, uses Prisma's DMMF plus Prisma schema parsing, and emits Python `SQLModel` table models without database introspection.

The generator is schema-driven. It does not inspect a live database.

## Quick start

Install:

```bash
npm install -D prisma-sqlmodel-gen
```

npm package:

- https://www.npmjs.com/package/prisma-sqlmodel-gen

Add a generator block to `schema.prisma`:

```prisma
generator sqlmodel {
  provider            = "prisma-sqlmodel-gen"
  output              = "../python_app/generated"
  moduleName          = "models.py"
  emitInit            = "true"
  strict              = "true"
  headerComment       = "true"
  sqlmodelImportStyle = "sqlmodel"
}
```

Run generation:

```bash
npx prisma generate
```

Or verify generated files in CI:

```bash
prisma-sqlmodel-gen --schema ./prisma/schema.prisma --output ./python_app/generated --check
```

## Recommended workflow

```json
{
  "scripts": {
    "db:migrate": "prisma migrate dev && prisma generate",
    "db:deploy": "prisma migrate deploy && prisma generate"
  }
}
```

`--check` verifies that committed generated files match the current Prisma schema and exits nonzero on drift.

## Minimal example

Prisma schema:

```prisma
datasource db {
  provider = "postgresql"
}

generator sqlmodel {
  provider = "prisma-sqlmodel-gen"
  output   = "./generated/sqlmodel"
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique @db.VarChar(255)

  @@map("users")
}
```

Representative generated output:

```python
class User(SQLModel, table=True):
    __tablename__ = "users"
    id: int | None = Field(
        sa_column=Column(Integer(), primary_key=True, nullable=False, autoincrement=True),
        default=None,
    )
    email: str = Field(sa_column=Column(VARCHAR(255), unique=True, nullable=False))
```

## Support matrix

Runtime targets:

- Prisma 7
- Node 20+
- Python 3.11+
- current `SQLModel`

Datasource targets:

- PostgreSQL
- MySQL

Validation matrix:

- Python 3.11 + PostgreSQL
- Python 3.12 + PostgreSQL
- Python 3.12 + MySQL

Generated artifacts:

- `models.py`
- `__init__.py`

Mode:

- strict generation with hard failures for unsupported constructs
- deterministic output intended for commit-and-review workflows

## Supported features

Supported patterns include:

- mapped tables and columns via `@@map` and `@map`
- enums
- explicit one-to-one and one-to-many relations
- explicit join models
- named indexes and unique constraints
- PostgreSQL and MySQL native types where Prisma exposes them directly
- defaults such as `autoincrement()`, `uuid()`, `now()`, and `dbgenerated(...)` when they map cleanly

Feature matrix:

| Feature | Status |
| --- | --- |
| `@map` / `@@map` | Supported |
| `@id` | Supported |
| `@@id` explicit join-model composite keys | Supported |
| `@unique` / `@@unique` | Supported |
| `@@index` | Supported |
| Prisma enums | Supported |
| Explicit one-to-one | Supported |
| Explicit one-to-many | Supported |
| Explicit many-to-many via join model | Supported |
| Multiple named relations between same model pair | Supported |
| Self-relations | Supported |
| PostgreSQL native types used by Prisma SQL schemas | Supported where mapped directly |
| MySQL native types used by Prisma SQL schemas | Supported where mapped directly |
| `autoincrement()` | Supported |
| `uuid()` | Supported |
| `now()` | Supported |
| `dbgenerated(...)` | Supported where SQLAlchemy server defaults can represent it |

## Known limitations

These are intentional hard-fail or out-of-scope cases for `0.1.x`:

- implicit Prisma many-to-many relations
- Prisma client-side defaults such as `cuid()`, `ulid()`, and `nanoid()`
- Prisma `Unsupported` scalar fields
- scalar lists outside PostgreSQL
- enum lists outside PostgreSQL
- features that require Python-only metadata not represented in Prisma
- non-PostgreSQL / non-MySQL providers

Unsupported matrix:

| Feature | Behavior |
| --- | --- |
| Implicit many-to-many | Hard fail |
| `Unsupported(...)` scalar fields | Hard fail |
| `cuid()` / `ulid()` / `nanoid()` defaults | Hard fail |
| SQLite / SQL Server / CockroachDB / MongoDB | Hard fail |
| Features that need Python-only metadata absent from Prisma | Out of scope for v1 |

## Diagnostics

Failures include:

- machine-readable diagnostic codes
- model and field context
- source line and column when discovered from the schema text
- a short remediation suggestion when one is available

Example:

```text
ERROR UNSUPPORTED_IMPLICIT_MANY_TO_MANY (Post.tags) [line 12, col 3]:
Implicit many-to-many Prisma relations are not supported in SQLModel output.
Suggestion: Define an explicit join model and replace the implicit many-to-many relation with two one-to-many relations.
```

## Troubleshooting

- `UNSUPPORTED_IMPLICIT_MANY_TO_MANY`
  Replace the implicit relation with an explicit join model.
- `UNSUPPORTED_CLIENT_SIDE_DEFAULT`
  Replace client-side defaults such as `cuid()` with `uuid()` or a database-generated default.
- `PYTHON_FIELD_NAME_COLLISION`
  Rename Prisma fields that collapse to the same Python identifier after sanitization.
- stale output in `--check`
  Run `prisma generate` again and commit the regenerated Python files.

## Python runtime notes

The generated code assumes a current `SQLModel` release compatible with Python 3.11+ and SQLAlchemy 2.x style imports used by SQLModel.

Your Python application still needs to install its own runtime dependencies, for example:

```bash
pip install sqlmodel sqlalchemy psycopg[binary]
```

Choose the database driver appropriate for your environment.

## Development

Useful commands:

```bash
npm ci
npm run check
npm test
npm run test:coverage
npm run test:integration
npm run test:all
```

## Repository

- Homepage: https://github.com/ganesh-rao/prisma-sqlmodel-gen
- Issues: https://github.com/ganesh-rao/prisma-sqlmodel-gen/issues

## Security

Run `npm audit` before release. At the time of the initial public release, there are unresolved upstream advisories in transitive dependencies used by `@mrleebo/prisma-ast`, and npm audit currently suggests semver-incompatible Prisma downgrades for some advisories. See [SECURITY.md](./SECURITY.md) for the current project stance.

## Project structure

- Generated Python modules are fully owned by the generator.
- Handwritten Python business logic should live in separate wrapper modules.
- Regenerate after every successful schema migration or schema change.

Internal source layout:

- `src/generator.ts` Prisma generator entrypoint
- `src/cli.ts` standalone CLI
- `src/ir/*` normalized schema IR exports
- `src/compat/*` compatibility and diagnostics exports
- `src/emit/python/*` Python emission exports
- `src/map/*` Prisma schema parsing and mapping exports

## Notes

- This generator currently emits table models only.
- It does not emit `Create`, `Update`, or `Read` DTO classes.
