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

As of the initial open-source release, `npm audit` reports unresolved advisories in transitive dependencies:

- `@mrleebo/prisma-ast` pulls in a vulnerable `chevrotain` / `lodash-es` chain
- current npm registry data does not provide a clean upgrade path beyond the latest published `@mrleebo/prisma-ast`
- Prisma-related audit entries currently point to semver-incompatible downgrade suggestions and should be reviewed manually before acting on them

Current project posture:

- no known direct remote-execution issue in project-authored code
- no runtime network server surface inside this package
- dependencies are reviewed before release, and unresolved advisories are documented rather than ignored silently

If an upstream fix becomes available, updating away from the vulnerable parser chain should be treated as a release priority.
