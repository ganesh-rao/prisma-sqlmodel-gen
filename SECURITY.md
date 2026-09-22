# Security Policy

## Supported versions

Only the latest released version is considered supported for security fixes.

## Reporting

Please report suspected vulnerabilities privately to the project maintainer before opening a public issue.

Include:

- affected version
- reproduction steps
- impact assessment
- any proposed mitigation

## Dependency advisories

As of 2.0.0, the package ships zero runtime dependencies, so there is no runtime transitive audit surface. The remaining `npm audit` scope is dev-only (TypeScript, Vitest, tsup); review it before each release.

Earlier advisories in `@mrleebo/prisma-ast` (`chevrotain` / `lodash-es` chain) and Prisma-related entries no longer apply: those dependencies were removed with the v7 frontend.

Current project posture:

- no known direct remote-execution issue in project-authored code
- no runtime network server surface inside this package
- dependencies are reviewed before release, and unresolved advisories are documented rather than ignored silently

If an upstream fix becomes available, updating away from the vulnerable parser chain should be treated as a release priority.
