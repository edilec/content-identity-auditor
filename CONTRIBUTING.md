# Contributing

Contributions that improve correctness, documentation, compatibility, or
maintainability are welcome. Open an issue before a large API, schema, or
baseline-semantics change so the migration and maintenance cost can be reviewed.

## Prepare a focused change

1. Create a branch from `main`.
2. Keep the change limited to one clear problem.
3. Add tests for every behavior change and regression fix.
4. Preserve deterministic ordering and fail-closed baseline validation.
5. Update the README, declarations, and changelog when public behavior changes.
6. Run `npm run check` on Node.js 22 or newer.
7. Explain verification and remaining limitations in the pull request.

Do not commit production catalogs, deployed baselines, credentials, private
URLs, analytics, customer information, or other sensitive data. Reproductions
must use the small synthetic fixture format already present in `test/fixtures/`.

## Compatibility

Changes to normalization, schemas, default publication limits, collision
dimensions, or ratchet behavior can invalidate existing baselines. Such changes
must use a new version identifier, document migration behavior, and include
tests showing that older baselines fail with an actionable error.

## Provenance and licence

Contributors must have the right to submit their work. Preserve required
copyright, licence, NOTICE, and attribution records. Identify generated code,
templates, and substantial third-party sources accurately.

Contributions are submitted under the repository's MIT License.

## Security

Suspected vulnerabilities must follow [SECURITY.md](./SECURITY.md), not a
public issue or pull request.
