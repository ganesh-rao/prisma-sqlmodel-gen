# Contributing

## Development setup

Requirements:

- Node.js 20+
- npm
- Docker
- `uv`

Install dependencies:

```bash
npm ci
```

Useful commands:

```bash
npm run check
npm test
npm run test:coverage
npm run test:integration
npm run test:all
```

## Scope

This project is intentionally strict. If a Prisma construct cannot be emitted with deterministic SQLModel behavior, prefer a hard failure with a clear diagnostic over a lossy fallback.

## Pull requests

- Keep generated output deterministic.
- Add or update tests for every behavior change.
- Preserve 100% coverage for `src/**/*.ts` excluding the type-only file already excluded by configuration.
- Do not silently broaden support for unsupported Prisma features without explicit tests and documentation updates.

## Commit and release expectations

- Update `README.md` if user-facing behavior changes.
- Update `CHANGELOG.md` for notable release-visible changes.
- Run `npm run test:all` before opening a release PR.
