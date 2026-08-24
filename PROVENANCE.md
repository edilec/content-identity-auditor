# Provenance

## Ownership basis

Content Identity Auditor was extracted and generalized by Edilec Private
Limited from code owned and used in the Edilec website repository.

The source modules at the time of extraction were:

- `content/editorial/seo-topic-identity.mjs`
- `content/editorial/seo-topic-identity.test.mjs`
- `content/editorial/audit-content-identity.mjs`

The extraction was prepared on 2026-08-24. It retains the core ideas of
deterministic normalization, collision ceilings, publication-window limits,
and monotonic debt retirement. Naming, schemas, record shapes, CLI behavior,
configuration, tests, examples, and documentation were generalized for use
outside the source website.

## Deliberately excluded

The repository does not contain:

- Edilec production articles or metadata;
- a production collision baseline or its counts;
- private product, customer, analytics, or infrastructure data;
- Edilec-specific canonical routes or title suffixes;
- deployment credentials, environment files, or release configuration; or
- unrelated website source code.

All committed catalogs are small synthetic fixtures created for this project.

## Third-party code

No third-party implementation was copied into this extraction. GitHub Actions
used by the repository remain separately licensed third-party software and are
referenced by immutable commit SHA in workflow files.

## Maintainer

Edilec Private Limited is the project owner and initial maintainer. See
[MAINTAINERS.md](./MAINTAINERS.md) for the current maintenance boundary.
