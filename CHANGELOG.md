# Changelog

All notable changes to this project will be documented here. The project uses
[Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- optional `locale` on catalog items. `title` and `primaryKeyword` collisions
  are now compared within a locale, so translated variants that share a title
  or a target keyword are no longer reported as duplicate identity. `route`,
  `slug`, and `canonical` stay global, because two items cannot share one
  address whatever locale they declare.
- optional `canonical` on catalog items, indexed as a fifth identity dimension
  with `NEW_CANONICAL_COLLISION`. Comparison lowercases scheme and host and
  drops the fragment, and preserves path case.
- `INVALID_LOCALE_TYPE`, `UNSAFE_LOCALE`, `INVALID_CANONICAL_TYPE`, and
  `UNSAFE_CANONICAL` blockers for declared values that cannot be used.
- exported `normalizeContentLocale`, `isValidContentLocale`, and
  `normalizeContentCanonical`.

### Changed

- a baseline written before the `canonical` dimension existed loads unchanged;
  its missing entries read as no accepted debt rather than as a malformed
  baseline. The baseline schema is unchanged.

## [Unreleased]

### Added

- Dependency-free content identity library and CLI.
- Deterministic baselines for route, slug, title, and primary-keyword collisions.
- Daily, seven-day, and thirty-day publication-cadence limits.
- Monotonic retirement of resolved collision pairs and publication debt.
- Synthetic fixtures, tests, TypeScript declarations, and project governance.
- An approval-gated release workflow for verified, checksummed GitHub release
  artifacts built from immutable version tags.

## [0.1.0] - 2026-08-24

### Added

- Initial public release extracted and generalized from owned Edilec website
  tooling. The package is not currently published to npm.

[Unreleased]: https://github.com/edilec/content-identity-auditor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/edilec/content-identity-auditor/releases/tag/v0.1.0
