# Releasing

Releases package a reviewed, immutable `v*` tag. The workflow creates a GitHub
release with the npm-compatible tarball, its SHA-256 checksum, and the exact
source commit. It does not publish the package to npm.

## Maintainer checklist

1. Merge the version and changelog update through a pull request.
2. Confirm CI and CodeQL pass on `main`.
3. Create and push an annotated tag matching `package.json`.
4. Run the `Release` workflow with that existing tag.
5. Approve the protected `release` environment only after verification passes.
6. Run the packaged CLI against the synthetic example and verify its checksum.

Release tags are protected against update and deletion. Correct a failed
release with a new version instead of moving an existing tag.
