# prisma-sqlmodel-gen

[![npm version](https://img.shields.io/npm/v/prisma-sqlmodel-gen)](https://www.npmjs.com/package/prisma-sqlmodel-gen)
[![CI](https://github.com/ganesh-rao/prisma-sqlmodel-gen/actions/workflows/ci.yml/badge.svg)](https://github.com/ganesh-rao/prisma-sqlmodel-gen/actions/workflows/ci.yml)

Generate Python `SQLModel` table models from a Prisma schema.

## Who needs this?

Use this package if your TypeScript app uses Prisma, but another Python service needs matching `SQLModel` models for the same database. It is for teams that want Prisma to stay as the single source of truth instead of hand-maintaining the same schema twice.

## What it does

`prisma-sqlmodel-gen` reads your Prisma schema file and generates Python `SQLModel` classes from it. It works from the schema file itself, so it does not need to inspect a live database.

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
- Node 22+
- Python 3.11+
- `SQLModel 0.0.38`

Datasource targets:

- PostgreSQL
- MySQL

Validation matrix:

- Python 3.11 + PostgreSQL + `SQLModel 0.0.38`
- Python 3.12 + PostgreSQL + `SQLModel 0.0.38`
- Python 3.12 + MySQL + `SQLModel 0.0.38`

Generated artifacts:

- `models.py`
- `__init__.py`

Mode:

- strict generation with hard failures for unsupported constructs
- deterministic output intended for commit-and-review workflows

## Supported features

Fully supported relational-schema features:

- mapped tables and columns via `@@map` and `@map`
- PostgreSQL `@@schema`
- enums
- PostgreSQL scalar lists and enum lists
- explicit one-to-one and one-to-many relations
- explicit many-to-many via join model
- implicit many-to-many via synthesized `PrismaImplicitLink_*` models
- relation `map`, `onDelete`, and `onUpdate`
- named/composite foreign keys
- named indexes and unique constraints
- MySQL index `length`
- index `sort` where SQLAlchemy can represent it directly
- `@updatedAt`
- defaults such as `autoincrement()`, `uuid()`, `now()`, and `dbgenerated(...)` when they map cleanly

Feature matrix:

| Feature | Status |
| --- | --- |
| `@map` / `@@map` | Supported |
| `@@schema` on PostgreSQL | Supported |
| `@id` | Supported |
| `@@id` composite keys | Supported |
| `@unique` / `@@unique` | Supported |
| `@@index` basic indexes | Supported |
| PostgreSQL `@@index(..., type: BTree|Hash|SpGist|Brin|Gin)` | Supported |
| Prisma enums | Supported |
| PostgreSQL scalar lists | Supported |
| PostgreSQL enum lists | Supported |
| Prisma `Json` on PostgreSQL | Supported as `JSONB` |
| Explicit one-to-one | Supported |
| Explicit one-to-many | Supported |
| Explicit many-to-many via join model | Supported |
| Implicit many-to-many | Supported via synthesized link model |
| Multiple named relations between same model pair | Supported |
| Self-relations | Supported |
| Relation `map` / `onDelete` / `onUpdate` | Supported |
| Composite foreign keys | Supported |
| `@updatedAt` | Supported |
| PostgreSQL native types used by Prisma SQL schemas | Supported where mapped directly |
| MySQL native types used by Prisma SQL schemas | Supported where mapped directly |
| MySQL index `length` | Supported |
| Index `sort` | Supported where mapped directly |
| `autoincrement()` | Supported |
| `uuid()` | Supported |
| `now()` | Supported |
| `dbgenerated(...)` | Supported where SQLAlchemy server defaults can represent it |

Supported with provider limitations:

| Feature | Status |
| --- | --- |
| Scalar lists | PostgreSQL only |
| Enum lists | PostgreSQL only |
| `@@schema` | PostgreSQL only |
| Dialect native types | Limited to PostgreSQL/MySQL direct SQLAlchemy mappings |

Intentionally unsupported non-isomorphic features:

| Feature | Behavior |
| --- | --- |
| `relationMode = "prisma"` | Hard fail |
| `@ignore` / `@@ignore` | Hard fail |
| `Unsupported(...)` scalar fields | Hard fail |
| `cuid()` / `ulid()` / `nanoid()` defaults | Hard fail |
| PostgreSQL operator classes / expression-style indexes | Hard fail |
| Advanced index algorithms other than supported PostgreSQL `BTree|Hash|SpGist|Brin|Gin` | Hard fail |
| Providers outside PostgreSQL / MySQL | Hard fail |
| Features that need Python-only metadata absent from Prisma | Out of scope |

## Known limitations

The generator stays in strict mode by default. If a Prisma feature cannot be represented 1:1 in SQLModel/SQLAlchemy metadata or ORM behavior, generation fails instead of degrading silently.

Examples:

- scalar lists outside PostgreSQL
- enum lists outside PostgreSQL
- advanced PostgreSQL index forms such as operator classes or unsupported custom index algorithms
- provider-specific features outside PostgreSQL/MySQL scope
- Prisma-client-only behaviors such as `relationMode = "prisma"` or `@ignore`

## Diagnostics

Failures include:

- machine-readable diagnostic codes
- model and field context
- source line and column when discovered from the schema text
- a short remediation suggestion when one is available

Example:

```text
ERROR UNSUPPORTED_ADVANCED_INDEX (User.value) [line 7, col 3]:
Prisma index field modifier 'ops' does not map 1:1 to generated SQLModel metadata.
Suggestion: Use only supported sort/length modifiers or manage the advanced index manually in migrations.
```

## Troubleshooting

- `UNSUPPORTED_CLIENT_SIDE_DEFAULT`
  Replace client-side defaults such as `cuid()` with `uuid()` or a database-generated default.
- `UNSUPPORTED_ADVANCED_INDEX`
  Keep unsupported operator classes or expression-style indexes in Prisma migrations instead of generated SQLModel metadata. Supported PostgreSQL `type: BTree`, `Hash`, `SpGist`, `Brin`, and `Gin` indexes are generated directly.
- `PYTHON_FIELD_NAME_COLLISION`
  Rename Prisma fields that collapse to the same Python identifier after sanitization.
- stale output in `--check`
  Run `prisma generate` again and commit the regenerated Python files.

## Python runtime notes

If you use a different `SQLModel` version, treat it as unvalidated until you run this project's integration suite against that version.

The generated code is validated against `SQLModel 0.0.38` on Python 3.11+ with the SQLAlchemy 2.x dependency range that `SQLModel 0.0.38` resolves.

Your Python application still needs to install its own runtime dependencies, for example:

```bash
pip install "sqlmodel==0.0.38" psycopg[binary]
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

- `src/bin.ts` package executable that routes Prisma generator invocations to the generator entrypoint and manual commands to the standalone CLI
- `src/generator.ts` Prisma generator entrypoint
- `src/cli.ts` standalone CLI
- `src/ir/*` normalized schema IR exports
- `src/compat/*` compatibility and diagnostics exports
- `src/emit/python/*` Python emission exports
- `src/map/*` Prisma schema parsing and mapping exports

## Notes

- This generator currently emits table models only.
- It does not emit `Create`, `Update`, or `Read` DTO classes.
